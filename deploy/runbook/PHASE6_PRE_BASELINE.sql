-- ============================================================================
-- PHASE 6 -- STEP 1: PRE-MIGRATION BASELINE   (READ ONLY -- changes nothing)
--
-- Run this BEFORE anything else and keep the output. It is the only way to
-- prove afterwards that nothing moved: every post-migration check compares
-- against these numbers.
--
-- Safe to run at any time. It writes nothing.
-- ============================================================================
\pset format aligned
\pset border 2

\echo '=== A. THE FIGURES THAT MUST NOT MOVE ==================================='
select coalesce(round(sum(revenue),2),0)                as total_revenue,
       coalesce(round(sum(cogs),2),0)                   as total_cogs,
       count(*)                                         as sale_lines,
       coalesce(round(sum(qty),3),0)                    as total_units
  from v_sales_unified;

\echo '=== B. REVENUE BY MONTH (keep this table; it must match afterwards) ====='
select business_id, period,
       round(revenue,2) as revenue, round(coalesce(cogs,0),2) as cogs
  from v_profit_by_period order by business_id, period;

\echo '=== C. ORDER POPULATION BY SHAPE ========================================'
select status::text as status,
       (finalised_at is not null) as has_confirmation_time,
       (voided_at is not null)    as voided,
       count(*)                   as orders
  from orders group by 1,2,3 order by 1,2,3;

\echo '=== D. THE ROWS 0045 WILL RECONCILE (expect this exact count in its NOTICE)'
select count(*) as will_be_reconciled
  from orders
 where status not in ('draft','cancelled')
   and finalised_at is null and voided_at is null;

\echo '    ...and which ones, so they can be checked individually afterwards:'
select id, order_no, status::text as status, order_date, created_at
  from orders
 where status not in ('draft','cancelled')
   and finalised_at is null and voided_at is null
 order by created_at;

\echo '=== E. FROZEN COSTS (every one must be byte-for-byte identical after) ==='
select count(*) filter (where unit_cost_at_sale is not null) as frozen_lines,
       coalesce(sum(qty * unit_cost_at_sale),0)              as frozen_total,
       md5(coalesce(string_agg(id::text || ':' || coalesce(unit_cost_at_sale::text,'-'),
                               ',' order by id),'')) as frozen_fingerprint
  from order_lines;

\echo '=== F. SECURITY BASELINE ==============================================='
select (select count(*) from pg_policies where schemaname='public')          as policies,
       (select count(*) from auth.users)                                     as auth_users,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='v')                         as views;

\echo '=== G. SNAPSHOT POPULATION (must be identical afterwards) =============='
select count(*) as cost_snapshots,
       coalesce(max(computed_at)::text,'none') as newest_snapshot
  from cost_snapshots;
