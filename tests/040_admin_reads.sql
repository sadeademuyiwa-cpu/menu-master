-- ============================================================================
-- MENU MASTER NG -- tests/040_admin_reads.sql
--
-- Acceptance test for 0054. Run on a database with 0054 applied.
-- Rolls everything back.
--
-- Every read refuses a non-admin BEFORE it reads, an admin gets the documented
-- shape, and nothing a customer could not already see about their own account
-- leaks: no payload, no provider codes, no recipes or prices.
-- ============================================================================

begin;

create temp table t40 (n int, check_name text, verdict text, detail text) on commit drop;

-- an admin, a customer with a business, and a customer who never finished
insert into auth.users (id, email) values
  ('00000040-0000-4000-8000-000000000001', 'admin@t40.test'),
  ('00000040-0000-4000-8000-000000000002', 'owner@t40.test'),
  ('00000040-0000-4000-8000-000000000003', 'lost@t40.test');
insert into platform_admins (user_id, reason) values ('00000040-0000-4000-8000-000000000001', 'test 040');

create temp table t40_ids on commit drop as
select (fn_create_account_and_business('T40 Foods','T40 Kitchen','other',
          '00000040-0000-4000-8000-000000000002', p_idempotency_key => 't40-owner')->>'account_id')::uuid as account_id;

-- a second account with no business, made the way the data would actually look
insert into accounts (id, name) values ('00000040-0000-4000-8000-00000000000a', 'T40 Unfinished');
insert into memberships (account_id, user_id, role)
  values ('00000040-0000-4000-8000-00000000000a', '00000040-0000-4000-8000-000000000003', 'owner');

-- a failed billing event with a payload that must never come back out
insert into billing_events (event_type, provider_event_id, reference, account_id, body_sha256,
                            payload, signature_valid, status, last_error_code, last_error)
values ('charge.success', 'evt-t40', 'ref-t40', (select account_id from t40_ids), 'sha-t40',
        '{"data":{"secret_marker":"NEVER_SHOWN","authorization":{"last4":"4081"}}}'::jsonb,
        true, 'failed_permanent', 'unmapped_plan_code', 'plan code X is not mapped');
-- and a rejected signature
insert into billing_events (event_type, body_sha256, signature_valid, status)
values ('charge.success', 'sha-t40-bad', false, 'rejected');

-- ============================================ 1. refusals, as a client
do $$
declare c1 text; c2 text; c3 text; a1 text;
begin
  perform set_config('request.jwt.claim.sub','00000040-0000-4000-8000-000000000002', true);
  set local role authenticated;
  c1 := 'OK'; begin perform fn_admin_billing_health(30); exception when others then c1 := sqlstate; end;
  c2 := 'OK'; begin perform fn_admin_subscriptions();     exception when others then c2 := sqlstate; end;
  c3 := 'OK'; begin perform fn_admin_signups(30);         exception when others then c3 := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  set local role anon;
  a1 := 'OK'; begin perform fn_admin_subscriptions(); exception when others then a1 := sqlstate; end;
  reset role;
  insert into t40 values (1,'a customer is refused billing health with 42501', case when c1='42501' then 'PASS' else 'FAIL' end, c1);
  insert into t40 values (2,'a customer is refused subscriptions with 42501',  case when c2='42501' then 'PASS' else 'FAIL' end, c2);
  insert into t40 values (3,'a customer is refused signups with 42501',        case when c3='42501' then 'PASS' else 'FAIL' end, c3);
  insert into t40 values (4,'anon cannot even execute the function',           case when a1='42501' then 'PASS' else 'FAIL' end, a1);
end $$;

-- ============================================ 2. the admin's view
do $$
declare b jsonb; s jsonb; g jsonb; acct uuid; row_ jsonb;
begin
  select account_id into acct from t40_ids;
  perform set_config('request.jwt.claim.sub','00000040-0000-4000-8000-000000000001', true);
  set local role authenticated;
  b := fn_admin_billing_health(30);
  s := fn_admin_subscriptions();
  g := fn_admin_signups(30);
  reset role;
  perform set_config('request.jwt.claim.sub','', true);

  -- billing
  insert into t40 values (5,'billing health carries the documented keys',
    case when b ? 'events_by_day' and b ? 'totals' and b ? 'reconciliation' and b ? 'anomalies'
          and b ? 'signature_rejections' then 'PASS' else 'FAIL' end, '');
  insert into t40 values (6,'the failed event is in the reconciliation rows',
    case when exists (select 1 from jsonb_array_elements(b->'reconciliation') r
                       where r->>'reference'='ref-t40' and r->>'status'='failed_permanent') then 'PASS' else 'FAIL' end, '');
  insert into t40 values (7,'and its payload is NOT -- not even the redacted shape',
    case when b::text not like '%NEVER_SHOWN%' and b::text not like '%payload%' and b::text not like '%last4%'
         then 'PASS' else 'FAIL' end, '');
  insert into t40 values (8,'a rejected signature is counted',
    case when (b->>'signature_rejections')::int >= 1 then 'PASS' else 'FAIL' end, b->>'signature_rejections');
  insert into t40 values (9,'totals count by status',
    case when (b->'totals'->>'failed_permanent')::int >= 1 and (b->'totals'->>'rejected')::int >= 1 then 'PASS' else 'FAIL' end,
    (b->'totals')::text);

  -- subscriptions
  select r into row_ from jsonb_array_elements(s->'rows') r where (r->>'account_id')::uuid = acct;
  insert into t40 values (10,'the new account''s subscription is listed with its plan and owner',
    case when row_ is not null and row_->>'plan_id'='trial' and row_->>'status'='trialing'
          and row_->>'owner_email'='owner@t40.test' and row_->>'account_name'='T40 Foods' then 'PASS' else 'FAIL' end,
    coalesce(row_::text, 'missing'));
  insert into t40 values (11,'entitled is the database''s own verdict',
    case when (row_->>'entitled')::bool = fn_account_is_entitled(acct) then 'PASS' else 'FAIL' end, row_->>'entitled');
  insert into t40 values (12,'no provider codes come back',
    case when s::text not like '%provider_customer_code%' and s::text not like '%provider_subscription_code%'
         then 'PASS' else 'FAIL' end, '');
  insert into t40 values (13,'founder slot totals add up to 100',
    case when (s->'founder_slots'->>'total')::int = 100
          and (s->'founder_slots'->>'claimed')::int + (s->'founder_slots'->>'forfeited')::int
              + (s->'founder_slots'->>'free')::int <= 100 then 'PASS' else 'FAIL' end,
    (s->'founder_slots')::text);
  insert into t40 values (14,'the row count equals the subscriptions table',
    case when jsonb_array_length(s->'rows') = (select count(*) from subscriptions) then 'PASS' else 'FAIL' end,
    jsonb_array_length(s->'rows')::text);

  -- signups
  insert into t40 values (15,'today''s signups include the new accounts',
    case when exists (select 1 from jsonb_array_elements(g->'per_day') d
                       where (d->>'day')::date = current_date and (d->>'accounts')::int >= 2) then 'PASS' else 'FAIL' end,
    (g->'per_day')::text);
  insert into t40 values (16,'the account that never made a business is named, with its owner',
    case when exists (select 1 from jsonb_array_elements(g->'accounts_without_business') a
                       where a->>'name'='T40 Unfinished' and a->>'owner_email'='lost@t40.test') then 'PASS' else 'FAIL' end, '');
  insert into t40 values (17,'the finished account is not in that list',
    case when not exists (select 1 from jsonb_array_elements(g->'accounts_without_business') a
                           where (a->>'account_id')::uuid = acct) then 'PASS' else 'FAIL' end, '');
  insert into t40 values (18,'nothing a customer entered is returned',
    case when (b::text || s::text || g::text) not like '%recipe%'
          and (b::text || s::text || g::text) not like '%ingredient%'
          and (b::text || s::text || g::text) not like '%T40 Kitchen%' then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 3. a trial ending soon is surfaced
update subscriptions set trial_ends_at = now() + interval '3 days'
 where account_id = (select account_id from t40_ids);

do $$
declare g jsonb;
begin
  perform set_config('request.jwt.claim.sub','00000040-0000-4000-8000-000000000001', true);
  set local role authenticated;
  g := fn_admin_signups(30);
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  insert into t40 values (19,'a trial ending within 7 days is listed',
    case when exists (select 1 from jsonb_array_elements(g->'trials_ending_soon') t
                       where t->>'name'='T40 Foods') then 'PASS' else 'FAIL' end, (g->'trials_ending_soon')::text);
end $$;

-- ============================================ 4. nothing else moved
insert into t40 values (20,'117 policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=117 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,70) as detail from t40 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t40;

rollback;
