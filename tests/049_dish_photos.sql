-- ============================================================================
-- MENU MASTER NG -- tests/049_dish_photos.sql
--
-- Acceptance test for 0063. Run on a database with 0063 applied.
-- Rolls everything back.
--
-- A dish photo goes in the business's own folder of the public bucket
-- "dish", and only the people who may edit dishes there (owner, manager,
-- kitchen, on an entitled account) may put it there, replace it or remove
-- it. Any member may list the folder; nobody else may. recipes.photo_path
-- can only point inside the dish's own business folder. Against the local
-- shim's storage tables, which carry the same policies Supabase's do; the
-- local gateway's Storage stand-in writes each upload's row as the caller.
-- ============================================================================

begin;

create temp table t49 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000049-0000-4000-8000-000000000001', 'owner@t49.test'),
  ('00000049-0000-4000-8000-000000000002', 'manager@t49.test'),
  ('00000049-0000-4000-8000-000000000003', 'kitchen@t49.test'),
  ('00000049-0000-4000-8000-000000000004', 'sales@t49.test'),
  ('00000049-0000-4000-8000-000000000005', 'accountant@t49.test'),
  ('00000049-0000-4000-8000-000000000006', 'other-owner@t49.test'),
  ('00000049-0000-4000-8000-000000000007', 'stranger@t49.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $$;

-- ============================================ 0. fixture: business A (five roles) and business B
create temp table fx49 on commit drop as
select (a->>'account_id')::uuid as acct_a, (a->>'business_id')::uuid as biz_a,
       (b->>'account_id')::uuid as acct_b, (b->>'business_id')::uuid as biz_b,
       (select id from units where account_id is null and code='g') as g,
       gen_random_uuid() as dish_a, gen_random_uuid() as dish_b
from fn_create_account_and_business('T49 A Foods','T49 A Kitchen','other',
       '00000049-0000-4000-8000-000000000001', p_idempotency_key => 't49-a') a,
     fn_create_account_and_business('T49 B Foods','T49 B Kitchen','other',
       '00000049-0000-4000-8000-000000000006', p_idempotency_key => 't49-b') b;

do $$
declare f record;
begin
  select * into f from fx49;
  insert into memberships (account_id, user_id, role) values
    (f.acct_a, '00000049-0000-4000-8000-000000000002', 'manager'),
    (f.acct_a, '00000049-0000-4000-8000-000000000003', 'kitchen'),
    (f.acct_a, '00000049-0000-4000-8000-000000000004', 'sales'),
    (f.acct_a, '00000049-0000-4000-8000-000000000005', 'accountant');
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status) values
    (f.dish_a, f.acct_a, f.biz_a, 'T49 Jollof', 4500, f.g, 500, 'active'),
    (f.dish_b, f.acct_b, f.biz_b, 'T49 Puff-puff', 1000, f.g, 50, 'active');
end $$;
insert into storage.buckets (id, name, public) values ('t49-other', 't49-other', false);

-- ============================================ 1. the bucket, the policies, the column
insert into t49 values (1,'bucket "dish" is public, 512 KB, JPEG and WebP only',
  case when exists (select 1 from storage.buckets where id='dish' and public and file_size_limit=524288
                     and allowed_mime_types = array['image/jpeg','image/webp'])
       then 'PASS' else 'FAIL' end,
  coalesce((select public||' '||file_size_limit||' '||allowed_mime_types::text from storage.buckets where id='dish'), 'no bucket'));

insert into t49 values (2,'four mm_dish_* policies, for authenticated, each limited to bucket "dish"',
  case when (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
               and policyname in ('mm_dish_insert','mm_dish_update','mm_dish_delete','mm_dish_select')
               and roles = '{authenticated}'
               and coalesce(qual,'')||coalesce(with_check,'') like '%bucket_id = ''dish''%') = 4
        and (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%') = 4
       then 'PASS' else 'FAIL' end,
  (select string_agg(policyname||':'||cmd, ', ' order by policyname) from pg_policies
    where schemaname='storage' and policyname like 'mm\_dish\_%'));

insert into t49 values (3,'recipes.photo_path is a nullable text column, empty for every dish',
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='recipes'
                      and column_name='photo_path' and data_type='text' and is_nullable='YES')
        and not exists (select 1 from recipes where photo_path is not null)
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 2. who may write, and where
do $$
declare
  f record; a text; b text;
  v_owner text; v_owner_thumb text; v_manager text; v_kitchen text; v_sales text; v_acct text;
  v_owner_in_b text; v_not_biz text; v_no_folder text; v_other_bucket text; v_move text;
  v_k_upd text; v_k_del text; v_s_upd text; v_s_del text; v_s_list int;
  v_b_list int; v_b_upd text; v_b_del text; v_b_own text;
  v_str_list int; v_str_ins text; v_anon_ins text; v_anon_list int;
begin
  select * into f from fx49;
  a := f.biz_a::text; b := f.biz_b::text;

  -- the owner of A
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000001');
  set local role authenticated;
  v_owner := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/k3Rw9.webp');
  exception when others then v_owner := sqlstate; end;
  v_owner_thumb := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/k3Rw9-320.webp');
  exception when others then v_owner_thumb := sqlstate; end;
  v_owner_in_b := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', b||'/'||f.dish_b||'/evil.webp');
  exception when others then v_owner_in_b := sqlstate; end;
  v_not_biz := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', 'menu/'||f.dish_a||'/x.webp');
  exception when others then v_not_biz := sqlstate; end;
  v_no_folder := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a);
  exception when others then v_no_folder := sqlstate; end;
  v_other_bucket := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('t49-other', a||'/'||f.dish_a||'/x.webp');
  exception when others then v_other_bucket := sqlstate; end;
  v_move := 'MOVED';
  begin
    update storage.objects set name = b||'/'||f.dish_b||'/k3Rw9.webp'
     where bucket_id = 'dish' and name = a||'/'||f.dish_a||'/k3Rw9.webp';
    if not found then v_move := 'no rows'; end if;
  exception when others then v_move := sqlstate; end;
  reset role;

  -- the manager of A
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000002');
  set local role authenticated;
  v_manager := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/mgr.jpg');
  exception when others then v_manager := sqlstate; end;
  reset role;

  -- the kitchen of A: may add, replace and remove, as it may edit the dish
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000003');
  set local role authenticated;
  v_kitchen := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/kit.webp');
  exception when others then v_kitchen := sqlstate; end;
  v_k_upd := 'UPDATED';
  begin
    update storage.objects set name = a||'/'||f.dish_a||'/kit2.webp'
     where bucket_id = 'dish' and name = a||'/'||f.dish_a||'/kit.webp';
    if not found then v_k_upd := 'no rows'; end if;
  exception when others then v_k_upd := sqlstate; end;
  v_k_del := 'DELETED';
  begin
    delete from storage.objects where bucket_id = 'dish' and name = a||'/'||f.dish_a||'/kit2.webp';
    if not found then v_k_del := 'no rows'; end if;
  exception when others then v_k_del := sqlstate; end;
  reset role;

  -- the sales member of A: may look, may not touch
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000004');
  set local role authenticated;
  v_sales := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/sales.webp');
  exception when others then v_sales := sqlstate; end;
  v_s_upd := 'UPDATED';
  begin
    update storage.objects set name = a||'/'||f.dish_a||'/renamed.webp'
     where bucket_id = 'dish' and name = a||'/'||f.dish_a||'/k3Rw9.webp';
    if not found then v_s_upd := 'no rows'; end if;
  exception when others then v_s_upd := sqlstate; end;
  v_s_del := 'DELETED';
  begin
    delete from storage.objects where bucket_id = 'dish' and name = a||'/'||f.dish_a||'/k3Rw9.webp';
    if not found then v_s_del := 'no rows'; end if;
  exception when others then v_s_del := sqlstate; end;
  select count(*) into v_s_list from storage.objects where bucket_id = 'dish';
  reset role;

  -- the accountant of A: no recipe administration (0015), so no dish photos
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000005');
  set local role authenticated;
  v_acct := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/acct.webp');
  exception when others then v_acct := sqlstate; end;
  reset role;

  -- the owner of B
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000006');
  set local role authenticated;
  select count(*) into v_b_list from storage.objects where bucket_id = 'dish' and name like a||'/%';
  v_b_upd := 'UPDATED';
  begin
    update storage.objects set name = b||'/'||f.dish_b||'/stolen.webp'
     where bucket_id = 'dish' and name = a||'/'||f.dish_a||'/k3Rw9.webp';
    if not found then v_b_upd := 'no rows'; end if;
  exception when others then v_b_upd := sqlstate; end;
  v_b_del := 'DELETED';
  begin
    delete from storage.objects where bucket_id = 'dish' and name like a||'/%';
    if not found then v_b_del := 'no rows'; end if;
  exception when others then v_b_del := sqlstate; end;
  v_b_own := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', b||'/'||f.dish_b||'/own.webp');
  exception when others then v_b_own := sqlstate; end;
  reset role;

  -- signed in, but a member of nothing
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000007');
  set local role authenticated;
  select count(*) into v_str_list from storage.objects where bucket_id = 'dish';
  v_str_ins := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/x.webp');
  exception when others then v_str_ins := sqlstate; end;
  reset role;

  -- nobody signed in
  perform pg_temp.as_user(null);
  set local role anon;
  select count(*) into v_anon_list from storage.objects where bucket_id = 'dish';
  v_anon_ins := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', a||'/'||f.dish_a||'/anon.webp');
  exception when others then v_anon_ins := sqlstate; end;
  reset role;

  insert into t49 values (4,'the owner of A can upload a photo and its thumbnail into A''s folder',
    case when v_owner = 'STORED' and v_owner_thumb = 'STORED' then 'PASS' else 'FAIL' end, v_owner||' / '||v_owner_thumb);
  insert into t49 values (5,'so can the manager of A',
    case when v_manager = 'STORED' then 'PASS' else 'FAIL' end, v_manager);
  insert into t49 values (6,'and the kitchen of A, which may also replace and remove one',
    case when v_kitchen = 'STORED' and v_k_upd = 'UPDATED' and v_k_del = 'DELETED' then 'PASS' else 'FAIL' end,
    v_kitchen||' / '||v_k_upd||' / '||v_k_del);
  insert into t49 values (7,'the owner of A cannot upload into B''s folder (42501)',
    case when v_owner_in_b = '42501' then 'PASS' else 'FAIL' end, v_owner_in_b);
  insert into t49 values (8,'nor move A''s photo into B''s folder',
    case when v_move = '42501' then 'PASS' else 'FAIL' end, v_move);
  insert into t49 values (9,'nor upload outside a business folder (not a business, or no folder at all)',
    case when v_not_biz = '42501' and v_no_folder = '42501' then 'PASS' else 'FAIL' end, v_not_biz||' / '||v_no_folder);
  insert into t49 values (10,'and the dish policies open no other bucket',
    case when v_other_bucket = '42501' then 'PASS' else 'FAIL' end, v_other_bucket);
  insert into t49 values (11,'a sales member of A cannot upload (42501)',
    case when v_sales = '42501' then 'PASS' else 'FAIL' end, v_sales);
  insert into t49 values (12,'nor replace or delete the owner''s photo',
    case when v_s_upd = 'no rows' and v_s_del = 'no rows' then 'PASS' else 'FAIL' end, v_s_upd||' / '||v_s_del);
  insert into t49 values (13,'but can list A''s folder, like any member (3 files)',
    case when v_s_list = 3 then 'PASS' else 'FAIL' end, v_s_list::text);
  insert into t49 values (14,'an accountant of A cannot upload (no recipe administration)',
    case when v_acct = '42501' then 'PASS' else 'FAIL' end, v_acct);
  insert into t49 values (15,'the owner of B cannot list, replace or delete A''s photos',
    case when v_b_list = 0 and v_b_upd = 'no rows' and v_b_del = 'no rows' then 'PASS' else 'FAIL' end,
    v_b_list||' / '||v_b_upd||' / '||v_b_del);
  insert into t49 values (16,'but uploads into B''s own folder',
    case when v_b_own = 'STORED' then 'PASS' else 'FAIL' end, v_b_own);
  insert into t49 values (17,'a signed-in non-member cannot list the bucket or upload',
    case when v_str_list = 0 and v_str_ins = '42501' then 'PASS' else 'FAIL' end, v_str_list||' / '||v_str_ins);
  insert into t49 values (18,'a logged-out caller cannot list the bucket or upload',
    case when v_anon_list = 0 and v_anon_ins = '42501' then 'PASS' else 'FAIL' end, v_anon_list||' / '||v_anon_ins);
  insert into t49 values (19,'A''s photos are all still there',
    case when (select count(*) from storage.objects where bucket_id='dish' and name like a||'/%') = 3
         then 'PASS' else 'FAIL' end,
    (select count(*)::text from storage.objects where bucket_id='dish' and name like a||'/%'));
end $$;

-- ============================================ 3. photo_path stays inside the dish's own business folder
do $$
declare
  f record; a text; b text; v text;
  v_ok text; v_other text; v_dots text; v_long text; v_max text; v_bare text; v_folder text; v_null text;
  v_k text; v_s text; v_b text;
begin
  select * into f from fx49;
  a := f.biz_a::text; b := f.biz_b::text;

  -- the constraint alone, as the table owner
  v_ok := 'ACCEPTED';
  begin update recipes set photo_path = a||'/'||f.dish_a||'/k3Rw9.webp' where id = f.dish_a;
  exception when others then v_ok := sqlstate; end;
  v_other := 'ACCEPTED';
  begin update recipes set photo_path = b||'/'||f.dish_a||'/k3Rw9.webp' where id = f.dish_a;
  exception when others then v_other := sqlstate; end;
  v_dots := 'ACCEPTED';
  begin update recipes set photo_path = a||'/../'||b||'/'||f.dish_b||'/x.webp' where id = f.dish_a;
  exception when others then v_dots := sqlstate; end;
  v := a||'/'||f.dish_a||'/';
  v_max := 'ACCEPTED';
  begin update recipes set photo_path = v||repeat('x', 200 - length(v) - 5)||'.webp' where id = f.dish_a;
  exception when others then v_max := sqlstate; end;
  v_long := 'ACCEPTED';
  begin update recipes set photo_path = v||repeat('x', 201 - length(v) - 5)||'.webp' where id = f.dish_a;
  exception when others then v_long := sqlstate; end;
  v_bare := 'ACCEPTED';
  begin update recipes set photo_path = 'k3Rw9.webp' where id = f.dish_a;
  exception when others then v_bare := sqlstate; end;
  v_folder := 'ACCEPTED';
  begin update recipes set photo_path = a||'/' where id = f.dish_a;
  exception when others then v_folder := sqlstate; end;
  v_null := 'ACCEPTED';
  begin update recipes set photo_path = null where id = f.dish_a;
  exception when others then v_null := sqlstate; end;

  -- writing it rides on the recipes UPDATE policy: kitchen yes, sales no, B no
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000003');
  set local role authenticated;
  v_k := 'SET';
  begin
    update recipes set photo_path = a||'/'||f.dish_a||'/kit.webp' where id = f.dish_a;
    if not found then v_k := 'no rows'; end if;
  exception when others then v_k := sqlstate; end;
  reset role;
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000004');
  set local role authenticated;
  v_s := 'SET';
  begin
    update recipes set photo_path = a||'/'||f.dish_a||'/sales.webp' where id = f.dish_a;
    if not found then v_s := 'no rows'; end if;
  exception when others then v_s := sqlstate; end;
  reset role;
  perform pg_temp.as_user('00000049-0000-4000-8000-000000000006');
  set local role authenticated;
  v_b := 'SET';
  begin
    update recipes set photo_path = a||'/'||f.dish_a||'/b.webp' where id = f.dish_a;
    if not found then v_b := 'no rows'; end if;
  exception when others then v_b := sqlstate; end;
  reset role;

  insert into t49 values (20,'photo_path accepts the app''s name: <business>/<dish>/<random>.webp',
    case when v_ok = 'ACCEPTED' then 'PASS' else 'FAIL' end, v_ok);
  insert into t49 values (21,'and refuses another business''s folder (23514)',
    case when v_other = '23514' then 'PASS' else 'FAIL' end, v_other);
  insert into t49 values (22,'and refuses ".." (23514)',
    case when v_dots = '23514' then 'PASS' else 'FAIL' end, v_dots);
  insert into t49 values (23,'200 characters is accepted, 201 is refused',
    case when v_max = 'ACCEPTED' and v_long = '23514' then 'PASS' else 'FAIL' end, v_max||' / '||v_long);
  insert into t49 values (24,'a name outside any folder, or the folder itself, is refused',
    case when v_bare = '23514' and v_folder = '23514' then 'PASS' else 'FAIL' end, v_bare||' / '||v_folder);
  insert into t49 values (25,'NULL (no photo) is accepted',
    case when v_null = 'ACCEPTED' then 'PASS' else 'FAIL' end, v_null);
  insert into t49 values (26,'the kitchen of A sets a dish''s photo through the recipes UPDATE policy',
    case when v_k = 'SET' and (select photo_path from recipes where id = f.dish_a) = a||'/'||f.dish_a||'/kit.webp'
         then 'PASS' else 'FAIL' end, v_k);
  insert into t49 values (27,'a sales member of A and the owner of B cannot',
    case when v_s = 'no rows' and v_b = 'no rows' then 'PASS' else 'FAIL' end, v_s||' / '||v_b);
end $$;

-- ============================================ 4. a lapsed account keeps its photos but adds none
do $$
declare f record; v_ins text; v_list int; v_path text;
begin
  select * into f from fx49;
  -- as the billing system: no signed-in user (fn_is_service_context)
  perform pg_temp.as_user(null);
  update subscriptions set status = 'cancelled', current_period_end = now() - interval '1 day'
   where account_id = f.acct_a;

  perform pg_temp.as_user('00000049-0000-4000-8000-000000000001');
  set local role authenticated;
  v_ins := 'STORED';
  begin insert into storage.objects (bucket_id, name) values ('dish', f.biz_a||'/'||f.dish_a||'/late.webp');
  exception when others then v_ins := sqlstate; end;
  select count(*) into v_list from storage.objects where bucket_id = 'dish';
  v_path := 'SET';
  begin
    update recipes set photo_path = f.biz_a||'/'||f.dish_a||'/late.webp' where id = f.dish_a;
    if not found then v_path := 'no rows'; end if;
  exception when others then v_path := sqlstate; end;
  reset role;

  insert into t49 values (28,'once the account lapses, the owner cannot upload (entitlement, as for dishes)',
    case when v_ins = '42501' and v_path = 'no rows' then 'PASS' else 'FAIL' end, v_ins||' / '||v_path);
  insert into t49 values (29,'but still lists the photos already there (reads are never gated)',
    case when v_list = 3 then 'PASS' else 'FAIL' end, v_list::text);
end $$;

-- ============================================ 5. nothing else moved
insert into t49 values (30,'118 public policies; the website bucket''s four policies unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=118
        and (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%')=4
       then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,60) as detail from t49 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t49;

rollback;
