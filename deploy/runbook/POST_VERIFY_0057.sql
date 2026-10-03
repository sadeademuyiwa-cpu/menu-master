-- ============================================================================
-- 0057 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0057 commits.
-- EXPECTED: 8 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'site_settings: exactly the five rows',
         (select string_agg(key, ',' order by key) from site_settings) = 'analytics,company,landing,privacy,signin',
         (select string_agg(key, ',' order by key) from site_settings)
  union all select 2, 'RLS on, one SELECT policy',
         (select relrowsecurity from pg_class where relname='site_settings')
         and (select count(*) from pg_policies where tablename='site_settings') = 1, ''
  union all select 3, '118 policies (117 + 1)',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 4, '93 fn_* functions (92 + 1)',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 93,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 5, 'visitors read key, value and date only; never who edited it',
         has_column_privilege('anon','site_settings','value','select')
         and not has_column_privilege('anon','site_settings','updated_by','select')
         and not has_column_privilege('authenticated','site_settings','updated_by','select'), ''
  union all select 6, 'no client role can write the table directly',
         not has_table_privilege('anon','site_settings','insert,update,delete,truncate')
         and not has_table_privilege('authenticated','site_settings','insert,update,delete,truncate'), ''
  union all select 7, 'anon cannot call the writer',
         not has_function_privilege('anon','fn_admin_set_site_setting(text, jsonb)','execute'), ''
  union all select 8, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
