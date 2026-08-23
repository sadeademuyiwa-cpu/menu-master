-- ============================================================================
-- MENU MASTER NG — C2 CHECKPOINT: DATA
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run ONLY AFTER PART 3. catalog_categories and catalog_ingredients are
-- created by 0003, so this script fails at PARSE time before PART_3 -- which
-- is why the checkpoint is split rather than guarded.
--
-- Reads no personal data: auth.users is counted, never listed.
-- ============================================================================

select * from (
  select 'A reference data' as section, 'units' as item, count(*)::text as observed from units
  union all select 'A reference data','catalog_categories',  count(*)::text from catalog_categories
  union all select 'A reference data','catalog_ingredients', count(*)::text from catalog_ingredients
  union all select 'A reference data','plans',               count(*)::text from plans
  union all select 'A reference data','plan_features',       count(*)::text from plan_features

  union all select 'B tenant data','accounts',        count(*)::text from accounts
  union all select 'B tenant data','businesses',      count(*)::text from businesses
  union all select 'B tenant data','memberships',     count(*)::text from memberships
  union all select 'B tenant data','subscriptions',   count(*)::text from subscriptions
  union all select 'B tenant data','ingredients',     count(*)::text from ingredients
  union all select 'B tenant data','ingredient_prices', count(*)::text from ingredient_prices
  union all select 'B tenant data','recipes',         count(*)::text from recipes
  union all select 'B tenant data','cost_snapshots',  count(*)::text from cost_snapshots
  union all select 'B tenant data','purchases',       count(*)::text from purchases
  union all select 'B tenant data','orders',          count(*)::text from orders
  union all select 'B tenant data','sales_entries',   count(*)::text from sales_entries
  union all select 'B tenant data','auth.users (count only)', count(*)::text from auth.users

  union all select 'C plan prices','>>> non-zero monthly_price',
    coalesce((select string_agg(id||'='||monthly_price, ', ') from plans where monthly_price <> 0), 'none — all zero')
) as chk order by section, item;
