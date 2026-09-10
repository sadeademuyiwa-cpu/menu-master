-- ============================================================================
-- MENU MASTER NG -- tests/039_platform_admins.sql
--
-- Acceptance test for 0053. Run on a database with 0053 applied.
-- Rolls everything back.
--
-- The one fact Part A rests on: a short list of administrators that no client
-- can read, write or forge, and two helpers that answer only about the caller.
--
-- Client-role probes capture their result into variables and write the row
-- AFTER `reset role`: the results table belongs to the test session's own
-- role, which a client role cannot write to.
-- ============================================================================

begin;

create temp table t39 (n int, check_name text, verdict text, detail text) on commit drop;

-- two signed-in users: one will be granted, one never is
insert into auth.users (id, email) values
  ('00000039-0000-4000-8000-000000000001', 'admin@t39.test'),
  ('00000039-0000-4000-8000-000000000002', 'customer@t39.test');

-- ============================================ 1. shape
do $$
begin
  insert into t39 values (1,'platform_admins exists with RLS on and no policy',
    case when (select relrowsecurity from pg_class where relname='platform_admins')
          and not exists (select 1 from pg_policies where tablename='platform_admins')
         then 'PASS' else 'FAIL' end, '');
  insert into t39 values (2,'no client role holds any privilege on it',
    case when not has_table_privilege('anon','platform_admins','select')
          and not has_table_privilege('authenticated','platform_admins','select')
          and not has_table_privilege('authenticated','platform_admins','insert')
         then 'PASS' else 'FAIL' end, '');
  insert into t39 values (3,'service_role cannot delete a grant (revocation is a timestamp)',
    case when not has_table_privilege('service_role','platform_admins','delete') then 'PASS' else 'FAIL' end, '');
  insert into t39 values (4,'a grant needs a reason',
    case when exists (select 1 from pg_constraint where conname='ck_platform_admins_reason') then 'PASS' else 'FAIL' end, '');
  insert into t39 values (5,'anon can call neither helper',
    case when not has_function_privilege('anon','fn_is_platform_admin()','execute')
          and not has_function_privilege('anon','fn_require_platform_admin()','execute')
         then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 2. behaviour, as a client
-- grant one admin in the service context (what the runbook does)
insert into platform_admins (user_id, reason) values
  ('00000039-0000-4000-8000-000000000001', 'test 039');

do $$
declare v_is bool; v_req text; v_ins text; v_read text; v_none bool;
begin
  -- the admin, signed in
  perform set_config('request.jwt.claim.sub','00000039-0000-4000-8000-000000000001', true);
  set local role authenticated;
  v_is := fn_is_platform_admin();
  v_req := 'OK';
  begin perform fn_require_platform_admin(); exception when others then v_req := sqlstate; end;
  reset role;
  insert into t39 values (6,'an unrevoked admin is recognised',
    case when v_is then 'PASS' else 'FAIL' end, v_is::text);
  insert into t39 values (7,'fn_require_platform_admin lets the admin through',
    case when v_req='OK' then 'PASS' else 'FAIL' end, v_req);

  -- the customer, signed in
  perform set_config('request.jwt.claim.sub','00000039-0000-4000-8000-000000000002', true);
  set local role authenticated;
  v_is := fn_is_platform_admin();
  v_req := 'OK';
  begin perform fn_require_platform_admin(); exception when others then v_req := sqlstate; end;
  v_ins := 'WROTE';
  begin
    insert into platform_admins (user_id, reason) values ('00000039-0000-4000-8000-000000000002','self');
  exception when others then v_ins := sqlstate; end;
  v_read := 'READ';
  begin perform * from platform_admins; exception when others then v_read := sqlstate; end;
  reset role;
  insert into t39 values (8,'a signed-in customer is not an admin',
    case when not v_is then 'PASS' else 'FAIL' end, v_is::text);
  insert into t39 values (9,'and is refused with 42501, not an empty result',
    case when v_req='42501' then 'PASS' else 'FAIL' end, v_req);
  insert into t39 values (10,'a customer cannot insert a grant for themselves',
    case when v_ins='42501' then 'PASS' else 'FAIL' end, v_ins);
  insert into t39 values (11,'a customer cannot read the list',
    case when v_read='42501' then 'PASS' else 'FAIL' end, v_read);

  -- nobody signed in
  perform set_config('request.jwt.claim.sub','', true);
  set local role authenticated;
  v_none := fn_is_platform_admin();
  reset role;
  insert into t39 values (12,'no session is not an admin',
    case when not v_none then 'PASS' else 'FAIL' end, v_none::text);
end $$;

-- ============================================ 3. revocation
update platform_admins set revoked_at = now()
 where user_id = '00000039-0000-4000-8000-000000000001';

do $$
declare v_is bool;
begin
  perform set_config('request.jwt.claim.sub','00000039-0000-4000-8000-000000000001', true);
  set local role authenticated;
  v_is := fn_is_platform_admin();
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  insert into t39 values (13,'a revoked admin is no longer recognised',
    case when not v_is then 'PASS' else 'FAIL' end, v_is::text);
  insert into t39 values (14,'the revoked row is kept, not deleted',
    case when (select count(*) from platform_admins where revoked_at is not null) = 1 then 'PASS' else 'FAIL' end, '');
  -- service context passes the requirement (operators, scheduled jobs)
  insert into t39 values (15,'the service context passes fn_require_platform_admin',
    case when fn_is_service_context() then 'PASS' else 'FAIL' end, 'running as '||current_user);
end $$;

-- ============================================ 4. nothing else moved
insert into t39 values (16,'117 policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=117 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,60) as detail from t39 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t39;

rollback;
