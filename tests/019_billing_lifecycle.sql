-- ============================================================================
-- MENU MASTER NG -- tests/019_billing_lifecycle.sql
--
-- Acceptance test for 0029 (the database side of the Paystack webhook).
-- Run on a database with 0021-0029 applied. Rolls everything back.
--
-- USES NO SECRET AND NEEDS NO NETWORK. Signature verification belongs to the
-- Edge Function; everything from step 7 onward is exercised here.
-- ============================================================================

begin;

create temp table ta (n int, check_name text, verdict text, detail text) on commit drop;
create temp table ta_fx (acct uuid, usr uuid) on commit drop;

create or replace function pg_temp.ev(p_type text, p_acct uuid, p_evid text,
                                      p_ref text, p_next text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('event', p_type, 'data', jsonb_build_object(
           'id', p_evid, 'reference', p_ref,
           'next_payment_date', p_next,
           'plan', jsonb_build_object('plan_code','trial'),
           'metadata', jsonb_build_object('account_id', p_acct::text)));
$$;

do $$
declare a uuid; u uuid := gen_random_uuid(); res jsonb; r jsonb; st text;
begin
  insert into auth.users (id,email) values (u,'pay@t.test');
  res := fn_create_account_and_business('Pay Co','Pay Kitchen','soup_seller', u,
           p_idempotency_key => gen_random_uuid()::text);
  a := (res->>'account_id')::uuid;
  insert into ta_fx values (a,u);

  -- ================================================ 1. rejected signature
  r := fn_billing_ingest('sha-bad', false, p_body_bytes => 120,
                         p_source_ip => '203.0.113.9'::inet);
  insert into ta values (1,'an invalid signature is recorded and goes no further',
    case when r->>'action' = 'rejected' then 'PASS' else 'FAIL' end, r->>'action');

  select status into st from billing_events where body_sha256='sha-bad' limit 1;
  insert into ta values (2,'and the attacker-controlled body is NOT stored',
    case when st='rejected' and (select payload from billing_events
                                  where body_sha256='sha-bad') is null
         then 'PASS' else 'FAIL' end, 'status '||coalesce(st,'none')||', payload null');

  -- ================================================ 2. idempotency
  r := fn_billing_ingest('sha-1', true, 'charge.success', 'evt-1', 'ref-1',
                          pg_temp.ev('charge.success', a, 'evt-1','ref-1',
                                     (now()+interval '30 days')::text), 400, null);
  insert into ta values (3,'a fresh event is claimed for processing',
    case when r->>'action' = 'process' then 'PASS' else 'FAIL' end, r->>'action');

  r := fn_billing_ingest('sha-1', true, 'charge.success', 'evt-1', 'ref-1',
                          pg_temp.ev('charge.success', a, 'evt-1','ref-1'), 400, null);
  insert into ta values (4,'an exact redelivery is a duplicate, not a new payment',
    case when r->>'action' = 'duplicate' then 'PASS' else 'FAIL' end,
    (r->>'action')||' / was '||coalesce(r->>'existing_status','?'));

  r := fn_billing_ingest('sha-1b', true, 'charge.success', 'evt-1', 'ref-1',
                          pg_temp.ev('charge.success', a, 'evt-1','ref-1'), 401, null);
  insert into ta values (5,'a renumbered redelivery of the same event is too',
    case when r->>'action' = 'duplicate' then 'PASS' else 'FAIL' end, r->>'action');
end
$$;

do $$
declare f record; r jsonb; st text; pe timestamptz; v_id uuid; n int;
begin
  select * into f from ta_fx;

  -- ================================================ 3. charge.success -> active
  select be.id into v_id from billing_events be where be.body_sha256='sha-1';
  r := fn_billing_apply(v_id);
  select status, current_period_end into st, pe from subscriptions where account_id=f.acct;
  insert into ta values (6,'charge.success moves the subscription to active',
    case when r->>'status'='applied' and st='active' then 'PASS' else 'FAIL' end,
    'event '||(r->>'status')||', subscription '||coalesce(st,'none'));
  insert into ta values (7,'and advances the paid period',
    case when pe > now() then 'PASS' else 'FAIL' end, 'period_end '||coalesce(pe::text,'null'));

  -- ================================================ 4. failed renewal
  r := fn_billing_ingest('sha-2', true, 'invoice.payment_failed', 'evt-2', 'ref-2',
                          pg_temp.ev('invoice.payment_failed', f.acct, 'evt-2','ref-2',
                                     (now()+interval '99 days')::text), 300, null);
  r := fn_billing_apply((r->>'event_id')::uuid);
  select status, current_period_end into st, pe from subscriptions where account_id=f.acct;
  insert into ta values (8,'a failed renewal moves to past_due',
    case when st='past_due' then 'PASS' else 'FAIL' end, coalesce(st,'none'));
  insert into ta values (9,'and does NOT advance the period end',
    case when pe < now() + interval '90 days' then 'PASS' else 'FAIL' end,
    'period_end '||coalesce(pe::text,'null')||' — the event offered 99 days');

  insert into ta values (10,'past_due still permits writing (dunning grace)',
    case when fn_account_is_entitled(f.acct) then 'PASS' else 'FAIL' end,
    'entitled = '||fn_account_is_entitled(f.acct)::text);

  -- ================================================ 5. cancellation
  r := fn_billing_ingest('sha-3', true, 'subscription.not_renew', 'evt-3', 'ref-3',
                          pg_temp.ev('subscription.not_renew', f.acct, 'evt-3','ref-3'), 250, null);
  r := fn_billing_apply((r->>'event_id')::uuid);
  select status into st from subscriptions where account_id=f.acct;
  insert into ta values (11,'not_renew moves to cancelled',
    case when st='cancelled' then 'PASS' else 'FAIL' end, coalesce(st,'none'));

  -- ================================================ 6. unsupported and unmapped
  r := fn_billing_ingest('sha-4', true, 'customer.identification.failed', 'evt-4', 'ref-4',
                          pg_temp.ev('customer.identification.failed', f.acct, 'evt-4','ref-4'), 200, null);
  r := fn_billing_apply((r->>'event_id')::uuid);
  insert into ta values (12,'an event type we do not handle is ignored, not failed',
    case when r->>'status'='ignored' then 'PASS' else 'FAIL' end, r->>'status');

  r := fn_billing_ingest('sha-5', true, 'charge.success', 'evt-5', 'ref-5',
         jsonb_build_object('event','charge.success','data',
           jsonb_build_object('id','evt-5','reference','ref-5')), 150, null);
  r := fn_billing_apply((r->>'event_id')::uuid);
  insert into ta values (13,'an event with no account is failed_permanent, for a human',
    case when r->>'status'='failed_permanent' then 'PASS' else 'FAIL' end,
    (r->>'status')||' — '||coalesce(r->>'reason','')); 

  insert into ta values (14,'and it surfaces in the reconciliation queue',
    case when (select count(*) from v_billing_reconciliation
                where status='failed_permanent') = 1 then 'PASS' else 'FAIL' end,
    (select count(*)::text from v_billing_reconciliation)||' row(s) awaiting a human');

  -- ================================================ 7. the bearer credential
  r := fn_billing_ingest('sha-6', true, 'charge.success', 'evt-6', 'ref-6',
         jsonb_build_object('event','charge.success','data', jsonb_build_object(
           'id','evt-6','metadata', jsonb_build_object('account_id', f.acct::text),
           'authorization', jsonb_build_object('authorization_code','AUTH_leak',
                                               'last4','4081'))), 500, null);
  insert into ta values (15,'the authorization code never reaches storage',
    case when (select payload #>> '{data,authorization,authorization_code}'
                 from billing_events where body_sha256='sha-6') is null
         then 'PASS' else 'FAIL' end,
    coalesce((select payload #>> '{data,authorization,authorization_code}'
                from billing_events where body_sha256='sha-6'),'absent'));
end
$$;

-- ================================================ 8. access surface
do $$
declare n int; msg text;
begin
  set local role authenticated;
  begin
    perform fn_billing_ingest('sha-attack', true);
    msg := 'ACCEPTED';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  insert into ta values (16,'authenticated cannot call the ingest function',
    case when msg <> 'ACCEPTED' then 'PASS' else 'FAIL' end, left(msg,50));

  select count(*) into n from pg_proc p
   where p.proname in ('fn_billing_ingest','fn_billing_apply')
     and (has_function_privilege('anon', p.oid,'EXECUTE')
       or has_function_privilege('authenticated', p.oid,'EXECUTE'));
  insert into ta values (17,'neither billing function is granted to a client role',
    case when n=0 then 'PASS' else 'FAIL' end, n||' grant(s)');
end
$$;

select n, check_name, verdict, left(detail,54) as detail from ta order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from ta;

rollback;
