-- ============================================================================
-- MENU MASTER NG -- tests/043_site_settings.sql
--
-- Acceptance test for 0057. Run on a database with 0057 applied.
-- Rolls everything back.
--
-- What the public website says is readable by anyone and writable only by a
-- platform admin, and reading it never reveals which admin wrote it.
--
-- Client-role probes capture their result into variables and write the row
-- AFTER `reset role`: the results table belongs to the test session's own
-- role, which a client role cannot write to.
-- ============================================================================

begin;

create temp table t43 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000043-0000-4000-8000-000000000001', 'admin@t43.test'),
  ('00000043-0000-4000-8000-000000000002', 'customer@t43.test');
insert into platform_admins (user_id, reason) values
  ('00000043-0000-4000-8000-000000000001', 'test 043');

-- ============================================ 1. shape
do $$
begin
  insert into t43 values (1,'exactly the five settings exist',
    case when (select string_agg(key, ',' order by key) from site_settings) = 'analytics,company,landing,privacy,signin'
         then 'PASS' else 'FAIL' end, (select string_agg(key, ',' order by key) from site_settings));
  insert into t43 values (2,'RLS is on, with one SELECT policy',
    case when (select relrowsecurity from pg_class where relname='site_settings')
          and (select count(*) from pg_policies where tablename='site_settings') = 1
          and (select cmd from pg_policies where tablename='site_settings') = 'SELECT'
         then 'PASS' else 'FAIL' end, '');
  insert into t43 values (3,'no client role may write the table directly',
    case when not has_table_privilege('anon','site_settings','insert,update,delete,truncate')
          and not has_table_privilege('authenticated','site_settings','insert,update,delete,truncate')
         then 'PASS' else 'FAIL' end, '');
  insert into t43 values (4,'no client role may see who edited it',
    case when not has_column_privilege('anon','site_settings','updated_by','select')
          and not has_column_privilege('authenticated','site_settings','updated_by','select')
         then 'PASS' else 'FAIL' end, '');
  insert into t43 values (5,'anon cannot call the writer',
    case when not has_function_privilege('anon','fn_admin_set_site_setting(text, jsonb)','execute')
         then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 2. reading, as a visitor
do $$
declare v_rows int; v_who text;
begin
  perform set_config('request.jwt.claim.sub','', true);
  set local role anon;
  select count(*) into v_rows from (select key, value, updated_at from site_settings) s;
  v_who := 'HIDDEN';
  begin perform updated_by from site_settings; v_who := 'SHOWN'; exception when others then v_who := sqlstate; end;
  reset role;
  insert into t43 values (6,'a logged-out visitor reads key, value and date',
    case when v_rows = 5 then 'PASS' else 'FAIL' end, v_rows::text);
  insert into t43 values (7,'but not who wrote it (42501)',
    case when v_who = '42501' then 'PASS' else 'FAIL' end, v_who);
end $$;

-- ============================================ 3. writing
do $$
declare v_res text; v_upd text; v_bad text; v_shape text;
begin
  -- a signed-in customer
  perform set_config('request.jwt.claim.sub','00000043-0000-4000-8000-000000000002', true);
  set local role authenticated;
  v_res := 'WROTE';
  begin perform fn_admin_set_site_setting('analytics', '{"meta_pixel_id":"123"}'); exception when others then v_res := sqlstate; end;
  v_upd := 'WROTE';
  begin update site_settings set value = '{"x":1}' where key = 'landing'; exception when others then v_upd := sqlstate; end;
  reset role;
  insert into t43 values (8,'a customer cannot change the website through the function (42501)',
    case when v_res = '42501' then 'PASS' else 'FAIL' end, v_res);
  insert into t43 values (9,'nor by writing the table (42501)',
    case when v_upd = '42501' then 'PASS' else 'FAIL' end, v_upd);
  insert into t43 values (10,'and nothing changed',
    case when (select value from site_settings where key='analytics') = '{}'::jsonb
          and (select value from site_settings where key='landing') = '{}'::jsonb
         then 'PASS' else 'FAIL' end, '');

  -- the admin
  perform set_config('request.jwt.claim.sub','00000043-0000-4000-8000-000000000001', true);
  set local role authenticated;
  perform fn_admin_set_site_setting('analytics', '{"meta_pixel_id":"123456789012345"}');
  v_bad := 'ACCEPTED';
  begin perform fn_admin_set_site_setting('secrets', '{"a":1}'); exception when others then v_bad := sqlstate; end;
  v_shape := 'ACCEPTED';
  begin perform fn_admin_set_site_setting('privacy', '"just text"'); exception when others then v_shape := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  insert into t43 values (11,'the admin can change a setting',
    case when (select value->>'meta_pixel_id' from site_settings where key='analytics') = '123456789012345'
         then 'PASS' else 'FAIL' end, '');
  insert into t43 values (12,'and the change records who and when',
    case when (select updated_by from site_settings where key='analytics') = '00000043-0000-4000-8000-000000000001'
          and (select updated_at from site_settings where key='analytics') > now() - interval '1 minute'
         then 'PASS' else 'FAIL' end, '');
  insert into t43 values (13,'an unknown setting is refused, not created (P0002)',
    case when v_bad = 'P0002' and (select count(*) from site_settings) = 5 then 'PASS' else 'FAIL' end, v_bad);
  insert into t43 values (14,'a value that is not an object is refused (22023)',
    case when v_shape = '22023' then 'PASS' else 'FAIL' end, v_shape);
end $$;

-- ============================================ 4. nothing else moved
insert into t43 values (15,'118 policies: 0057 added exactly one',
  case when (select count(*) from pg_policies where schemaname='public')=118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,60) as detail from t43 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t43;

rollback;
