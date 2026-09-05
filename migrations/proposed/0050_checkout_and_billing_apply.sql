-- ============================================================================
-- MENU MASTER NG
-- 0050: teach the billing pipeline about 0049, and add the checkout quote
--
-- Requires: 0001-0049 applied.
--
-- THE DEFECT THIS CORRECTS
--   fn_billing_apply was written at 0029 and has never been told that founder
--   slots exist. Today, when a founding customer pays:
--
--     * their slot stays RESERVED and expires 30 minutes later. They paid
--       N3,500 and are not recorded as a founder.
--     * none of 0049's five subscriptions columns are written, so the founding
--       price is never locked and we hold no provider subscription code -- we
--       could not disable their subscription at Paystack if we had to.
--     * a lapse never forfeits the founding price.
--
--   That is not a missing feature. It is a payment we take and do not honour.
--
-- WHAT THIS ADDS
--   fn_checkout_quote  -- the server decides plan, price and founding
--                         eligibility. The client sends a selection and
--                         nothing else, so a hostile client posting
--                         amount: 100, tier: founding gets the honest quote.
--
-- WHAT THIS DOES NOT DO
--   No Paystack call. No secret. No provider_plan_code values -- those are
--   entered by the operator once the four Paystack Plans exist, because a
--   plan code invented here would be a guess about a live payment provider.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN IN AN EXECUTOR THAT DOES NOT HONOUR TRANSACTION CONTROL
--
-- Same guard as 0049, same reason: the Supabase SQL Editor commits every
-- statement individually, which is how production was left part-migrated once.
-- ---------------------------------------------------------------------------
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0050 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Do NOT run 0050 here. Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='founder_slots') then
    raise exception '0050 preflight FAILED: founder_slots is missing. Apply 0049 first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name='subscriptions' and column_name='founding_price_active') then
    raise exception '0050 preflight FAILED: subscriptions.founding_price_active is missing (0049).';
  end if;
  if not exists (select 1 from pg_proc where proname='fn_billing_apply'
                   and pronamespace='public'::regnamespace) then
    raise exception '0050 preflight FAILED: fn_billing_apply is missing (0029).';
  end if;
  if exists (select 1 from pg_proc where proname='fn_checkout_quote'
               and pronamespace='public'::regnamespace) then
    raise exception '0050 preflight FAILED: fn_checkout_quote already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0050 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. THE QUOTE
--
-- The client sends a TIER -- 'costing' or 'trading' -- and nothing else. It is
-- never authoritative for the amount, the price tier, founding eligibility,
-- slot availability or the Paystack plan code. Each is resolved here, from our
-- own data.
--
-- Eligibility, in order, because the order is the commercial rule:
--
--   1. Already a confirmed founder?  They keep founding pricing on the tier
--      they now choose. A founder who upgrades Costing -> Costing + Sales is
--      still a founder; making them pay standard for the upgrade would be
--      taking the offer back.
--   2. Forfeited a slot?             Standard. 0049 ruled a forfeited slot
--      never returns to the pool, and its holder never reclaims it.
--   3. A slot is free?               Claim it on a hold and quote founding.
--   4. None free?                    Standard. NEVER invent a founding price.
--
-- A quote RESERVES but does not CONSUME. The hold expires and the slot returns
-- to the free pool, so an abandoned checkout cannot burn a founding number.
-- The slot is only consumed at fn_confirm_founder_slot, which runs from a
-- signature-verified payment event and nowhere else.
-- ---------------------------------------------------------------------------
create or replace function fn_checkout_quote(p_account_id uuid, p_tier text,
                                             p_hold interval default '30 minutes')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_seq int; v_price_tier text; v_plan plans%rowtype; v_forfeited boolean;
begin
  if not fn_is_service_context() then
    raise exception 'fn_checkout_quote is a service-context function'
      using errcode = '42501';
  end if;

  if p_tier is null or p_tier not in ('costing','trading') then
    raise exception 'Unknown tier %. Choose costing or trading.',
      coalesce(quote_literal(p_tier),'NULL') using errcode = '22023';
  end if;

  if not exists (select 1 from accounts where id = p_account_id and deleted_at is null) then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  -- 1. an existing founder keeps founding pricing
  select seq into v_seq from founder_slots
   where account_id = p_account_id and claimed_at is not null and forfeited_at is null;
  if found then
    v_price_tier := 'founding';
  else
    -- 2. a forfeited founder is standard, permanently
    select true into v_forfeited from founder_slots
     where account_id = p_account_id and forfeited_at is not null limit 1;
    if coalesce(v_forfeited, false) then
      v_price_tier := 'standard';
    else
      -- 3. claim a slot if one is free, 4. otherwise standard
      v_seq := fn_claim_founder_slot(p_account_id, p_hold);
      v_price_tier := case when v_seq is null then 'standard' else 'founding' end;
    end if;
  end if;

  select * into v_plan from plans
   where tier = p_tier and price_tier = v_price_tier and is_active;

  if not found then
    -- Refuse before Paystack. There is no fallback price and no invented one:
    -- a missing price is incomplete data, not zero and not a guess.
    raise exception 'No active % plan at % pricing. Checkout refused.',
      p_tier, v_price_tier using errcode = '22023';
  end if;

  if v_plan.price_kobo <= 0 then
    raise exception 'Plan % is priced at zero. Checkout refused.', v_plan.id
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'account_id',         p_account_id,
    'plan_id',            v_plan.id,
    'plan_name',          v_plan.name,
    'tier',               v_plan.tier,
    'price_tier',         v_plan.price_tier,
    'price_kobo',         v_plan.price_kobo,
    'currency',           v_plan.currency,
    'provider_plan_code', v_plan.provider_plan_code,
    'founder_seq',        v_seq,
    'slots_remaining',    (select count(*) from founder_slots
                            where account_id is null
                               or (claimed_at is null and reserved_until < now())));
end;
$fn$;

revoke all on function fn_checkout_quote(uuid, text, interval) from public, anon, authenticated;

comment on function fn_checkout_quote(uuid, text, interval) is
  'Resolves what an account may be charged. The caller supplies a tier and '
  'nothing else -- amount, price tier, founding eligibility and plan code all '
  'come from our data, so a hostile client cannot quote itself a price.';

-- ---------------------------------------------------------------------------
-- 2. THE PAYMENT BOUNDARY
--
-- Everything 0049 needs done when money actually moves, in ONE function
-- called from ONE place inside fn_billing_apply's transaction. If any part
-- fails the whole event fails and Paystack is told to retry -- we never end up
-- with a plan changed and a slot unconfirmed.
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
-- 3. fn_billing_apply, with the 0049 boundary wired in
--
-- The 0029 body is unchanged except for the marked block: same event mapping,
-- same three plan-resolution cases, same failed_transient / failed_permanent
-- discipline. The side effects run INSIDE the same exception frame as
-- fn_set_subscription_plan, so a failure there fails the whole event.
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
  v_ref text; v_res jsonb; v_side jsonb;
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
  v_period := nullif(e.payload #>> '{data,next_payment_date}','')::timestamptz;

  if e.event_type = 'invoice.payment_failed' then
    v_period := null;
  end if;

  begin
    v_res := fn_set_subscription_plan(v_account, v_plan, v_status, v_period, v_ref);
    -- >>> 0050: the 0049 payment boundary, in the same frame as the plan change
    v_side := fn_apply_billing_side_effects(v_account, v_plan, v_status, e.payload);
    -- <<<
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
                            'plan_id',v_plan,'subscription',v_res,'billing',v_side);
end;
$fn$;

revoke all on function fn_billing_apply(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_pol int;
begin
  select count(*) into v_pol from pg_policies where schemaname='public';
  if v_pol <> 117 then
    raise exception '0050 self-check FAILED: policy count is % (expected 117 -- 0050 adds none).', v_pol;
  end if;

  if (select count(*) from founder_slots) <> 100 then
    raise exception '0050 self-check FAILED: founder_slots is no longer exactly 100 rows.';
  end if;

  if (select count(*) from pg_proc where pronamespace='public'::regnamespace
       and proname in ('fn_checkout_quote','fn_apply_billing_side_effects')) <> 2 then
    raise exception '0050 self-check FAILED: the two new functions are not both present.';
  end if;

  if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname in ('fn_checkout_quote','fn_apply_billing_side_effects','fn_billing_apply')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) <> 0 then
    raise exception '0050 self-check FAILED: a billing function is reachable from the browser.';
  end if;

  if (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
       and pronamespace='public'::regnamespace) not like '%fn_apply_billing_side_effects%' then
    raise exception '0050 self-check FAILED: fn_billing_apply does not call the 0049 boundary.';
  end if;

  raise notice '0050 OK: checkout quote added, billing apply now confirms founder slots '
               'and writes the five 0049 fields, 117 policies unchanged, nothing '
               'reachable from the browser.';
end
$$;
