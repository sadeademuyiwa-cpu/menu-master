-- ============================================================================
-- 0069 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at 0068 (with or without 0067) and 0069 is not applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0068 is applied (contact_consents and fn_admin_checkins_due exist)',
         to_regclass('public.contact_consents') is not null
         and to_regprocedure('public.fn_admin_checkins_due()') is not null, ''
  union all select 2, 'identity: 118 policies; 106 fn_* (0066, 0068) or 111 (and 0067)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') in (106, 111),
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 3, 'not yet applied: none of the four 0069 tables, the profile column or the twelve functions',
         to_regclass('public.usage_views') is null and to_regclass('public.usage_events') is null
         and to_regclass('public.help_requests') is null and to_regclass('public.feedback') is null
         and not exists (select 1 from information_schema.columns where table_schema='public'
                          and table_name='profiles' and column_name='usage_opt_out_at')
         and not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                          and proname in ('fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback',
                                          'fn_feedback_due','fn_set_my_usage_tracking','fn_admin_live',
                                          'fn_admin_activation','fn_admin_journey','fn_admin_help',
                                          'fn_admin_set_help_status','fn_usage_purge')), ''
  union all select 4, 'what 0069 reads is there: the admin guards, the entitlement check, platform_admins',
         to_regprocedure('public.fn_require_platform_admin()') is not null
         and to_regprocedure('public.fn_is_platform_admin()') is not null
         and to_regprocedure('public.fn_account_is_entitled(uuid)') is not null
         and to_regclass('public.platform_admins') is not null, ''
  union all select 5, 'pg_cron: the nightly purge is scheduled only where it is on (information, not a gate)',
         true,
         case when exists (select 1 from pg_extension where extname = 'pg_cron')
              then 'pg_cron is on: 0069 schedules mm-usage-purge at 02:17 UTC'
              else 'pg_cron is off: schedule select public.fn_usage_purge(); yourself' end
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
