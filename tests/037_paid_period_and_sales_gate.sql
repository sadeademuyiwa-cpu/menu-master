-- ============================================================================
-- MENU MASTER NG -- tests/037_paid_period_and_sales_gate.sql
--
-- Acceptance test for 0051. Run on a database with 0051 applied.
-- Rolls everything back.
--
-- All three of these come from the FIRST REAL PAYMENT. It succeeded -- plan,
-- status, price, provider codes and the founder slot were all correct -- and
-- still exposed three faults. These pin them.
-- ============================================================================

begin;

create temp table t37 (n int, check_name text, verdict text, detail text) on commit drop;

-- deliver a signed-and-verified event exactly as the edge function does
create or replace function pg_temp.deliver(p_event text, p_account uuid, p_extra jsonb)
returns jsonb language plpgsql as $$
declare v_body text; v_ing jsonb;
begin
  v_body := gen_random_uuid()::text;
  v_ing := fn_billing_ingest(
      p_body_sha256 => encode(digest(v_body,'sha256'),'hex'),
      p_signature_valid => true, p_event_type => p_event,
      p_provider_event_id => v_body, p_reference => 'ref-'||v_body,
      p_payload => jsonb_build_object('event', p_event, 'data',
        jsonb_build_object('id', floor(random()*1e9)::bigint, 'reference','ref-'||v_body,
          'metadata', jsonb_build_object('account_id', p_account::text),
          'customer', jsonb_build_object('customer_code','CUS_t37')) || p_extra),
      p_body_bytes => 10, p_source_ip => '127.0.0.1'::inet);
  return fn_billing_apply((v_ing->>'event_id')::uuid);
end $$;

create or replace function pg_temp.new_account(p_label text)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); res jsonb;
begin
  insert into auth.users(id,email) values (u, p_label||gen_random_uuid()||'@t37.test');
  res := fn_create_account_and_business(p_label,'K','other',u,
           p_idempotency_key => gen_random_uuid()::text);
  return (res->>'account_id')::uuid;
end $$;

do $$
declare a uuid; s record; r jsonb; v_trial timestamptz; v_paid timestamptz;
begin
  -- ============================================ 1. THE PAID PERIOD
  --
  -- charge.success carries paid_at and a plan, and NO next_payment_date. The
  -- trial's end date used to survive the payment.
  a := pg_temp.new_account('paid');
  select current_period_end into v_trial from subscriptions where account_id=a;
  perform fn_checkout_quote(a, 'costing');

  v_paid := now() - interval '2 days';   -- deliberately not "now"
  r := pg_temp.deliver('charge.success', a,
        jsonb_build_object('paid_at', v_paid::text, 'subscription_code','SUB_t37',
          'plan', jsonb_build_object('plan_code','founding_costing','interval','monthly')));

  select * into s from subscriptions where account_id=a;
  insert into t37 values (1,'a successful charge applies',
    case when r->>'status'='applied' then 'PASS' else 'FAIL' end,
    coalesce(r->>'status','null')||' '||coalesce(r->>'error',''));

  insert into t37 values (2,'the period end is NO LONGER the trial end',
    case when s.current_period_end <> v_trial then 'PASS' else 'FAIL' end,
    'was '||v_trial::date||', now '||s.current_period_end::date);

  insert into t37 values (3,'it is one month from when they PAID, not from now',
    case when s.current_period_end::date = (v_paid + interval '1 month')::date
         then 'PASS' else 'FAIL' end,
    'paid '||v_paid::date||' -> '||s.current_period_end::date);

  insert into t37 values (4,'and the plan, status and price are still right',
    case when s.plan_id='founding_costing' and s.status='active'
          and s.price_kobo=350000 then 'PASS' else 'FAIL' end,
    s.plan_id||' / '||s.status||' / '||coalesce(s.price_kobo::text,'NULL'));

  -- Paystack's own date must always win over the derived one
  a := pg_temp.new_account('explicit');
  perform fn_checkout_quote(a, 'costing');
  r := pg_temp.deliver('subscription.create', a,
        jsonb_build_object('next_payment_date', (now() + interval '31 days')::text,
          'plan', jsonb_build_object('plan_code','founding_costing')));
  select * into s from subscriptions where account_id=a;
  insert into t37 values (5,'Paystack''s own next_payment_date wins when present',
    case when s.current_period_end::date = (now() + interval '31 days')::date
         then 'PASS' else 'FAIL' end, s.current_period_end::date::text);

  -- a failed renewal must NOT advance the period
  a := pg_temp.new_account('dunning');
  perform fn_checkout_quote(a, 'costing');
  perform pg_temp.deliver('charge.success', a,
        jsonb_build_object('paid_at', now()::text,
          'plan', jsonb_build_object('plan_code','founding_costing')));
  select current_period_end into v_paid from subscriptions where account_id=a;
  perform pg_temp.deliver('invoice.payment_failed', a,
        jsonb_build_object('next_payment_date', (now() + interval '99 days')::text,
          'plan', jsonb_build_object('plan_code','founding_costing')));
  select * into s from subscriptions where account_id=a;
  insert into t37 values (6,'a FAILED renewal does not advance the period end',
    case when s.current_period_end = v_paid and s.status='past_due'
         then 'PASS' else 'FAIL' end,
    'still '||s.current_period_end::date||', status '||s.status);

  -- a charge with no paid_at at all still gets a period, not the trial date
  a := pg_temp.new_account('nopaidat');
  select current_period_end into v_trial from subscriptions where account_id=a;
  perform fn_checkout_quote(a, 'costing');
  perform pg_temp.deliver('charge.success', a,
        jsonb_build_object('plan', jsonb_build_object('plan_code','founding_costing')));
  select * into s from subscriptions where account_id=a;
  insert into t37 values (7,'a charge with no paid_at still leaves the trial date behind',
    case when s.current_period_end <> v_trial then 'PASS' else 'FAIL' end,
    'trial '||v_trial::date||' -> '||s.current_period_end::date);
end $$;

-- ============================================ 2. THE SALES GATE
--
-- The screen must ask the SAME question the write policies ask. A Costing
-- subscriber was shown the whole Record a Sale form.
do $$
declare a_cost uuid; a_sales uuid; u_cost uuid; u_sales uuid; v boolean;
begin
  a_cost  := pg_temp.new_account('gatecost');
  a_sales := pg_temp.new_account('gatesales');
  select user_id into u_cost  from memberships where account_id=a_cost  limit 1;
  select user_id into u_sales from memberships where account_id=a_sales limit 1;

  update subscriptions set plan_id='founding_costing', status='active',
         current_period_end = now()+interval '30 days' where account_id=a_cost;
  update subscriptions set plan_id='founding_trading', status='active',
         current_period_end = now()+interval '30 days' where account_id=a_sales;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u_cost::text, true);
  v := fn_my_has_sales();
  reset role; perform set_config('request.jwt.claim.sub','',true);
  insert into t37 values (8,'a Costing subscriber is told they have NO Sales',
    case when v = false then 'PASS' else 'FAIL' end, 'fn_my_has_sales = '||v::text);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u_sales::text, true);
  v := fn_my_has_sales();
  reset role; perform set_config('request.jwt.claim.sub','',true);
  insert into t37 values (9,'a Costing + Sales subscriber is told they HAVE Sales',
    case when v = true then 'PASS' else 'FAIL' end, 'fn_my_has_sales = '||v::text);

  -- the screen and the policy must never disagree
  insert into t37 values (10,'the screen predicate agrees with the write policy',
    case when fn_account_has_sales(a_cost) = false
          and fn_account_has_sales(a_sales) = true then 'PASS' else 'FAIL' end,
    'fn_my_has_sales derives from fn_account_has_sales');
end $$;

-- and it must still be RLS that refuses, not the screen
do $$
declare f record; msg text := 'WROTE'; b uuid; u uuid; a uuid;
begin
  select account_id, business_id, user_id into a, b, u
    from memberships where account_id = (select account_id from subscriptions
                                          where plan_id='founding_costing' limit 1) limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    insert into orders (account_id, business_id, order_no, order_date)
      values (a, b, 't37-'||gen_random_uuid(), current_date);
  exception when others then msg := sqlstate; end;
  reset role; perform set_config('request.jwt.claim.sub','',true);
  insert into t37 values (11,'RLS still refuses the write -- the UI gate protects nothing',
    case when msg <> 'WROTE' then 'PASS' else 'FAIL' end,
    'sqlstate '||msg||' -- the database is the boundary, the screen is courtesy');
end $$;

-- ============================================ 3. GRANTS
do $$
begin
  insert into t37 values (12,'anon cannot ask about Sales entitlement',
    case when not has_function_privilege('anon','fn_my_has_sales()','execute')
         then 'PASS' else 'FAIL' end, '');
  insert into t37 values (13,'a signed-in user can ask about their own',
    case when has_function_privilege('authenticated','fn_my_has_sales()','execute')
         then 'PASS' else 'FAIL' end, '');
  insert into t37 values (14,'0051 added no policy',
    case when (select count(*) from pg_policies where schemaname='public')=117
         then 'PASS' else 'FAIL' end,
    (select count(*)::text from pg_policies where schemaname='public'));
end $$;

select n, check_name, verdict, left(detail,58) as detail from t37 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t37;

rollback;
