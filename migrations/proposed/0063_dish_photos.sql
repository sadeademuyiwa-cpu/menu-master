-- ============================================================================
-- MENU MASTER NG
-- 0063: a photo of each dish, taken by the business itself
--
-- Requires: 0001-0062 applied.
--
-- WHY
--   The owner asked for the app to look like a menu: her own jollof on the
--   sale screen, the dish list, Home and the dish page. There is nowhere to
--   keep such a picture. The only storage is the website's bucket (0059),
--   which only a platform admin may write.
--
-- HOW
--   recipes.photo_path      the storage object name of the dish's photo, or
--                           NULL. A check keeps it inside the dish's OWN
--                           business folder: it starts with the recipe's
--                           business_id and '/', has no '..' and is at most
--                           200 characters. The app writes
--                             <business_id>/<recipe_id>/<random>.<webp|jpg>
--                           and a thumbnail beside it with "-320" before the
--                           extension. Writing the column rides on the
--                           existing recipes UPDATE policy (0015/0028):
--                           owner, manager and kitchen, on an entitled account.
--   storage bucket 'dish'   PUBLIC: a photo opens by its address, which is
--                           cheapest on a customer's data and ready for a
--                           shared menu. The file names are random, so an
--                           address cannot be guessed. JPEG or WebP only, at
--                           most 512 KB (the phone shrinks a photo to about
--                           120 KB first).
--   four policies on storage.objects, each limited to bucket 'dish', keyed on
--                           the FIRST FOLDER of the object name, which is a
--                           business id:
--                             INSERT, UPDATE, DELETE  the same people who may
--                               edit dishes: a member of that business's
--                               account whose role is owner, manager or
--                               kitchen, on an account that is entitled. These
--                               are the three conjuncts of p_recipes_update,
--                               built from the same helpers, so a photo can be
--                               changed by exactly whoever can change the dish.
--                             SELECT (listing)  any member of that account.
--                           Opening a file by its public address needs no
--                           policy: the bucket is public.
--
-- WHAT DOES NOT CHANGE
--   No public policy (118) and no function (98). The website bucket and its
--   four mm_site_* policies are untouched. No customer row is written: every
--   existing dish starts with no photo.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0063 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if (select pg_get_viewdef('v_recipe_line_costs'::regclass) not like '%rl.ingredient_id IS NOT NULL%') then
    raise exception '0063 preflight FAILED: v_recipe_line_costs is not the 0062 version. Apply 0062 first.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'storage' and c.relname = 'objects')
     or not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'storage' and c.relname = 'buckets') then
    raise exception '0063 preflight FAILED: storage.objects or storage.buckets is missing. Supabase provides them; locally the shim does.';
  end if;
  if to_regprocedure('public.fn_is_account_member(uuid)') is null
     or to_regprocedure('public.fn_has_account_role(uuid, public.member_role[])') is null
     or to_regprocedure('public.fn_account_is_entitled(uuid)') is null then
    raise exception '0063 preflight FAILED: a membership, role or entitlement helper is missing (0004, 0015, 0028).';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='recipes' and column_name='photo_path') then
    raise exception '0063 preflight FAILED: recipes.photo_path already exists.';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%') then
    raise exception '0063 preflight FAILED: the mm_dish_* storage policies already exist.';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') <> 4 then
    raise exception '0063 preflight FAILED: % mm_site_* storage policies, expected the four from 0059.',
      (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%');
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0063 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0063 preflight FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Where a dish's photo is
-- ---------------------------------------------------------------------------
-- A path, not a URL: the address is built from the bucket at read time, so a
-- change of project URL or CDN never leaves stale links in the data. The
-- check is a table constraint because it reads business_id as well.
alter table recipes
  add column photo_path text,
  add constraint ck_recipes_photo_path check (
    photo_path is null
    or (    starts_with(photo_path, business_id::text || '/')
        -- something inside the folder, not the folder itself
        and length(photo_path) > length(business_id::text) + 1
        and strpos(photo_path, '..') = 0
        and length(photo_path) <= 200));

comment on column recipes.photo_path is
  'Storage object name of the dish''s photo in the public bucket "dish", or NULL '
  'when there is none. Always inside the dish''s own business folder: '
  '<business_id>/<recipe_id>/<random>.<webp|jpg>; the thumbnail is the same name '
  'with -320 before the extension. A missing photo shows the dish tile.';

-- ---------------------------------------------------------------------------
-- 2. The bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish', 'dish', true, 524288, array['image/jpeg', 'image/webp'])
on conflict (id) do update
   set public = true,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Who may write it: whoever may edit dishes in that business
-- ---------------------------------------------------------------------------
-- The first folder is compared as text, so a name whose first folder is not a
-- uuid simply matches nothing instead of raising a cast error. The subquery
-- does not refer to the object row, so it is worked out once per statement.
create policy mm_dish_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dish'
    and strpos(name, '/') > 0
    and split_part(name, '/', 1) in (
      select b.id::text from public.businesses b
       where public.fn_is_account_member(b.account_id)
         and public.fn_has_account_role(b.account_id,
               array['owner','manager','kitchen']::public.member_role[])
         and public.fn_account_is_entitled(b.account_id)));

-- USING and WITH CHECK alike: a photo cannot be moved into another
-- business's folder, nor taken over from one.
create policy mm_dish_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'dish'
    and strpos(name, '/') > 0
    and split_part(name, '/', 1) in (
      select b.id::text from public.businesses b
       where public.fn_is_account_member(b.account_id)
         and public.fn_has_account_role(b.account_id,
               array['owner','manager','kitchen']::public.member_role[])
         and public.fn_account_is_entitled(b.account_id)))
  with check (
    bucket_id = 'dish'
    and strpos(name, '/') > 0
    and split_part(name, '/', 1) in (
      select b.id::text from public.businesses b
       where public.fn_is_account_member(b.account_id)
         and public.fn_has_account_role(b.account_id,
               array['owner','manager','kitchen']::public.member_role[])
         and public.fn_account_is_entitled(b.account_id)));

create policy mm_dish_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'dish'
    and strpos(name, '/') > 0
    and split_part(name, '/', 1) in (
      select b.id::text from public.businesses b
       where public.fn_is_account_member(b.account_id)
         and public.fn_has_account_role(b.account_id,
               array['owner','manager','kitchen']::public.member_role[])
         and public.fn_account_is_entitled(b.account_id)));

-- Listing the bucket through the API: any member, like every other read.
-- Not gated on entitlement, by the rule since 0028: a lapsed customer keeps
-- read access to what is theirs.
create policy mm_dish_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dish'
    and strpos(name, '/') > 0
    and split_part(name, '/', 1) in (
      select b.id::text from public.businesses b
       where public.fn_is_account_member(b.account_id)));

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='recipes' and column_name='photo_path'
                   and data_type='text' and is_nullable='YES') then
    raise exception '0063 self-check FAILED: recipes.photo_path is not a nullable text column.';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid='public.recipes'::regclass and conname='ck_recipes_photo_path'
                   and contype='c' and convalidated) then
    raise exception '0063 self-check FAILED: ck_recipes_photo_path is missing or not validated.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'dish' and public
                   and file_size_limit = 524288
                   and allowed_mime_types = array['image/jpeg', 'image/webp']) then
    raise exception '0063 self-check FAILED: bucket dish is not public, limited to 512 KB and JPEG/WebP.';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
        and policyname like 'mm\_dish\_%' and roles = '{authenticated}'
        and coalesce(qual, '') || coalesce(with_check, '') like '%''dish''%') <> 4 then
    raise exception '0063 self-check FAILED: expected four mm_dish_* storage policies, for authenticated, limited to bucket dish.';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%'
        and policyname <> 'mm_dish_select'
        and coalesce(qual, '') || coalesce(with_check, '') like '%fn_has_account_role%'
        and coalesce(qual, '') || coalesce(with_check, '') like '%kitchen%'
        and coalesce(qual, '') || coalesce(with_check, '') like '%fn_account_is_entitled%') <> 3 then
    raise exception '0063 self-check FAILED: a write policy does not carry the dish-editing role and entitlement checks.';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') <> 4 then
    raise exception '0063 self-check FAILED: the website bucket''s four policies moved.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0063 self-check FAILED: 0063 must add no policy in public.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0063 self-check FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0063 OK: recipes.photo_path (inside its own business folder); public bucket "dish" '
               '(JPEG/WebP, 512 KB); four mm_dish_* storage policies (write: owner, manager, kitchen '
               'on an entitled account; list: members); 118 public policies, 98 fn_* unchanged.';
end
$$;
