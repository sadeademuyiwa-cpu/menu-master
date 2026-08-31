-- ============================================================================
-- PHASE 6 -- STEP 1a: PREREQUISITE AUDIT   (READ ONLY -- changes nothing)
--
-- Run this FIRST, before the baseline and before any migration.
--
-- It exists because the first production attempt failed on a dependency that
-- every earlier gate had missed: production is at migration 0033, while the
-- Phase 6 chain was built and rehearsed on 0042. Nine migrations in between
-- were never deployed, and nothing checked for them.
--
-- The policy count was the same -- 116 -- in both states, so the preflights
-- passed and gave false comfort.
--
-- Every row must read PASS before STEP 1.
-- ============================================================================
with req(migration, kind, name, present) as (
  select '0034','function','fn_ingredient_cost_basis',
         exists(select 1 from pg_proc where proname='fn_ingredient_cost_basis' and pronamespace='public'::regnamespace)
  union all select '0034','type','ingredient_cost_basis',
         exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='ingredient_cost_basis')
  union all select '0034','view column','v_recipe_line_costs.cost_basis',
         exists(select 1 from information_schema.columns
                 where table_name='v_recipe_line_costs' and column_name='cost_basis')
  union all select '0035','view','v_purchase_summary',
         exists(select 1 from pg_views where schemaname='public' and viewname='v_purchase_summary')
  union all select '0036','view column','v_price_check.markup_pct',
         exists(select 1 from information_schema.columns
                 where table_name='v_price_check' and column_name='markup_pct')
  union all select '0037','column','cost_snapshots.seq',
         exists(select 1 from information_schema.columns
                 where table_name='cost_snapshots' and column_name='seq')
  union all select '0038','function body','fn_variant_cost tie-breaks on seq',
         coalesce((select pg_get_functiondef(oid) ~ 'seq desc' from pg_proc
                    where proname='fn_freeze_sale_cost' and pronamespace='public'::regnamespace), false)
  union all select '0039','view','v_recipe_basis',
         exists(select 1 from pg_views where schemaname='public' and viewname='v_recipe_basis')
  union all select '0039','view column','v_recipe_basis.costing_model',
         exists(select 1 from information_schema.columns
                 where table_name='v_recipe_basis' and column_name='costing_model')
  union all select '0040','function body','fn_variant_problem defers to the resolver',
         coalesce((select pg_get_functiondef(oid) ~ 'fn_variant_resolved_qty' from pg_proc
                    where proname='fn_variant_problem' and pronamespace='public'::regnamespace), false)
  union all select '0041','function','fn_overhead_breakdown',
         exists(select 1 from pg_proc where proname='fn_overhead_breakdown' and pronamespace='public'::regnamespace)
  union all select '0041','function','fn_overhead_problem',
         exists(select 1 from pg_proc where proname='fn_overhead_problem' and pronamespace='public'::regnamespace)
  union all select '0041','column','overhead_items.basis_qty',
         exists(select 1 from information_schema.columns
                 where table_name='overhead_items' and column_name='basis_qty')
  union all select '0041','column','overhead_items.basis_unit_id',
         exists(select 1 from information_schema.columns
                 where table_name='overhead_items' and column_name='basis_unit_id')
  union all select '0042','view','v_product_attention',
         exists(select 1 from pg_views where schemaname='public' and viewname='v_product_attention')
  union all select '0042','view','v_ingredient_price_status',
         exists(select 1 from pg_views where schemaname='public' and viewname='v_ingredient_price_status')
  union all select '0042','view column','v_onboarding_status.products_ready',
         exists(select 1 from information_schema.columns
                 where table_name='v_onboarding_status' and column_name='products_ready')
  -- Phase 6's own starting assumptions
  union all select '0042','baseline','policy count is 116',
         (select count(*) from pg_policies where schemaname='public') = 116
  union all select '0042','baseline','order_lines.business_id absent (0043 adds it)',
         not exists(select 1 from information_schema.columns
                     where table_name='order_lines' and column_name='business_id')
  union all select '0042','baseline','orders.order_discount absent (0044 adds it)',
         not exists(select 1 from information_schema.columns
                     where table_name='orders' and column_name='order_discount')
  union all select '0042','baseline','trg_order_lines_freeze present (0045 removes it)',
         exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                 where c.relname='order_lines' and t.tgname='trg_order_lines_freeze')
)
select case when present then 'PASS' else '*** MISSING ***' end as verdict,
       migration as needs_migration, kind, name
  from req
 order by present, migration, name;
