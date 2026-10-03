-- ============================================================================
-- 0059 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0058 and 0059 is not applied.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0058 is applied (trial_reminders exists)',
         exists(select 1 from pg_class where relname='trial_reminders' and relnamespace='public'::regnamespace), ''
  union all select 2, 'identity: 118 policies in public',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'Supabase Storage is present (storage.objects)',
         exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='storage' and c.relname='objects'), ''
  union all select 4, 'not yet applied: no mm_site_* storage policies',
         not exists(select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%'), ''
  union all select 5, 'a bucket called "site" does not exist yet (0059 would take it over)',
         not exists(select 1 from storage.buckets where id='site'),
         coalesce((select 'exists: public='||public from storage.buckets where id='site'), 'none')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
