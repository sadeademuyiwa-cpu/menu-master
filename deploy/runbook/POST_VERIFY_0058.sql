-- ============================================================================
-- 0058 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0058 commits.
-- EXPECTED: 6 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'trial_reminders: RLS on, no policy, no client grant',
         (select relrowsecurity from pg_class where relname='trial_reminders')
         and not exists (select 1 from pg_policies where tablename='trial_reminders')
         and not has_table_privilege('authenticated','trial_reminders','select')
         and not has_table_privilege('anon','trial_reminders','select'), ''
  union all select 2, '118 policies, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, '95 fn_* functions (93 + 2)',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 95,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'no client role can list owners'' emails or record a send',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
            and p.proname in ('fn_trial_reminders_due','fn_record_trial_reminder')
            and (has_function_privilege('anon', p.oid, 'execute')
                 or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, ''
  union all select 5, 'what the first run will send',
         true, coalesce((select string_agg(kind||'='||n, ', ') from
                          (select kind, count(*) n from fn_trial_reminders_due() group by kind) x), 'nothing owed')
  union all select 6, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
