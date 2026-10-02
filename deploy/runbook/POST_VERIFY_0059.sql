-- ============================================================================
-- 0059 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0059 commits.
-- EXPECTED: 4 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'bucket "site": public, 2 MB, PNG/JPEG/WebP only',
         exists(select 1 from storage.buckets where id='site' and public and file_size_limit=2097152
                  and allowed_mime_types = array['image/png','image/jpeg','image/webp']), ''
  union all select 2, 'four mm_site_* storage policies, all for authenticated, all platform-admin only',
         (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%'
            and roles = '{authenticated}'
            and coalesce(qual, '') || coalesce(with_check, '') like '%fn_is_platform_admin%') = 4,
         (select string_agg(policyname, ', ' order by policyname) from pg_policies
           where schemaname='storage' and policyname like 'mm\_site\_%')
  union all select 3, '118 policies in public, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 4, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
