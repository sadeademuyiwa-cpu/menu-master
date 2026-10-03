-- ============================================================================
-- MENU MASTER NG
-- 0052: pin every function's search_path, index every foreign key, and stop
--       handing billing_config to anonymous callers
--
-- Requires: 0001-0051 applied.
--
-- Source: the Supabase security and performance advisors, read against
-- production on 10 September 2026, cross-checked on a repository-built replica
-- that matches production to the object count. Every statement below was
-- GENERATED from that replica's catalogue, not typed: 23 functions, 138
-- foreign keys.
--
-- 1. search_path. Twenty-three fn_* functions -- every trigger function and a
--    few helpers -- had no search_path setting. A function without one resolves
--    unqualified names through the CALLER's search_path, which is the classic
--    route to executing an attacker's same-named object. Every SECURITY
--    DEFINER function in this schema already pins `public`; these now match.
--    `public`, not '', because the bodies use unqualified table names.
--
-- 2. Foreign-key indexes. 138 foreign keys had no covering index. Most are
--    account_id, which every RLS policy filters on for every row, and the
--    hottest tables are the trading ones: sales_entries 13, orders 11,
--    purchases 11, order_lines 9. Small today; the cost of adding them is the
--    write amplification on tables that are written by a person, one row at a
--    time. Names are ix_fk_<table>_<columns>, longest 59 characters.
--
-- 3. billing_config. 0032 granted SELECT to anon and authenticated. Nothing
--    outside the database reads the table -- no page, no edge function -- and
--    its one reader, fn_payment_failure_grace(), is SECURITY DEFINER. 0049
--    already described it as service-context only. The anon grant widened the
--    anonymous surface to six tables for no caller, and three suites (009,
--    011, 017) have said "expected five, found six" ever since. This revokes
--    it. THIS SECTION IS DELIBERATELY SEPARATE and can be removed without
--    affecting the other two.
--
-- Policies: 117 before and after. Functions: 77 before and after. No data.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0052 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
declare v int;
begin
  if not exists (select 1 from pg_proc where proname='fn_my_has_sales'
                   and pronamespace='public'::regnamespace) then
    raise exception '0052 preflight FAILED: 0051 is not applied.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0052 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if exists (select 1 from pg_class where relname like 'ix\_fk\_%' and relkind='i') then
    raise exception '0052 preflight FAILED: ix_fk_* indexes already exist.';
  end if;
  select count(*) into v from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if v <> 23 then
    raise exception '0052 preflight FAILED: % fn_* functions lack a search_path, expected 23.', v;
  end if;
  raise notice '0052 preflight OK: 23 functions to pin, billing_config anon grant is %.',
    case when has_table_privilege('anon','billing_config','select') then 'present' else 'already absent' end;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on the twenty-three
-- ---------------------------------------------------------------------------
alter function public.fn_allocate_order_discount(p_order_id uuid) set search_path = public;
alter function public.fn_assert_no_packaging_double_count() set search_path = public;
alter function public.fn_assert_packaging_item_kind() set search_path = public;
alter function public.fn_assert_sale_variant_valid() set search_path = public;
alter function public.fn_assert_unit_visible() set search_path = public;
alter function public.fn_assert_unit_visible_col() set search_path = public;
alter function public.fn_block_format_change_mutation() set search_path = public;
alter function public.fn_block_snapshot_mutation() set search_path = public;
alter function public.fn_guard_finalised_order() set search_path = public;
alter function public.fn_guard_frozen_cost() set search_path = public;
alter function public.fn_guard_ingredient_prices() set search_path = public;
alter function public.fn_guard_order_discount() set search_path = public;
alter function public.fn_guard_order_lifecycle() set search_path = public;
alter function public.fn_guard_order_line_revenue() set search_path = public;
alter function public.fn_guard_posted_purchase() set search_path = public;
alter function public.fn_guard_sales_entry_immutable() set search_path = public;
alter function public.fn_guard_subscription_changes() set search_path = public;
alter function public.fn_is_service_context() set search_path = public;
alter function public.fn_log_serving_format_change() set search_path = public;
alter function public.fn_order_line_scope() set search_path = public;
alter function public.fn_prevent_recipe_cycle() set search_path = public;
alter function public.fn_redact_billing_payload() set search_path = public;
alter function public.fn_reject_variant_on_inactive_format() set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Cover every foreign key
-- ---------------------------------------------------------------------------
create index if not exists ix_fk_billing_events_account_id on public.billing_events (account_id);
create index if not exists ix_fk_business_settings_account_id on public.business_settings (account_id);
create index if not exists ix_fk_business_settings_business_id_account_id on public.business_settings (business_id, account_id);
create index if not exists ix_fk_business_settings_overhead_basis_unit_id on public.business_settings (overhead_basis_unit_id);
create index if not exists ix_fk_catalog_ingredients_category_name on public.catalog_ingredients (category_name);
create index if not exists ix_fk_channels_account_id on public.channels (account_id);
create index if not exists ix_fk_channels_business_id_account_id on public.channels (business_id, account_id);
create index if not exists ix_fk_cost_snapshots_account_id on public.cost_snapshots (account_id);
create index if not exists ix_fk_cost_snapshots_business_id on public.cost_snapshots (business_id);
create index if not exists ix_fk_cost_snapshots_business_id_account_id on public.cost_snapshots (business_id, account_id);
create index if not exists ix_fk_cost_snapshots_created_by on public.cost_snapshots (created_by);
create index if not exists ix_fk_cost_snapshots_recipe_id_account_id on public.cost_snapshots (recipe_id, account_id);
create index if not exists ix_fk_cost_snapshots_resolved_unit_id on public.cost_snapshots (resolved_unit_id);
create index if not exists ix_fk_cost_snapshots_variant_id_account_id on public.cost_snapshots (variant_id, account_id);
create index if not exists ix_fk_costing_method_changes_account_id on public.costing_method_changes (account_id);
create index if not exists ix_fk_costing_method_changes_business_id on public.costing_method_changes (business_id);
create index if not exists ix_fk_costing_method_changes_changed_by on public.costing_method_changes (changed_by);
create index if not exists ix_fk_customers_account_id on public.customers (account_id);
create index if not exists ix_fk_customers_business_id on public.customers (business_id);
create index if not exists ix_fk_customers_business_id_account_id on public.customers (business_id, account_id);
create index if not exists ix_fk_ingredient_categories_account_id on public.ingredient_categories (account_id);
create index if not exists ix_fk_ingredient_prices_entered_by on public.ingredient_prices (entered_by);
create index if not exists ix_fk_ingredient_prices_ingredient_id_account_id on public.ingredient_prices (ingredient_id, account_id);
create index if not exists ix_fk_ingredient_prices_purchase_line_id on public.ingredient_prices (purchase_line_id);
create index if not exists ix_fk_ingredient_prices_reversed_by_purchase_id on public.ingredient_prices (reversed_by_purchase_id);
create index if not exists ix_fk_ingredient_prices_supplier_id on public.ingredient_prices (supplier_id);
create index if not exists ix_fk_ingredient_prices_supplier_id_account_id on public.ingredient_prices (supplier_id, account_id);
create index if not exists ix_fk_ingredient_unit_conversions_account_id on public.ingredient_unit_conversions (account_id);
create index if not exists ix_fk_ingredient_unit_conversions_ingredient_id_account_id on public.ingredient_unit_conversions (ingredient_id, account_id);
create index if not exists ix_fk_ingredient_unit_conversions_unit_id on public.ingredient_unit_conversions (unit_id);
create index if not exists ix_fk_ingredients_base_unit_id on public.ingredients (base_unit_id);
create index if not exists ix_fk_ingredients_category_id on public.ingredients (category_id);
create index if not exists ix_fk_ingredients_category_id_account_id on public.ingredients (category_id, account_id);
create index if not exists ix_fk_labour_rates_account_id on public.labour_rates (account_id);
create index if not exists ix_fk_labour_rates_business_id on public.labour_rates (business_id);
create index if not exists ix_fk_labour_rates_business_id_account_id on public.labour_rates (business_id, account_id);
create index if not exists ix_fk_locations_account_id on public.locations (account_id);
create index if not exists ix_fk_locations_business_id on public.locations (business_id);
create index if not exists ix_fk_locations_business_id_account_id on public.locations (business_id, account_id);
create index if not exists ix_fk_memberships_business_id on public.memberships (business_id);
create index if not exists ix_fk_memberships_business_id_account_id on public.memberships (business_id, account_id);
create index if not exists ix_fk_onboarding_requests_account_id on public.onboarding_requests (account_id);
create index if not exists ix_fk_onboarding_requests_business_id on public.onboarding_requests (business_id);
create index if not exists ix_fk_order_lines_account_id on public.order_lines (account_id);
create index if not exists ix_fk_order_lines_business_id_account_id on public.order_lines (business_id, account_id);
create index if not exists ix_fk_order_lines_cost_snapshot_id on public.order_lines (cost_snapshot_id);
create index if not exists ix_fk_order_lines_cost_snapshot_id_account_id on public.order_lines (cost_snapshot_id, account_id);
create index if not exists ix_fk_order_lines_order_id on public.order_lines (order_id);
create index if not exists ix_fk_order_lines_order_id_account_id on public.order_lines (order_id, account_id);
create index if not exists ix_fk_order_lines_recipe_id on public.order_lines (recipe_id);
create index if not exists ix_fk_order_lines_recipe_id_account_id on public.order_lines (recipe_id, account_id);
create index if not exists ix_fk_order_lines_variant_id_account_id on public.order_lines (variant_id, account_id);
create index if not exists ix_fk_orders_account_id on public.orders (account_id);
create index if not exists ix_fk_orders_business_id_account_id on public.orders (business_id, account_id);
create index if not exists ix_fk_orders_channel_id on public.orders (channel_id);
create index if not exists ix_fk_orders_channel_id_account_id on public.orders (channel_id, account_id);
create index if not exists ix_fk_orders_created_by on public.orders (created_by);
create index if not exists ix_fk_orders_customer_id on public.orders (customer_id);
create index if not exists ix_fk_orders_customer_id_account_id on public.orders (customer_id, account_id);
create index if not exists ix_fk_orders_finalised_by on public.orders (finalised_by);
create index if not exists ix_fk_orders_location_id on public.orders (location_id);
create index if not exists ix_fk_orders_replaces_account_id on public.orders (replaces, account_id);
create index if not exists ix_fk_orders_voided_by on public.orders (voided_by);
create index if not exists ix_fk_overhead_items_account_id on public.overhead_items (account_id);
create index if not exists ix_fk_overhead_items_basis_unit_id on public.overhead_items (basis_unit_id);
create index if not exists ix_fk_overhead_items_business_id on public.overhead_items (business_id);
create index if not exists ix_fk_overhead_items_business_id_account_id on public.overhead_items (business_id, account_id);
create index if not exists ix_fk_period_closes_account_id on public.period_closes (account_id);
create index if not exists ix_fk_period_closes_business_id_account_id on public.period_closes (business_id, account_id);
create index if not exists ix_fk_period_closes_closed_by on public.period_closes (closed_by);
create index if not exists ix_fk_purchase_lines_account_id on public.purchase_lines (account_id);
create index if not exists ix_fk_purchase_lines_ingredient_id on public.purchase_lines (ingredient_id);
create index if not exists ix_fk_purchase_lines_ingredient_id_account_id on public.purchase_lines (ingredient_id, account_id);
create index if not exists ix_fk_purchase_lines_purchase_id on public.purchase_lines (purchase_id);
create index if not exists ix_fk_purchase_lines_purchase_id_account_id on public.purchase_lines (purchase_id, account_id);
create index if not exists ix_fk_purchase_lines_unit_id on public.purchase_lines (unit_id);
create index if not exists ix_fk_purchases_account_id on public.purchases (account_id);
create index if not exists ix_fk_purchases_business_id on public.purchases (business_id);
create index if not exists ix_fk_purchases_business_id_account_id on public.purchases (business_id, account_id);
create index if not exists ix_fk_purchases_created_by on public.purchases (created_by);
create index if not exists ix_fk_purchases_location_id on public.purchases (location_id);
create index if not exists ix_fk_purchases_location_id_account_id on public.purchases (location_id, account_id);
create index if not exists ix_fk_purchases_posted_by on public.purchases (posted_by);
create index if not exists ix_fk_purchases_reversed_by on public.purchases (reversed_by);
create index if not exists ix_fk_purchases_reverses on public.purchases (reverses);
create index if not exists ix_fk_purchases_supplier_id on public.purchases (supplier_id);
create index if not exists ix_fk_purchases_supplier_id_account_id on public.purchases (supplier_id, account_id);
create index if not exists ix_fk_recipe_labour_account_id on public.recipe_labour (account_id);
create index if not exists ix_fk_recipe_labour_labour_rate_id on public.recipe_labour (labour_rate_id);
create index if not exists ix_fk_recipe_labour_labour_rate_id_account_id on public.recipe_labour (labour_rate_id, account_id);
create index if not exists ix_fk_recipe_labour_recipe_id_account_id on public.recipe_labour (recipe_id, account_id);
create index if not exists ix_fk_recipe_lines_account_id on public.recipe_lines (account_id);
create index if not exists ix_fk_recipe_lines_ingredient_id on public.recipe_lines (ingredient_id);
create index if not exists ix_fk_recipe_lines_ingredient_id_account_id on public.recipe_lines (ingredient_id, account_id);
create index if not exists ix_fk_recipe_lines_recipe_id_account_id on public.recipe_lines (recipe_id, account_id);
create index if not exists ix_fk_recipe_lines_sub_recipe_id_account_id on public.recipe_lines (sub_recipe_id, account_id);
create index if not exists ix_fk_recipe_lines_unit_id on public.recipe_lines (unit_id);
create index if not exists ix_fk_recipe_prices_account_id on public.recipe_prices (account_id);
create index if not exists ix_fk_recipe_prices_channel_id on public.recipe_prices (channel_id);
create index if not exists ix_fk_recipe_prices_channel_id_account_id on public.recipe_prices (channel_id, account_id);
create index if not exists ix_fk_recipe_prices_recipe_id_account_id on public.recipe_prices (recipe_id, account_id);
create index if not exists ix_fk_recipe_prices_set_by on public.recipe_prices (set_by);
create index if not exists ix_fk_recipe_prices_variant_id_account_id on public.recipe_prices (variant_id, account_id);
create index if not exists ix_fk_recipe_variants_account_id on public.recipe_variants (account_id);
create index if not exists ix_fk_recipe_variants_business_id_account_id on public.recipe_variants (business_id, account_id);
create index if not exists ix_fk_recipe_variants_format_id_business_id on public.recipe_variants (format_id, business_id);
create index if not exists ix_fk_recipe_variants_recipe_id_business_id on public.recipe_variants (recipe_id, business_id);
create index if not exists ix_fk_recipe_variants_sellable_unit_id on public.recipe_variants (sellable_unit_id);
create index if not exists ix_fk_recipes_account_id on public.recipes (account_id);
create index if not exists ix_fk_recipes_business_id_account_id on public.recipes (business_id, account_id);
create index if not exists ix_fk_recipes_yield_unit_id on public.recipes (yield_unit_id);
create index if not exists ix_fk_sales_entries_account_id on public.sales_entries (account_id);
create index if not exists ix_fk_sales_entries_business_id_account_id on public.sales_entries (business_id, account_id);
create index if not exists ix_fk_sales_entries_channel_id on public.sales_entries (channel_id);
create index if not exists ix_fk_sales_entries_channel_id_account_id on public.sales_entries (channel_id, account_id);
create index if not exists ix_fk_sales_entries_cost_snapshot_id on public.sales_entries (cost_snapshot_id);
create index if not exists ix_fk_sales_entries_cost_snapshot_id_account_id on public.sales_entries (cost_snapshot_id, account_id);
create index if not exists ix_fk_sales_entries_created_by on public.sales_entries (created_by);
create index if not exists ix_fk_sales_entries_location_id on public.sales_entries (location_id);
create index if not exists ix_fk_sales_entries_recipe_id on public.sales_entries (recipe_id);
create index if not exists ix_fk_sales_entries_recipe_id_account_id on public.sales_entries (recipe_id, account_id);
create index if not exists ix_fk_sales_entries_replaces_account_id on public.sales_entries (replaces, account_id);
create index if not exists ix_fk_sales_entries_variant_id_account_id on public.sales_entries (variant_id, account_id);
create index if not exists ix_fk_sales_entries_voided_by on public.sales_entries (voided_by);
create index if not exists ix_fk_serving_format_changes_account_id on public.serving_format_changes (account_id);
create index if not exists ix_fk_serving_format_changes_business_id_account_id on public.serving_format_changes (business_id, account_id);
create index if not exists ix_fk_serving_format_changes_changed_by on public.serving_format_changes (changed_by);
create index if not exists ix_fk_serving_format_changes_format_id_business_id on public.serving_format_changes (format_id, business_id);
create index if not exists ix_fk_serving_format_packaging_account_id on public.serving_format_packaging (account_id);
create index if not exists ix_fk_serving_format_packaging_business_id_account_id on public.serving_format_packaging (business_id, account_id);
create index if not exists ix_fk_serving_format_packaging_format_id_business_id on public.serving_format_packaging (format_id, business_id);
create index if not exists ix_fk_serving_format_packaging_packaging_item_id_account_id on public.serving_format_packaging (packaging_item_id, account_id);
create index if not exists ix_fk_serving_formats_account_id on public.serving_formats (account_id);
create index if not exists ix_fk_serving_formats_business_id_account_id on public.serving_formats (business_id, account_id);
create index if not exists ix_fk_serving_formats_capacity_unit_id on public.serving_formats (capacity_unit_id);
create index if not exists ix_fk_subscriptions_plan_id on public.subscriptions (plan_id);
create index if not exists ix_fk_suppliers_account_id on public.suppliers (account_id);
create index if not exists ix_fk_units_account_id on public.units (account_id);

-- ---------------------------------------------------------------------------
-- 3. billing_config is not for anonymous callers          (separable section)
-- ---------------------------------------------------------------------------
revoke select on billing_config from anon;

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v int; v_anon text;
begin
  select count(*) into v from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if v <> 0 then
    raise exception '0052 self-check FAILED: % fn_* functions still lack a search_path.', v;
  end if;

  with fk as (
    select c.conrelid::regclass::text as tbl, c.conname, c.conkey
      from pg_constraint c join pg_class r on r.oid=c.conrelid
     where c.contype='f' and r.relnamespace='public'::regnamespace),
  covered as (
    select fk.conname from fk join pg_index i on i.indrelid = fk.tbl::regclass
     where (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] = fk.conkey)
  select count(*) into v from fk where conname not in (select conname from covered);
  if v <> 0 then
    raise exception '0052 self-check FAILED: % foreign key(s) still uncovered.', v;
  end if;

  if (select count(*) from pg_class where relname like 'ix\_fk\_%' and relkind='i') <> 138 then
    raise exception '0052 self-check FAILED: expected 138 ix_fk_* indexes, found %.',
      (select count(*) from pg_class where relname like 'ix\_fk\_%' and relkind='i');
  end if;

  select string_agg(table_name, ', ' order by table_name) into v_anon
    from information_schema.role_table_grants
   where grantee='anon' and table_schema='public' and privilege_type='SELECT';
  if v_anon <> 'catalog_categories, catalog_ingredients, plan_features, plans, units' then
    raise exception '0052 self-check FAILED: anon SELECT surface is [%], expected the five reference tables.', v_anon;
  end if;

  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0052 self-check FAILED: policy count changed.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 77 then
    raise exception '0052 self-check FAILED: fn_* count changed.';
  end if;

  raise notice '0052 OK: 23 functions pinned to public, 138 foreign keys indexed, '
               'anon reads exactly the five reference tables, 117 policies and 77 functions unchanged.';
end
$$;
