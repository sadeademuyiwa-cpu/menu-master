-- ============================================================================
-- MENU MASTER NG -- tests/051_help_videos.sql
--
-- Acceptance test for 0065. Run on a database with 0065 applied.
-- Rolls everything back.
--
-- Each screen's help video link is public, like the rest of the website's
-- settings: anyone may read it, only a platform admin may change it, and
-- the sixth row changed nothing else.
-- ============================================================================

begin;

create temp table t51 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000051-0000-4000-8000-000000000001', 'admin@t51.test'),
  ('00000051-0000-4000-8000-000000000002', 'owner@t51.test');
insert into platform_admins (user_id, reason) values
  ('00000051-0000-4000-8000-000000000001', 'test 051');

-- ============================================ 1. shape
do $$
begin
  insert into t51 values (1,'the help setting exists and starts empty',
    case when (select value from site_settings where key='help') = '{}'::jsonb then 'PASS' else 'FAIL' end, '');
  insert into t51 values (2,'six settings, no more',
    case when (select string_agg(key, ',' order by key) from site_settings) = 'analytics,company,help,landing,privacy,signin'
         then 'PASS' else 'FAIL' end, (select string_agg(key, ',' order by key) from site_settings));
  insert into t51 values (3,'the key constraint admits help',
    case when (select count(*) from pg_constraint where conname='ck_site_settings_key'
                and pg_get_constraintdef(oid) like '%help%') = 1 then 'PASS' else 'FAIL' end, '');
end $$;

do $$
declare v text := 'INSERTED';
begin
  begin insert into site_settings (key) values ('secrets'); exception when others then v := sqlstate; end;
  insert into t51 values (4,'the constraint refuses an unknown key (23514)',
    case when v = '23514' then 'PASS' else 'FAIL' end, v);
end $$;

-- ============================================ 2. reading, as a visitor and as an owner
do $$
declare v_anon int; v_owner int;
begin
  perform set_config('request.jwt.claim.sub','', true);
  set local role anon;
  select count(*) into v_anon from (select key, value from site_settings where key = 'help') s;
  reset role;
  perform set_config('request.jwt.claim.sub','00000051-0000-4000-8000-000000000002', true);
  set local role authenticated;
  select count(*) into v_owner from (select key, value from site_settings where key = 'help') s;
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  insert into t51 values (5,'a logged-out visitor reads the help links (the login screen has one)',
    case when v_anon = 1 then 'PASS' else 'FAIL' end, v_anon::text);
  insert into t51 values (6,'a signed-in owner reads them too',
    case when v_owner = 1 then 'PASS' else 'FAIL' end, v_owner::text);
end $$;

-- ============================================ 3. writing
do $$
declare v_res text; v_upd text;
begin
  perform set_config('request.jwt.claim.sub','00000051-0000-4000-8000-000000000002', true);
  set local role authenticated;
  v_res := 'WROTE';
  begin perform fn_admin_set_site_setting('help', '{"sale-new":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'); exception when others then v_res := sqlstate; end;
  v_upd := 'WROTE';
  begin update site_settings set value = '{"x":1}' where key = 'help'; exception when others then v_upd := sqlstate; end;
  reset role;
  insert into t51 values (7,'an owner cannot set help videos through the function (42501)',
    case when v_res = '42501' then 'PASS' else 'FAIL' end, v_res);
  insert into t51 values (8,'nor by writing the table (42501)',
    case when v_upd = '42501' then 'PASS' else 'FAIL' end, v_upd);

  perform set_config('request.jwt.claim.sub','00000051-0000-4000-8000-000000000001', true);
  set local role authenticated;
  perform fn_admin_set_site_setting('help', '{"sale-new":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}');
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  insert into t51 values (9,'the admin can set a screen''s video',
    case when (select value->>'sale-new' from site_settings where key='help') = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
         then 'PASS' else 'FAIL' end, '');
  insert into t51 values (10,'and the change records who',
    case when (select updated_by from site_settings where key='help') = '00000051-0000-4000-8000-000000000001'
         then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 4. nothing else moved
insert into t51 values (11,'118 policies: 0065 added none',
  case when (select count(*) from pg_policies where schemaname='public')=118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));
insert into t51 values (12,'99 fn_*: 0065 added none',
  case when (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')=99
       then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%'));

select n, check_name, verdict, left(detail,60) as detail from t51 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t51;

rollback;
