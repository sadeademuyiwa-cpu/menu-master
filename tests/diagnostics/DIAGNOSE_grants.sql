-- ============================================================================
-- MENU MASTER NG — what privileges do anon and authenticated actually hold?
--
-- DISPOSABLE PROJECT ONLY. READ ONLY: one SELECT, no writes of any kind.
--
-- Migration 0011 states privileges explicitly but never revokes Supabase's
-- default grants, which are additive. This shows what is really there, per
-- table, and flags the two that RLS cannot save us from:
--   TRUNCATE  -- not row-gated at all; empties the table regardless of policy
--   anon DML  -- gated by RLS today, but only as long as every policy holds
-- ============================================================================

with t as (
  select unnest(array[
    'accounts','profiles','businesses','locations','memberships','subscriptions',
    'ingredient_categories','ingredients','ingredient_unit_conversions',
    'suppliers','ingredient_prices','business_settings','costing_method_changes',
    'recipes','recipe_lines','labour_rates','recipe_labour','overhead_items',
    'cost_snapshots','channels','recipe_prices','purchases','purchase_lines',
    'customers','orders','order_lines','sales_entries','period_closes',
    'units','catalog_categories','catalog_ingredients','plans','plan_features'
  ]) as tbl
),
g as (
  select table_name, grantee,
         string_agg(privilege_type, ',' order by privilege_type) as privs
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated')
  group by table_name, grantee
)
select
  t.tbl                                                   as table_name,
  coalesce(c.relrowsecurity, false)                       as rls_enabled,
  coalesce((select privs from g where g.table_name = t.tbl and g.grantee='anon'), 'none')          as anon_privileges,
  coalesce((select privs from g where g.table_name = t.tbl and g.grantee='authenticated'), 'none') as authenticated_privileges,
  case
    when coalesce((select privs from g where g.table_name=t.tbl and g.grantee='anon'),'') like '%TRUNCATE%'
      or coalesce((select privs from g where g.table_name=t.tbl and g.grantee='authenticated'),'') like '%TRUNCATE%'
    then '>>> TRUNCATE GRANTED — not gated by RLS'
    when coalesce((select privs from g where g.table_name=t.tbl and g.grantee='anon'),'') <> ''
     and t.tbl not in ('units','catalog_categories','catalog_ingredients','plans','plan_features')
    then '>>> anon holds privileges on tenant data'
    else 'ok'
  end                                                     as flag
from t
left join pg_class c on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace
order by
  case when coalesce((select privs from g where g.table_name=t.tbl and g.grantee='anon'),'') like '%TRUNCATE%'
         or coalesce((select privs from g where g.table_name=t.tbl and g.grantee='authenticated'),'') like '%TRUNCATE%'
       then 0 else 1 end,
  t.tbl;
