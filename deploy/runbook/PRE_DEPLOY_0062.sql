-- ============================================================================
-- 0062 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0061 and 0062 is not applied.
-- EXPECTED: 4 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0061 is applied (order_lines.extra_unit_cost exists)',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost'), ''
  union all select 2, 'identity: 118 policies, 98 fn_* functions',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98, ''
  union all select 3, 'v_recipe_line_costs has 22 columns',
         (select count(*) from information_schema.columns where table_name='v_recipe_line_costs') = 22, ''
  union all select 4, 'not yet applied: the view still looks up purchase evidence for every line',
         (select pg_get_viewdef('v_recipe_line_costs'::regclass) not like '%rl.ingredient_id IS NOT NULL%'), ''
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
