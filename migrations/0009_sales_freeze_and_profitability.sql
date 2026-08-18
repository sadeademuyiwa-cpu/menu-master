-- ============================================================================
-- MENU MASTER NG
-- 0009: sales cost freeze and profitability
--
-- At the moment of sale the current cost snapshot is stamped onto the line.
-- Nothing that happens afterwards can move it: not a price change, not a
-- recipe edit, not a new conversion, not a yield correction, not a repricing.
--
-- If the cost was incomplete at sale time, both cost_snapshot_id and
-- unit_cost_at_sale stay NULL. Revenue counts. COGS does not. The gap is
-- reported as cost_coverage_pct rather than hidden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Freeze on insert
-- ----------------------------------------------------------------------------

create or replace function fn_freeze_sale_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s cost_snapshots%rowtype;
begin
  if new.recipe_id is null then
    new.cost_snapshot_id  := null;
    new.unit_cost_at_sale := null;
    return new;
  end if;

  select * into s
  from cost_snapshots
  where recipe_id = new.recipe_id
  order by computed_at desc
  limit 1;

  -- The gate applies here too. An incomplete cost is not a cost.
  if not found or not s.is_complete or s.cost_per_portion is null then
    new.cost_snapshot_id  := null;
    new.unit_cost_at_sale := null;
  else
    new.cost_snapshot_id  := s.id;
    new.unit_cost_at_sale := s.cost_per_portion;
  end if;

  return new;
end;
$$;

create trigger trg_order_lines_freeze
  before insert on order_lines
  for each row execute function fn_freeze_sale_cost();

create trigger trg_sales_entries_freeze
  before insert on sales_entries
  for each row execute function fn_freeze_sale_cost();

-- ----------------------------------------------------------------------------
-- 2. The frozen cost is immutable
-- ----------------------------------------------------------------------------

create or replace function fn_guard_frozen_cost()
returns trigger language plpgsql as $$
begin
  if new.cost_snapshot_id is distinct from old.cost_snapshot_id
     or new.unit_cost_at_sale is distinct from old.unit_cost_at_sale then
    raise exception
      'The cost frozen at sale time cannot be changed. Reverse the sale instead.'
      using errcode='check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_order_lines_frozen
  before update on order_lines
  for each row execute function fn_guard_frozen_cost();

create trigger trg_sales_entries_frozen
  before update on sales_entries
  for each row execute function fn_guard_frozen_cost();

-- ----------------------------------------------------------------------------
-- 3. Profitability, rebuilt on the frozen figures
-- ----------------------------------------------------------------------------

drop view if exists v_profit_by_period;
drop view if exists v_profit_by_product;
drop view if exists v_sales_unified;

create view v_sales_unified with (security_invoker = on) as
select
  ol.account_id, o.business_id, o.order_date as sale_date, o.channel_id,
  ol.recipe_id, ol.qty, ol.unit_price,
  ol.line_total as revenue,
  ol.unit_cost_at_sale,
  ol.cost_snapshot_id,
  case when ol.unit_cost_at_sale is not null
       then ol.qty * ol.unit_cost_at_sale end as cogs,
  'order'::text as source
from order_lines ol
join orders o on o.id = ol.order_id
where o.status <> 'cancelled'
union all
select
  se.account_id, se.business_id, se.sale_date, se.channel_id,
  se.recipe_id, se.qty, se.unit_price,
  se.qty * se.unit_price,
  se.unit_cost_at_sale,
  se.cost_snapshot_id,
  case when se.unit_cost_at_sale is not null
       then se.qty * se.unit_cost_at_sale end,
  'daily_total'
from sales_entries se;

create view v_profit_by_period with (security_invoker = on) as
select
  account_id,
  business_id,
  date_trunc('month', sale_date)::date as period,
  round(sum(revenue), 2)                                  as revenue,
  round(sum(cogs), 2)                                     as cogs,
  round(sum(revenue) - coalesce(sum(cogs), 0), 2)         as gross_profit,
  round(100.0 * (sum(revenue) - coalesce(sum(cogs), 0))
        / nullif(sum(revenue), 0), 2)                     as gross_margin_pct,
  -- Share of revenue with a complete cost behind it. Anything below 100
  -- means the profit figure above is partial, and the UI must say so.
  round(100.0 * sum(case when unit_cost_at_sale is not null then revenue else 0 end)
        / nullif(sum(revenue), 0), 2)                     as cost_coverage_pct,
  round(sum(case when unit_cost_at_sale is null then revenue else 0 end), 2)
                                                          as revenue_without_cost
from v_sales_unified
group by account_id, business_id, date_trunc('month', sale_date);

create view v_profit_by_product with (security_invoker = on) as
select
  s.account_id,
  s.business_id,
  s.recipe_id,
  r.name,
  round(sum(s.qty), 3)                              as units_sold,
  round(sum(s.revenue), 2)                          as revenue,
  round(sum(s.cogs), 2)                             as cogs,
  round(sum(s.revenue) - coalesce(sum(s.cogs), 0), 2) as gross_profit,
  round(100.0 * (sum(s.revenue) - coalesce(sum(s.cogs), 0))
        / nullif(sum(s.revenue), 0), 2)             as gross_margin_pct,
  round(100.0 * sum(case when s.unit_cost_at_sale is not null then s.revenue else 0 end)
        / nullif(sum(s.revenue), 0), 2)             as cost_coverage_pct
from v_sales_unified s
join recipes r on r.id = s.recipe_id
group by s.account_id, s.business_id, s.recipe_id, r.name;

-- The dashboard waterfall for a period
create or replace view v_dashboard_waterfall with (security_invoker = on) as
select
  business_id,
  account_id,
  period,
  revenue,
  cogs,
  gross_profit,
  gross_margin_pct,
  cost_coverage_pct,
  revenue_without_cost,
  case when cost_coverage_pct is null then 'no_sales'
       when cost_coverage_pct >= 100 then 'complete'
       when cost_coverage_pct >= 80  then 'mostly_covered'
       else 'partial' end as confidence
from v_profit_by_period;
