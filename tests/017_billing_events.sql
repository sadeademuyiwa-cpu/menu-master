-- ============================================================================
-- MENU MASTER NG -- tests/017_billing_events.sql
--
-- Acceptance test for 0027 (Gate 3 -- the webhook audit trail).
-- Run on a database with 0021-0027 applied. Rolls everything back.
-- Uses NO Paystack secret and requires no network.
-- ============================================================================

begin;

create temp table t8 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table t8_fx (acct uuid) on commit drop;

do $$
declare a uuid := gen_random_uuid(); u uuid := gen_random_uuid();
        p jsonb; n int; msg text;
begin
  insert into auth.users (id,email) values (u,'bill@t.test');
  insert into accounts (id,name) values (a,'Billing Acct');
  insert into t8_fx values (a);

  -- ============================================ 1. redaction (design section 7)
  insert into billing_events (body_sha256, signature_valid, account_id, event_type,
                              provider_event_id, reference, payload)
  values ('sha-1', true, a, 'charge.success', 'evt_1', 'ref_1',
          jsonb_build_object('data', jsonb_build_object(
            'amount', 500000,
            'authorization', jsonb_build_object(
              'authorization_code','AUTH_leak_me','signature','SIG_leak_me',
              'bin','408408','exp_month','12','exp_year','2030',
              'last4','4081','card_type','visa','bank','GTB'))))
  returning payload into p;

  insert into t8 values (1,'the authorization_code is stripped',
    case when p #>> '{data,authorization,authorization_code}' is null
         then 'PASS' else 'FAIL' end,
    coalesce(p #>> '{data,authorization,authorization_code}','absent')
    ||' — a bearer credential that can charge the customer again');
  insert into t8 values (2,'the card signature and BIN are stripped',
    case when p #>> '{data,authorization,signature}' is null
          and p #>> '{data,authorization,bin}' is null then 'PASS' else 'FAIL' end,
    'signature '||coalesce(p #>> '{data,authorization,signature}','absent')
    ||', bin '||coalesce(p #>> '{data,authorization,bin}','absent'));
  insert into t8 values (3,'expiry is stripped',
    case when p #>> '{data,authorization,exp_month}' is null
          and p #>> '{data,authorization,exp_year}' is null then 'PASS' else 'FAIL' end,
    'absent');
  insert into t8 values (4,'last4, card_type and bank are RETAINED for support',
    case when p #>> '{data,authorization,last4}' = '4081'
          and p #>> '{data,authorization,card_type}' = 'visa'
          and p #>> '{data,authorization,bank}' = 'GTB' then 'PASS' else 'FAIL' end,
    'last4 '||coalesce(p #>> '{data,authorization,last4}','MISSING'));
  insert into t8 values (5,'the rest of the payload is untouched',
    case when p #>> '{data,amount}' = '500000' then 'PASS' else 'FAIL' end,
    'amount '||coalesce(p #>> '{data,amount}','MISSING'));

  -- redaction must also apply on UPDATE, not only INSERT
  update billing_events set payload = jsonb_build_object('data', jsonb_build_object(
    'authorization', jsonb_build_object('authorization_code','AUTH_via_update')))
   where body_sha256='sha-1'
   returning payload into p;
  insert into t8 values (6,'redaction applies on UPDATE too',
    case when p #>> '{data,authorization,authorization_code}' is null
         then 'PASS' else 'FAIL' end,
    coalesce(p #>> '{data,authorization,authorization_code}','absent'));

  -- ============================================ 2. idempotency keys
  begin
    insert into billing_events (body_sha256, signature_valid)
      values ('sha-1', true);
    insert into t8 values (7,'an exact redelivery of the same bytes is refused',
      'FAIL','the same body was stored twice');
  exception when unique_violation then
    insert into t8 values (7,'an exact redelivery of the same bytes is refused',
      'PASS','unique on (provider, body_sha256)');
  end;

  begin
    insert into billing_events (body_sha256, signature_valid, event_type, provider_event_id)
      values ('sha-2', true, 'charge.success', 'evt_1');
    insert into t8 values (8,'a renumbered redelivery of the same event is refused',
      'FAIL','the same provider event was stored twice');
  exception when unique_violation then
    insert into t8 values (8,'a renumbered redelivery of the same event is refused',
      'PASS','unique on (provider, event_type, provider_event_id)');
  end;

  -- two events with no provider_event_id must both be storable
  insert into billing_events (body_sha256, signature_valid, event_type)
    values ('sha-3', false, 'unparseable');
  insert into billing_events (body_sha256, signature_valid, event_type)
    values ('sha-4', false, 'unparseable');
  select count(*) into n from billing_events where provider_event_id is null;
  insert into t8 values (9,'unidentifiable events are still all recorded',
    case when n = 2 then 'PASS' else 'FAIL' end, n||' row(s)');

  -- ============================================ 3. status discipline
  begin
    update billing_events set status='whatever' where body_sha256='sha-3';
    insert into t8 values (10,'an unknown status is refused','FAIL','accepted');
  exception when check_violation then
    insert into t8 values (10,'an unknown status is refused','PASS','ck_billing_events_status');
  end;

  -- ============================================ 4. reconciliation
  update billing_events set status='failed_permanent', last_error_code='P0002',
         last_error='no subscription for account', attempts=3
   where body_sha256='sha-1';
  select count(*) into n from v_billing_reconciliation where reference='ref_1';
  insert into t8 values (11,'a permanently failed event surfaces for reconciliation',
    case when n = 1 then 'PASS' else 'FAIL' end,
    n||' row(s) — money moved with no matching entitlement change');

  update billing_events set status='applied', applied_at=now() where body_sha256='sha-3';
  select count(*) into n from v_billing_reconciliation where reference is not distinct from null
     and status='applied';
  insert into t8 values (12,'an applied event does not surface',
    case when n = 0 then 'PASS' else 'FAIL' end, n||' row(s)');

  -- ============================================ 5. evidence survives deletion
  delete from accounts where id = a;
  select count(*) into n from billing_events where body_sha256='sha-1';
  insert into t8 values (13,'deleting an account does NOT erase the evidence',
    case when n = 1 then 'PASS' else 'FAIL' end, n||' row(s) retained');
  select count(*) into n from billing_events where body_sha256='sha-1' and account_id is null;
  insert into t8 values (14,'and the account link is nulled, not cascaded',
    case when n = 1 then 'PASS' else 'FAIL' end, n||' row(s) with account_id null');
end
$$;

-- ============================================ 6. access surface
do $$
declare n_read int; n_write text; n int;
begin
  set local role authenticated;
  begin
    select count(*) into n_read from billing_events;
  exception when insufficient_privilege then n_read := -1;
  end;
  begin
    insert into billing_events (body_sha256, signature_valid) values ('attack', true);
    n_write := 'ACCEPTED';
  exception when others then n_write := sqlerrm;
  end;
  reset role;

  insert into t8 values (15,'authenticated cannot read the billing audit trail',
    case when n_read in (-1, 0) then 'PASS' else 'FAIL' end,
    case when n_read = -1 then 'permission denied' else 'saw '||n_read end);
  insert into t8 values (16,'authenticated cannot write to it',
    case when n_write <> 'ACCEPTED' then 'PASS' else 'FAIL' end, left(n_write,52));

  select count(*) into n from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('billing_events','v_billing_reconciliation')
     and grantee in ('anon','authenticated');
  insert into t8 values (17,'anon and authenticated hold no grant at all',
    case when n=0 then 'PASS' else 'FAIL' end, n||' grant(s)');

  select count(*) into n from pg_policies
   where schemaname='public' and tablename='billing_events';
  insert into t8 values (18,'RLS on, with zero client policies (deny by default)',
    case when n=0 and (select relrowsecurity from pg_class where relname='billing_events')
         then 'PASS' else 'FAIL' end, n||' policy(ies)');

  -- the owner inherently holds everything; what matters is that the trusted
  -- BACKEND role cannot erase the evidence by accident
  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and table_name='billing_events'
     and grantee='service_role' and privilege_type in ('DELETE','TRUNCATE');
  insert into t8 values (19,'not even service_role may DELETE or TRUNCATE an audit row',
    case when n=0 then 'PASS' else 'FAIL' end,
    n||' grant(s) — Supabase default privileges hand it arwdDxtm; 0027 narrows that');

  select count(distinct table_name) into n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public';
  insert into t8 values (20,'the 0018 anon surface is still exactly 5 tables',
    case when n=5 then 'PASS' else 'FAIL' end, n||' table(s)');
end
$$;

select n, check_name, verdict, left(detail,58) as detail from t8 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t8;

rollback;
