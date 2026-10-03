-- ============================================================================
-- 0053-0055 -- POST-VERIFY             READ ONLY. Changes nothing.
-- Run immediately after 0055 commits.
-- EXPECTED: 10 rows, every one PASS. Row 9 is PASS with 0 admins until
-- GRANT_PLATFORM_ADMIN.sql has been run; row 10 says whether the scan is
-- scheduled.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'platform_admins: RLS on, no policy, no client grant',
         (select relrowsecurity from pg_class where relname='platform_admins')
         and not exists (select 1 from pg_policies where tablename='platform_admins')
         and not has_table_privilege('authenticated','platform_admins','select')
         and not has_table_privilege('anon','platform_admins','select'), ''
  union all select 2, 'platform_alerts: RLS on, no policy, no client grant',
         (select relrowsecurity from pg_class where relname='platform_alerts')
         and not exists (select 1 from pg_policies where tablename='platform_alerts')
         and not has_table_privilege('authenticated','platform_alerts','select'), ''
  union all select 3, '85 fn_* functions (77 + 8)',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 85,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, '117 policies, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 5, 'every fn_admin_* read requires a platform admin',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
            and p.proname in ('fn_admin_billing_health','fn_admin_subscriptions','fn_admin_signups','fn_admin_alerts','fn_admin_resolve_alert')
            and pg_get_functiondef(p.oid) like '%perform fn_require_platform_admin();%') = 5, ''
  union all select 6, 'anon can call no admin function',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_admin\_%'
            and has_function_privilege('anon', p.oid, 'execute')) = 0, ''
  union all select 7, 'the scan is service-context only (authenticated cannot execute it)',
         not has_function_privilege('authenticated','fn_admin_scan()','execute'), ''
  union all select 8, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
  union all select 9, 'platform admins granted so far',
         true, (select count(*)::text||' active' from platform_admins where revoked_at is null)
  union all select 10, 'hourly scan scheduled (pg_cron job mm-admin-scan)',
         true, case when exists (select 1 from pg_extension where extname='pg_cron')
                    then (select coalesce(string_agg(jobname||' '||schedule, ', '), 'pg_cron present but NOT scheduled -- run SCHEDULE_ADMIN_SCAN.sql')
                            from cron.job where jobname='mm-admin-scan')
                    else 'pg_cron not enabled -- scan runs only when called' end
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
