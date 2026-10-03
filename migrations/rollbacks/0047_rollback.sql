-- Rollback for 0047.
--
-- Restores v_sales_unified, v_profit_by_period, v_profit_by_product and
-- v_dashboard_waterfall to their 0046 definitions, and removes the five new
-- views.
--
-- Two things this deliberately restores are DEFECTS, and rolling back means
-- accepting them again:
--   v_sales_unified will count unconfirmed drafts as revenue, which after 0045
--     means most orders, and
--   gross profit will again credit uncosted revenue as pure profit.
-- Roll back only to unblock, and go forward again quickly.
--
-- security_invoker and the grants are restated on every view: DROP VIEW
-- discards both, and a definition fingerprint cannot see either.
begin;

drop view if exists v_sale_cost_breakdown;
drop view if exists v_orders_attention;
drop view if exists v_product_performance;
drop view if exists v_sales_summary;
drop view if exists v_sale_lines;

drop view if exists v_dashboard_waterfall;
drop view if exists v_profit_by_product;
drop view if exists v_profit_by_period;
drop view if exists v_sales_unified;

create view v_sales_unified with (security_invoker = on) as
  select ol.account_id,
         o.business_id,
         o.order_date as sale_date,
         o.channel_id,
         ol.recipe_id,
         ol.qty,
         ol.unit_price,
         ol.line_total as revenue,
         ol.unit_cost_at_sale,
         ol.cost_snapshot_id,
         case when ol.unit_cost_at_sale is not null
              then ol.qty * ol.unit_cost_at_sale end as cogs,
         'order'::text as source
    from order_lines ol
    join orders o on o.id = ol.order_id
   where o.status <> 'cancelled'::order_status and o.voided_at is null
  union all
  select se.account_id,
         se.business_id,
         se.sale_date,
         se.channel_id,
         se.recipe_id,
         se.qty,
         se.unit_price,
         se.qty * se.unit_price as revenue,
         se.unit_cost_at_sale,
         se.cost_snapshot_id,
         case when se.unit_cost_at_sale is not null
              then se.qty * se.unit_cost_at_sale end as cogs,
         'daily_total'::text as source
    from sales_entries se
   where se.voided_at is null;

grant select, insert, update, delete on v_sales_unified to authenticated;

create view v_profit_by_period with (security_invoker = on) as
  select account_id,
         business_id,
         date_trunc('month', sale_date::timestamptz)::date as period,
         round(sum(revenue), 2) as revenue,
         round(sum(cogs), 2) as cogs,
         round(sum(revenue) - coalesce(sum(cogs), 0), 2) as gross_profit,
         round(100.0 * (sum(revenue) - coalesce(sum(cogs), 0))
               / nullif(sum(revenue), 0), 2) as gross_margin_pct,
         round(100.0 * sum(case when unit_cost_at_sale is not null then revenue else 0 end)
               / nullif(sum(revenue), 0), 2) as cost_coverage_pct,
         round(sum(case when unit_cost_at_sale is null then revenue else 0 end), 2)
           as revenue_without_cost
    from v_sales_unified
   group by account_id, business_id, date_trunc('month', sale_date::timestamptz);

grant select, insert, update, delete on v_profit_by_period to authenticated;

create view v_profit_by_product with (security_invoker = on) as
  select s.account_id,
         s.business_id,
         s.recipe_id,
         r.name,
         round(sum(s.qty), 3) as units_sold,
         round(sum(s.revenue), 2) as revenue,
         round(sum(s.cogs), 2) as cogs,
         round(sum(s.revenue) - coalesce(sum(s.cogs), 0), 2) as gross_profit,
         round(100.0 * (sum(s.revenue) - coalesce(sum(s.cogs), 0))
               / nullif(sum(s.revenue), 0), 2) as gross_margin_pct,
         round(100.0 * sum(case when s.unit_cost_at_sale is not null then s.revenue else 0 end)
               / nullif(sum(s.revenue), 0), 2) as cost_coverage_pct
    from v_sales_unified s
    join recipes r on r.id = s.recipe_id
   group by s.account_id, s.business_id, s.recipe_id, r.name;

grant select, insert, update, delete on v_profit_by_product to authenticated;

create view v_dashboard_waterfall with (security_invoker = on) as
  select business_id, account_id, period, revenue, cogs, gross_profit,
         gross_margin_pct, cost_coverage_pct, revenue_without_cost,
         case
           when cost_coverage_pct is null then 'no_sales'
           when cost_coverage_pct >= 100  then 'complete'
           when cost_coverage_pct >= 80   then 'mostly_covered'
           else 'partial'
         end as confidence
    from v_profit_by_period;

grant select, insert, update, delete on v_dashboard_waterfall to authenticated;

do $$
declare v_bad text;
begin
  if exists (select 1 from pg_views where schemaname = 'public'
              and viewname in ('v_sale_lines','v_sales_summary','v_product_performance',
                               'v_orders_attention','v_sale_cost_breakdown')) then
    raise exception '0047 rollback FAILED: a Phase 6 view survived.';
  end if;
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('v_sales_unified','v_profit_by_period','v_profit_by_product',
                       'v_dashboard_waterfall')
     and not coalesce('security_invoker=on' = any(c.reloptions), false);
  if v_bad is not null then
    raise exception '0047 rollback FAILED: restored without security_invoker: %', v_bad;
  end if;
  select string_agg(v, ', ') into v_bad
    from unnest(array['v_sales_unified','v_profit_by_period','v_profit_by_product',
                      'v_dashboard_waterfall']) v
   where not exists (select 1 from information_schema.role_table_grants g
                      where g.table_schema = 'public' and g.table_name = v
                        and g.grantee = 'authenticated' and g.privilege_type = 'SELECT');
  if v_bad is not null then
    raise exception '0047 rollback FAILED: authenticated cannot read: %', v_bad;
  end if;
  raise notice '0047 rollback OK: pre-0047 reporting restored, with its known defects.';
end
$$;

commit;
