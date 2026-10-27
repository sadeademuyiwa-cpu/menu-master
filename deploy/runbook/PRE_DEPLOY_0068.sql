-- ============================================================================
-- 0068 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at 0066 (with or without 0067) and 0068 is not applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0066 is applied (fn_require_entitled exists)',
         to_regprocedure('public.fn_require_entitled(uuid, boolean)') is not null, ''
  union all select 2, 'identity: 118 policies; 102 fn_* (0066) or 107 (0066 and 0067)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') in (102, 107),
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 3, 'not yet applied: no contact_consents, no admin_checkins, none of the four 0068 functions',
         to_regclass('public.contact_consents') is null and to_regclass('public.admin_checkins') is null
         and not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                          and proname in ('fn_normalise_ng_phone','fn_set_my_contact','fn_admin_checkins_due','fn_admin_record_checkin')), ''
  union all select 4, 'no profile holds a phone the new format check would refuse (nothing has written profiles)',
         not exists (select 1 from profiles where phone is not null and phone !~ '^234(70|80|81|90|91)[0-9]{8}$'),
         (select count(*)::text from profiles) || ' profile rows'
  union all select 5, 'the admin guard 0068 relies on is present: fn_require_platform_admin()',
         to_regprocedure('public.fn_require_platform_admin()') is not null, ''
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
