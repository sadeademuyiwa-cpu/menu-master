-- ============================================================================
-- 0034 PRE-DEPLOYMENT AUDIT — READ ONLY
--
-- Owner rule 7: "Existing manual records must be audited before changing
-- costing behaviour. Do not destroy historical evidence."
--
-- 0034 changes which rows the engine uses. Any ingredient whose cost is
-- currently derived from a BLEND of purchase and manual rows will change
-- value when 0034 is applied. This names them before anything is deployed.
-- It writes nothing.
-- ============================================================================

-- 1. How much of the price book is purchases vs estimates.
select source,
       count(*)                          as rows,
       count(distinct ingredient_id)     as ingredients,
       count(*) filter (where reversed_at is not null) as reversed
  from ingredient_prices
 group by source
 order by source;

-- 2. THE ONES THAT WILL CHANGE. Ingredients holding both real purchases and
--    manual estimates inside the costing window: today they are blended,
--    after 0034 the estimates are ignored. old_cost vs new_cost is the exact
--    movement each will see.
select i.name                                     as ingredient,
       bs.wavg_window_days                         as window_days,
       count(*) filter (where ip.source = 'purchase')                       as purchase_rows,
       count(*) filter (where ip.source in ('manual','benchmark_accepted')) as estimate_rows,
       round(sum(ip.amount) / nullif(sum(ip.qty_base), 0), 4)               as old_cost_blended,
       round(sum(ip.amount) filter (where ip.source = 'purchase')
             / nullif(sum(ip.qty_base) filter (where ip.source = 'purchase'), 0), 4)
                                                                            as new_cost_purchases_only
  from ingredient_prices ip
  join ingredients i        on i.id = ip.ingredient_id
  join businesses b         on b.account_id = ip.account_id
  join business_settings bs on bs.business_id = b.id
 where ip.reversed_at is null
   and ip.effective_date <= current_date
   and ip.effective_date >  current_date - (bs.wavg_window_days || ' days')::interval
 group by i.id, i.name, bs.wavg_window_days
having count(*) filter (where ip.source = 'purchase') > 0
   and count(*) filter (where ip.source in ('manual','benchmark_accepted')) > 0
 order by abs(coalesce(round(sum(ip.amount) / nullif(sum(ip.qty_base), 0), 4), 0)
            - coalesce(round(sum(ip.amount) filter (where ip.source = 'purchase')
              / nullif(sum(ip.qty_base) filter (where ip.source = 'purchase'), 0), 4), 0)) desc;

-- 3. Ingredients priced ONLY by estimate. These keep working (0034 falls back
--    to the estimate) but will now be labelled as estimates on screen.
select i.name as ingredient, count(*) as estimate_rows, max(ip.effective_date) as latest
  from ingredient_prices ip
  join ingredients i on i.id = ip.ingredient_id
 where ip.reversed_at is null
   and ip.source in ('manual','benchmark_accepted')
   and not exists (select 1 from ingredient_prices p2
                    where p2.ingredient_id = ip.ingredient_id
                      and p2.source = 'purchase' and p2.reversed_at is null)
 group by i.id, i.name
 order by i.name;

-- 4. Stored snapshots are historical record and 0034 does not rewrite them.
--    This is how many carry a cost computed under the old blending rule.
select count(*) as snapshots_computed_under_old_rule,
       min(computed_at) as earliest, max(computed_at) as latest
  from cost_snapshots;
