-- ============================================================================
-- 0058 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0057 and 0058 is not applied.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0057 is applied (site_settings exists)',
         exists(select 1 from pg_class where relname='site_settings' and relnamespace='public'::regnamespace), ''
  union all select 2, 'identity: 118 policies',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: 93 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 93,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'not yet applied: no trial_reminders table',
         not exists(select 1 from pg_class where relname='trial_reminders' and relnamespace='public'::regnamespace), ''
  union all select 5, 'who the first run would email (trials ending within 3 days or ended in the last 7)',
         true,
         (select count(*)::text||' account(s)' from subscriptions
           where status='trialing' and current_period_end > now() - interval '7 days'
             and current_period_end <= now() + interval '3 days')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
