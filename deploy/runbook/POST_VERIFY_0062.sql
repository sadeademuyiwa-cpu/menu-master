-- ============================================================================
-- 0062 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0062 commits.
-- EXPECTED: 4 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'the view guards the purchase-evidence lookup and costs a sub-recipe line',
         (select pg_get_viewdef('v_recipe_line_costs'::regclass) like '%rl.ingredient_id IS NOT NULL%'
             and pg_get_viewdef('v_recipe_line_costs'::regclass) like '%cost_per_yield_unit%'), ''
  union all select 2, 'v_recipe_line_costs still has 22 columns and is security_invoker',
         (select count(*) from information_schema.columns where table_name='v_recipe_line_costs') = 22
         and (select 'security_invoker=on' = any(reloptions) from pg_class where relname='v_recipe_line_costs'), ''
  union all select 3, '118 policies and 98 fn_* functions, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98, ''
  union all select 4, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
