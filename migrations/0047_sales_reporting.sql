-- ============================================================================
-- MENU MASTER NG
-- 0047: what the sales actually made
--
-- Requires: 0001-0046 applied.
--
-- Two defects in the existing reporting are corrected here, and both matter
-- more than the new views.
--
-- P0 -- v_sales_unified counted drafts as revenue.
--   It admitted every order whose status was not 'cancelled'. Until 0045 an
--   order was born 'confirmed', so drafts were rare and the filter looked
--   harmless. Now that an order is born a draft, an unconfirmed order would be
--   reported as money taken. Revenue is now recognised at confirmation --
--   finalised_at -- which is the same boundary that freezes the cost, so
--   revenue and COGS can never be recognised at different moments.
--
-- P1 -- gross profit credited uncosted revenue as pure profit.
--   v_profit_by_period and v_profit_by_product computed
--   revenue - coalesce(sum(cogs), 0). sum() skips NULLs, so a line with no
--   frozen cost contributed its full revenue and no cost, and the reported
--   margin rose exactly when the least was known. Gross profit is now
--   costed_revenue - cogs: margin is measured only over the sales whose cost
--   is actually known, and coverage is reported beside it so the owner can see
--   how much of the picture that is. cost_coverage_pct already existed to warn
--   about this; the profit figure itself did not listen to it.
--
-- Revenue is also now net of discounts. Gross revenue, the line discount, the
-- allocated share of the order discount and net revenue are all carried
-- separately, so a discount is visible as a decision rather than buried in a
-- smaller number.
--
-- Every view here is security_invoker: it sees exactly what its caller may
-- see, and no more. The option is restated on every single one -- CREATE OR
-- REPLACE VIEW does not preserve reloptions, and pg_views.definition does not
-- show them, so a fingerprint check cannot catch its loss. Only an explicit
-- assertion can, and tests/027 makes it.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'cost_snapshots' and column_name = 'variant_overhead_cost') then
    raise exception '0047 preflight FAILED: 0046 has not been applied.';
  end if;
  if exists (select 1 from pg_views where schemaname = 'public'
              and viewname in ('v_sale_lines','v_sales_summary','v_product_performance',
                               'v_orders_attention','v_sale_cost_breakdown')) then
    raise exception '0047 preflight FAILED: one of the new views already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0047 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Rebuild the shared sales grain
--
-- Dropped rather than replaced: CREATE OR REPLACE VIEW cannot reorder or
-- remove a column, and this needs both. Dropping discards grants, so every
-- grant is restated at the end of each block -- the omission that had to be
-- repaired twice in 0036 and 0042.
-- ---------------------------------------------------------------------------

drop view if exists v_dashboard_waterfall;
drop view if exists v_profit_by_product;
drop view if exists v_profit_by_period;
drop view if exists v_sales_unified;

create view v_sales_unified with (security_invoker = on) as
  -- Confirmed order lines. finalised_at is the recognition boundary: it is set
  -- in the same statement that freezes the costs, so a sale never appears in
  -- revenue before its cost is frozen.
  select ol.account_id,
         o.business_id,
         'order'::text                     as source,
         ol.id                             as record_id,
         o.id                              as order_id,
         o.order_no                        as reference,
         o.order_date                      as sale_date,
         o.channel_id,
         o.customer_id,
         ol.recipe_id,
         ol.variant_id,
         ol.qty,
         ol.unit_price,
         a.gross_revenue,
         a.line_discount,
         a.allocated_order_discount,
         a.net_revenue                     as revenue,
         ol.unit_cost_at_sale,
         ol.cost_snapshot_id,
         case when ol.unit_cost_at_sale is not null
              then round(ol.qty * ol.unit_cost_at_sale, 2) end as cogs
    from order_lines ol
    join orders o on o.id = ol.order_id
    join fn_allocate_order_discount() a on a.order_line_id = ol.id
   where o.finalised_at is not null
     and o.voided_at is null
     and o.status <> 'cancelled'

  union all

  -- A daily total. It has no draft state and no discount fields; a quick sale
  -- is recorded at the price actually taken.
  select se.account_id,
         se.business_id,
         'daily_total'::text               as source,
         se.id                             as record_id,
         null::uuid                        as order_id,
         null::text                        as reference,
         se.sale_date,
         se.channel_id,
         null::uuid                        as customer_id,
         se.recipe_id,
         se.variant_id,
         se.qty,
         se.unit_price,
         round(se.qty * se.unit_price, 2)  as gross_revenue,
         0::numeric(14,2)                  as line_discount,
         0::numeric(14,2)                  as allocated_order_discount,
         round(se.qty * se.unit_price, 2)  as revenue,
         se.unit_cost_at_sale,
         se.cost_snapshot_id,
         case when se.unit_cost_at_sale is not null
              then round(se.qty * se.unit_cost_at_sale, 2) end as cogs
    from sales_entries se
   where se.voided_at is null;

comment on view v_sales_unified is
  'Every recognised sale at line grain, from orders and daily totals alike. '
  'An order appears only once confirmed, which is the same instant its cost '
  'was frozen.';

grant select on v_sales_unified to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Profit, measured only over what is actually known
-- ---------------------------------------------------------------------------

create view v_profit_by_period with (security_invoker = on) as
  select account_id,
         business_id,
         date_trunc('month', sale_date::timestamptz)::date as period,
         round(sum(revenue), 2)                            as revenue,
         round(sum(revenue) filter (where cogs is not null), 2) as costed_revenue,
         round(sum(cogs), 2)                               as cogs,
         -- Only the costed subset. Crediting uncosted revenue as pure profit
         -- would flatter the margin exactly where least is known.
         round(sum(revenue) filter (where cogs is not null) - sum(cogs), 2) as gross_profit,
         round(100.0 * (sum(revenue) filter (where cogs is not null) - sum(cogs))
               / nullif(sum(revenue) filter (where cogs is not null), 0), 2) as gross_margin_pct,
         round(100.0 * coalesce(sum(revenue) filter (where cogs is not null), 0)
               / nullif(sum(revenue), 0), 2)               as cost_coverage_pct,
         round(coalesce(sum(revenue) filter (where cogs is null), 0), 2) as revenue_without_cost
    from v_sales_unified
   group by account_id, business_id, date_trunc('month', sale_date::timestamptz);

comment on view v_profit_by_period is
  'Monthly trading. gross_profit is costed_revenue minus cogs, never revenue '
  'minus cogs: a sale with no known cost contributes to revenue and coverage, '
  'and to neither profit nor margin.';

grant select on v_profit_by_period to authenticated;

create view v_profit_by_product with (security_invoker = on) as
  select s.account_id,
         s.business_id,
         s.recipe_id,
         r.name,
         round(sum(s.qty), 3)                                as units_sold,
         round(sum(s.revenue), 2)                            as revenue,
         round(sum(s.revenue) filter (where s.cogs is not null), 2) as costed_revenue,
         round(sum(s.cogs), 2)                               as cogs,
         round(sum(s.revenue) filter (where s.cogs is not null) - sum(s.cogs), 2) as gross_profit,
         round(100.0 * (sum(s.revenue) filter (where s.cogs is not null) - sum(s.cogs))
               / nullif(sum(s.revenue) filter (where s.cogs is not null), 0), 2) as gross_margin_pct,
         round(100.0 * coalesce(sum(s.revenue) filter (where s.cogs is not null), 0)
               / nullif(sum(s.revenue), 0), 2)               as cost_coverage_pct
    from v_sales_unified s
    join recipes r on r.id = s.recipe_id
   group by s.account_id, s.business_id, s.recipe_id, r.name;

comment on view v_profit_by_product is
  'Trading by dish. Same profit rule as v_profit_by_period.';

grant select on v_profit_by_product to authenticated;

create view v_dashboard_waterfall with (security_invoker = on) as
  select business_id,
         account_id,
         period,
         revenue,
         costed_revenue,
         cogs,
         gross_profit,
         gross_margin_pct,
         cost_coverage_pct,
         revenue_without_cost,
         case
           when cost_coverage_pct is null      then 'no_sales'
           when cost_coverage_pct >= 100       then 'complete'
           when cost_coverage_pct >= 80        then 'mostly_covered'
           else 'partial'
         end as confidence
    from v_profit_by_period;

grant select on v_dashboard_waterfall to authenticated;

-- ---------------------------------------------------------------------------
-- 3. v_sale_lines -- the line an owner actually looks at
--
-- Drafts are included and labelled, because an owner building an order needs
-- to see it. Only cancelled and voided orders are excluded. A draft's revenue
-- columns are what it WOULD be worth; is_confirmed says which is which, and
-- no summary view here counts a draft.
-- ---------------------------------------------------------------------------

create view v_sale_lines with (security_invoker = on) as
  select ol.id                              as line_id,
         ol.account_id,
         ol.business_id,
         o.id                               as order_id,
         o.order_no,
         o.order_date,
         o.status                           as order_status,
         (o.finalised_at is not null)       as is_confirmed,
         o.payment_status,
         o.customer_id,
         c.name                             as customer_name,
         o.channel_id,
         ol.recipe_id,
         r.name                             as product_name,
         ol.variant_id,
         f.name                             as format_name,
         ol.description,
         ol.qty,
         ol.unit_price,
         a.gross_revenue,
         a.line_discount,
         a.allocated_order_discount,
         a.net_revenue,
         ol.unit_cost_at_sale,
         case when ol.unit_cost_at_sale is not null
              then round(ol.qty * ol.unit_cost_at_sale, 2) end as cogs,
         -- Profit only where the cost is known. Never net_revenue - 0.
         case when ol.unit_cost_at_sale is not null
              then round(a.net_revenue - ol.qty * ol.unit_cost_at_sale, 2) end as gross_profit,
         case when ol.unit_cost_at_sale is not null and a.net_revenue <> 0
              then round(100.0 * (a.net_revenue - ol.qty * ol.unit_cost_at_sale)
                         / a.net_revenue, 2) end as gross_margin_pct,
         case
           when ol.recipe_id is null              then 'no_product'
           when ol.unit_cost_at_sale is not null  then 'costed'
           when o.finalised_at is null            then 'not_costed_yet'
           else                                        'sold_without_cost'
         end                                as cost_status
    from order_lines ol
    join orders o   on o.id = ol.order_id
    join fn_allocate_order_discount() a on a.order_line_id = ol.id
    left join customers c on c.id = o.customer_id
    left join recipes r   on r.id = ol.recipe_id
    left join recipe_variants rv on rv.id = ol.variant_id
    left join serving_formats f  on f.id = rv.format_id
   where o.voided_at is null
     and o.status <> 'cancelled';

comment on view v_sale_lines is
  'Order lines with revenue, discounts, frozen cost and margin. Drafts are '
  'included and marked is_confirmed = false; cancelled and voided orders are '
  'not shown here at all -- v_voided_sales keeps those inspectable.';

grant select on v_sale_lines to authenticated;

-- ---------------------------------------------------------------------------
-- 4. v_sales_summary -- one row per trading day
--
-- The day, its week and its month are all on the row, so a caller can group at
-- any of the three without three separate views drifting apart.
-- ---------------------------------------------------------------------------

create view v_sales_summary with (security_invoker = on) as
  select account_id,
         business_id,
         sale_date,
         date_trunc('week',  sale_date::timestamptz)::date as week_start,
         date_trunc('month', sale_date::timestamptz)::date as month_start,
         count(distinct case when source = 'order' then order_id end)
           + count(*) filter (where source = 'daily_total')     as sale_count,
         round(sum(gross_revenue), 2)                           as gross_revenue,
         round(sum(line_discount + allocated_order_discount), 2) as discount_given,
         round(sum(revenue), 2)                                 as revenue,
         round(sum(revenue) filter (where cogs is not null), 2)  as costed_revenue,
         round(sum(cogs), 2)                                    as cogs,
         round(sum(revenue) filter (where cogs is not null) - sum(cogs), 2) as gross_profit,
         round(100.0 * (sum(revenue) filter (where cogs is not null) - sum(cogs))
               / nullif(sum(revenue) filter (where cogs is not null), 0), 2) as gross_margin_pct,
         round(100.0 * coalesce(sum(revenue) filter (where cogs is not null), 0)
               / nullif(sum(revenue), 0), 2)                    as cost_coverage_pct,
         round(coalesce(sum(revenue) filter (where cogs is null), 0), 2) as revenue_without_cost
    from v_sales_unified
   group by account_id, business_id, sale_date;

comment on view v_sales_summary is
  'A trading day: what was sold, what was given away in discounts, what it '
  'cost, and how much of that cost is actually known.';

grant select on v_sales_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 5. v_product_performance -- what sells, and what is worth selling
--
-- At variant grain where a variant was sold, because a 2.5 litre pot and a
-- 1 litre pot are different products with different economics.
-- ---------------------------------------------------------------------------

create view v_product_performance with (security_invoker = on) as
  select s.account_id,
         s.business_id,
         s.recipe_id,
         r.name                                              as product_name,
         s.variant_id,
         f.name                                              as format_name,
         round(sum(s.qty), 3)                                as units_sold,
         round(sum(s.revenue), 2)                            as revenue,
         round(sum(s.revenue) filter (where s.cogs is not null), 2) as costed_revenue,
         round(sum(s.cogs), 2)                               as cogs,
         round(sum(s.revenue) filter (where s.cogs is not null) - sum(s.cogs), 2) as gross_profit,
         round(100.0 * (sum(s.revenue) filter (where s.cogs is not null) - sum(s.cogs))
               / nullif(sum(s.revenue) filter (where s.cogs is not null), 0), 2) as gross_margin_pct,
         round(100.0 * coalesce(sum(s.revenue) filter (where s.cogs is not null), 0)
               / nullif(sum(s.revenue), 0), 2)               as cost_coverage_pct,
         min(s.sale_date)                                    as first_sold,
         max(s.sale_date)                                    as last_sold,
         -- A verdict only where there is something to judge. An unknown margin
         -- is 'unknown', never 'healthy'.
         case
           when sum(s.revenue) filter (where s.cogs is not null) is null
             or sum(s.revenue) filter (where s.cogs is not null) = 0 then 'unknown'
           when sum(s.revenue) filter (where s.cogs is not null) - sum(s.cogs) < 0 then 'losing_money'
           when 100.0 * (sum(s.revenue) filter (where s.cogs is not null) - sum(s.cogs))
                / nullif(sum(s.revenue) filter (where s.cogs is not null), 0) < 20 then 'thin'
           else 'healthy'
         end                                                 as margin_verdict
    from v_sales_unified s
    join recipes r on r.id = s.recipe_id
    left join recipe_variants rv on rv.id = s.variant_id
    left join serving_formats f  on f.id = rv.format_id
   group by s.account_id, s.business_id, s.recipe_id, r.name, s.variant_id, f.name;

comment on view v_product_performance is
  'Sales and margin by product and, where one was sold, by serving format. '
  'margin_verdict is unknown -- not healthy -- when the cost is not known.';

grant select on v_product_performance to authenticated;

-- ---------------------------------------------------------------------------
-- 6. v_orders_attention -- orders that need the owner to do something
-- ---------------------------------------------------------------------------

create view v_orders_attention with (security_invoker = on) as
  select o.id                                as order_id,
         o.account_id,
         o.business_id,
         o.order_no,
         o.order_date,
         o.status,
         o.payment_status,
         o.customer_id,
         c.name                              as customer_name,
         l.line_count,
         l.gross_revenue,
         o.order_discount,
         l.net_revenue,
         l.lines_without_cost,
         o.amount_paid,
         round(coalesce(l.net_revenue, 0) - o.amount_paid, 2) as amount_outstanding,
         current_date - o.order_date         as days_old,
         case
           when o.finalised_at is null and l.line_count = 0 then 'empty_draft'
           when o.finalised_at is null                      then 'draft_not_confirmed'
           when l.lines_without_cost > 0                    then 'sold_without_cost'
           when o.payment_status <> 'paid'
            and current_date - o.order_date > 7             then 'unpaid_over_a_week'
           else                                                  'ok'
         end                                 as attention,
         case
           when o.finalised_at is null and l.line_count = 0
             then 'This order has nothing on it yet.'
           when o.finalised_at is null
             then 'Still a draft. Its costs are not locked in until you confirm it.'
           when l.lines_without_cost > 0
             then 'Sold, but we do not know what some of it cost you.'
           when o.payment_status <> 'paid' and current_date - o.order_date > 7
             then 'Confirmed over a week ago and still not paid in full.'
           else 'Nothing needed.'
         end                                 as what_to_do
    from orders o
    left join customers c on c.id = o.customer_id
    left join lateral (
      select count(*)                                            as line_count,
             round(sum(sl.gross_revenue), 2)                     as gross_revenue,
             round(sum(sl.net_revenue), 2)                       as net_revenue,
             count(*) filter (where sl.unit_cost_at_sale is null
                                and sl.recipe_id is not null)    as lines_without_cost
        from v_sale_lines sl
       where sl.order_id = o.id
    ) l on true
   where o.voided_at is null
     and o.status <> 'cancelled';

comment on view v_orders_attention is
  'One row per live order with what, if anything, it needs. what_to_do is '
  'written for the owner, not for a developer.';

grant select on v_orders_attention to authenticated;

-- ---------------------------------------------------------------------------
-- 7. v_sale_cost_breakdown -- why a frozen cost is what it is
--
-- Reads the snapshot frozen onto the line, never today's configuration. Where
-- a snapshot predates 0046 the component columns are NULL and reconciles is
-- NULL: detail that was never recorded is reported as missing, not as zero.
-- ---------------------------------------------------------------------------

create view v_sale_cost_breakdown with (security_invoker = on) as
  select ol.id                              as line_id,
         ol.account_id,
         ol.business_id,
         ol.order_id,
         ol.recipe_id,
         ol.variant_id,
         ol.qty,
         ol.unit_cost_at_sale,
         cs.id                              as cost_snapshot_id,
         cs.computed_at                     as cost_frozen_at,
         cs.costing_method,
         cs.basis_used,
         cs.resolved_qty,
         cs.cost_per_yield_unit,
         cs.portion_qty_at_snapshot,
         -- A variant sale carries its own packaging and overhead; a portion
         -- sale carries the recipe's.
         coalesce(cs.format_packaging_cost, cs.packaging_cost) as packaging_cost,
         coalesce(cs.variant_overhead_cost,  cs.overhead_cost)  as overhead_cost,
         case
           when cs.variant_id is not null
            and cs.cost_per_yield_unit is not null
            and cs.resolved_qty is not null
             then round(cs.cost_per_yield_unit * cs.resolved_qty, 4)
           when cs.variant_id is null
            and cs.cost_per_yield_unit is not null
            and cs.portion_qty_at_snapshot is not null
             then round(cs.cost_per_yield_unit * cs.portion_qty_at_snapshot, 4)
         end                                as ingredients_and_labour,
         cs.is_complete,
         cs.unpriced_items
    from order_lines ol
    join orders o on o.id = ol.order_id
    join cost_snapshots cs on cs.id = ol.cost_snapshot_id
   where o.voided_at is null;

comment on view v_sale_cost_breakdown is
  'The components behind a line''s frozen cost, read from the snapshot that '
  'was frozen onto it. NULL components mean detail that was never recorded, '
  'which is not the same as zero.';

grant select on v_sale_cost_breakdown to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------

do $$
declare v_pol int; v_missing text;
begin
  select string_agg(v, ', ') into v_missing
    from unnest(array['v_sales_unified','v_profit_by_period','v_profit_by_product',
                      'v_dashboard_waterfall','v_sale_lines','v_sales_summary',
                      'v_product_performance','v_orders_attention',
                      'v_sale_cost_breakdown']) v
   where not exists (select 1 from pg_views where schemaname = 'public' and viewname = v);
  if v_missing is not null then
    raise exception '0047 self-check FAILED: missing view(s): %', v_missing;
  end if;

  -- Every one of them must be security_invoker. This is the check a definition
  -- fingerprint cannot make.
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('v_sales_unified','v_profit_by_period','v_profit_by_product',
                       'v_dashboard_waterfall','v_sale_lines','v_sales_summary',
                       'v_product_performance','v_orders_attention','v_sale_cost_breakdown')
     and not coalesce('security_invoker=on' = any(c.reloptions), false);
  if v_missing is not null then
    raise exception '0047 self-check FAILED: not security_invoker: %', v_missing;
  end if;

  -- Grants are discarded by DROP VIEW. Assert they came back.
  select string_agg(v, ', ') into v_missing
    from unnest(array['v_sales_unified','v_profit_by_period','v_profit_by_product',
                      'v_dashboard_waterfall','v_sale_lines','v_sales_summary',
                      'v_product_performance','v_orders_attention',
                      'v_sale_cost_breakdown']) v
   where not exists (select 1 from information_schema.role_table_grants g
                      where g.table_schema = 'public' and g.table_name = v
                        and g.grantee = 'authenticated' and g.privilege_type = 'SELECT');
  if v_missing is not null then
    raise exception '0047 self-check FAILED: authenticated cannot read: %', v_missing;
  end if;

  -- A draft must never appear as revenue.
  if exists (select 1 from v_sales_unified s
              join orders o on o.id = s.order_id
             where o.finalised_at is null) then
    raise exception '0047 self-check FAILED: an unconfirmed order is being reported as revenue.';
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0047 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0047 OK: revenue recognised at confirmation, profit measured only where cost is known.';
end
$$;
