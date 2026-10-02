-- ============================================================================
-- MENU MASTER NG -- tests/045_site_images.sql
--
-- Acceptance test for 0059. Run on a database with 0059 applied.
-- Rolls everything back.
--
-- Only a platform admin may put a file in the website's bucket, and only in
-- that bucket. Against the local shim's storage tables, which carry the same
-- policies Supabase's do; the HTTP side is exercised by web/e2e/journey-site.mjs.
-- ============================================================================

begin;

create temp table t45 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000045-0000-4000-8000-000000000001', 'admin@t45.test'),
  ('00000045-0000-4000-8000-000000000002', 'customer@t45.test');
insert into platform_admins (user_id, reason) values ('00000045-0000-4000-8000-000000000001', 'test 045');
insert into storage.buckets (id, name, public) values ('t45-other', 't45-other', false);

-- ============================================ 1. the bucket
insert into t45 values (1,'bucket "site" is public, 2 MB, PNG/JPEG/WebP only (no SVG)',
  case when exists (select 1 from storage.buckets where id='site' and public and file_size_limit=2097152
                     and allowed_mime_types = array['image/png','image/jpeg','image/webp'])
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 2. who may write
do $$
declare v_admin text; v_other text; v_cust text; v_anon text; v_cust_upd text; v_cust_del text; v_cust_list int;
begin
  -- the admin
  perform set_config('request.jwt.claim.sub','00000045-0000-4000-8000-000000000001', true);
  set local role authenticated;
  v_admin := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('site', 'logo-t45.png');
  exception when others then v_admin := sqlstate; end;
  v_other := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('t45-other', 'x.png');
  exception when others then v_other := sqlstate; end;
  reset role;

  -- a signed-in customer
  perform set_config('request.jwt.claim.sub','00000045-0000-4000-8000-000000000002', true);
  set local role authenticated;
  v_cust := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('site', 'evil.png');
  exception when others then v_cust := sqlstate; end;
  v_cust_upd := 'UPDATED';
  begin
    update storage.objects set name = 'replaced.png' where bucket_id = 'site' and name = 'logo-t45.png';
    if not found then v_cust_upd := 'no rows'; end if;
  exception when others then v_cust_upd := sqlstate; end;
  v_cust_del := 'DELETED';
  begin
    delete from storage.objects where bucket_id = 'site' and name = 'logo-t45.png';
    if not found then v_cust_del := 'no rows'; end if;
  exception when others then v_cust_del := sqlstate; end;
  select count(*) into v_cust_list from storage.objects where bucket_id = 'site';
  reset role;

  -- nobody signed in
  perform set_config('request.jwt.claim.sub','', true);
  set local role anon;
  v_anon := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('site', 'anon.png');
  exception when others then v_anon := sqlstate; end;
  reset role;

  insert into t45 values (2,'a platform admin can upload to "site"',
    case when v_admin = 'STORED' then 'PASS' else 'FAIL' end, v_admin);
  insert into t45 values (3,'but not to any other bucket',
    case when v_other = '42501' then 'PASS' else 'FAIL' end, v_other);
  insert into t45 values (4,'a signed-in customer cannot upload (42501)',
    case when v_cust = '42501' then 'PASS' else 'FAIL' end, v_cust);
  insert into t45 values (5,'nor replace the admin''s picture',
    case when v_cust_upd = 'no rows' then 'PASS' else 'FAIL' end, v_cust_upd);
  insert into t45 values (6,'nor delete it',
    case when v_cust_del = 'no rows' then 'PASS' else 'FAIL' end, v_cust_del);
  insert into t45 values (7,'nor list the bucket',
    case when v_cust_list = 0 then 'PASS' else 'FAIL' end, v_cust_list::text);
  insert into t45 values (8,'a logged-out caller cannot upload',
    case when v_anon = '42501' then 'PASS' else 'FAIL' end, v_anon);
  insert into t45 values (9,'the admin''s picture is still there',
    case when exists (select 1 from storage.objects where bucket_id='site' and name='logo-t45.png') then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 3. nothing else moved
insert into t45 values (10,'118 public policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,60) as detail from t45 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t45;

rollback;
