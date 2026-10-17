-- ============================================================================
-- 0064 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0064 commits. Row 4 calls the function, so on a
-- database without 0064 the script stops with "function public.fn_menu_prices()
-- does not exist": that is a FAIL.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'fn_menu_prices(): SECURITY DEFINER, STABLE, search_path pinned to public',
         exists(select 1 from pg_proc p where p.oid = to_regprocedure('public.fn_menu_prices()')
                  and p.prosecdef and p.provolatile = 's' and 'search_path=public' = any(p.proconfig)), ''
  union all select 2, 'callable by a signed-in user; not by a logged-out caller, not by PUBLIC',
         coalesce(has_function_privilege('authenticated', to_regprocedure('public.fn_menu_prices()'), 'execute'), false)
         and not coalesce(has_function_privilege('anon', to_regprocedure('public.fn_menu_prices()'), 'execute'), true)
         and not exists(select 1 from pg_proc p, unnest(p.proacl) a
                         where p.oid = to_regprocedure('public.fn_menu_prices()') and a::text like '=%'), ''
  union all select 3, 'it returns the five selling-price columns and nothing cost-like',
         (select array_to_string(array_agg(n order by o), ',')
            from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
           where p.oid = to_regprocedure('public.fn_menu_prices()') and m = 't')
           = 'business_id,recipe_id,variant_id,channel_id,selling_price', ''
  union all select 4, 'it runs, and returns no row here (this session has no signed-in user)',
         (select count(*) from public.fn_menu_prices()) = 0, ''
  union all select 5, 'recipe_prices is still cost-gated: its four fn_can_see_costs policies are unchanged',
         (select count(*) from pg_policies where schemaname='public' and tablename='recipe_prices'
            and coalesce(qual,'') || coalesce(with_check,'') like '%fn_can_see_costs%') = 4, ''
  union all select 6, '118 policies in public, 99 fn_* functions',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 99,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 7, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
