-- ============================================================================
-- MENU MASTER NG
-- 0067: self-serve billing -- every Paystack event reaches the right account,
--       a plan change switches the old subscription off, and an owner's
--       cancel or card request is recorded
--
-- Requires: 0001-0066 applied (0066_trial_gate: 118 policies, 102 fn_*).
-- Authority: the owner's decisions D5 (plan changes are self-serve, no double
-- charge) and D6 (a Cancel plan button), 18 Oct 2026; trial-plan billing
-- designs DB1 (event attribution), DB4 (supersede) and EF2 (cancel, card).
--
-- THE DEFECTS THIS CORRECTS
--
--   1. ATTRIBUTION. fn_billing_apply finds the account only from
--      data.metadata.account_id. Our checkout puts that on the TRANSACTION,
--      so charge.success carries it. Paystack's subscription.create,
--      subscription.not_renew, subscription.disable, invoice.payment_failed
--      and the renewal charges do not. They fail as 'no_account', so:
--        * provider_subscription_code is usually never stored;
--        * a customer who stops renewing stays 'active' for good, because
--          entitlement admits 'active' on status alone (0032);
--        * a failed renewal never reaches past_due.
--
--   2. A SECOND SUBSCRIPTION. Paystack has no plan-switch call. Moving to the
--      other plan opens a new subscription and nothing switches the old one
--      off, so the customer is charged for both every month. And once the old
--      one IS switched off, its not_renew and disable events would cancel the
--      account and forfeit the founding price.
--
-- WHAT THIS ADDS
--   billing_superseded               the old Paystack subscription each time a
--                                    new one replaces it, and whether it has
--                                    been switched off at Paystack yet
--   fn_billing_find_account          who an event belongs to: metadata, then
--                                    the stored subscription code, then a
--                                    replaced code, then a customer code held
--                                    by exactly ONE account. Exact matches
--                                    only. A customer code on two accounts
--                                    fails closed ('ambiguous_customer').
--   fn_billing_claim_switch_offs     the webhook's work list: replaced codes
--                                    still to switch off, never a current one
--   fn_billing_record_switch_off     the webhook records what Paystack said
--   fn_billing_record_manage_request paystack-manage records an owner's cancel
--                                    or card-link request in
--                                    subscription_changes
--
-- WHAT THIS CHANGES
--   fn_billing_apply                 uses fn_billing_find_account; marks any
--                                    event for a replaced subscription
--                                    'ignored' (it changes nothing); records
--                                    the replacement; catches up a
--                                    subscription.create that arrived before
--                                    its own charge.success (same customer
--                                    code, within the hour, nothing older)
--   fn_apply_billing_side_effects    only a payment may REPLACE the stored
--                                    subscription or customer code; any other
--                                    event may only fill an empty one
--   fn_admin_scan + its kind check   three new alerts: an old subscription not
--                                    switched off after an hour, a replaced
--                                    subscription that took a payment, and a
--                                    cancel Paystack never confirmed
--   subscriptions                    a one-time, exact recovery of a missing
--                                    provider_subscription_code from the
--                                    account's own subscription.create events
--
-- WHAT THIS DOES NOT DO
--   No Paystack call. The webhook and paystack-manage make those. No policy.
--   No change to entitlement: 'cancelled' stays entitled until
--   current_period_end (0032), which is what keeps a cancelled plan on until
--   the end of the month already paid. The founding price is still forfeited
--   only by the 0050 rule (a real, current subscription disabled); a replaced
--   subscription's disable is ignored, so a founder who changes plan keeps it.
--
-- Shared Paystack Plans are never mutated to move a subscriber (D13 7.4.A).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN IN AN EXECUTOR THAT DOES NOT HONOUR TRANSACTION CONTROL
-- ---------------------------------------------------------------------------
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0067 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Do NOT run 0067 here. Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

-- the starting counts, so the self-check can prove what 0067 itself added
create temp table _mm0067_before on commit drop as
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') as fns,
       (select count(*) from pg_policies where schemaname='public') as pols;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT
--
-- The three bodies 0067 replaces must be exactly the ones it was written
-- against (0051, 0050, 0055). These are checked on every database, fresh or
-- not: a later change to any of them must be merged here first, not silently
-- overwritten. The production baseline (0066 applied, 102 fn_*, 118 policies)
-- is checked only on a database that was not built from scratch.
-- ---------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int;
begin
  if (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace
       and proname='fn_billing_apply') is distinct from '82a53c707c3597dd86b3c3b1b7d634a9' then
    raise exception '0067 preflight FAILED: fn_billing_apply is not the 0051 body (md5 %). '
      'Something changed it since 0051; merge that change into 0067 first.',
      (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname='fn_billing_apply');
  end if;
  if (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace
       and proname='fn_apply_billing_side_effects') is distinct from 'd7921e3bf95357d70b8062f85e1754b5' then
    raise exception '0067 preflight FAILED: fn_apply_billing_side_effects is not the 0050 body.';
  end if;
  if (select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace
       and proname='fn_admin_scan') is distinct from '8d402ad907dcd23906a333f70217a1f9' then
    raise exception '0067 preflight FAILED: fn_admin_scan is not the 0055 body.';
  end if;
  if to_regclass('public.billing_superseded') is not null then
    raise exception '0067 preflight FAILED: billing_superseded already exists; 0067 is applied.';
  end if;
  if exists (select 1 from pg_proc where pronamespace='public'::regnamespace
              and proname in ('fn_billing_find_account','fn_billing_claim_switch_offs',
                              'fn_billing_record_switch_off','fn_billing_record_manage_request')) then
    raise exception '0067 preflight FAILED: a 0067 function already exists.';
  end if;
  if to_regclass('public.subscription_changes') is null then
    raise exception '0067 preflight FAILED: subscription_changes (0031) is missing.';
  end if;

  if coalesce(current_setting('mm.fresh_install', true), '') = 'on' then
    raise notice '0067 preflight: fresh install, production baseline counts skipped.';
    return;
  end if;

  select fns, pols into v_fns, v_pols from _mm0067_before;
  if to_regprocedure('public.fn_require_entitled(uuid, boolean)') is null then
    raise exception '0067 preflight FAILED: fn_require_entitled is missing. Apply 0066_trial_gate first.';
  end if;
  if v_pols <> 118 then
    raise exception '0067 preflight FAILED: policy count is %, expected 118.', v_pols;
  end if;
  if v_fns <> 102 then
    raise exception '0067 preflight FAILED: fn_* count is %, expected 102 (0066 applied).', v_fns;
  end if;
  raise notice '0067 preflight OK: 0066 applied, 118 policies, 102 fn_*.';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. THE REPLACED SUBSCRIPTIONS
--
-- One row per Paystack subscription that a newer one replaced. The webhook
-- reads it to switch the old one off at Paystack, and fn_billing_apply reads
-- it to ignore the old one's later events.
--
-- account_id is ON DELETE SET NULL on purpose: if an account is deleted while
-- its old subscription is still live at Paystack, the switch-off must still
-- happen. Subscription codes are unique across our Paystack integration.
-- ---------------------------------------------------------------------------
create table billing_superseded (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid references accounts(id) on delete set null,
  subscription_code  text not null,
  customer_code      text,
  plan_id            text,               -- the plan the old subscription was on
  replaced_by_code   text,               -- the subscription that replaced it, once known
  replaced_by_event  uuid references billing_events(id) on delete set null,
  recorded_at        timestamptz not null default now(),
  attempts           integer not null default 0,
  last_attempt_at    timestamptz,
  disabled_at        timestamptz,        -- set once Paystack confirms it is off
  outcome            text,
  last_error         text,
  constraint ux_billing_superseded_code unique (subscription_code),
  constraint ck_billing_superseded_outcome
    check (outcome is null or outcome in ('disabled','already_off','failed')),
  constraint ck_billing_superseded_code check (length(subscription_code) > 0)
);

create index ix_fk_billing_superseded_account_id on billing_superseded (account_id);
create index ix_fk_billing_superseded_replaced_by_event on billing_superseded (replaced_by_event);
create index ix_billing_superseded_pending on billing_superseded (recorded_at)
  where disabled_at is null;

comment on table billing_superseded is
  'Paystack subscriptions replaced by a newer one on the same account (a plan '
  'change or a fresh start). The webhook switches each one off at Paystack and '
  'records the outcome; fn_billing_apply ignores their later events, so an old '
  'subscription can never cancel the account or forfeit the founding price. '
  'Written only by service-context functions.';

-- Like billing_events: RLS on, no client policy, written only by functions.
alter table billing_superseded enable row level security;
-- Supabase's default privileges give service_role everything on a new table;
-- it needs only to read this one (fn_* do the writing).
revoke all on billing_superseded from public, anon, authenticated, service_role;
grant select on billing_superseded to service_role;

-- ---------------------------------------------------------------------------
-- 3. WHO AN EVENT BELONGS TO
--
-- Exact matches only, in this order, and the first that answers wins:
--   1. data.metadata.account_id      our checkout put it there
--   2. the stored subscription code  data.subscription_code, or
--                                    data.subscription.subscription_code on
--                                    the invoice events
--   3. a replaced subscription code  billing_superseded (the event is then
--                                    ignored by fn_billing_apply)
--   4. the customer code             data.customer.customer_code, only when
--                                    exactly ONE account holds it
-- A code held by two accounts is never guessed between: 'ambiguous_customer'
-- or 'ambiguous_subscription', and the event stays failed_permanent for a
-- person to look at. Wrongly attributing an event could cancel someone
-- else's business.
-- ---------------------------------------------------------------------------
create or replace function fn_billing_find_account(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_meta text; v_account uuid; v_sub text; v_cust text; v_ids uuid[];
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_find_account is a service-context function'
      using errcode = '42501';
  end if;

  -- 1. metadata
  v_meta := nullif(btrim(coalesce(p_payload #>> '{data,metadata,account_id}','')), '');
  if v_meta is not null then
    begin
      v_account := v_meta::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('error','bad_metadata');
    end;
    return jsonb_build_object('account_id', v_account, 'via', 'metadata');
  end if;

  -- 2. the subscription code we hold
  v_sub := coalesce(nullif(p_payload #>> '{data,subscription_code}',''),
                    nullif(p_payload #>> '{data,subscription,subscription_code}',''));
  if v_sub is not null then
    select array_agg(s.account_id) into v_ids
      from subscriptions s where s.provider_subscription_code = v_sub;
    if cardinality(v_ids) = 1 then
      return jsonb_build_object('account_id', v_ids[1], 'via', 'subscription_code');
    elsif cardinality(v_ids) > 1 then
      return jsonb_build_object('error','ambiguous_subscription');
    end if;

    -- 3. a subscription code that a newer one replaced
    select array_agg(distinct b.account_id) into v_ids
      from billing_superseded b
     where b.subscription_code = v_sub and b.account_id is not null;
    if cardinality(v_ids) = 1 then
      return jsonb_build_object('account_id', v_ids[1], 'via', 'superseded_code');
    end if;
  end if;

  -- 4. the customer code, held by exactly one account
  v_cust := nullif(p_payload #>> '{data,customer,customer_code}','');
  if v_cust is not null then
    select array_agg(s.account_id) into v_ids
      from subscriptions s where s.provider_customer_code = v_cust;
    if cardinality(v_ids) = 1 then
      return jsonb_build_object('account_id', v_ids[1], 'via', 'customer_code');
    elsif cardinality(v_ids) > 1 then
      return jsonb_build_object('error','ambiguous_customer');
    end if;
  end if;

  return jsonb_build_object('error','no_account');
end;
$fn$;

revoke all on function fn_billing_find_account(jsonb) from public, anon, authenticated;
grant execute on function fn_billing_find_account(jsonb) to service_role;

comment on function fn_billing_find_account(jsonb) is
  'Service context only. Which account a Paystack event belongs to: metadata, '
  'then the stored subscription code, then a replaced code, then a customer '
  'code held by exactly one account. Exact matches only; a code on two '
  'accounts returns an ambiguous_* error instead of a guess.';

-- ---------------------------------------------------------------------------
-- 4. THE PAYMENT BOUNDARY, with the codes protected
--
-- The 0050 body, with one change (marked): only a payment (status 'active')
-- may REPLACE the stored subscription or customer code. Any other event may
-- only fill an empty one. Before, a past_due or cancelling event attributed
-- by customer code could overwrite the current subscription code with some
-- other subscription's, and the old one would never be switched off.
-- The invoice events carry the code under data.subscription, now read too.
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
  v_cust text; v_sub text; v_not_renew boolean; v_paid boolean;
begin
  if not fn_is_service_context() then
    raise exception 'fn_apply_billing_side_effects is a service-context function'
      using errcode = '42501';
  end if;

  select * into v_plan from plans where id = p_plan_id;

  v_cust := nullif(p_payload #>> '{data,customer,customer_code}','');
  v_sub  := coalesce(nullif(p_payload #>> '{data,subscription_code}',''),
                     nullif(p_payload #>> '{data,subscription,subscription_code}',''),
                     nullif(p_payload #>> '{data,plan,subscription_code}',''));

  v_not_renew := (p_payload ->> 'event') = 'subscription.not_renew';
  v_paid      := p_status = 'active';

  update subscriptions
     set price_kobo                 = coalesce(v_plan.price_kobo, price_kobo),
         -- >>> 0067: only a payment replaces a code; anything else fills a gap
         provider_customer_code     = case when v_paid then coalesce(v_cust, provider_customer_code)
                                           else coalesce(provider_customer_code, v_cust) end,
         provider_subscription_code = case when v_paid then coalesce(v_sub, provider_subscription_code)
                                           else coalesce(provider_subscription_code, v_sub) end,
         -- <<<
         cancel_at_period_end       = case when v_not_renew then true
                                           when p_status = 'active' then false
                                           else cancel_at_period_end end,
         founding_price_active      = case when v_plan.price_tier = 'founding'
                                            and p_status in ('active','trialing')
                                           then true else founding_price_active end
   where account_id = p_account_id;

  if v_plan.price_tier = 'founding' and p_status in ('active','trialing') then
    v_seq := fn_confirm_founder_slot(p_account_id);
    if v_seq is null then
      raise notice '0050: account % paid founding pricing with no slot held', p_account_id;
    end if;
  end if;

  -- THE LAPSE (0050, unchanged). A cancellation still inside the paid period
  -- (not_renew) is NOT a lapse. fn_billing_apply never gets here for a
  -- replaced subscription, so only the current one can forfeit.
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
-- 5. fn_billing_apply
--
-- The 0051 body, with the marked 0067 blocks: attribution, ignoring a
-- replaced subscription, recording a replacement, and the arrival-order
-- catch-up. Event mapping, plan resolution, the paid period and the
-- failed_transient / failed_permanent discipline are unchanged.
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
  v_find jsonb; v_via text; v_evsub text; v_replaces text;
  v_cur_plan text; v_cur_sub text; v_cur_cust text; v_sub_id uuid;
  v_replaced text; v_catchup jsonb := '[]'::jsonb; v_cust_now text; c record;
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

  -- >>> 0067: WHO IT BELONGS TO
  v_account := e.account_id;
  v_via := case when v_account is not null then 'event' end;
  if v_account is null then
    v_find := fn_billing_find_account(e.payload);
    if v_find ? 'error' then
      update billing_events
         set status='failed_permanent', last_error_code = v_find->>'error',
             last_error = case v_find->>'error'
               when 'no_account' then
                 'no account matches this event: no account_id in metadata, and '
                 'neither its subscription code nor its customer code is on file'
               when 'ambiguous_customer' then
                 'this customer code is on more than one account; refusing to guess which'
               when 'ambiguous_subscription' then
                 'this subscription code is on more than one account; refusing to guess which'
               when 'bad_metadata' then
                 'metadata.account_id is not a valid account id'
               else v_find->>'error' end
       where id=e.id;
      return jsonb_build_object('status','failed_permanent','reason', v_find->>'error');
    end if;
    v_account := (v_find->>'account_id')::uuid;
    v_via := v_find->>'via';
  end if;

  v_evsub := coalesce(nullif(e.payload #>> '{data,subscription_code}',''),
                      nullif(e.payload #>> '{data,subscription,subscription_code}',''));
  v_replaces := nullif(e.payload #>> '{data,metadata,replaces}','');

  select s.plan_id, s.provider_subscription_code, s.provider_customer_code
    into v_cur_plan, v_cur_sub, v_cur_cust
    from subscriptions s where s.account_id = v_account;

  -- A REPLACED SUBSCRIPTION CHANGES NOTHING. Its not_renew and disable come
  -- from our own switch-off; a failed renewal on it is not this account's
  -- problem any more. Status, period, plan and the founding price stay as
  -- they are. A payment on it means someone was charged twice: it is kept as
  -- 'superseded_charge' and fn_admin_scan raises it for a refund.
  if v_evsub is not null and v_evsub is distinct from v_cur_sub
     and exists (select 1 from billing_superseded b
                  where b.subscription_code = v_evsub and b.account_id = v_account) then
    update billing_events
       set status='ignored', applied_at=now(), account_id=v_account,
           last_error_code = case when e.event_type = 'charge.success'
                                  then 'superseded_charge' else 'superseded' end,
           last_error = 'subscription '||v_evsub||' was replaced by a newer one on this '
                        'account; this event changes nothing'
     where id=e.id;
    return jsonb_build_object('status','ignored','reason','superseded',
                              'account_id', v_account, 'subscription_code', v_evsub);
  end if;
  -- <<<

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

  -- >>> 0067: A RENEWAL OF A REPLACED SUBSCRIPTION THAT NAMES NO SUBSCRIPTION
  -- A renewal charge carries the customer and the plan but no subscription
  -- code. If it is for a plan this account has left (a replaced subscription
  -- on that plan exists) it is the old subscription charging, not a plan
  -- change back: ignore it and raise it, never flip the plan.
  if e.event_type = 'charge.success' and v_via = 'customer_code'
     and v_plan is distinct from v_cur_plan
     and exists (select 1 from billing_superseded b
                  where b.account_id = v_account and b.plan_id = v_plan) then
    update billing_events
       set status='ignored', applied_at=now(), account_id=v_account,
           last_error_code = 'superseded_charge',
           last_error = 'a charge on plan '||v_plan||', which this account has left; '
                        'it is the replaced subscription charging, so it changes nothing'
     where id=e.id;
    return jsonb_build_object('status','ignored','reason','superseded',
                              'account_id', v_account, 'plan_id', v_plan);
  end if;
  -- <<<

  v_ref    := coalesce(e.reference, e.provider_event_id);

  -- THE PERIOD THE CUSTOMER PAID FOR (0051, unchanged)
  v_period := nullif(e.payload #>> '{data,next_payment_date}','')::timestamptz;

  if v_period is null and e.event_type = 'charge.success' then
    v_paid := nullif(e.payload #>> '{data,paid_at}','')::timestamptz;
    if v_paid is null then
      v_paid := nullif(e.payload #>> '{data,paidAt}','')::timestamptz;
    end if;
    v_period := coalesce(v_paid, e.received_at) + interval '1 month';
  end if;

  if e.event_type = 'invoice.payment_failed' then
    v_period := null;
  end if;

  begin
    v_res := fn_set_subscription_plan(v_account, v_plan, v_status, v_period, v_ref);

    -- >>> 0067: A NEW SUBSCRIPTION REPLACES THE OLD ONE
    -- Only a payment does this. The old code is recorded BEFORE the side
    -- effects overwrite it, so the webhook can switch it off. Two signals:
    --   * the event names a different subscription than the one on file
    --     (subscription.create of the new one), or
    --   * our checkout said so: metadata.replaces is the code on file. That
    --     arrives on the charge, which is usually first, and keeps the old
    --     customer code. The old code stays current until the new
    --     subscription's own code arrives, and a current code is never
    --     switched off.
    if v_status = 'active' and v_cur_sub is not null
       and ((v_evsub is not null and v_evsub <> v_cur_sub)
         or (v_replaces is not null and v_replaces = v_cur_sub)) then
      insert into billing_superseded (account_id, subscription_code, customer_code,
                                      plan_id, replaced_by_code, replaced_by_event)
      values (v_account, v_cur_sub, v_cur_cust, v_cur_plan,
              case when v_evsub <> v_cur_sub then v_evsub end, e.id)
      on conflict (subscription_code) do update
         set replaced_by_code = coalesce(billing_superseded.replaced_by_code,
                                         excluded.replaced_by_code)
       where billing_superseded.account_id is not distinct from excluded.account_id;
      v_replaced := v_cur_sub;

      -- the history row is written once, at the moment the code on file moves
      if v_evsub is not null and v_evsub <> v_cur_sub then
        select id into v_sub_id from subscriptions where account_id = v_account;
        insert into subscription_changes (subscription_id, account_id, change_kind,
               previous_values, new_values, change_source, reason, effective_at)
        values (v_sub_id, v_account, 'subscription_replaced',
                jsonb_build_object('provider_subscription_code', v_cur_sub, 'plan_id', v_cur_plan),
                jsonb_build_object('provider_subscription_code', v_evsub, 'plan_id', v_plan),
                'provider',
                'A new Paystack subscription replaced the old one. The old one is '
                'switched off so the customer is not charged for both.',
                clock_timestamp());
      end if;
    end if;
    -- <<<

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

  -- >>> 0067: ARRIVAL-ORDER CATCH-UP
  -- Paystack sends charge.success (which carries our metadata) and
  -- subscription.create (which does not) within seconds of each other, in
  -- either order. When the subscription.create of a NEW customer is processed
  -- first, nothing on file matches it yet and it fails as 'no_account'. Once
  -- the charge has stored the customer code, that event is applied here.
  -- Narrow on purpose: subscription.create only, the exact customer code now
  -- on this account, received within the last hour, a few at most. Older
  -- 'no_account' events are only ever re-applied by hand, one at a time,
  -- after review (DEPLOY_0067).
  if v_status = 'active' then
    select provider_customer_code into v_cust_now from subscriptions where account_id = v_account;
    if v_cust_now is not null then
      for c in
        select be.id from billing_events be
         where be.status = 'failed_permanent' and be.last_error_code = 'no_account'
           and be.event_type = 'subscription.create' and be.signature_valid
           and be.received_at > now() - interval '1 hour'
           and be.payload #>> '{data,customer,customer_code}' = v_cust_now
         order by be.received_at
         limit 3
      loop
        begin
          update billing_events
             set status='processing', attempts = attempts + 1
           where id = c.id and status = 'failed_permanent';
          v_catchup := v_catchup || jsonb_build_array(
                         jsonb_build_object('event_id', c.id) || fn_billing_apply(c.id));
        exception when others then
          raise warning '0067 catch-up of billing event % failed: %', c.id, sqlerrm;
        end;
      end loop;
    end if;
  end if;
  -- <<<

  return jsonb_build_object('status','applied','account_id',v_account,
                            'plan_id',v_plan,'period_end',v_period, 'via', v_via,
                            'replaced', v_replaced, 'caught_up', v_catchup,
                            'subscription',v_res,'billing',v_side);
end;
$fn$;

revoke all on function fn_billing_apply(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE SWITCH-OFF WORK LIST AND ITS RECORD (called by paystack-webhook)
--
-- claim: up to p_limit replaced subscriptions still to switch off, each
--   claimed (attempts + 1, last_attempt_at = now) under SKIP LOCKED so two
--   deliveries never work the same row at once. A code that is CURRENT on
--   any account is never handed out. Retries back off (2, 4, 8 ... 256
--   minutes) and stop after 20 attempts; the alert stays open until a person
--   records the outcome.
-- record: what Paystack said. 'disabled' or 'already_off' closes the row and
--   is refused for a code that is current anywhere. A later 'failed' never
--   reopens a closed row, so retries are idempotent.
-- ---------------------------------------------------------------------------
create or replace function fn_billing_claim_switch_offs(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_out jsonb;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_claim_switch_offs is a service-context function'
      using errcode = '42501';
  end if;

  with c as (
    select b.id
      from billing_superseded b
     where b.disabled_at is null
       and b.attempts < 20
       and not exists (select 1 from subscriptions s
                        where s.provider_subscription_code = b.subscription_code)
       and (b.last_attempt_at is null
            or b.last_attempt_at < now() - interval '1 minute' * power(2, least(b.attempts, 8)))
     order by b.recorded_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  ), u as (
    update billing_superseded b
       set attempts = b.attempts + 1, last_attempt_at = now()
      from c where b.id = c.id
    returning b.subscription_code, b.account_id, b.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('subscription_code', u.subscription_code,
                                               'account_id', u.account_id,
                                               'attempt', u.attempts)), '[]'::jsonb)
    into v_out from u;
  return v_out;
end;
$fn$;

revoke all on function fn_billing_claim_switch_offs(integer) from public, anon, authenticated;
grant execute on function fn_billing_claim_switch_offs(integer) to service_role;

create or replace function fn_billing_record_switch_off(
  p_subscription_code text, p_outcome text, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare b billing_superseded%rowtype; v_sub_id uuid;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_record_switch_off is a service-context function'
      using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('disabled','already_off','failed') then
    raise exception 'Unknown switch-off outcome %. Use disabled, already_off or failed.',
      coalesce(quote_literal(p_outcome),'NULL') using errcode = '22023';
  end if;

  select * into b from billing_superseded
   where subscription_code = p_subscription_code for update;
  if not found then
    raise exception 'No replaced subscription % is on file', p_subscription_code
      using errcode = 'P0002';
  end if;

  if p_outcome <> 'failed' and exists (select 1 from subscriptions s
                                        where s.provider_subscription_code = p_subscription_code) then
    raise exception 'Subscription % is the current one on an account; it is never switched off here',
      p_subscription_code using errcode = '22023';
  end if;

  if b.disabled_at is not null then
    return jsonb_build_object('status','already_recorded','outcome', b.outcome);
  end if;

  if p_outcome = 'failed' then
    update billing_superseded
       set outcome = 'failed', last_error = left(coalesce(p_detail,'(no detail)'), 500)
     where id = b.id;
    return jsonb_build_object('status','recorded','outcome','failed','attempts', b.attempts);
  end if;

  update billing_superseded
     set outcome = p_outcome, disabled_at = now(),
         last_error = case when p_detail is null then last_error else left(p_detail, 500) end
   where id = b.id;

  if b.account_id is not null then
    select id into v_sub_id from subscriptions where account_id = b.account_id;
    if v_sub_id is not null then
      insert into subscription_changes (subscription_id, account_id, change_kind,
             previous_values, new_values, change_source, reason, effective_at)
      values (v_sub_id, b.account_id, 'old_subscription_switched_off',
              jsonb_build_object('subscription_code', b.subscription_code, 'plan_id', b.plan_id),
              jsonb_build_object('outcome', p_outcome),
              'system',
              case p_outcome when 'disabled'
                then 'The replaced Paystack subscription was switched off, so it will not charge again.'
                else 'The replaced Paystack subscription was already off at Paystack.' end,
              clock_timestamp());
    end if;
  end if;

  return jsonb_build_object('status','recorded','outcome', p_outcome);
end;
$fn$;

revoke all on function fn_billing_record_switch_off(text, text, text) from public, anon, authenticated;
grant execute on function fn_billing_record_switch_off(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. AN OWNER'S CANCEL OR CARD REQUEST (called by paystack-manage)
--
-- paystack-manage never writes the subscription row: the webhook does that
-- when Paystack's not_renew arrives. What it does write is this history row,
-- so the request is on record even before Paystack answers, and so
-- fn_admin_scan can notice a cancel Paystack never confirmed. The caller
-- must be the account's owner; this is checked again here. The update-card
-- link itself is never stored: it carries a token.
-- ---------------------------------------------------------------------------
create or replace function fn_billing_record_manage_request(
  p_account_id uuid, p_user_id uuid, p_action text, p_outcome text,
  p_subscription_code text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare s subscriptions%rowtype; v_id uuid;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_record_manage_request is a service-context function'
      using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('cancel','card_link') then
    raise exception 'Unknown billing request %. Use cancel or card_link.',
      coalesce(quote_literal(p_action),'NULL') using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('sent','already_off','link_issued','failed') then
    raise exception 'Unknown outcome %.', coalesce(quote_literal(p_outcome),'NULL')
      using errcode = '22023';
  end if;
  if not exists (select 1 from memberships m
                  where m.account_id = p_account_id and m.user_id = p_user_id
                    and m.role = 'owner') then
    raise exception 'Only the owner of this account can change its billing'
      using errcode = '42501';
  end if;

  select * into s from subscriptions where account_id = p_account_id;
  if not found then
    raise exception 'No subscription exists for account %', p_account_id
      using errcode = 'P0002';
  end if;

  insert into subscription_changes (subscription_id, account_id, change_kind,
         previous_values, new_values, change_source, authorised_by, reason, effective_at)
  values (s.id, p_account_id,
          case p_action when 'cancel' then 'cancel_requested' else 'card_link_requested' end,
          jsonb_build_object('status', s.status, 'plan_id', s.plan_id,
                             'cancel_at_period_end', s.cancel_at_period_end,
                             'current_period_end', s.current_period_end),
          jsonb_build_object('action', p_action, 'outcome', p_outcome,
                             'subscription_code', coalesce(p_subscription_code,
                                                           s.provider_subscription_code)),
          'customer', p_user_id::text,
          case p_action
            when 'cancel' then 'The owner asked to stop renewing from the Account page.'
            else 'The owner asked for a link to update their card.' end,
          clock_timestamp())
  returning id into v_id;

  return jsonb_build_object('recorded', true, 'change_id', v_id);
end;
$fn$;

revoke all on function fn_billing_record_manage_request(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function fn_billing_record_manage_request(uuid, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. THE ALERTS
--
-- The 0055 scan, unchanged except for the marked block, and its kind check
-- with three kinds added:
--   subscription_not_switched_off   critical. A replaced subscription is still
--                                   live at Paystack an hour on: either the
--                                   switch-off keeps failing, or the new
--                                   subscription's own event never reached
--                                   us and the old code is still current.
--                                   Left alone, the customer pays twice.
--   superseded_subscription_charged critical. A replaced subscription took a
--                                   payment (last 14 days). Refund it.
--   cancel_not_confirmed            warn. An owner stopped renewing at
--                                   Paystack an hour ago and our row still
--                                   says it renews.
-- ---------------------------------------------------------------------------
alter table platform_alerts drop constraint ck_platform_alerts_kind;
alter table platform_alerts add constraint ck_platform_alerts_kind check (kind in (
  'billing_failed_permanent','billing_stuck','founder_slots_low',
  'founder_slots_exhausted','past_due_beyond_grace','subscription_no_period',
  'subscription_not_switched_off','superseded_subscription_charged','cancel_not_confirmed'));

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

  -- >>> 0067: self-serve billing
  insert into _seen
  select 'subscription_not_switched_off', b.subscription_code, 'critical',
         case when exists (select 1 from subscriptions s where s.provider_subscription_code = b.subscription_code)
              then 'An old Paystack subscription is still the one on file an hour after a new plan was paid for. '
                   'Check the new subscription reached us, then switch the old one off.'
              else 'An old Paystack subscription has not been switched off after '||b.attempts||' attempt(s). '
                   'Switch it off in the Paystack dashboard so the customer is not charged twice.' end,
         jsonb_build_object('subscription_code', b.subscription_code, 'account_id', b.account_id,
                            'plan_id', b.plan_id, 'attempts', b.attempts, 'last_error', b.last_error,
                            'recorded_at', b.recorded_at)
    from billing_superseded b
   where b.disabled_at is null and b.recorded_at < now() - interval '1 hour';

  insert into _seen
  select 'superseded_subscription_charged', e.id::text, 'critical',
         'A replaced Paystack subscription took a payment. The customer was charged twice: refund it.',
         jsonb_build_object('event_id', e.id, 'reference', e.reference, 'account_id', e.account_id,
                            'error', e.last_error, 'received_at', e.received_at)
    from billing_events e
   where e.status = 'ignored' and e.last_error_code = 'superseded_charge'
     and e.received_at > now() - interval '14 days';

  insert into _seen
  select distinct on (sc.account_id)
         'cancel_not_confirmed', sc.account_id::text, 'warn',
         'An owner stopped renewing at Paystack an hour ago, but Paystack''s confirmation has not reached us.',
         jsonb_build_object('account_id', sc.account_id, 'requested_at', sc.created_at,
                            'subscription_code', sc.new_values->>'subscription_code')
    from subscription_changes sc
    join subscriptions s on s.account_id = sc.account_id
   where sc.change_kind = 'cancel_requested' and sc.new_values->>'outcome' = 'sent'
     and sc.created_at < now() - interval '1 hour'
     and sc.created_at > now() - interval '35 days'
     and s.status = 'active' and not s.cancel_at_period_end
     and s.provider_subscription_code is not distinct from sc.new_values->>'subscription_code'
   order by sc.account_id, sc.created_at desc;
  -- <<<

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
-- 9. ONE-TIME RECOVERY OF A MISSING SUBSCRIPTION CODE
--
-- Before 0067, subscription.create almost always failed as 'no_account', so
-- a paying account usually has its customer code (from the charge) but no
-- subscription code. Without it a plan change could not switch the old
-- subscription off, and paystack-checkout refuses the change
-- ('switch_needs_support').
--
-- Exact and narrow: an account that is not on trial, has a customer code that
-- no other account shares, and no subscription code, gets the subscription
-- code of its signature-verified subscription.create events -- only when
-- they name exactly ONE subscription. Nothing else on the row moves: not the
-- status, the plan, the period or the founding price, so no old event is
-- re-applied. Each recovery is written to subscription_changes. Two or more
-- codes is left alone and counted (that customer may be paying twice; see
-- DEPLOY_0067).
-- ---------------------------------------------------------------------------
do $$
declare r record; v_done int := 0; v_multi int := 0;
begin
  for r in
    select s.id, s.account_id, s.provider_customer_code,
           array_agg(distinct be.payload #>> '{data,subscription_code}') as codes
      from subscriptions s
      join billing_events be
        on be.event_type = 'subscription.create' and be.signature_valid
       and be.payload #>> '{data,customer,customer_code}' = s.provider_customer_code
       and nullif(be.payload #>> '{data,subscription_code}','') is not null
     where s.provider_subscription_code is null
       and s.status <> 'trialing'
       and s.provider_customer_code is not null
       and (select count(*) from subscriptions s2
             where s2.provider_customer_code = s.provider_customer_code) = 1
     group by s.id, s.account_id, s.provider_customer_code
  loop
    if cardinality(r.codes) = 1 then
      update subscriptions set provider_subscription_code = r.codes[1]
       where id = r.id and provider_subscription_code is null;
      insert into subscription_changes (subscription_id, account_id, change_kind,
             previous_values, new_values, change_source, reason, effective_at)
      values (r.id, r.account_id, 'subscription_code_recovered',
              jsonb_build_object('provider_subscription_code', null),
              jsonb_build_object('provider_subscription_code', r.codes[1]),
              'system',
              '0067: the Paystack subscription code was recovered from this account''s own '
              'subscription.create event, matched by its customer code. Nothing else changed.',
              clock_timestamp());
      v_done := v_done + 1;
    else
      v_multi := v_multi + 1;
    end if;
  end loop;
  raise notice '0067 recovery: % subscription code(s) recovered; % account(s) with more than one '
               'subscription code left alone for review.', v_done, v_multi;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. SELF-CHECK
-- ---------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int; b record;
begin
  select fns, pols into b from _mm0067_before;
  select count(*) into v_fns from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_pols from pg_policies where schemaname='public';

  if v_pols <> b.pols then
    raise exception '0067 self-check FAILED: policy count moved from % to %; 0067 adds none.', b.pols, v_pols;
  end if;
  if v_fns <> b.fns + 4 then
    raise exception '0067 self-check FAILED: fn_* went from % to %, expected +4.', b.fns, v_fns;
  end if;
  if coalesce(current_setting('mm.fresh_install', true), '') <> 'on'
     and (v_fns <> 106 or v_pols <> 118) then
    raise exception '0067 self-check FAILED: expected 106 fn_* and 118 policies, found % and %.', v_fns, v_pols;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.billing_superseded'::regclass) then
    raise exception '0067 self-check FAILED: RLS is off on billing_superseded.';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='billing_superseded') then
    raise exception '0067 self-check FAILED: billing_superseded has a client policy.';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema='public' and table_name='billing_superseded'
                and grantee in ('anon','authenticated','PUBLIC')) then
    raise exception '0067 self-check FAILED: a client role holds a grant on billing_superseded.';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema='public' and table_name='billing_superseded'
                and grantee = 'service_role' and privilege_type <> 'SELECT') then
    raise exception '0067 self-check FAILED: service_role can write billing_superseded directly.';
  end if;

  if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname in ('fn_billing_find_account','fn_billing_claim_switch_offs',
                         'fn_billing_record_switch_off','fn_billing_record_manage_request',
                         'fn_billing_apply','fn_apply_billing_side_effects','fn_admin_scan')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) <> 0 then
    raise exception '0067 self-check FAILED: a billing function is reachable from the browser.';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname in ('fn_billing_find_account','fn_billing_claim_switch_offs',
                         'fn_billing_record_switch_off','fn_billing_record_manage_request')
       and p.prosecdef and 'search_path=public' = any(p.proconfig)) <> 4 then
    raise exception '0067 self-check FAILED: the four new functions are not all SECURITY DEFINER with search_path pinned.';
  end if;

  if (select prosrc from pg_proc where pronamespace='public'::regnamespace and proname='fn_billing_apply')
       not like '%fn_billing_find_account%billing_superseded%' then
    raise exception '0067 self-check FAILED: fn_billing_apply does not attribute and supersede.';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname='ck_platform_alerts_kind')
       not like '%subscription_not_switched_off%' then
    raise exception '0067 self-check FAILED: the alert kinds were not extended.';
  end if;
  if (select count(*) from founder_slots) <> 100 then
    raise exception '0067 self-check FAILED: founder_slots is no longer 100 rows.';
  end if;

  raise notice '0067 OK: events are attributed by subscription or customer code, a replaced '
               'subscription is switched off and its events ignored, owner requests are '
               'recorded; % fn_* (+4), % policies (unchanged).', v_fns, v_pols;
end
$$;
