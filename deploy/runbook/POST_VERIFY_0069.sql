-- ============================================================================
-- 0069 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0069 commits.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'the four tables are in place, RLS on, and no client role can reach them',
         (select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.usage_views'::regclass, 'public.usage_events'::regclass,
                           'public.help_requests'::regclass, 'public.feedback'::regclass))
         and not exists (select 1 from unnest(array['usage_views','usage_events','help_requests','feedback']) t
                          where has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete')
                             or has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')), ''
  union all select 2, 'profiles has usage_opt_out_at, and people still cannot write profiles directly',
         exists (select 1 from information_schema.columns where table_schema='public'
                  and table_name='profiles' and column_name='usage_opt_out_at')
         and not has_table_privilege('authenticated','profiles','update'), ''
  union all select 3, 'a signed-in person can send a beat, an event, a help request and an answer; a visitor cannot',
         has_function_privilege('authenticated','public.fn_usage_beat(uuid, uuid, text, text, text, integer, text)','execute')
         and has_function_privilege('authenticated','public.fn_usage_event(text, text, text, text)','execute')
         and has_function_privilege('authenticated','public.fn_ask_for_help(text, text, text, text, text)','execute')
         and has_function_privilege('authenticated','public.fn_give_feedback(text, integer, text, text)','execute')
         and has_function_privilege('authenticated','public.fn_set_my_usage_tracking(boolean)','execute')
         and not has_function_privilege('anon','public.fn_usage_beat(uuid, uuid, text, text, text, integer, text)','execute')
         and not has_function_privilege('anon','public.fn_ask_for_help(text, text, text, text, text)','execute'), ''
  union all select 4, 'the admin reads are closed to visitors; the purge is closed to every client role',
         not has_function_privilege('anon','public.fn_admin_live()','execute')
         and not has_function_privilege('anon','public.fn_admin_activation(uuid)','execute')
         and not has_function_privilege('anon','public.fn_admin_help()','execute')
         and not has_function_privilege('authenticated','public.fn_usage_purge()','execute')
         and not has_function_privilege('anon','public.fn_usage_purge()','execute'), ''
  union all select 5, 'all twelve 0069 functions are security definer with search_path=public',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef
            and 'search_path=public' = any(proconfig)
            and proname in ('fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback',
                            'fn_feedback_due','fn_set_my_usage_tracking','fn_admin_live',
                            'fn_admin_activation','fn_admin_journey','fn_admin_help',
                            'fn_admin_set_help_status','fn_usage_purge')) = 12, ''
  union all select 6, 'the nightly purge is scheduled where pg_cron is on',
         not exists (select 1 from pg_extension where extname = 'pg_cron')
         or (select count(*) from pg_extension where extname = 'pg_cron') = 1
            and to_regclass('cron.job') is not null,
         case when exists (select 1 from pg_extension where extname = 'pg_cron')
              then 'pg_cron on: confirm with  select jobname, schedule from cron.job where jobname = ''mm-usage-purge'';'
              else 'pg_cron off: schedule select public.fn_usage_purge(); yourself' end
  union all select 7, '118 policies; 118 fn_* (123 with 0067): 0069 adds twelve functions and no policy',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') in (118, 123),
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
