-- ============================================================================
-- 0065 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at 0064 and 0065 is not applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0064 is applied (fn_menu_prices exists)',
         to_regprocedure('public.fn_menu_prices()') is not null, ''
  union all select 2, 'identity: 118 policies in public, 99 fn_* functions',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 99,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 3, 'site_settings holds exactly the five rows of 0057',
         (select string_agg(key, ',' order by key) from site_settings) = 'analytics,company,landing,privacy,signin',
         (select string_agg(key, ',' order by key) from site_settings)
  union all select 4, 'not yet applied: the key constraint does not admit help',
         (select pg_get_constraintdef(oid) not like '%help%' from pg_constraint
           where conname='ck_site_settings_key' and conrelid='public.site_settings'::regclass), ''
  union all select 5, 'the writer 0065 relies on is present: fn_admin_set_site_setting(text, jsonb)',
         to_regprocedure('public.fn_admin_set_site_setting(text, jsonb)') is not null, ''
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
