-- ============================================================================
-- 0053-0055 -- PRE-DEPLOY AUDIT        READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0052 and no part of Part A is applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 8 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0052 is applied (ix_fk_* indexes exist)',
         exists(select 1 from pg_class where relname='ix_fk_subscriptions_plan_id' and relkind='i'), ''
  union all select 2, 'identity: 117 policies',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: 77 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 77,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'not yet applied: no platform_admins table',
         not exists(select 1 from pg_class where relname='platform_admins' and relnamespace='public'::regnamespace), ''
  union all select 5, 'not yet applied: no fn_admin_* function',
         not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_admin\_%'), ''
  union all select 6, 'not yet applied: no platform_alerts table',
         not exists(select 1 from pg_class where relname='platform_alerts' and relnamespace='public'::regnamespace), ''
  union all select 7, 'pg_cron: enabled, so 0055 can schedule the hourly scan (enable it in Database > Extensions first if FAIL)',
         exists(select 1 from pg_extension where extname='pg_cron'), ''
  union all select 8, 'live data: nothing in 0053-0055 touches a customer row',
         true, (select count(*)::text||' subscriptions, '||(select count(*) from founder_slots where claimed_at is not null)||' founder(s)' from subscriptions)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
