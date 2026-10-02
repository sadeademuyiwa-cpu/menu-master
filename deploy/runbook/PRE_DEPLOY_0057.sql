-- ============================================================================
-- 0057 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0056 and 0057 is not applied.
-- EXPECTED: 6 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0056 is applied (fn_accept_invitations exists)',
         exists(select 1 from pg_proc where proname='fn_accept_invitations' and pronamespace='public'::regnamespace), ''
  union all select 2, 'identity: 0053 is applied (fn_require_platform_admin exists)',
         exists(select 1 from pg_proc where proname='fn_require_platform_admin' and pronamespace='public'::regnamespace), ''
  union all select 3, 'identity: 117 policies',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 4, 'identity: 92 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 92,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 5, 'not yet applied: no site_settings table',
         not exists(select 1 from pg_class where relname='site_settings' and relnamespace='public'::regnamespace), ''
  union all select 6, 'at least one platform admin exists, so someone can edit the website',
         exists(select 1 from platform_admins where revoked_at is null),
         (select count(*)::text||' active admin(s)' from platform_admins where revoked_at is null)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
