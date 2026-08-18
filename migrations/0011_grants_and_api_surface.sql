-- ============================================================================
-- MENU MASTER NG
-- 0011: API surface and grants
--
-- Supabase relies on default privileges to expose tables to the anon and
-- authenticated roles. Depending on that default is fragile: if it is ever
-- changed, or a table is created outside the dashboard, the app silently
-- breaks or, worse, a later blanket GRANT opens something that should stay
-- closed. Privileges are stated explicitly here.
--
-- RLS remains the gate. Grants only decide which tables the gate applies to.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Reference data readable by anyone signed in or not
-- ----------------------------------------------------------------------------

grant select on units, catalog_categories, catalog_ingredients, plans, plan_features
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Tenant data: full DML for authenticated users, every row gated by RLS
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'accounts','profiles','businesses','locations','memberships','subscriptions',
    'ingredient_categories','ingredients','ingredient_unit_conversions',
    'suppliers','ingredient_prices','business_settings','costing_method_changes',
    'recipes','recipe_lines','labour_rates','recipe_labour','overhead_items',
    'cost_snapshots','channels','recipe_prices','purchases','purchase_lines',
    'customers','orders','order_lines','sales_entries','period_closes'
  ]
  loop
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- The anon role gets nothing on tenant data. Not read, not write.
-- An unauthenticated request should return zero rows, not an empty policy match.

-- ----------------------------------------------------------------------------
-- 3. Views
-- ----------------------------------------------------------------------------

grant select on
  v_price_check, v_costing_blockers, v_missing_unit_conversions,
  v_recipe_cost_current, v_sales_unified, v_profit_by_period,
  v_profit_by_product, v_dashboard_waterfall, v_onboarding_status
  to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Functions
-- Only the ones a client legitimately calls. The recursive costing internals
-- are not part of the API.
-- ----------------------------------------------------------------------------

revoke execute on function fn__recipe_cost_core(uuid, date, integer) from public, anon, authenticated;
revoke execute on function fn_guard_posted_purchase() from public, anon, authenticated;
revoke execute on function fn_guard_ingredient_prices() from public, anon, authenticated;
revoke execute on function fn_block_snapshot_mutation() from public, anon, authenticated;
revoke execute on function fn_freeze_sale_cost() from public, anon, authenticated;
revoke execute on function fn_guard_frozen_cost() from public, anon, authenticated;

grant execute on function
  fn_resolve_qty_to_base(uuid, numeric, uuid),
  fn_can_resolve_unit(uuid, uuid),
  fn_ingredient_unit_cost(uuid, uuid, date),
  fn_ingredient_usable_unit_cost(uuid, uuid, date),
  fn_compute_recipe_cost_snapshot(uuid, date, uuid),
  fn_recompute_recipes_for_ingredient(uuid, date),
  fn_purchase_blockers(uuid),
  fn_post_purchase(uuid),
  fn_reverse_purchase(uuid, text),
  fn_is_account_member(uuid),
  fn_can_see_costs(uuid),
  fn_create_account_and_business(text, text, business_type, uuid, text, text, integer),
  fn_clone_starter_catalog(uuid, business_type)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Sequences
-- ----------------------------------------------------------------------------

do $$
declare s text;
begin
  for s in select sequence_name from information_schema.sequences where sequence_schema='public'
  loop
    execute format('grant usage, select on sequence %I to authenticated', s);
  end loop;
end $$;
