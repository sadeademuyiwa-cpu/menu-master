-- ============================================================================
-- MENU MASTER NG
-- 0059: pictures for the public website, uploaded by a platform admin
--
-- Requires: 0001-0058 applied.
--
-- WHY
--   0057 lets the admin set the landing page's logo, main picture and
--   screenshots -- as links. The owner has the pictures on a phone, not a
--   link. This gives them somewhere to upload to: Admin -> Website now has an
--   "Upload a picture" button beside each picture.
--
-- HOW
--   storage bucket 'site'   PUBLIC: anyone may open a file by its address,
--                           because these are the website's own pictures.
--                           PNG, JPEG or WebP only -- not SVG, which can carry
--                           script -- and at most 2 MB each.
--   four policies on storage.objects, each limited to bucket 'site' and to
--                           fn_is_platform_admin(): only an admin may add,
--                           replace, remove or list files there. A customer's
--                           session can upload nothing.
--
-- WHAT DOES NOT CHANGE
--   No public table, function or policy: 118 policies in public before and
--   after (these four live in the storage schema). No customer row.
--   Nothing a customer entered is ever stored in this bucket.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0059 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='trial_reminders' and relnamespace='public'::regnamespace) then
    raise exception '0059 preflight FAILED: trial_reminders is missing. Apply 0058 first.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'storage' and c.relname = 'objects') then
    raise exception '0059 preflight FAILED: storage.objects is missing. Supabase provides it; locally the shim does.';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') then
    raise exception '0059 preflight FAILED: the mm_site_* storage policies already exist.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0059 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site', 'site', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
   set public = true,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Who may write it: platform admins, in this bucket only
-- ---------------------------------------------------------------------------
create policy mm_site_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site' and public.fn_is_platform_admin());

create policy mm_site_update on storage.objects
  for update to authenticated
  using (bucket_id = 'site' and public.fn_is_platform_admin())
  with check (bucket_id = 'site' and public.fn_is_platform_admin());

create policy mm_site_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'site' and public.fn_is_platform_admin());

-- Listing the bucket through the API. Opening a file by its public address
-- needs no policy: the bucket is public.
create policy mm_site_select on storage.objects
  for select to authenticated
  using (bucket_id = 'site' and public.fn_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0059 self-check FAILED: 0059 must add no policy in public.';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') <> 4 then
    raise exception '0059 self-check FAILED: expected the four mm_site_* storage policies.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site' and public
                   and file_size_limit = 2097152
                   and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']) then
    raise exception '0059 self-check FAILED: bucket site is not public, limited to 2 MB and three picture types.';
  end if;
  raise notice '0059 OK: public bucket "site" (PNG/JPEG/WebP, 2 MB); four storage policies, '
               'platform admins only; 118 public policies unchanged.';
end
$$;
