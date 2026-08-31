-- ============================================================================
-- STEP 1 -- PRE-DEPLOY AUDIT        READ ONLY. Changes nothing.
--
-- Proves production is at EXACTLY migration 0033 and that no part of
-- 0034-0048 has been applied. It fails closed: an unexpected object, a partial
-- chain, or anything that is not the state this deployment was rehearsed
-- against is a FAIL, not a warning.
--
-- The first attempt failed because the only starting-state check was the policy
-- count, and that count is 116 at 0033 and at 0042 alike. It proved nothing.
-- This one pins the function catalogue itself.
--
-- Paste the whole file into the Supabase SQL Editor and Run once.
-- EXPECTED: 24 rows, every one PASS.
-- ============================================================================
with
sig as (
  select md5(string_agg(s,',' order by s)) as fp
    from (select replace(p.oid::regprocedure::text,' ','') as s
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname like 'fn\_%') z
),
-- Objects that exist ONLY after 0034-0048. Any one present means production is
-- part-migrated and this deployment must not run.
ahead(migration, obj, present) as (
  select '0034','function fn_ingredient_cost_basis', exists(select 1 from pg_proc where proname='fn_ingredient_cost_basis' and pronamespace='public'::regnamespace)
  union all select '0034','type ingredient_cost_basis', exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='ingredient_cost_basis')
  union all select '0035','view v_purchase_summary', exists(select 1 from pg_views where schemaname='public' and viewname='v_purchase_summary')
  union all select '0036','column v_price_check.markup_pct', exists(select 1 from information_schema.columns where table_name='v_price_check' and column_name='markup_pct')
  union all select '0037','column cost_snapshots.seq', exists(select 1 from information_schema.columns where table_name='cost_snapshots' and column_name='seq')
  union all select '0039','view v_recipe_basis', exists(select 1 from pg_views where schemaname='public' and viewname='v_recipe_basis')
  union all select '0041','function fn_overhead_breakdown', exists(select 1 from pg_proc where proname='fn_overhead_breakdown' and pronamespace='public'::regnamespace)
  union all select '0041','column overhead_items.basis_qty', exists(select 1 from information_schema.columns where table_name='overhead_items' and column_name='basis_qty')
  union all select '0042','view v_product_attention', exists(select 1 from pg_views where schemaname='public' and viewname='v_product_attention')
  union all select '0042','view v_ingredient_price_status', exists(select 1 from pg_views where schemaname='public' and viewname='v_ingredient_price_status')
  union all select '0043','column order_lines.business_id', exists(select 1 from information_schema.columns where table_name='order_lines' and column_name='business_id')
  union all select '0044','column orders.order_discount', exists(select 1 from information_schema.columns where table_name='orders' and column_name='order_discount')
  union all select '0045','function fn_confirm_order', exists(select 1 from pg_proc where proname='fn_confirm_order' and pronamespace='public'::regnamespace)
  union all select '0046','column cost_snapshots.variant_overhead_cost', exists(select 1 from information_schema.columns where table_name='cost_snapshots' and column_name='variant_overhead_cost')
  union all select '0047','view v_sale_lines', exists(select 1 from pg_views where schemaname='public' and viewname='v_sale_lines')
),
checks(n, check_name, ok, detail) as (
  -- 1. IDENTITY: production must be exactly the catalogue we rehearsed against
  select 1, 'identity: function catalogue is exactly the rehearsed 0033 set',
         (select fp from sig) = '26a45d7d98026721366ec58a66cb6d1b',
         'fingerprint ' || (select fp from sig) || ' (expect 26a45d7d98026721366ec58a66cb6d1b)'
  union all select 2, 'identity: 60 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 60,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 3, 'identity: 14 views',
         (select count(*) from pg_views where schemaname='public') = 14,
         (select count(*)::text from pg_views where schemaname='public')
  union all select 4, 'identity: 41 tables',
         (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') = 41,
         (select count(*)::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
  union all select 5, 'identity: 34 triggers',
         (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) = 34,
         (select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)
  union all select 6, 'identity: 116 RLS policies',
         (select count(*) from pg_policies where schemaname='public') = 116,
         (select count(*)::text from pg_policies where schemaname='public')
  -- 2. FAIL CLOSED: nothing from 0034-0048 may already exist
  union all select 7, 'fail-closed: no part of 0034-0048 is already applied',
         not exists(select 1 from ahead where present),
         coalesce((select string_agg(migration||' '||obj,'; ' order by migration,obj) from ahead where present),'none present -- correct')
  -- 3. PRESENT: what 0034 actually builds on must be there
  union all select 8, 'prerequisite: v_recipe_line_costs exists (0033)',
         exists(select 1 from pg_views where schemaname='public' and viewname='v_recipe_line_costs'), ''
  union all select 9, 'prerequisite: fn_my_entitlement_status exists (0032)',
         exists(select 1 from pg_proc where proname='fn_my_entitlement_status' and pronamespace='public'::regnamespace), ''
  union all select 10,'prerequisite: fn_ingredient_unit_cost(uuid,uuid,date) exists (0007)',
         exists(select 1 from pg_proc where oid::regprocedure::text = 'fn_ingredient_unit_cost(uuid,uuid,date)'), ''
  union all select 11,'prerequisite: cost_snapshots.format_packaging_cost exists (0021)',
         exists(select 1 from information_schema.columns where table_name='cost_snapshots' and column_name='format_packaging_cost'), ''
  union all select 12,'prerequisite: trg_order_lines_freeze present (0045 removes it)',
         exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='order_lines' and t.tgname='trg_order_lines_freeze'), ''
  union all select 13,'prerequisite: orders.status defaults to confirmed (0045 changes it)',
         (select column_default from information_schema.columns where table_name='orders' and column_name='status') = '''confirmed''::order_status',
         coalesce((select column_default from information_schema.columns where table_name='orders' and column_name='status'),'none')
  union all select 14,'prerequisite: overhead_items exists (0023)',
         exists(select 1 from information_schema.tables where table_schema='public' and table_name='overhead_items'), ''
  union all select 15,'prerequisite: recipe_variants.costing_basis exists (0024)',
         exists(select 1 from information_schema.columns where table_name='recipe_variants' and column_name='costing_basis'), ''
  -- 4. THE SEVEN LOGINS, and the data baseline
  union all select 16,'auth: exactly 7 login accounts, to be preserved untouched',
         (select count(*) from auth.users) = 7,
         (select count(*)::text from auth.users) || ' (nothing in 0034-0048 reads or writes auth.users)'
  union all select 17,'baseline: orders', true, (select count(*)::text from orders)
  union all select 18,'baseline: order_lines', true, (select count(*)::text from order_lines)
  union all select 19,'baseline: customers', true, (select count(*)::text from customers)
  union all select 20,'baseline: cost_snapshots', true, (select count(*)::text from cost_snapshots)
  union all select 21,'baseline: accounts / businesses', true,
         (select count(*)::text from accounts) || ' / ' || (select count(*)::text from businesses)
  union all select 22,'baseline: recipes / ingredients', true,
         (select count(*)::text from recipes) || ' / ' || (select count(*)::text from ingredients)
  union all select 23,'baseline: total revenue recognised today', true,
         coalesce((select round(sum(revenue),2)::text from v_sales_unified),'0')
  union all select 24,'baseline: rows 0045 will reconcile (expect 0 on an empty database)', true,
         (select count(*)::text from orders where status not in ('draft','cancelled') and finalised_at is null and voided_at is null)
)
select n, case when ok then 'PASS' else '*** FAIL -- STOP ***' end as verdict, check_name, detail
  from checks order by ok, n;
