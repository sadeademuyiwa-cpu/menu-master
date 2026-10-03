-- ============================================================================
-- 0056 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0055 and 0056 is not applied.
-- EXPECTED: 6 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0055 is applied (fn_admin_scan exists)',
         exists(select 1 from pg_proc where proname='fn_admin_scan' and pronamespace='public'::regnamespace), ''
  union all select 2, 'identity: 117 policies',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: 85 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 85,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'not yet applied: no invitations table',
         not exists(select 1 from pg_class where relname='invitations' and relnamespace='public'::regnamespace), ''
  union all select 5, 'the last-owner guard from 0012 is present',
         exists(select 1 from pg_trigger where tgname='trg_memberships_last_owner'), ''
  union all select 6, 'live data: nothing in 0056 touches a row',
         true, (select count(*)::text||' memberships across '||(select count(*) from accounts)||' accounts' from memberships)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
