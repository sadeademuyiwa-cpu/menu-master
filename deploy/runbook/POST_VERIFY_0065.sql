-- ============================================================================
-- 0065 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0065 commits.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'site_settings holds six rows: the five of 0057 and help',
         (select string_agg(key, ',' order by key) from site_settings) = 'analytics,company,help,landing,privacy,signin',
         (select string_agg(key, ',' order by key) from site_settings)
  union all select 2, 'the help setting starts empty (no screen shows a Help button yet)',
         (select value from site_settings where key='help') = '{}'::jsonb, ''
  union all select 3, 'the key constraint admits help and nothing else new',
         (select pg_get_constraintdef(oid) from pg_constraint
           where conname='ck_site_settings_key' and conrelid='public.site_settings'::regclass)
           like '%analytics%privacy%landing%company%signin%help%', ''
  union all select 4, 'no client role may write site_settings directly',
         not has_table_privilege('anon','site_settings','insert,update,delete,truncate')
         and not has_table_privilege('authenticated','site_settings','insert,update,delete,truncate'), ''
  union all select 5, '118 policies in public, 99 fn_* functions (0065 adds neither)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 99,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
