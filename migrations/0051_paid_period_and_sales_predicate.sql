-- ============================================================================
-- MENU MASTER NG
-- 0051: give a paid subscription its own period, and let the UI ask about Sales
--
-- Requires: 0001-0050 applied.
--
-- THE DEFECT THIS CORRECTS
--   The first real payment worked: plan, status, price, provider codes and the
--   founder slot were all set correctly. But the account still showed
--   "Access runs to 21 September 2026" -- the FREE TRIAL's end date.
--
--   Paystack's charge.success carries paid_at and a plan object. It does NOT
--   carry next_payment_date; that appears on subscription.create and the
--   invoice events. fn_billing_apply read only next_payment_date, so a
--   successful charge passed NULL to fn_set_subscription_plan, which does
--   `current_period_end = coalesce(p_period_end, current_period_end)` -- and
--   the trial's end date survived the payment.
--
--   Reproduced on the replica: plan founding_costing, status active,
--   price_kobo 350000, and current_period_end still equal to trial_ends_at.
--
--   It is not currently a loss of access -- fn_account_is_entitled admits
--   status 'active' without consulting the date. It is worse than that in one
--   way and better in another: nobody is locked out, but the customer is shown
--   a date that has nothing to do with what they bought, and every downstream
--   reader of current_period_end -- dunning, cancellation-in-period, renewal
--   reconciliation -- is working from the wrong date.
--
-- WHERE THE NEW DATE COMES FROM
--   Paystack first, always: next_payment_date when the event carries it.
--   Only when it does not, and only for a charge we know succeeded, is the
--   period derived as paid_at + one month.
--
--   That is not an invented value. V1 sells one thing -- a monthly
--   subscription -- and 0049 fixed that deliberately: "Monthly only in V1. No
--   quarterly, biannual or annual." A month from the payment IS the period
--   that was bought. The derivation is confined to charge.success so that no
--   other event can silently move a period end.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0051 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_apply_billing_side_effects'
                   and pronamespace='public'::regnamespace) then
    raise exception '0051 preflight FAILED: fn_apply_billing_side_effects is missing. Apply 0050 first.';
  end if;
  if exists (select 1 from pg_proc where proname='fn_my_has_sales'
               and pronamespace='public'::regnamespace) then
    raise exception '0051 preflight FAILED: fn_my_has_sales already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0051 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. What the signed-in user may ask about their OWN Sales entitlement
--
-- fn_account_has_sales already refuses a non-member, so this adds no access.
-- It exists so the interface never has to hold an account id, and so the page
-- and the RLS policy consult the SAME predicate. A screen that decides for
-- itself what a plan grants is a second source of truth, and it drifts.
--
-- This changes no policy. RLS remains the authority; the UI merely stops
-- offering what the database will refuse.
-- ---------------------------------------------------------------------------
create or replace function fn_my_has_sales()
returns boolean
language sql
stable
security invoker
set search_path to 'public'
as $fn$
  select coalesce(
    (select fn_account_has_sales(m.account_id)
       from memberships m
      where m.user_id = auth.uid()
      order by m.created_at
      limit 1),
    false);
$fn$;

revoke all on function fn_my_has_sales() from public, anon;
grant execute on function fn_my_has_sales() to authenticated;

comment on function fn_my_has_sales() is
  'Whether the signed-in user''s account has paid for Sales. The same predicate '
  'the thirteen Sales write policies use, so the screen and the database cannot '
  'disagree. Adds no access: fn_account_has_sales already refuses a non-member.';

-- ---------------------------------------------------------------------------
-- 2. A paid charge sets the period it paid for
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
-- 3. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0051 self-check FAILED: 0051 must add no policy.';
  end if;
  if (select count(*) from founder_slots) <> 100 then
    raise exception '0051 self-check FAILED: founder_slots is no longer 100 rows.';
  end if;
  if not exists (select 1 from pg_proc where proname='fn_my_has_sales'
                   and pronamespace='public'::regnamespace) then
    raise exception '0051 self-check FAILED: fn_my_has_sales is missing.';
  end if;
  if has_function_privilege('anon', 'fn_my_has_sales()', 'execute') then
    raise exception '0051 self-check FAILED: anon can call fn_my_has_sales.';
  end if;
  if not has_function_privilege('authenticated', 'fn_my_has_sales()', 'execute') then
    raise exception '0051 self-check FAILED: authenticated cannot call fn_my_has_sales.';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
       and pronamespace='public'::regnamespace) not like '%paid_at%' then
    raise exception '0051 self-check FAILED: fn_billing_apply does not derive a paid period.';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname in ('fn_billing_apply','fn_checkout_quote','fn_account_has_sales')
       and has_function_privilege('anon', p.oid, 'EXECUTE')) <> 0 then
    raise exception '0051 self-check FAILED: a billing function is reachable by anon.';
  end if;
  raise notice '0051 OK: a paid charge now sets its own period, fn_my_has_sales added '
               'for the interface, 117 policies unchanged, nothing new reachable by anon.';
end
$$;
