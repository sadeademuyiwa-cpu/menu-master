-- ============================================================================
-- 0059 ROLLBACK: remove the four mm_site_* storage policies. Back at 0058.
--
-- The bucket and its files are LEFT IN PLACE: they are the website's
-- pictures, the landing page may still point at them, and Supabase does not
-- allow deleting storage rows from SQL. With the policies gone nobody can
-- upload to it any more. To remove it, empty and delete it in Supabase ->
-- Storage, after taking the pictures off the landing page.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0059 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') then
    raise exception '0059 rollback: the mm_site_* policies do not exist; 0059 is not applied.';
  end if;
end
$$;

drop policy if exists mm_site_select on storage.objects;
drop policy if exists mm_site_delete on storage.objects;
drop policy if exists mm_site_update on storage.objects;
drop policy if exists mm_site_insert on storage.objects;

do $$
begin
  if exists (select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') then
    raise exception '0059 rollback FAILED: an mm_site_* policy remains.';
  end if;
  raise notice '0059 rollback OK: back at 0058. Bucket "site" and its files are kept; nobody can upload to it.';
end
$$;
