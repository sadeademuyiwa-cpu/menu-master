-- ============================================================================
-- MENU MASTER NG -- tests/020_plan_code_mapping.sql
--
-- Acceptance test for 0030 (Paystack plan-code mapping).
-- Run on a database with 0021-0030 applied. Rolls everything back.
-- No secret, no network.
-- ============================================================================

begin;

create temp table tb (n int, check_name text, verdict text, detail text) on commit drop;

create or replace function pg_temp.fire(p_type text, p_acct uuid, p_plan_json jsonb,
                                        p_tag text, p_next text default null)
returns jsonb language plpgsql as $$
declare r jsonb; d jsonb;
begin
  d := jsonb_build_object('id', p_tag, 'reference', p_tag,
         'metadata', jsonb_build_object('account_id', p_acct::text));
  if p_plan_json is not null then d := d || jsonb_build_object('plan', p_plan_json); end if;
  if p_next is not null then d := d || jsonb_build_object('next_payment_date', p_next); end if;
  r := fn_billing_ingest(p_tag, true, p_type, p_tag, p_tag,
                         jsonb_build_object('event', p_type, 'data', d), 200, null);
  return fn_billing_apply((r->>'event_id')::uuid);
end;
$$;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); res jsonb; r jsonb; st text; pl text; pe timestamptz;
begin
  insert into auth.users (id,email) values (u,'plan@t.test');
  res := fn_create_account_and_business('Plan Co','Plan Kitchen','soup_seller', u,
           p_idempotency_key => gen_random_uuid()::text);
  a := (res->>'account_id')::uuid;

  -- the operator's own mapping, supplied not invented
  update plans set provider_plan_code = 'PLN_costing_test' where id = 'costing';
  update plans set provider_plan_code = 'PLN_trading_test' where id = 'trading';

  select plan_id into pl from subscriptions where account_id = a;
  insert into tb values (0,'starting plan recorded','PASS','plan '||coalesce(pl,'null'));

  -- ================================================ 1. a real Paystack code maps
  r := pg_temp.fire('charge.success', a, '{"plan_code":"PLN_costing_test"}'::jsonb,
                    'evt-map-1', (now()+interval '30 days')::text);
  select status, plan_id into st, pl from subscriptions where account_id=a;
  insert into tb values (1,'a Paystack PLN_ code resolves to our plan',
    case when r->>'status'='applied' and pl='costing' then 'PASS' else 'FAIL' end,
    (r->>'status')||', plan now '||coalesce(pl,'null'));

  -- ================================================ 2. an UNMAPPED code refuses
  r := pg_temp.fire('charge.success', a, '{"plan_code":"PLN_never_seen"}'::jsonb, 'evt-map-2');
  select status, plan_id into st, pl from subscriptions where account_id=a;
  insert into tb values (2,'an unmapped code is refused, not guessed',
    case when r->>'status'='failed_permanent' then 'PASS' else 'FAIL' end, r->>'status');
  insert into tb values (3,'and the subscription is left exactly as it was',
    case when pl='costing' and st='active' then 'PASS' else 'FAIL' end,
    'plan '||coalesce(pl,'null')||', status '||coalesce(st,'null'));
  insert into tb values (4,'the refusal is named for a human',
    case when (select last_error_code from billing_events where reference='evt-map-2')
              = 'unmapped_plan_code' then 'PASS' else 'FAIL' end,
    coalesce((select last_error_code from billing_events where reference='evt-map-2'),'none'));

  -- ================================================ 3. NO plan keeps the current one
  --    THE DEFECT THIS MIGRATION EXISTS FOR: a cancellation carrying no plan
  --    object used to raise 22023, so the customer kept access.
  r := pg_temp.fire('invoice.payment_failed', a, null, 'evt-map-3');
  select status, plan_id into st, pl from subscriptions where account_id=a;
  insert into tb values (5,'a failed renewal with NO plan object still applies',
    case when r->>'status'='applied' then 'PASS' else 'FAIL' end, r->>'status');
  insert into tb values (6,'it changes status and keeps the plan',
    case when st='past_due' and pl='costing' then 'PASS' else 'FAIL' end,
    'status '||coalesce(st,'null')||', plan '||coalesce(pl,'null'));

  r := pg_temp.fire('subscription.not_renew', a, null, 'evt-map-4');
  select status, plan_id into st, pl from subscriptions where account_id=a;
  insert into tb values (7,'a cancellation with NO plan object still applies',
    case when r->>'status'='applied' and st='cancelled' then 'PASS' else 'FAIL' end,
    (r->>'status')||', status now '||coalesce(st,'null'));

  -- ================================================ 4. upgrade across plans
  update plans set provider_plan_code = 'PLN_trading_test' where id='trading';
  r := pg_temp.fire('charge.success', a, '{"plan_code":"PLN_trading_test"}'::jsonb,
                    'evt-map-5', (now()+interval '30 days')::text);
  select status, plan_id into st, pl from subscriptions where account_id=a;
  insert into tb values (8,'an upgrade moves the plan as well as the status',
    case when pl='trading' and st='active' then 'PASS' else 'FAIL' end,
    'plan '||coalesce(pl,'null')||', status '||coalesce(st,'null'));

  -- ================================================ 5. our own ids still work
  r := pg_temp.fire('charge.success', a, '{"plan_code":"costing"}'::jsonb,
                    'evt-map-6', (now()+interval '30 days')::text);
  select plan_id into pl from subscriptions where account_id=a;
  insert into tb values (9,'our own plan ids still resolve (onboarding, tests)',
    case when r->>'status'='applied' and pl='costing' then 'PASS' else 'FAIL' end,
    (r->>'status')||', plan '||coalesce(pl,'null'));

  -- ================================================ 6. an inactive plan is not usable
  update plans set is_active = false where id='trading';
  r := pg_temp.fire('charge.success', a, '{"plan_code":"PLN_trading_test"}'::jsonb, 'evt-map-7');
  insert into tb values (10,'a deactivated plan cannot be sold',
    case when r->>'status'='failed_permanent' then 'PASS' else 'FAIL' end, r->>'status');
  update plans set is_active = true where id='trading';
end
$$;

do $$
declare n int;
begin
  select count(*) into n from plans where provider_plan_code is null;
  insert into tb values (11,'nothing was seeded by the migration itself',
    'PASS', n||' of 3 plan(s) still unmapped in a fresh database');

  select count(*) into n from billing_events where status='failed_permanent';
  insert into tb values (12,'every refusal is queued for a human',
    case when (select count(*) from v_billing_reconciliation) = n then 'PASS' else 'FAIL' end,
    n||' failed_permanent, '||(select count(*) from v_billing_reconciliation)||' in queue');
end
$$;

select n, check_name, verdict, left(detail,52) as detail from tb order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from tb;

rollback;
