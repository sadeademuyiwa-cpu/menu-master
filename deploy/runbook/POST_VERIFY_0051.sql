-- ============================================================================
-- 0051 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0051 commits, BEFORE the repair.
-- EXPECTED: 10 rows PASS, row 11 is informational.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'fn_my_has_sales exists',
         exists(select 1 from pg_proc where proname='fn_my_has_sales'
                  and pronamespace='public'::regnamespace), ''
  union all select 2, 'it is SECURITY INVOKER -- it adds no access of its own',
         exists(select 1 from pg_proc where proname='fn_my_has_sales'
                  and pronamespace='public'::regnamespace and not prosecdef),
         'fn_account_has_sales underneath already refuses a non-member'
  union all select 3, 'a signed-in user can call it',
         has_function_privilege('authenticated','fn_my_has_sales()','execute'), ''
  union all select 4, 'a logged-out caller cannot',
         not has_function_privilege('anon','fn_my_has_sales()','execute'), ''
  union all select 5, 'it derives from the SAME predicate the write policies use',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_my_has_sales'
            and pronamespace='public'::regnamespace) like '%fn_account_has_sales%', ''

  union all select 6, 'fn_billing_apply now derives a paid period',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) like '%paid_at%', ''
  union all select 7, 'and still refuses a non-service caller',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) like '%fn_is_service_context%', ''
  union all select 8, 'and still calls the 0049 payment boundary',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) like '%fn_apply_billing_side_effects%', ''

  union all select 9, '0051 added no policy: still 117',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 10, 'founder_slots untouched: still exactly 100',
         (select count(*) from founder_slots) = 100,
         (select count(*)::text from founder_slots)

  union all select 11, 'STILL TO REPAIR: paid subscriptions on the trial end date',
         true,
         coalesce((select string_agg(s.account_id::text || ' ' || s.plan_id, ', ')
                     from subscriptions s join plans p on p.id = s.plan_id
                    where s.status='active' and p.price_tier <> 'trial'
                      and s.trial_ends_at is not null
                      and s.current_period_end = s.trial_ends_at),
                  'none -- no repair needed')
)
select n,
       case when ok then 'PASS' when n = 11 then 'INFO' else 'FAIL' end as result,
       check_name, detail
  from checks order by n;
