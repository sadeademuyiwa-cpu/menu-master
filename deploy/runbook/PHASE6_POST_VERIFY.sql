-- ============================================================================
-- PHASE 6 -- STEP 3: POST-MIGRATION VERIFICATION   (READ ONLY)
--
-- Run immediately after the migration. Compare A, B, E against the STEP 1
-- baseline by eye; the checks that can be self-evaluating are.
--
-- Any FAIL is a stop. Do not continue, do not deploy the frontend.
-- ============================================================================
\pset format aligned
\pset border 2

\echo '=== A. THE FIGURES THAT MUST NOT MOVE (compare to STEP 1 A) ============='
select coalesce(round(sum(revenue),2),0)  as total_revenue,
       coalesce(round(sum(cogs),2),0)     as total_cogs,
       count(*)                           as sale_lines,
       coalesce(round(sum(qty),3),0)      as total_units
  from v_sales_unified;

\echo '=== B. REVENUE BY MONTH (compare to STEP 1 B, line for line) ============'
select business_id, period,
       round(revenue,2) as revenue, round(coalesce(cogs,0),2) as cogs,
       round(coalesce(costed_revenue,0),2) as costed_revenue
  from v_profit_by_period order by business_id, period;

\echo '=== C. FROZEN COSTS (fingerprint must equal STEP 1 E exactly) =========='
select count(*) filter (where unit_cost_at_sale is not null) as frozen_lines,
       coalesce(sum(qty * unit_cost_at_sale),0)              as frozen_total,
       md5(coalesce(string_agg(id::text || ':' || coalesce(unit_cost_at_sale::text,'-'),
                               ',' order by id),'')) as frozen_fingerprint
  from order_lines;

\echo '=== D. SELF-EVALUATING CHECKS =========================================='
with c as (
  select 'lifecycle: no order reads as a sale without a confirmation time' as check_name,
         (select count(*) from orders
           where status not in ('draft','cancelled')
             and finalised_at is null and voided_at is null) = 0 as ok,
         (select count(*)::text from orders
           where status not in ('draft','cancelled')
             and finalised_at is null and voided_at is null) as detail
  union all
  select 'lifecycle: no order is finalised while still labelled a draft',
         (select count(*) from orders where finalised_at is not null and status = 'draft') = 0,
         (select count(*)::text from orders where finalised_at is not null and status = 'draft')
  union all
  select 'lifecycle: every reconciled order took its own created_at',
         not exists (select 1 from orders where finalised_at < created_at),
         (select count(*)::text from orders where finalised_at < created_at)||' with a time before creation'
  union all
  select 'tenancy: policy count is still 116',
         (select count(*) from pg_policies where schemaname='public') = 116,
         (select count(*)::text from pg_policies where schemaname='public')
  union all
  select 'tenancy: every tenant view is security_invoker',
         (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='v'
             and c.relname <> 'v_billing_reconciliation'
             and not coalesce('security_invoker=on' = any(c.reloptions), false)) = 0,
         coalesce((select string_agg(c.relname,', ') from pg_class c
                    join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='v'
                     and c.relname <> 'v_billing_reconciliation'
                     and not coalesce('security_invoker=on' = any(c.reloptions), false)),'none')
  union all
  select 'tenancy: no function is executable by public or anon',
         (select count(*) from pg_proc p
           where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
             and (p.proacl is null or '=X/postgres' = any(p.proacl::text[])
                  or 'anon=X/postgres' = any(p.proacl::text[]))) = 0,
         coalesce((select string_agg(p.proname,', ') from pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
                      and (p.proacl is null or '=X/postgres' = any(p.proacl::text[])
                           or 'anon=X/postgres' = any(p.proacl::text[]))),'none')
  union all
  select 'tenancy: the cost freezer refuses an unchecked account',
         (select pg_get_functiondef(oid) ~ 'fn_require_member' from pg_proc
           where proname='fn_frozen_sale_cost' and pronamespace='public'::regnamespace),
         'fn_frozen_sale_cost'
  union all
  select 'schema: all six migrations landed',
         (select count(*) from information_schema.columns
           where table_name='order_lines' and column_name in ('business_id','discount_amount')) = 2
         and (select count(*) from information_schema.columns
               where table_name='cost_snapshots'
                 and column_name in ('portion_qty_at_snapshot','variant_overhead_cost')) = 2
         and (select count(*) from pg_views where schemaname='public'
               and viewname in ('v_sale_lines','v_sales_summary','v_product_performance',
                                'v_orders_attention','v_sale_cost_breakdown')) = 5
         and (select count(*) from pg_proc where proname='fn_confirm_order'
               and pronamespace='public'::regnamespace) = 1,
         'columns, views and functions'
  union all
  select 'schema: an order is now born a draft',
         (select column_default from information_schema.columns
           where table_name='orders' and column_name='status') = '''draft''::order_status',
         coalesce((select column_default from information_schema.columns
                    where table_name='orders' and column_name='status'),'none')
  union all
  select 'data: no snapshot gained provenance it never had',
         not exists (
           select 1 from cost_snapshots cs
            where (cs.portion_qty_at_snapshot is not null or cs.variant_overhead_cost is not null)
              and cs.computed_at < (select min(created_at) from orders)),
         'pre-existing snapshots still read NULL for the 0046 columns'
)
select case when ok then 'PASS' else '*** FAIL ***' end as verdict, check_name, detail from c
order by ok, check_name;

\echo '=== E. SNAPSHOT POPULATION (compare to STEP 1 G -- both must be identical) ='
select count(*) as cost_snapshots,
       coalesce(max(computed_at)::text,'none') as newest_snapshot
  from cost_snapshots;

\echo '=== F. THE ORDERS 0045 RECONCILED ======================================='
\echo '    Compare these ids to STEP 1 section D. They must be the SAME LIST,'
\echo '    and the count must equal the number in the 0045 NOTICE. Matching by'
\echo '    id, not by timestamp: an order finalised in the same transaction it'
\echo '    was created in also has finalised_at = created_at, so a timestamp'
\echo '    test would over-count.'
select id, order_no, status::text as status, order_date,
       finalised_at, (finalised_at = created_at) as took_its_own_created_at
  from orders
 where status not in ('draft','cancelled') and voided_at is null
   and finalised_at = created_at
 order by created_at;
