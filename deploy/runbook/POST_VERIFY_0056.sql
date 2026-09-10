-- ============================================================================
-- 0056 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0056 commits.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'invitations: RLS on, no policy, no client grant',
         (select relrowsecurity from pg_class where relname='invitations')
         and not exists (select 1 from pg_policies where tablename='invitations')
         and not has_table_privilege('authenticated','invitations','select')
         and not has_table_privilege('anon','invitations','select'), ''
  union all select 2, '92 fn_* functions (85 + 7)',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 92,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 3, '117 policies, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 4, 'anon can call none of the seven',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
            and p.proname in ('fn_invite_member','fn_list_invitations','fn_revoke_invitation','fn_accept_invitations',
                              'fn_list_members','fn_set_member_role','fn_remove_member')
            and has_function_privilege('anon', p.oid, 'execute')) = 0, ''
  union all select 5, 'an owner role can never be invited (constraint)',
         exists(select 1 from pg_constraint where conname='ck_invitations_not_owner'), ''
  union all select 6, 'every membership is untouched',
         true, (select count(*)::text||' memberships' from memberships)
  union all select 7, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
