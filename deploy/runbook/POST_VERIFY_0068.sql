-- ============================================================================
-- 0068 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0068 commits.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'the normaliser reads the ways people type a number, and refuses the rest',
         public.fn_normalise_ng_phone('+234 (0) 803 123 4567') = '2348031234567'
         and public.fn_normalise_ng_phone('0803 123 4567') = '2348031234567'
         and public.fn_normalise_ng_phone('+44 7700 900123') is null, ''
  union all select 2, 'profiles: the phone format check and the five new columns are in place',
         exists (select 1 from pg_constraint where conname='ck_profiles_phone' and conrelid='public.profiles'::regclass)
         and (select count(*) from information_schema.columns where table_schema='public' and table_name='profiles'
               and column_name in ('phone_added_at','phone_confirmed_at','marketing_ok_at','contact_wording','phone_wrong_at')) = 5, ''
  union all select 3, 'people read their own profile; nobody writes it directly any more',
         has_table_privilege('authenticated','profiles','select')
         and not has_table_privilege('authenticated','profiles','insert')
         and not has_table_privilege('authenticated','profiles','update')
         and not has_table_privilege('authenticated','profiles','delete'), ''
  union all select 4, 'the consent log and the check-ins: RLS on, no client role can reach them',
         (select relrowsecurity from pg_class where oid='public.contact_consents'::regclass)
         and (select relrowsecurity from pg_class where oid='public.admin_checkins'::regclass)
         and not has_table_privilege('authenticated','contact_consents','select,insert,update,delete')
         and not has_table_privilege('anon','contact_consents','select,insert,update,delete')
         and not has_table_privilege('authenticated','admin_checkins','select,insert,update,delete')
         and not has_table_privilege('anon','admin_checkins','select,insert,update,delete'), ''
  union all select 5, 'a signed-in person can set their number; a visitor cannot',
         has_function_privilege('authenticated','public.fn_set_my_contact(text, boolean, text, text)','execute')
         and not has_function_privilege('anon','public.fn_set_my_contact(text, boolean, text, text)','execute'), ''
  union all select 6, 'the admin functions are security definer and closed to visitors',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef
            and proname in ('fn_set_my_contact','fn_admin_checkins_due','fn_admin_record_checkin')) = 3
         and not has_function_privilege('anon','public.fn_admin_checkins_due()','execute')
         and not has_function_privilege('anon','public.fn_admin_record_checkin(uuid, text, text, text, text)','execute'), ''
  union all select 7, '118 policies; 106 fn_* (111 with 0067): 0068 adds four functions and no policy',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') in (106, 111),
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
