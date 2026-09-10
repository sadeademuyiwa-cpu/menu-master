-- ============================================================================
-- 0052 ROLLBACK: unpin the twenty-three, drop the 138 indexes, restore the
-- 0032 grant on billing_config. Byte-faithful to 0051 -- nothing else moved.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0052 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if (select count(*) from pg_class where relname like 'ix\_fk\_%' and relkind='i') = 0 then
    raise exception '0052 rollback: no ix_fk_* indexes exist; 0052 is not applied.';
  end if;
end
$$;
alter function public.fn_allocate_order_discount(p_order_id uuid) reset search_path;
alter function public.fn_assert_no_packaging_double_count() reset search_path;
alter function public.fn_assert_packaging_item_kind() reset search_path;
alter function public.fn_assert_sale_variant_valid() reset search_path;
alter function public.fn_assert_unit_visible() reset search_path;
alter function public.fn_assert_unit_visible_col() reset search_path;
alter function public.fn_block_format_change_mutation() reset search_path;
alter function public.fn_block_snapshot_mutation() reset search_path;
alter function public.fn_guard_finalised_order() reset search_path;
alter function public.fn_guard_frozen_cost() reset search_path;
alter function public.fn_guard_ingredient_prices() reset search_path;
alter function public.fn_guard_order_discount() reset search_path;
alter function public.fn_guard_order_lifecycle() reset search_path;
alter function public.fn_guard_order_line_revenue() reset search_path;
alter function public.fn_guard_posted_purchase() reset search_path;
alter function public.fn_guard_sales_entry_immutable() reset search_path;
alter function public.fn_guard_subscription_changes() reset search_path;
alter function public.fn_is_service_context() reset search_path;
alter function public.fn_log_serving_format_change() reset search_path;
alter function public.fn_order_line_scope() reset search_path;
alter function public.fn_prevent_recipe_cycle() reset search_path;
alter function public.fn_redact_billing_payload() reset search_path;
alter function public.fn_reject_variant_on_inactive_format() reset search_path;

drop index if exists public.ix_fk_billing_events_account_id;
drop index if exists public.ix_fk_business_settings_account_id;
drop index if exists public.ix_fk_business_settings_business_id_account_id;
drop index if exists public.ix_fk_business_settings_overhead_basis_unit_id;
drop index if exists public.ix_fk_catalog_ingredients_category_name;
drop index if exists public.ix_fk_channels_account_id;
drop index if exists public.ix_fk_channels_business_id_account_id;
drop index if exists public.ix_fk_cost_snapshots_account_id;
drop index if exists public.ix_fk_cost_snapshots_business_id;
drop index if exists public.ix_fk_cost_snapshots_business_id_account_id;
drop index if exists public.ix_fk_cost_snapshots_created_by;
drop index if exists public.ix_fk_cost_snapshots_recipe_id_account_id;
drop index if exists public.ix_fk_cost_snapshots_resolved_unit_id;
drop index if exists public.ix_fk_cost_snapshots_variant_id_account_id;
drop index if exists public.ix_fk_costing_method_changes_account_id;
drop index if exists public.ix_fk_costing_method_changes_business_id;
drop index if exists public.ix_fk_costing_method_changes_changed_by;
drop index if exists public.ix_fk_customers_account_id;
drop index if exists public.ix_fk_customers_business_id;
drop index if exists public.ix_fk_customers_business_id_account_id;
drop index if exists public.ix_fk_ingredient_categories_account_id;
drop index if exists public.ix_fk_ingredient_prices_entered_by;
drop index if exists public.ix_fk_ingredient_prices_ingredient_id_account_id;
drop index if exists public.ix_fk_ingredient_prices_purchase_line_id;
drop index if exists public.ix_fk_ingredient_prices_reversed_by_purchase_id;
drop index if exists public.ix_fk_ingredient_prices_supplier_id;
drop index if exists public.ix_fk_ingredient_prices_supplier_id_account_id;
drop index if exists public.ix_fk_ingredient_unit_conversions_account_id;
drop index if exists public.ix_fk_ingredient_unit_conversions_ingredient_id_account_id;
drop index if exists public.ix_fk_ingredient_unit_conversions_unit_id;
drop index if exists public.ix_fk_ingredients_base_unit_id;
drop index if exists public.ix_fk_ingredients_category_id;
drop index if exists public.ix_fk_ingredients_category_id_account_id;
drop index if exists public.ix_fk_labour_rates_account_id;
drop index if exists public.ix_fk_labour_rates_business_id;
drop index if exists public.ix_fk_labour_rates_business_id_account_id;
drop index if exists public.ix_fk_locations_account_id;
drop index if exists public.ix_fk_locations_business_id;
drop index if exists public.ix_fk_locations_business_id_account_id;
drop index if exists public.ix_fk_memberships_business_id;
drop index if exists public.ix_fk_memberships_business_id_account_id;
drop index if exists public.ix_fk_onboarding_requests_account_id;
drop index if exists public.ix_fk_onboarding_requests_business_id;
drop index if exists public.ix_fk_order_lines_account_id;
drop index if exists public.ix_fk_order_lines_business_id_account_id;
drop index if exists public.ix_fk_order_lines_cost_snapshot_id;
drop index if exists public.ix_fk_order_lines_cost_snapshot_id_account_id;
drop index if exists public.ix_fk_order_lines_order_id;
drop index if exists public.ix_fk_order_lines_order_id_account_id;
drop index if exists public.ix_fk_order_lines_recipe_id;
drop index if exists public.ix_fk_order_lines_recipe_id_account_id;
drop index if exists public.ix_fk_order_lines_variant_id_account_id;
drop index if exists public.ix_fk_orders_account_id;
drop index if exists public.ix_fk_orders_business_id_account_id;
drop index if exists public.ix_fk_orders_channel_id;
drop index if exists public.ix_fk_orders_channel_id_account_id;
drop index if exists public.ix_fk_orders_created_by;
drop index if exists public.ix_fk_orders_customer_id;
drop index if exists public.ix_fk_orders_customer_id_account_id;
drop index if exists public.ix_fk_orders_finalised_by;
drop index if exists public.ix_fk_orders_location_id;
drop index if exists public.ix_fk_orders_replaces_account_id;
drop index if exists public.ix_fk_orders_voided_by;
drop index if exists public.ix_fk_overhead_items_account_id;
drop index if exists public.ix_fk_overhead_items_basis_unit_id;
drop index if exists public.ix_fk_overhead_items_business_id;
drop index if exists public.ix_fk_overhead_items_business_id_account_id;
drop index if exists public.ix_fk_period_closes_account_id;
drop index if exists public.ix_fk_period_closes_business_id_account_id;
drop index if exists public.ix_fk_period_closes_closed_by;
drop index if exists public.ix_fk_purchase_lines_account_id;
drop index if exists public.ix_fk_purchase_lines_ingredient_id;
drop index if exists public.ix_fk_purchase_lines_ingredient_id_account_id;
drop index if exists public.ix_fk_purchase_lines_purchase_id;
drop index if exists public.ix_fk_purchase_lines_purchase_id_account_id;
drop index if exists public.ix_fk_purchase_lines_unit_id;
drop index if exists public.ix_fk_purchases_account_id;
drop index if exists public.ix_fk_purchases_business_id;
drop index if exists public.ix_fk_purchases_business_id_account_id;
drop index if exists public.ix_fk_purchases_created_by;
drop index if exists public.ix_fk_purchases_location_id;
drop index if exists public.ix_fk_purchases_location_id_account_id;
drop index if exists public.ix_fk_purchases_posted_by;
drop index if exists public.ix_fk_purchases_reversed_by;
drop index if exists public.ix_fk_purchases_reverses;
drop index if exists public.ix_fk_purchases_supplier_id;
drop index if exists public.ix_fk_purchases_supplier_id_account_id;
drop index if exists public.ix_fk_recipe_labour_account_id;
drop index if exists public.ix_fk_recipe_labour_labour_rate_id;
drop index if exists public.ix_fk_recipe_labour_labour_rate_id_account_id;
drop index if exists public.ix_fk_recipe_labour_recipe_id_account_id;
drop index if exists public.ix_fk_recipe_lines_account_id;
drop index if exists public.ix_fk_recipe_lines_ingredient_id;
drop index if exists public.ix_fk_recipe_lines_ingredient_id_account_id;
drop index if exists public.ix_fk_recipe_lines_recipe_id_account_id;
drop index if exists public.ix_fk_recipe_lines_sub_recipe_id_account_id;
drop index if exists public.ix_fk_recipe_lines_unit_id;
drop index if exists public.ix_fk_recipe_prices_account_id;
drop index if exists public.ix_fk_recipe_prices_channel_id;
drop index if exists public.ix_fk_recipe_prices_channel_id_account_id;
drop index if exists public.ix_fk_recipe_prices_recipe_id_account_id;
drop index if exists public.ix_fk_recipe_prices_set_by;
drop index if exists public.ix_fk_recipe_prices_variant_id_account_id;
drop index if exists public.ix_fk_recipe_variants_account_id;
drop index if exists public.ix_fk_recipe_variants_business_id_account_id;
drop index if exists public.ix_fk_recipe_variants_format_id_business_id;
drop index if exists public.ix_fk_recipe_variants_recipe_id_business_id;
drop index if exists public.ix_fk_recipe_variants_sellable_unit_id;
drop index if exists public.ix_fk_recipes_account_id;
drop index if exists public.ix_fk_recipes_business_id_account_id;
drop index if exists public.ix_fk_recipes_yield_unit_id;
drop index if exists public.ix_fk_sales_entries_account_id;
drop index if exists public.ix_fk_sales_entries_business_id_account_id;
drop index if exists public.ix_fk_sales_entries_channel_id;
drop index if exists public.ix_fk_sales_entries_channel_id_account_id;
drop index if exists public.ix_fk_sales_entries_cost_snapshot_id;
drop index if exists public.ix_fk_sales_entries_cost_snapshot_id_account_id;
drop index if exists public.ix_fk_sales_entries_created_by;
drop index if exists public.ix_fk_sales_entries_location_id;
drop index if exists public.ix_fk_sales_entries_recipe_id;
drop index if exists public.ix_fk_sales_entries_recipe_id_account_id;
drop index if exists public.ix_fk_sales_entries_replaces_account_id;
drop index if exists public.ix_fk_sales_entries_variant_id_account_id;
drop index if exists public.ix_fk_sales_entries_voided_by;
drop index if exists public.ix_fk_serving_format_changes_account_id;
drop index if exists public.ix_fk_serving_format_changes_business_id_account_id;
drop index if exists public.ix_fk_serving_format_changes_changed_by;
drop index if exists public.ix_fk_serving_format_changes_format_id_business_id;
drop index if exists public.ix_fk_serving_format_packaging_account_id;
drop index if exists public.ix_fk_serving_format_packaging_business_id_account_id;
drop index if exists public.ix_fk_serving_format_packaging_format_id_business_id;
drop index if exists public.ix_fk_serving_format_packaging_packaging_item_id_account_id;
drop index if exists public.ix_fk_serving_formats_account_id;
drop index if exists public.ix_fk_serving_formats_business_id_account_id;
drop index if exists public.ix_fk_serving_formats_capacity_unit_id;
drop index if exists public.ix_fk_subscriptions_plan_id;
drop index if exists public.ix_fk_suppliers_account_id;
drop index if exists public.ix_fk_units_account_id;

grant select on billing_config to anon;

do $$
begin
  if exists (select 1 from pg_class where relname like 'ix\_fk\_%' and relkind='i') then
    raise exception '0052 rollback FAILED: an ix_fk_* index survived.';
  end if;
  if not has_table_privilege('anon','billing_config','select') then
    raise exception '0052 rollback FAILED: the 0032 anon grant was not restored.';
  end if;
  raise notice '0052 rollback OK: back at 0051.';
end
$$;
