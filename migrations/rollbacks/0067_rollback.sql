-- ============================================================================
-- 0067 ROLLBACK: back to 0066.
--
-- Restores fn_billing_apply (0051 body), fn_apply_billing_side_effects (0050
-- body), fn_admin_scan and its kind check (0055), and drops billing_superseded
-- and the five 0067 functions. The bodies below are copied from those
-- migrations unchanged, and their md5 is checked at the end.
--
-- ROLL THE EDGE FUNCTIONS BACK FIRST: redeploy the previous paystack-webhook
-- and paystack-checkout, and delete paystack-manage. The 0067 webhook calls
-- fn_billing_claim_switch_offs; once this has run, that call fails (the
-- webhook carries on and logs it, but nothing is switched off any more).
--
-- WHAT IS KEPT
--   * subscription codes recovered by 0067 section 9, and codes stored by
--     events since: 0050 could have stored them too, and removing them would
--     lose what Paystack told us.
--   * every subscription_changes row 0067 wrote: the log is append-only.
--   * billing_events rows marked 'ignored' / 'superseded', and those held
--     failed_permanent as 'not_current_subscription', 'subscription_not_on_file'
--     or 'no_subscription_code': they stay as the record of what arrived, and
--     the last three stay failed_permanent in the review queue. Do not
--     re-apply one after the rollback: 0051 has none of the checks that held it.
--   * platform_alerts rows of the four 0067 kinds, if any were raised. The
--     kind check is then re-added NOT VALID, so it binds new rows and leaves
--     those as evidence.
--
-- IT REFUSES while a replaced subscription has not been switched off at
-- Paystack, because dropping billing_superseded would forget that the
-- customer is still being billed for it. Switch each one off in the Paystack
-- dashboard first (the refusal lists the codes), then either record it with
--   select fn_billing_record_switch_off('<code>', 'already_off', 'switched off by hand');
-- or, if you have recorded the codes somewhere else, run this file with
--   set mm.rollback_0067 = 'pending-switch-offs-handled';
-- at the top of the same psql session.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0067 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

create temp table _mm0067_rb_before on commit drop as
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') as fns,
       (select count(*) from pg_policies where schemaname='public') as pols;

do $$
declare v_pending text;
begin
  if to_regclass('public.billing_superseded') is null then
    raise exception '0067 rollback: billing_superseded does not exist; 0067 is not applied.';
  end if;
  select string_agg(subscription_code, ', ' order by recorded_at) into v_pending
    from billing_superseded where disabled_at is null;
  if v_pending is not null
     and coalesce(current_setting('mm.rollback_0067', true), '') <> 'pending-switch-offs-handled' then
    raise exception '0067 rollback REFUSED: these replaced Paystack subscriptions are not switched off yet: %. '
      'Switch them off in the Paystack dashboard first (see the header of this file).', v_pending;
  end if;
  if v_pending is not null then
    raise notice '0067 rollback: going ahead with pending switch-offs acknowledged: %', v_pending;
  end if;
end
$$;

drop function if exists fn_billing_find_account(jsonb);
drop function if exists fn_billing_claim_switch_offs(integer);
drop function if exists fn_billing_record_switch_off(text, text, text);
drop function if exists fn_billing_record_manage_request(uuid, uuid, text, text, text);
drop table billing_superseded;
drop function if exists fn_billing_event_sub_code(jsonb);

-- ---------------------------------------------------------------------------
-- fn_billing_apply, exactly as 0051 left it
-- ---------------------------------------------------------------------------
create or replace function fn_billing_apply(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  e billing_events%rowtype;
  v_account uuid; v_plan text; v_raw_plan text; v_status text; v_period timestamptz;
  v_ref text; v_res jsonb; v_side jsonb; v_paid timestamptz;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_apply is a service-context function'
      using errcode = '42501';
  end if;

  select * into e from billing_events where id = p_event_id;
  if not found then
    raise exception 'Billing event % does not exist', p_event_id;
  end if;

  v_status := case e.event_type
    when 'charge.success'          then 'active'
    when 'subscription.create'     then 'active'
    when 'invoice.payment_failed'  then 'past_due'
    when 'subscription.not_renew'  then 'cancelled'
    when 'subscription.disable'    then 'cancelled'
    else null end;

  if v_status is null then
    update billing_events set status='ignored', applied_at=now() where id=e.id;
    return jsonb_build_object('status','ignored','reason','unsupported event type');
  end if;

  v_account := e.account_id;
  if v_account is null then
    v_account := nullif(e.payload #>> '{data,metadata,account_id}','')::uuid;
  end if;
  if v_account is null then
    update billing_events
       set status='failed_permanent', last_error_code='no_account',
           last_error='the event carries no account_id in metadata'
     where id=e.id;
    return jsonb_build_object('status','failed_permanent','reason','no account_id');
  end if;

  v_raw_plan := coalesce(nullif(e.payload #>> '{data,plan,plan_code}',''),
                         nullif(e.payload #>> '{data,metadata,plan_id}',''));

  if v_raw_plan is null then
    select s.plan_id into v_plan from subscriptions s where s.account_id = v_account;
  else
    select p.id into v_plan
      from plans p
     where p.provider_plan_code = v_raw_plan and p.is_active;

    if v_plan is null then
      select p.id into v_plan from plans p where p.id = v_raw_plan and p.is_active;
    end if;

    if v_plan is null then
      update billing_events
         set status='failed_permanent', last_error_code='unmapped_plan_code',
             last_error='Paystack plan code '||v_raw_plan||' is not mapped to any '
                        'active plan. Set plans.provider_plan_code for it.'
       where id=e.id;
      return jsonb_build_object('status','failed_permanent',
                                'reason','unmapped plan code '||v_raw_plan);
    end if;
  end if;
  v_ref    := coalesce(e.reference, e.provider_event_id);

  -- >>> 0051: THE PERIOD THE CUSTOMER PAID FOR
  --
  -- Paystack's own date wins whenever the event carries one.
  v_period := nullif(e.payload #>> '{data,next_payment_date}','')::timestamptz;

  if v_period is null and e.event_type = 'charge.success' then
    -- charge.success never carries next_payment_date. Without this the trial's
    -- end date survives the payment, which is what the first real customer saw.
    -- V1 sells a monthly subscription and nothing else (0049), so a month from
    -- the payment is the period that was bought, not a guess at one.
    v_paid := nullif(e.payload #>> '{data,paid_at}','')::timestamptz;
    if v_paid is null then
      v_paid := nullif(e.payload #>> '{data,paidAt}','')::timestamptz;
    end if;
    -- received_at of the event is a last resort: we know the charge succeeded,
    -- so refusing to set any period would leave the stale trial date instead.
    v_period := coalesce(v_paid, e.received_at) + interval '1 month';
  end if;

  if e.event_type = 'invoice.payment_failed' then
    -- A failed renewal must NOT advance the period end: the dunning grace runs
    -- from the last date they actually paid through.
    v_period := null;
  end if;
  -- <<<

  begin
    v_res := fn_set_subscription_plan(v_account, v_plan, v_status, v_period, v_ref);
    v_side := fn_apply_billing_side_effects(v_account, v_plan, v_status, e.payload);
  exception
    when sqlstate 'P0002' or sqlstate '22023' or sqlstate '23514' then
      update billing_events
         set status='failed_permanent', last_error_code=sqlstate, last_error=sqlerrm
       where id=e.id;
      return jsonb_build_object('status','failed_permanent','error',sqlerrm);
    when others then
      update billing_events
         set status='failed_transient', last_error_code=sqlstate, last_error=sqlerrm,
             next_retry_at = now() + (interval '1 minute' * power(2, least(e.attempts,6)))
       where id=e.id;
      return jsonb_build_object('status','failed_transient','error',sqlerrm);
  end;

  update billing_events
     set status='applied', applied_at=now(), account_id=v_account
   where id=e.id;
  return jsonb_build_object('status','applied','account_id',v_account,
                            'plan_id',v_plan,'period_end',v_period,
                            'subscription',v_res,'billing',v_side);
end;
$fn$;

revoke all on function fn_billing_apply(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_apply_billing_side_effects, exactly as 0050 left it
-- ---------------------------------------------------------------------------
create or replace function fn_apply_billing_side_effects(
  p_account_id uuid, p_plan_id text, p_status text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_plan plans%rowtype; v_seq int; v_forfeited boolean := false;
  v_cust text; v_sub text; v_not_renew boolean;
begin
  if not fn_is_service_context() then
    raise exception 'fn_apply_billing_side_effects is a service-context function'
      using errcode = '42501';
  end if;

  select * into v_plan from plans where id = p_plan_id;

  v_cust := nullif(p_payload #>> '{data,customer,customer_code}','');
  v_sub  := nullif(p_payload #>> '{data,subscription_code}','');
  if v_sub is null then
    v_sub := nullif(p_payload #>> '{data,plan,subscription_code}','');
  end if;

  -- cancel_at_period_end: Paystack's subscription.not_renew means the customer
  -- has switched off renewal but is paid through the current period. That is a
  -- different fact from 'cancelled and over', and 0049 gave it a column.
  v_not_renew := (p_payload ->> 'event') = 'subscription.not_renew';

  -- price_kobo LOCKS what this subscriber pays. A later change to
  -- plans.price_kobo must not silently re-price an existing founder, so it is
  -- written once, on the way in, from the plan they actually bought.
  update subscriptions
     set price_kobo                 = coalesce(v_plan.price_kobo, price_kobo),
         provider_customer_code     = coalesce(v_cust, provider_customer_code),
         provider_subscription_code = coalesce(v_sub,  provider_subscription_code),
         cancel_at_period_end       = case when v_not_renew then true
                                           when p_status = 'active' then false
                                           else cancel_at_period_end end,
         founding_price_active      = case when v_plan.price_tier = 'founding'
                                            and p_status in ('active','trialing')
                                           then true else founding_price_active end
   where account_id = p_account_id;

  -- THE SLOT. Confirmed only here, only on a paid status, only for a founding
  -- plan. A reserved slot that is never confirmed expires and returns to the
  -- pool, which is what makes an abandoned checkout harmless.
  if v_plan.price_tier = 'founding' and p_status in ('active','trialing') then
    v_seq := fn_confirm_founder_slot(p_account_id);
    if v_seq is null then
      -- They paid the founding amount and hold no slot: their hold expired
      -- while they were on Paystack's page, or slot 100 went to someone else
      -- mid-checkout. Do NOT silently reinterpret the payment as standard and
      -- do NOT invent a slot. Honour the amount for the period paid and record
      -- the anomaly for a human -- D-20 section 4.
      raise notice '0050: account % paid founding pricing with no slot held', p_account_id;
    end if;
  end if;

  -- THE LAPSE. Forfeiture is 0049's ruling, applied at the one moment it can
  -- be observed. A cancellation that is still inside the paid period is NOT a
  -- lapse: they keep what they paid for, founding price included.
  if p_status = 'cancelled' and not v_not_renew then
    v_forfeited := fn_forfeit_founding_price(p_account_id, 'subscription ended');
  end if;

  return jsonb_build_object('founder_seq', v_seq, 'forfeited', v_forfeited,
                            'price_kobo', v_plan.price_kobo);
end;
$fn$;

revoke all on function fn_apply_billing_side_effects(uuid, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_admin_scan and its kind check, exactly as 0055 left them
-- ---------------------------------------------------------------------------
alter table platform_alerts drop constraint ck_platform_alerts_kind;
do $$
begin
  if exists (select 1 from platform_alerts
              where kind in ('subscription_not_switched_off','superseded_subscription_charged',
                             'cancel_not_confirmed','possible_double_charge')) then
    alter table platform_alerts add constraint ck_platform_alerts_kind check (kind in (
      'billing_failed_permanent','billing_stuck','founder_slots_low',
      'founder_slots_exhausted','past_due_beyond_grace','subscription_no_period')) not valid;
    raise notice '0067 rollback: platform_alerts holds 0067-kind rows; they are kept and the kind '
                 'check is NOT VALID (it binds every new row).';
  else
    alter table platform_alerts add constraint ck_platform_alerts_kind check (kind in (
      'billing_failed_permanent','billing_stuck','founder_slots_low',
      'founder_slots_exhausted','past_due_beyond_grace','subscription_no_period'));
  end if;
end
$$;

create or replace function fn_admin_scan()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_opened int := 0; v_refreshed int := 0; v_resolved int := 0;
  v_free int; v_grace interval;
  c record;
begin
  if not fn_is_service_context() then
    raise exception 'fn_admin_scan is a service-context function'
      using errcode = '42501';
  end if;

  create temp table _seen (kind text, subject text, severity text, summary text, detail jsonb) on commit drop;

  -- billing: permanent failures
  insert into _seen
  select 'billing_failed_permanent', e.id::text, 'critical',
         'A billing event will never apply: '||coalesce(e.last_error_code,'?')||' ('||coalesce(e.event_type,'?')||').',
         jsonb_build_object('event_id', e.id, 'event_type', e.event_type, 'reference', e.reference,
                            'account_id', e.account_id, 'error_code', e.last_error_code,
                            'error', e.last_error, 'received_at', e.received_at)
    from billing_events e where e.status = 'failed_permanent';

  -- billing: stuck
  insert into _seen
  select 'billing_stuck', e.id::text, 'warn',
         'A billing event has been '||e.status||' for too long ('||e.attempts||' attempt(s)).',
         jsonb_build_object('event_id', e.id, 'event_type', e.event_type, 'reference', e.reference,
                            'account_id', e.account_id, 'status', e.status, 'attempts', e.attempts,
                            'error_code', e.last_error_code, 'received_at', e.received_at)
    from billing_events e
   where (e.status in ('received','processing') and e.received_at < now() - interval '15 minutes')
      or (e.status = 'failed_transient' and e.attempts >= 3);

  -- founder slots
  select count(*) into v_free from founder_slots where account_id is null;
  if v_free = 0 then
    insert into _seen values ('founder_slots_exhausted', 'founder_slots', 'critical',
      'Every founding slot is taken. The founding price can no longer be offered.',
      jsonb_build_object('free', 0));
  elsif v_free <= 10 then
    insert into _seen values ('founder_slots_low', 'founder_slots', 'warn',
      v_free||' founding slot(s) left.', jsonb_build_object('free', v_free));
  end if;

  -- past due beyond grace: the gate has closed on a paying customer
  v_grace := fn_payment_failure_grace();
  insert into _seen
  select 'past_due_beyond_grace', s.account_id::text, 'warn',
         'A subscription is past due beyond the '||v_grace||' grace; the account can no longer record work.',
         jsonb_build_object('account_id', s.account_id, 'plan_id', s.plan_id,
                            'current_period_end', s.current_period_end, 'grace', v_grace::text)
    from subscriptions s
   where s.status = 'past_due' and s.current_period_end + v_grace < now();

  -- anomalies
  insert into _seen
  select 'subscription_no_period', a.subscription_id::text, 'warn',
         'A subscription has no period end.',
         jsonb_build_object('subscription_id', a.subscription_id, 'account_id', a.account_id, 'status', a.status)
    from v_billing_anomalies a;

  -- refresh what is still true
  update platform_alerts p
     set last_seen = now(), severity = s.severity, summary = s.summary, detail = s.detail
    from _seen s
   where p.kind = s.kind and p.subject = s.subject and p.resolved_at is null;
  get diagnostics v_refreshed = row_count;

  -- open what is new
  insert into platform_alerts (kind, subject, severity, summary, detail)
  select s.kind, s.subject, s.severity, s.summary, s.detail
    from _seen s
   where not exists (select 1 from platform_alerts p
                      where p.kind = s.kind and p.subject = s.subject and p.resolved_at is null);
  get diagnostics v_opened = row_count;

  -- resolve what has cleared (only the scan's own kinds; an admin's note is kept)
  update platform_alerts p
     set resolved_at = now(), resolution = coalesce(resolution, 'cleared: the condition is no longer present')
   where p.resolved_at is null
     and not exists (select 1 from _seen s where s.kind = p.kind and s.subject = p.subject);
  get diagnostics v_resolved = row_count;

  drop table _seen;
  return jsonb_build_object('opened', v_opened, 'refreshed', v_refreshed, 'resolved', v_resolved,
                            'open', (select count(*) from platform_alerts where resolved_at is null));
end;
$fn$;

revoke all on function fn_admin_scan() from public, anon, authenticated;
grant execute on function fn_admin_scan() to service_role;

-- ---------------------------------------------------------------------------
-- self-check
-- ---------------------------------------------------------------------------
do $$
declare b record; v_fns int; v_pols int;
begin
  select fns, pols into b from _mm0067_rb_before;
  select count(*) into v_fns from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_pols from pg_policies where schemaname='public';
  if v_pols <> b.pols then
    raise exception '0067 rollback FAILED: policy count moved from % to %.', b.pols, v_pols;
  end if;
  if v_fns <> b.fns - 5 then
    raise exception '0067 rollback FAILED: fn_* went from % to %, expected -5.', b.fns, v_fns;
  end if;
  if (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace
       and proname='fn_billing_apply') <> '82a53c707c3597dd86b3c3b1b7d634a9'
     or (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace
       and proname='fn_apply_billing_side_effects') <> 'd7921e3bf95357d70b8062f85e1754b5'
     or (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace
       and proname='fn_admin_scan') <> '8d402ad907dcd23906a333f70217a1f9' then
    raise exception '0067 rollback FAILED: a restored body is not byte-identical to its original.';
  end if;
  -- 0068 (signup contact) may be applied too; its four functions stay.
  if coalesce(current_setting('mm.fresh_install', true), '') <> 'on'
     and (v_fns <> 102 + (select count(*) from pg_proc where pronamespace='public'::regnamespace
                            and proname in ('fn_normalise_ng_phone','fn_set_my_contact','fn_admin_checkins_due','fn_admin_record_checkin',
                                       'fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback','fn_feedback_due',
                                       'fn_set_my_usage_tracking','fn_admin_live','fn_admin_activation','fn_admin_journey',
                                       'fn_admin_help','fn_admin_set_help_status','fn_usage_purge'))
          or v_pols <> 118) then
    raise exception '0067 rollback FAILED: expected 102 fn_* (106 with 0068) and 118 policies, found % and %.', v_fns, v_pols;
  end if;
  raise notice '0067 rollback OK: back at 0066; % fn_*, % policies.', v_fns, v_pols;
end
$$;
