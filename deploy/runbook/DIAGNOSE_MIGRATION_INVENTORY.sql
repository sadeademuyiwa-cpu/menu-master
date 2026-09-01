-- ============================================================================
-- DIAGNOSE_MIGRATION_INVENTORY.sql     READ ONLY -- a single SELECT.
--   No CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, GRANT, SET or DO.
--   It reads the catalogue and counts rows. It changes nothing.
--
-- Determines, per migration, exactly which parts of 0034-0048 exist in THIS
-- database -- from the catalogue itself, never from a migration ledger and
-- never from an assumption about what "should" have run.
--
-- Each migration is probed by two or three independent markers. A migration
-- reporting "3 of 3" landed; "0 of 3" never ran; anything between is a genuine
-- partial and must be reported before anything else is attempted.
--
-- Rows 34-48  one per migration.
-- Rows 50-52  the 0048 grant surface, which is the ONLY thing separating a
--             complete 0047 from a complete 0048: 0048 creates no objects.
-- Rows 60-67  data and auth baselines, to prove nothing was touched.
-- Row 99      the verdict.
-- ============================================================================
with m(mig, marker, present) as (
  select '0034','function fn_ingredient_cost_basis', to_regprocedure('fn_ingredient_cost_basis(uuid,uuid,date)') is not null
  union all select '0034','type ingredient_cost_basis',      exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='ingredient_cost_basis')
  union all select '0035','view v_purchase_summary',          exists(select 1 from pg_views where schemaname='public' and viewname='v_purchase_summary')
  union all select '0036','column v_price_check.markup_pct',  exists(select 1 from information_schema.columns where table_name='v_price_check' and column_name='markup_pct')
  union all select '0037','column cost_snapshots.seq',        exists(select 1 from information_schema.columns where table_name='cost_snapshots' and column_name='seq')
  union all select '0038','function fn_compute_recipe_cost_snapshot reads auth.uid()', exists(select 1 from pg_proc where proname='fn_compute_recipe_cost_snapshot' and pronamespace='public'::regnamespace and pg_get_functiondef(oid) ~ 'auth\.uid')
  union all select '0039','view v_recipe_basis',              exists(select 1 from pg_views where schemaname='public' and viewname='v_recipe_basis')
  union all select '0040','function fn_variant_problem',      to_regprocedure('fn_variant_problem(uuid)') is not null
  union all select '0041','function fn_overhead_breakdown',   to_regprocedure('fn_overhead_breakdown(uuid,uuid)') is not null
  union all select '0041','column overhead_items.basis_qty',  exists(select 1 from information_schema.columns where table_name='overhead_items' and column_name='basis_qty')
  union all select '0042','view v_product_attention',         exists(select 1 from pg_views where schemaname='public' and viewname='v_product_attention')
  union all select '0042','view v_ingredient_price_status',   exists(select 1 from pg_views where schemaname='public' and viewname='v_ingredient_price_status')
  union all select '0043','column order_lines.business_id',   exists(select 1 from information_schema.columns where table_name='order_lines' and column_name='business_id')
  union all select '0043','column customers.company',         exists(select 1 from information_schema.columns where table_name='customers' and column_name='company')
  union all select '0044','column orders.order_discount',     exists(select 1 from information_schema.columns where table_name='orders' and column_name='order_discount')
  union all select '0044','column order_lines.discount_amount', exists(select 1 from information_schema.columns where table_name='order_lines' and column_name='discount_amount')
  union all select '0045','function fn_confirm_order',        to_regprocedure('fn_confirm_order(uuid)') is not null
  union all select '0045','orders.status defaults to draft',  (select column_default from information_schema.columns where table_name='orders' and column_name='status') = '''draft''::order_status'
  union all select '0045','trg_order_lines_freeze REMOVED',   not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='order_lines' and t.tgname='trg_order_lines_freeze')
  union all select '0046','column cost_snapshots.variant_overhead_cost', exists(select 1 from information_schema.columns where table_name='cost_snapshots' and column_name='variant_overhead_cost')
  union all select '0046','function fn_variant_cost_components', to_regprocedure('fn_variant_cost_components(uuid)') is not null
  union all select '0047','view v_sale_lines',                exists(select 1 from pg_views where schemaname='public' and viewname='v_sale_lines')
  union all select '0047','view v_sales_summary',             exists(select 1 from pg_views where schemaname='public' and viewname='v_sales_summary')
),
g as (
  select
    (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE'))) as pub,
    (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
       and exists (select 1 from aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee where r.rolname='anon' and a.privilege_type='EXECUTE')) as anon,
    (select count(*) from unnest(array['fn_ingredient_cost_basis(uuid,uuid,date)','fn_overhead_breakdown(uuid,uuid)',
        'fn_overhead_problem(uuid,uuid)','fn_allocate_order_discount(uuid)','fn_confirm_order(uuid)',
        'fn_frozen_sale_cost(uuid,uuid,uuid)','fn_variant_cost_components(uuid)']) f
      where to_regprocedure(f) is not null and has_function_privilege('authenticated', to_regprocedure(f), 'execute')) as seven
),
roll as (
  select mig, count(*) filter (where present) as have, count(*) as want,
         coalesce(string_agg(marker, '; ' order by marker) filter (where not present), '') as missing
    from m group by mig
)
select mig::text as line, 'migration ' || mig as item,
       have || ' of ' || want || ' markers present'
       || case when have = want then '  -- APPLIED'
               when have = 0    then '  -- NOT APPLIED'
               else '  *** PARTIAL -- missing: ' || missing || ' ***' end as value
  from roll
union all select '0050','0048 revoke pass: fn_* executable by PUBLIC (0047 = 9, 0048 = 0)', pub::text from g
union all select '0051','0048 revoke pass: fn_* executable by anon   (0047 = 1, 0048 = 0)', anon::text from g
union all select '0052','0048 grant pass: of 7 app functions callable by authenticated', seven::text from g
union all select '0060','BASELINE auth.users (must be 7)', (select count(*)::text from auth.users)
union all select '0061','BASELINE RLS policies (must be 116)', (select count(*)::text from pg_policies where schemaname='public')
union all select '0062','BASELINE orders / order_lines', (select count(*)::text from orders)||' / '||(select count(*)::text from order_lines)
union all select '0063','BASELINE customers / cost_snapshots', (select count(*)::text from customers)||' / '||(select count(*)::text from cost_snapshots)
union all select '0064','BASELINE accounts / businesses', (select count(*)::text from accounts)||' / '||(select count(*)::text from businesses)
union all select '0065','BASELINE recipes / ingredients', (select count(*)::text from recipes)||' / '||(select count(*)::text from ingredients)
union all select '0066','BASELINE total revenue recognised', coalesce((select round(sum(revenue),2)::text from v_sales_unified),'0')
union all select '0067','BASELINE frozen sale lines', (select count(*)::text from order_lines where unit_cost_at_sale is not null)
union all select '0099','VERDICT',
  case
    when (select count(*) from roll where have <> want and have <> 0) > 0
      then 'PARTIAL MIGRATION PRESENT -- STOP. Report every row. Do not run any migration or rollback.'
    when (select count(*) from roll where have = 0) > 0
      then 'INCOMPLETE -- some migrations never ran. STOP and report every row.'
    when (select pub from g) = 0 and (select anon from g) = 0 and (select seven from g) = 7
      then 'COMPLETE AT 0048. Every migration 0034-0048 is fully applied, including the 0048 grant surface. PHASE6_MIGRATE.sql must NOT be run: its preflights are designed to refuse, which is what they did.'
    else 'ALL OBJECTS PRESENT BUT THE 0048 GRANT SURFACE IS NOT SET -- report rows 0050-0052.'
  end
order by 1;
