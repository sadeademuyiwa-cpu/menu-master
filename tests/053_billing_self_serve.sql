-- ============================================================================
-- MENU MASTER NG -- tests/053_billing_self_serve.sql
--
-- Acceptance test for 0067 (self-serve billing). Run on a database with 0067
-- applied. Rolls everything back. Asserts no global fn_* or policy total:
-- POST_VERIFY_0067 does that, on the production sequence.
--
--   A. attribution: metadata, subscription code, customer code, ambiguity
--   B. a plan change: the old subscription is recorded, handed to the
--      webhook to switch off, and its later events change nothing
--   C. cancelling: not_renew keeps access to the period end; a disable of
--      the CURRENT subscription still ends it and forfeits per 0050
--   D. arrival order: subscription.create before its own charge
--   E. the service-only functions refuse clients
--   F. the owner's cancel / card request record
--   G. the three new alerts
-- ============================================================================

begin;

create temp table t53 (n int, check_name text, verdict text, detail text) on commit drop;

-- A signed-and-verified event, exactly as the edge function delivers it:
-- ingest, then apply. p_data is the whole of data, so a test can leave
-- metadata out the way Paystack's subscription and invoice events do.
create or replace function pg_temp.deliver(p_event text, p_data jsonb)
returns jsonb language plpgsql as $$
declare v_body text := gen_random_uuid()::text; v_ing jsonb;
begin
  v_ing := fn_billing_ingest(
      p_body_sha256 => encode(digest(v_body,'sha256'),'hex'),
      p_signature_valid => true, p_event_type => p_event,
      p_provider_event_id => v_body, p_reference => 'ref-'||v_body,
      p_payload => jsonb_build_object('event', p_event, 'data',
        jsonb_build_object('id', floor(random()*1e9)::bigint, 'reference', 'ref-'||v_body) || p_data),
      p_body_bytes => 10, p_source_ip => '127.0.0.1'::inet);
  return jsonb_build_object('event_id', v_ing->>'event_id')
         || fn_billing_apply((v_ing->>'event_id')::uuid);
end $$;

create or replace function pg_temp.new_account(p_label text)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); res jsonb;
begin
  insert into auth.users(id,email) values (u, p_label||'-'||left(gen_random_uuid()::text,8)||'@t53.test');
  res := fn_create_account_and_business(p_label,'K','other',u,
           p_idempotency_key => gen_random_uuid()::text);
  return (res->>'account_id')::uuid;
end $$;

create or replace function pg_temp.owner_of(p_account uuid)
returns uuid language sql as $$
  select user_id from memberships where account_id = p_account and role = 'owner' limit 1
$$;

-- a paying account, the way the first real one became one: the charge carries
-- our metadata and the customer code; Paystack's subscription.create carries
-- the subscription code and no metadata.
create or replace function pg_temp.paying(p_label text, p_tier text, p_cust text, p_sub text)
returns uuid language plpgsql as $$
declare a uuid; q jsonb;
begin
  a := pg_temp.new_account(p_label);
  q := fn_checkout_quote(a, p_tier);
  perform pg_temp.deliver('charge.success', jsonb_build_object(
    'paid_at', now()::text,
    'metadata', jsonb_build_object('account_id', a::text, 'plan_id', q->>'plan_id'),
    'customer', jsonb_build_object('customer_code', p_cust),
    'plan', jsonb_build_object('plan_code', q->>'plan_id')));
  perform pg_temp.deliver('subscription.create', jsonb_build_object(
    'subscription_code', p_sub, 'email_token', 'tok_'||p_sub, 'status', 'active',
    'customer', jsonb_build_object('customer_code', p_cust),
    'plan', jsonb_build_object('plan_code', q->>'plan_id'),
    'next_payment_date', (now() + interval '1 month')::text));
  return a;
end $$;

-- ============================================================================
-- A. ATTRIBUTION
-- ============================================================================
do $$
declare a uuid; b uuid; c uuid; r jsonb; s record; s2 record; v_period timestamptz;
begin
  -- 1-2. subscription.create with no metadata, found by its customer code
  a := pg_temp.paying('attr', 'costing', 'CUS_t53_attr', 'SUB_t53_attr');
  select * into s from subscriptions where account_id = a;
  insert into t53 values (1, 'subscription.create with no metadata is applied by its customer code',
    case when s.provider_subscription_code = 'SUB_t53_attr' and s.status = 'active' then 'PASS' else 'FAIL' end,
    coalesce(s.provider_subscription_code,'NULL')||' / '||s.status);
  insert into t53 values (2, '... and the event row names the account it was attributed to',
    case when (select count(*) from billing_events where account_id = a and status = 'applied'
                and event_type = 'subscription.create') = 1 then 'PASS' else 'FAIL' end, '');

  -- 3. not_renew carrying only a subscription code: cancelled, renewal off,
  --    period kept, still entitled
  v_period := s.current_period_end;
  r := pg_temp.deliver('subscription.not_renew', jsonb_build_object(
         'subscription_code', 'SUB_t53_attr', 'status', 'non-renewing'));
  select * into s from subscriptions where account_id = a;
  insert into t53 values (3, 'not_renew found by subscription code alone cancels at the period end',
    case when r->>'status' = 'applied' and r->>'via' = 'subscription_code'
          and s.status = 'cancelled' and s.cancel_at_period_end and s.current_period_end = v_period
         then 'PASS' else 'FAIL' end,
    coalesce(r->>'via', r->>'reason', '?')||' / '||s.status||' / cancel_at_period_end '||s.cancel_at_period_end);
  insert into t53 values (4, 'not_renew keeps access until the paid period ends',
    case when fn_account_is_entitled(a) and s.current_period_end > now() then 'PASS' else 'FAIL' end,
    'entitled '||fn_account_is_entitled(a)::text||' to '||s.current_period_end::date);

  -- 5. invoice.payment_failed names the subscription under data.subscription
  b := pg_temp.paying('dunning', 'costing', 'CUS_t53_dun', 'SUB_t53_dun');
  select current_period_end into v_period from subscriptions where account_id = b;
  r := pg_temp.deliver('invoice.payment_failed', jsonb_build_object(
         'subscription', jsonb_build_object('subscription_code', 'SUB_t53_dun'),
         'next_payment_date', (now() + interval '90 days')::text));
  select * into s from subscriptions where account_id = b;
  insert into t53 values (5, 'invoice.payment_failed found by data.subscription.subscription_code: past_due, period kept',
    case when r->>'via' = 'subscription_code' and s.status = 'past_due' and s.current_period_end = v_period
         then 'PASS' else 'FAIL' end, coalesce(r->>'via','?')||' / '||s.status);

  -- 6. nothing on file matches: no_account, failed closed
  r := pg_temp.deliver('subscription.disable', jsonb_build_object(
         'subscription_code', 'SUB_t53_nobody', 'customer', jsonb_build_object('customer_code','CUS_t53_nobody')));
  insert into t53 values (6, 'an event matching no code on file stays failed_permanent no_account',
    case when r->>'status' = 'failed_permanent' and r->>'reason' = 'no_account'
          and (select last_error_code from billing_events where id = (r->>'event_id')::uuid) = 'no_account'
         then 'PASS' else 'FAIL' end, coalesce(r->>'reason','?'));

  -- 7-8. a customer code on two accounts is never guessed between
  c := pg_temp.paying('shared1', 'costing', 'CUS_t53_shared', 'SUB_t53_sh1');
  a := pg_temp.new_account('shared2');
  perform fn_checkout_quote(a, 'costing');
  perform pg_temp.deliver('charge.success', jsonb_build_object(
    'paid_at', now()::text, 'metadata', jsonb_build_object('account_id', a::text, 'plan_id', 'founding_costing'),
    'customer', jsonb_build_object('customer_code', 'CUS_t53_shared'),
    'plan', jsonb_build_object('plan_code','founding_costing')));
  select * into s  from subscriptions where account_id = c;
  select * into s2 from subscriptions where account_id = a;
  r := pg_temp.deliver('subscription.not_renew', jsonb_build_object(
         'subscription_code', 'SUB_t53_unknown', 'customer', jsonb_build_object('customer_code','CUS_t53_shared')));
  insert into t53 values (7, 'a customer code held by two accounts fails closed: ambiguous_customer',
    case when r->>'status' = 'failed_permanent' and r->>'reason' = 'ambiguous_customer' then 'PASS' else 'FAIL' end,
    coalesce(r->>'reason','?'));
  insert into t53 values (8, '... and neither account moved',
    case when (select status from subscriptions where account_id = c) = s.status
          and (select status from subscriptions where account_id = a) = s2.status
          and not (select cancel_at_period_end from subscriptions where account_id = c)
          and not (select cancel_at_period_end from subscriptions where account_id = a)
         then 'PASS' else 'FAIL' end, s.status||' / '||s2.status);

  -- 9. the stored subscription code wins over a shared customer code
  r := pg_temp.deliver('subscription.not_renew', jsonb_build_object(
         'subscription_code', 'SUB_t53_sh1', 'customer', jsonb_build_object('customer_code','CUS_t53_shared')));
  insert into t53 values (9, 'the stored subscription code is matched before the (shared) customer code',
    case when r->>'status' = 'applied' and (r->>'account_id')::uuid = c
          and (select status from subscriptions where account_id = c) = 'cancelled'
          and (select status from subscriptions where account_id = a) = 'active'
         then 'PASS' else 'FAIL' end, coalesce(r->>'via', r->>'reason', '?'));

  -- 10. metadata still comes first, and a malformed one fails closed
  r := pg_temp.deliver('charge.success', jsonb_build_object(
         'metadata', jsonb_build_object('account_id', 'not-a-uuid'),
         'customer', jsonb_build_object('customer_code','CUS_t53_attr')));
  insert into t53 values (10, 'a malformed metadata.account_id fails closed (bad_metadata), never falls back',
    case when r->>'status' = 'failed_permanent' and r->>'reason' = 'bad_metadata' then 'PASS' else 'FAIL' end,
    coalesce(r->>'reason','?'));

  -- 11. a non-payment event never replaces the code on file
  b := pg_temp.paying('keep', 'costing', 'CUS_t53_keep', 'SUB_t53_keep');
  r := pg_temp.deliver('invoice.payment_failed', jsonb_build_object(
         'subscription', jsonb_build_object('subscription_code', 'SUB_t53_stranger'),
         'customer', jsonb_build_object('customer_code','CUS_t53_keep')));
  insert into t53 values (11, 'a failed-payment event for another subscription does not overwrite the code on file',
    case when (select provider_subscription_code from subscriptions where account_id = b) = 'SUB_t53_keep'
         then 'PASS' else 'FAIL' end,
    (select coalesce(provider_subscription_code,'NULL') from subscriptions where account_id = b));
end $$;

-- ============================================================================
-- B. A PLAN CHANGE: Costing (founder) -> Costing + Sales
-- ============================================================================
do $$
declare a uuid; q jsonb; r jsonb; s record; b record; v_claim jsonb; v_claim2 jsonb;
        v_period timestamptz; v_slot record; v_err text;
begin
  a := pg_temp.paying('mover', 'costing', 'CUS_t53_mov', 'SUB_t53_A');
  select * into s from subscriptions where account_id = a;
  insert into t53 values (20, 'the mover starts as a founder on Costing with SUB_A',
    case when s.plan_id = 'founding_costing' and s.founding_price_active
          and s.provider_subscription_code = 'SUB_t53_A' then 'PASS' else 'FAIL' end,
    s.plan_id||' / '||s.provider_subscription_code);

  -- the owner pays for the other plan; our checkout says which one it replaces
  q := fn_checkout_quote(a, 'trading');
  r := pg_temp.deliver('charge.success', jsonb_build_object(
    'paid_at', now()::text,
    'metadata', jsonb_build_object('account_id', a::text, 'plan_id', q->>'plan_id', 'replaces', 'SUB_t53_A'),
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov'),
    'plan', jsonb_build_object('plan_code', q->>'plan_id')));
  select * into s from subscriptions where account_id = a;
  select * into b from billing_superseded where subscription_code = 'SUB_t53_A';
  insert into t53 values (21, 'the charge for the new plan records SUB_A as replaced, and it stays current until SUB_B arrives',
    case when r->>'status' = 'applied' and r->>'replaced' = 'SUB_t53_A' and b.account_id = a
          and b.plan_id = 'founding_costing' and s.provider_subscription_code = 'SUB_t53_A'
          and s.plan_id = 'founding_trading' then 'PASS' else 'FAIL' end,
    s.plan_id||' / current '||s.provider_subscription_code||' / replaced '||coalesce(b.subscription_code,'none'));
  insert into t53 values (22, 'while SUB_A is still current it is NOT handed out to be switched off',
    case when fn_billing_claim_switch_offs(10) = '[]'::jsonb then 'PASS' else 'FAIL' end, '');

  -- Paystack's subscription.create for the new subscription (no metadata)
  r := pg_temp.deliver('subscription.create', jsonb_build_object(
    'subscription_code', 'SUB_t53_B', 'status', 'active',
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov'),
    'plan', jsonb_build_object('plan_code', q->>'plan_id'),
    'next_payment_date', (now() + interval '1 month')::text));
  select * into s from subscriptions where account_id = a;
  select * into b from billing_superseded where subscription_code = 'SUB_t53_A';
  insert into t53 values (23, 'SUB_B becomes the current subscription; SUB_A is marked replaced by SUB_B',
    case when s.provider_subscription_code = 'SUB_t53_B' and b.replaced_by_code = 'SUB_t53_B'
          and s.status = 'active' and s.plan_id = 'founding_trading' then 'PASS' else 'FAIL' end,
    s.provider_subscription_code||' / replaced_by '||coalesce(b.replaced_by_code,'NULL'));
  insert into t53 values (24, 'the replacement is written to subscription_changes, once',
    case when (select count(*) from subscription_changes where account_id = a
                and change_kind = 'subscription_replaced'
                and previous_values->>'provider_subscription_code' = 'SUB_t53_A'
                and new_values->>'provider_subscription_code' = 'SUB_t53_B') = 1 then 'PASS' else 'FAIL' end, '');

  -- the webhook's work list
  v_claim := fn_billing_claim_switch_offs(10);
  insert into t53 values (25, 'now SUB_A (and never SUB_B) is handed to the webhook to switch off',
    case when v_claim @> '[{"subscription_code":"SUB_t53_A","attempt":1}]'::jsonb
          and not v_claim @> '[{"subscription_code":"SUB_t53_B"}]'::jsonb then 'PASS' else 'FAIL' end,
    v_claim::text);
  v_claim2 := fn_billing_claim_switch_offs(10);
  insert into t53 values (26, 'a claim backs off: asked again at once, SUB_A is not handed out twice',
    case when not v_claim2 @> '[{"subscription_code":"SUB_t53_A"}]'::jsonb then 'PASS' else 'FAIL' end, v_claim2::text);

  -- SUB_A's own events after we disable it: not_renew now, disable later
  select current_period_end into v_period from subscriptions where account_id = a;
  r := pg_temp.deliver('subscription.not_renew', jsonb_build_object(
    'subscription_code', 'SUB_t53_A', 'status', 'non-renewing',
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov')));
  insert into t53 values (27, 'SUB_A''s not_renew is ignored as superseded',
    case when r->>'status' = 'ignored' and r->>'reason' = 'superseded'
          and (select last_error_code from billing_events where id = (r->>'event_id')::uuid) = 'superseded'
         then 'PASS' else 'FAIL' end, coalesce(r->>'reason', r->>'status'));
  r := pg_temp.deliver('subscription.disable', jsonb_build_object(
    'subscription_code', 'SUB_t53_A', 'status', 'cancelled',
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov')));
  r := pg_temp.deliver('invoice.payment_failed', jsonb_build_object(
    'subscription', jsonb_build_object('subscription_code', 'SUB_t53_A'),
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov')));
  select * into s from subscriptions where account_id = a;
  select * into v_slot from founder_slots where account_id = a;
  insert into t53 values (28, 'after SUB_A''s not_renew, disable and failed payment the account is still active on the new plan',
    case when s.status = 'active' and not s.cancel_at_period_end and s.plan_id = 'founding_trading'
          and s.current_period_end = v_period and s.provider_subscription_code = 'SUB_t53_B'
         then 'PASS' else 'FAIL' end,
    s.status||' / '||s.plan_id||' / cancel_at_period_end '||s.cancel_at_period_end);
  insert into t53 values (29, '... and the founding price is kept: flag on, slot claimed and not forfeited',
    case when s.founding_price_active and v_slot.claimed_at is not null and v_slot.forfeited_at is null
         then 'PASS' else 'FAIL' end,
    'founding '||s.founding_price_active::text||' / forfeited '||coalesce(v_slot.forfeited_at::text,'no'));
  insert into t53 values (30, '... and it is still entitled',
    case when fn_account_is_entitled(a) then 'PASS' else 'FAIL' end, '');

  -- the old subscription charging again (the switch-off failed): a renewal
  -- names the customer and the old plan, no subscription code
  r := pg_temp.deliver('charge.success', jsonb_build_object(
    'paid_at', now()::text, 'customer', jsonb_build_object('customer_code', 'CUS_t53_mov'),
    'plan', jsonb_build_object('plan_code', 'founding_costing')));
  select * into s from subscriptions where account_id = a;
  insert into t53 values (31, 'a renewal charge on the plan the account left is ignored as superseded_charge; the plan does not flip back',
    case when r->>'status' = 'ignored'
          and (select last_error_code from billing_events where id = (r->>'event_id')::uuid) = 'superseded_charge'
          and s.plan_id = 'founding_trading' then 'PASS' else 'FAIL' end,
    coalesce(r->>'reason', r->>'status')||' / '||s.plan_id);

  -- the webhook records what Paystack said
  r := fn_billing_record_switch_off('SUB_t53_A', 'failed', 'paystack_error 503');
  select * into b from billing_superseded where subscription_code = 'SUB_t53_A';
  insert into t53 values (32, 'a failed switch-off is recorded and leaves the row open for a retry',
    case when r->>'outcome' = 'failed' and b.disabled_at is null and b.last_error like '%503%'
         then 'PASS' else 'FAIL' end, r::text);
  r := fn_billing_record_switch_off('SUB_t53_A', 'disabled', null);
  select * into b from billing_superseded where subscription_code = 'SUB_t53_A';
  insert into t53 values (33, 'a successful switch-off closes the row and is logged',
    case when r->>'status' = 'recorded' and b.disabled_at is not null and b.outcome = 'disabled'
          and (select count(*) from subscription_changes where account_id = a
                and change_kind = 'old_subscription_switched_off') = 1 then 'PASS' else 'FAIL' end, r::text);
  r := fn_billing_record_switch_off('SUB_t53_A', 'failed', 'a late retry');
  select * into b from billing_superseded where subscription_code = 'SUB_t53_A';
  insert into t53 values (34, 'retries are idempotent: a late failure never reopens a closed row',
    case when r->>'status' = 'already_recorded' and b.disabled_at is not null and b.outcome = 'disabled'
         then 'PASS' else 'FAIL' end, r::text);
  insert into t53 values (35, 'a closed row is never handed out again',
    case when not fn_billing_claim_switch_offs(10) @> '[{"subscription_code":"SUB_t53_A"}]'::jsonb
         then 'PASS' else 'FAIL' end, '');

  -- the current code can never be recorded as switched off
  insert into billing_superseded (account_id, subscription_code) values (a, 'SUB_t53_B');
  begin
    perform fn_billing_record_switch_off('SUB_t53_B', 'disabled', null);
    v_err := 'ACCEPTED';
  exception when others then v_err := sqlstate; end;
  insert into t53 values (36, 'the current subscription is refused as "switched off" even if a row names it',
    case when v_err = '22023' then 'PASS' else 'FAIL' end, v_err);
  insert into t53 values (37, '... and is never handed to the webhook to switch off',
    case when not fn_billing_claim_switch_offs(10) @> '[{"subscription_code":"SUB_t53_B"}]'::jsonb
         then 'PASS' else 'FAIL' end, '');
  delete from billing_superseded where subscription_code = 'SUB_t53_B';

  -- a redelivered subscription.create for SUB_A cannot make it current again
  r := pg_temp.deliver('subscription.create', jsonb_build_object(
    'subscription_code', 'SUB_t53_A', 'customer', jsonb_build_object('customer_code', 'CUS_t53_mov'),
    'plan', jsonb_build_object('plan_code', 'founding_costing')));
  insert into t53 values (38, 'a late subscription.create for a replaced code is ignored; SUB_B stays current',
    case when r->>'status' = 'ignored'
          and (select provider_subscription_code from subscriptions where account_id = a) = 'SUB_t53_B'
          and (select plan_id from subscriptions where account_id = a) = 'founding_trading'
         then 'PASS' else 'FAIL' end, coalesce(r->>'reason', r->>'status'));
end $$;

-- ============================================================================
-- C. CANCELLING THE CURRENT SUBSCRIPTION STILL WORKS
-- ============================================================================
do $$
declare a uuid; r jsonb; s record; v_slot record;
begin
  a := (select account_id from billing_superseded where subscription_code = 'SUB_t53_A');
  r := pg_temp.deliver('subscription.not_renew', jsonb_build_object(
    'subscription_code', 'SUB_t53_B', 'status', 'non-renewing',
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov')));
  select * into s from subscriptions where account_id = a;
  insert into t53 values (40, 'a not_renew for the CURRENT subscription cancels at the period end, still entitled',
    case when r->>'status' = 'applied' and s.status = 'cancelled' and s.cancel_at_period_end
          and fn_account_is_entitled(a) then 'PASS' else 'FAIL' end,
    s.status||' / entitled '||fn_account_is_entitled(a)::text);
  insert into t53 values (41, '... and keeps the founding price while the paid period runs',
    case when s.founding_price_active
          and (select forfeited_at from founder_slots where account_id = a) is null then 'PASS' else 'FAIL' end, '');

  r := pg_temp.deliver('subscription.disable', jsonb_build_object(
    'subscription_code', 'SUB_t53_B', 'status', 'cancelled',
    'customer', jsonb_build_object('customer_code', 'CUS_t53_mov')));
  select * into s from subscriptions where account_id = a;
  select * into v_slot from founder_slots where account_id = a;
  insert into t53 values (42, 'a disable of the CURRENT subscription still cancels and forfeits the founding price (0050 rule)',
    case when r->>'status' = 'applied' and s.status = 'cancelled' and not s.founding_price_active
          and v_slot.forfeited_at is not null then 'PASS' else 'FAIL' end,
    s.status||' / founding '||s.founding_price_active::text);

  -- access ends when the paid period does
  update subscriptions set current_period_end = now() - interval '1 minute' where account_id = a;
  insert into t53 values (43, 'once the paid period is over, a cancelled account is no longer entitled',
    case when not fn_account_is_entitled(a) then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================================================
-- D. ARRIVAL ORDER: subscription.create before its own charge
-- ============================================================================
do $$
declare a uuid; q jsonb; r1 jsonb; r2 jsonb; s record;
begin
  a := pg_temp.new_account('order');
  q := fn_checkout_quote(a, 'costing');
  r1 := pg_temp.deliver('subscription.create', jsonb_build_object(
    'subscription_code', 'SUB_t53_ord', 'customer', jsonb_build_object('customer_code', 'CUS_t53_ord'),
    'plan', jsonb_build_object('plan_code', q->>'plan_id'),
    'next_payment_date', (now() + interval '1 month')::text));
  insert into t53 values (50, 'a subscription.create for a brand-new customer, first to arrive, fails as no_account',
    case when r1->>'reason' = 'no_account' then 'PASS' else 'FAIL' end, coalesce(r1->>'reason', r1->>'status'));

  r2 := pg_temp.deliver('charge.success', jsonb_build_object(
    'paid_at', now()::text,
    'metadata', jsonb_build_object('account_id', a::text, 'plan_id', q->>'plan_id'),
    'customer', jsonb_build_object('customer_code', 'CUS_t53_ord'),
    'plan', jsonb_build_object('plan_code', q->>'plan_id')));
  select * into s from subscriptions where account_id = a;
  insert into t53 values (51, 'its charge then arrives and the earlier subscription.create is caught up',
    case when jsonb_array_length(r2->'caught_up') = 1 and r2->'caught_up'->0->>'status' = 'applied'
          and (select status from billing_events where id = (r1->>'event_id')::uuid) = 'applied'
          and s.provider_subscription_code = 'SUB_t53_ord' then 'PASS' else 'FAIL' end,
    coalesce(s.provider_subscription_code,'NULL')||' '||coalesce((r2->'caught_up')::text,''));

  -- an older one is never replayed automatically
  a := pg_temp.new_account('old');
  q := fn_checkout_quote(a, 'costing');
  r1 := pg_temp.deliver('subscription.create', jsonb_build_object(
    'subscription_code', 'SUB_t53_old', 'customer', jsonb_build_object('customer_code', 'CUS_t53_old'),
    'plan', jsonb_build_object('plan_code', q->>'plan_id')));
  update billing_events set received_at = now() - interval '2 hours' where id = (r1->>'event_id')::uuid;
  r2 := pg_temp.deliver('charge.success', jsonb_build_object(
    'paid_at', now()::text,
    'metadata', jsonb_build_object('account_id', a::text, 'plan_id', q->>'plan_id'),
    'customer', jsonb_build_object('customer_code', 'CUS_t53_old'),
    'plan', jsonb_build_object('plan_code', q->>'plan_id')));
  insert into t53 values (52, 'a no_account event older than an hour is left for a person to review',
    case when jsonb_array_length(r2->'caught_up') = 0
          and (select status from billing_events where id = (r1->>'event_id')::uuid) = 'failed_permanent'
         then 'PASS' else 'FAIL' end, (r2->'caught_up')::text);
end $$;

-- ============================================================================
-- E. THE SERVICE-ONLY FUNCTIONS REFUSE CLIENTS
-- ============================================================================
do $$
declare u uuid; a uuid; f text; v_state text; v_bad int := 0; v_list text := '';
begin
  a := pg_temp.new_account('client');
  u := pg_temp.owner_of(a);

  foreach f in array array['fn_billing_find_account(jsonb)', 'fn_billing_claim_switch_offs(integer)',
                           'fn_billing_record_switch_off(text,text,text)',
                           'fn_billing_record_manage_request(uuid,uuid,text,text,text)',
                           'fn_billing_apply(uuid)', 'fn_apply_billing_side_effects(uuid,text,text,jsonb)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      v_bad := v_bad + 1; v_list := v_list || f || ' ';
    end if;
  end loop;
  insert into t53 values (60, 'no billing function is executable by anon or authenticated',
    case when v_bad = 0 then 'PASS' else 'FAIL' end, v_list);

  -- and a signed-in owner actually calling them is refused
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true);
  v_bad := 0;
  begin perform fn_billing_find_account('{}'::jsonb); v_bad := v_bad + 1;
  exception when others then if sqlstate <> '42501' then v_bad := v_bad + 1; end if; end;
  begin perform fn_billing_claim_switch_offs(5); v_bad := v_bad + 1;
  exception when others then if sqlstate <> '42501' then v_bad := v_bad + 1; end if; end;
  begin perform fn_billing_record_switch_off('SUB_x', 'disabled', null); v_bad := v_bad + 1;
  exception when others then if sqlstate <> '42501' then v_bad := v_bad + 1; end if; end;
  begin perform fn_billing_record_manage_request(a, u, 'cancel', 'sent', null); v_bad := v_bad + 1;
  exception when others then if sqlstate <> '42501' then v_bad := v_bad + 1; end if; end;
  begin perform 1 from billing_superseded; v_state := 'READ';
  exception when others then v_state := sqlstate; end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into t53 values (61, 'a signed-in owner calling any of the four 0067 functions gets 42501',
    case when v_bad = 0 then 'PASS' else 'FAIL' end, v_bad||' not refused');
  insert into t53 values (62, 'a signed-in user cannot read billing_superseded',
    case when v_state = '42501' then 'PASS' else 'FAIL' end, v_state);

  -- even inside a SECURITY DEFINER caller, the functions check service context
  set local role service_role;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin perform fn_billing_claim_switch_offs(5); v_state := 'RAN';
  exception when others then v_state := sqlstate; end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into t53 values (63, 'service_role carrying an end-user JWT subject is not service context',
    case when v_state = '42501' then 'PASS' else 'FAIL' end, v_state);

  insert into t53 values (64, 'billing_superseded: RLS on, no client policy, service_role may only read it',
    case when (select relrowsecurity from pg_class where oid = 'billing_superseded'::regclass)
          and not exists (select 1 from pg_policies where tablename = 'billing_superseded')
          and has_table_privilege('service_role', 'billing_superseded', 'select')
          and not has_table_privilege('service_role', 'billing_superseded', 'insert')
          and not has_table_privilege('service_role', 'billing_superseded', 'update')
          and not has_table_privilege('service_role', 'billing_superseded', 'delete')
         then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================================================
-- F. THE OWNER'S CANCEL / CARD REQUEST RECORD
-- ============================================================================
do $$
declare a uuid; u uuid; staff uuid; r jsonb; v_state text; c record;
begin
  a := pg_temp.paying('manage', 'costing', 'CUS_t53_man', 'SUB_t53_man');
  u := pg_temp.owner_of(a);
  r := fn_billing_record_manage_request(a, u, 'cancel', 'sent', 'SUB_t53_man');
  select * into c from subscription_changes where id = (r->>'change_id')::uuid;
  insert into t53 values (70, 'an owner''s cancel request is recorded as cancel_requested, by the customer',
    case when c.change_kind = 'cancel_requested' and c.change_source = 'customer'
          and c.authorised_by = u::text and c.new_values->>'outcome' = 'sent'
          and c.new_values->>'subscription_code' = 'SUB_t53_man' then 'PASS' else 'FAIL' end,
    coalesce(c.change_kind,'none'));
  insert into t53 values (71, '... and the subscription row itself is untouched (the webhook writes that)',
    case when (select status from subscriptions where account_id = a) = 'active'
          and not (select cancel_at_period_end from subscriptions where account_id = a) then 'PASS' else 'FAIL' end, '');

  r := fn_billing_record_manage_request(a, u, 'card_link', 'link_issued', null);
  insert into t53 values (72, 'a card-link request is recorded, with no link stored',
    case when (select change_kind from subscription_changes where id = (r->>'change_id')::uuid) = 'card_link_requested'
          and (select new_values::text from subscription_changes where id = (r->>'change_id')::uuid) not like '%http%'
         then 'PASS' else 'FAIL' end, '');

  staff := gen_random_uuid();
  insert into auth.users(id, email) values (staff, 'staff-'||left(staff::text,8)||'@t53.test');
  insert into memberships (account_id, business_id, user_id, role)
  select a, business_id, staff, 'manager' from memberships where account_id = a and role = 'owner' limit 1;
  begin perform fn_billing_record_manage_request(a, staff, 'cancel', 'sent', null); v_state := 'RECORDED';
  exception when others then v_state := sqlstate; end;
  insert into t53 values (73, 'a manager''s request is refused (owner only, checked again in the database)',
    case when v_state = '42501' then 'PASS' else 'FAIL' end, v_state);

  begin perform fn_billing_record_manage_request(a, u, 'refund', 'sent', null); v_state := 'RECORDED';
  exception when others then v_state := sqlstate; end;
  insert into t53 values (74, 'an unknown request kind is refused (22023)',
    case when v_state = '22023' then 'PASS' else 'FAIL' end, v_state);
end $$;

-- ============================================================================
-- G. THE ALERTS
-- ============================================================================
do $$
declare a uuid; u uuid; r jsonb; v_sub uuid;
begin
  -- a replaced subscription still live after an hour
  a := pg_temp.paying('alert', 'costing', 'CUS_t53_al', 'SUB_t53_al1');
  perform pg_temp.deliver('subscription.create', jsonb_build_object(
    'subscription_code', 'SUB_t53_al2', 'customer', jsonb_build_object('customer_code', 'CUS_t53_al'),
    'plan', jsonb_build_object('plan_code', 'founding_trading')));
  update billing_superseded set recorded_at = now() - interval '2 hours' where subscription_code = 'SUB_t53_al1';

  -- a replaced subscription took a payment (B.31 left one)
  -- a cancel Paystack never confirmed
  u := pg_temp.owner_of((select account_id from subscriptions where provider_subscription_code = 'SUB_t53_man'));
  select id into v_sub from subscriptions where provider_subscription_code = 'SUB_t53_man';
  insert into subscription_changes (subscription_id, account_id, change_kind, previous_values, new_values,
         change_source, authorised_by, reason, effective_at, created_at)
  select v_sub, account_id, 'cancel_requested', '{}'::jsonb,
         jsonb_build_object('action','cancel','outcome','sent','subscription_code','SUB_t53_man'),
         'customer', u::text, 't53 backdated', now() - interval '2 hours', now() - interval '2 hours'
    from subscriptions where id = v_sub;

  r := fn_admin_scan();
  insert into t53 values (80, 'an old subscription not switched off after an hour raises subscription_not_switched_off (critical)',
    case when exists (select 1 from platform_alerts where kind = 'subscription_not_switched_off'
                       and subject = 'SUB_t53_al1' and severity = 'critical' and resolved_at is null)
         then 'PASS' else 'FAIL' end, r::text);
  insert into t53 values (81, 'a payment on a replaced subscription raises superseded_subscription_charged',
    case when exists (select 1 from platform_alerts where kind = 'superseded_subscription_charged'
                       and resolved_at is null) then 'PASS' else 'FAIL' end, '');
  insert into t53 values (82, 'a cancel Paystack never confirmed raises cancel_not_confirmed',
    case when exists (select 1 from platform_alerts where kind = 'cancel_not_confirmed' and resolved_at is null
                       and subject = (select account_id::text from subscriptions where id = v_sub))
         then 'PASS' else 'FAIL' end, '');

  -- the condition clears once the old subscription is off, and the scan resolves it
  perform fn_billing_record_switch_off('SUB_t53_al1', 'already_off', 'switched off by hand in the dashboard');
  perform fn_admin_scan();
  insert into t53 values (83, 'once recorded as off, the scan resolves subscription_not_switched_off',
    case when not exists (select 1 from platform_alerts where kind = 'subscription_not_switched_off'
                           and subject = 'SUB_t53_al1' and resolved_at is null) then 'PASS' else 'FAIL' end, '');

  -- the existing kinds are still accepted, and an unknown one is not
  begin
    insert into platform_alerts (kind, subject, severity, summary) values ('t53_unknown', 'x', 'info', 'x');
    insert into t53 values (84, 'the kind check still refuses an unknown kind', 'FAIL', 'accepted');
  exception when check_violation then
    insert into t53 values (84, 'the kind check still refuses an unknown kind', 'PASS', '');
  end;
end $$;

select n, check_name, verdict, left(detail,70) as detail from t53 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t53;

rollback;
