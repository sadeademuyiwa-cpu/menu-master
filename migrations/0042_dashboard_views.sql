-- ============================================================================
-- MENU MASTER NG
-- 0042: the dashboard's questions, answered in PostgreSQL
--
-- Requires: 0001-0041 applied.
--
-- WHY
--   The dashboard must answer five questions: what does this really cost me,
--   what should I charge, what am I making, which products make or lose money,
--   and is anything incomplete or out of date. Every one of those is a
--   financial judgement, so every one is answered here rather than assembled
--   in the browser.
--
--   v_onboarding_status already counts the early setup steps and is extended
--   rather than replaced. Two new views answer the questions it does not.
--
-- NO NEW TABLES. Nothing is stored; these are projections of what the costing
-- engine already knows.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_views where viewname = 'v_product_attention') then
    raise exception '0042 preflight FAILED: v_product_attention already exists.';
  end if;
  if not exists (select 1 from pg_views where viewname = 'v_recipe_basis') then
    raise exception '0042 preflight FAILED: 0039 must be applied first.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0042 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- WHICH PRODUCTS NEED ATTENTION, and why -- in states a shopkeeper recognises.
--
-- One row per sellable thing: a recipe sold by the portion, or a recipe/format
-- pair. The state is decided here so the page cannot invent a different one.
-- ----------------------------------------------------------------------------
create view v_product_attention with (security_invoker = on) as
select
  pc.account_id,
  pc.business_id,
  pc.recipe_id,
  pc.variant_id,
  pc.name                                        as product_name,
  pc.format_name,
  pc.is_complete,
  pc.cost_per_portion                            as true_cost,
  pc.selling_price,
  pc.profit,
  pc.margin_pct,
  pc.markup_pct,
  pc.recommended_price,
  pc.target_margin,
  case
    when not pc.is_complete                    then 'costing_incomplete'
    when pc.selling_price is null              then 'no_price_yet'
    when pc.profit < 0                         then 'losing_money'
    when pc.margin_pct < pc.target_margin      then 'below_target'
    else                                            'healthy'
  end                                            as state,
  -- Ordering for a "needs attention" list: money being lost first, then
  -- margins under target, then things not yet finished, then the healthy ones.
  case
    when pc.is_complete and pc.profit < 0                       then 1
    when pc.is_complete and pc.margin_pct < pc.target_margin    then 2
    when pc.is_complete and pc.selling_price is null            then 3
    when not pc.is_complete                                     then 4
    else                                                             5
  end                                            as attention_rank
from v_price_check pc;

comment on view v_product_attention is
  'One row per sellable product with the state a business owner acts on: '
  'losing money, below target, no price yet, costing incomplete, or healthy.';

grant select on v_product_attention to authenticated;

-- ----------------------------------------------------------------------------
-- WHICH INGREDIENTS NEED A PRICE, or a newer one.
--
-- "Out of date" is not an opinion: it is a purchase older than the business's
-- own costing window, which is the same window the engine averages over. An
-- ingredient priced only by estimate is reported separately from one with no
-- price at all, because they need different actions.
-- ----------------------------------------------------------------------------
create view v_ingredient_price_status with (security_invoker = on) as
select
  i.account_id,
  b.id                                           as business_id,
  i.id                                           as ingredient_id,
  i.name                                         as ingredient_name,
  i.kind                                         as item_kind,
  latest.effective_date                          as last_purchase_date,
  latest.source                                  as last_source,
  bs.wavg_window_days,
  case
    when latest.effective_date is null                     then 'never_priced'
    when latest.source <> 'purchase'                       then 'estimate_only'
    when latest.effective_date
         < current_date - (bs.wavg_window_days || ' days')::interval
                                                           then 'out_of_date'
    else                                                        'current'
  end                                            as price_state,
  (select count(*) from recipe_lines rl
    where rl.ingredient_id = i.id and rl.is_cost_bearing)::int as used_in_recipes
from ingredients i
join businesses b        on b.account_id = i.account_id and b.deleted_at is null
join business_settings bs on bs.business_id = b.id
left join lateral (
  select ip.effective_date, ip.source
    from ingredient_prices ip
   where ip.ingredient_id = i.id
     and ip.account_id    = i.account_id
     and ip.reversed_at is null
     and ip.effective_date <= current_date
   order by ip.effective_date desc, ip.created_at desc
   limit 1
) latest on true
where i.deleted_at is null
  and i.is_active;

comment on view v_ingredient_price_status is
  'Whether each ingredient has a current purchase price, only an estimate, a '
  'price older than the business costing window, or none at all.';

grant select on v_ingredient_price_status to authenticated;

-- ----------------------------------------------------------------------------
-- The setup journey, extended with the steps 0039-0041 made possible.
-- Existing columns keep their names, types and positions; new ones are added
-- at the end. security_invoker is RESTATED -- a replaced view silently loses
-- it, which opened a cross-tenant read in Phase 3.
-- ----------------------------------------------------------------------------
create or replace view v_onboarding_status with (security_invoker = on) as
select b.account_id,
  b.id as business_id,
  b.name,
  (select count(*) from ingredients i
    where i.account_id = b.account_id and i.deleted_at is null) as ingredients,
  (select count(*) from ingredient_prices ip
    where ip.account_id = b.account_id and ip.reversed_at is null) as prices_entered,
  (select count(*) from recipes r
    where r.business_id = b.id and r.deleted_at is null) as recipes,
  (select count(*) from cost_snapshots s
    where s.business_id = b.id and s.is_complete) as complete_costings,
  (select count(*) from v_missing_unit_conversions m
    where m.account_id = b.account_id and m.reason <> 'suggested'::text) as blocking_conversions,
  (select count(*) from recipe_prices rp
     join recipes r2 on r2.id = rp.recipe_id
    where r2.business_id = b.id) as selling_prices_set,
  -- added by 0042
  (select count(*) from recipes r
    where r.business_id = b.id and r.deleted_at is null
      and r.batch_yield_qty is not null) as recipes_with_yield,
  (select count(*) from serving_formats sf
    where sf.business_id = b.id and sf.is_active) as serving_formats,
  (select count(*) from serving_format_packaging spk
    where spk.business_id = b.id) as packaging_lines,
  (select count(*) from labour_rates lr
    where lr.business_id = b.id and lr.is_active) as labour_rates,
  (select count(*) from overhead_items oi
    where oi.business_id = b.id and oi.is_active) as overhead_items,
  (select count(*) from v_product_attention pa
    where pa.business_id = b.id and pa.state = 'healthy') as products_ready
from businesses b
where b.deleted_at is null;

grant select on v_onboarding_status to authenticated;

do $$
declare v_pol int; v_unsafe text;
begin
  select string_agg(c.relname, ', ') into v_unsafe
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('v_product_attention','v_ingredient_price_status','v_onboarding_status')
     and not coalesce('security_invoker=on' = any(c.reloptions), false);
  if v_unsafe is not null then
    raise exception '0042 self-check FAILED: % lost security_invoker.', v_unsafe;
  end if;

  if (select count(*) from information_schema.columns
       where table_name = 'v_onboarding_status') <> 15 then
    raise exception '0042 self-check FAILED: v_onboarding_status has % columns, expected 15.',
      (select count(*) from information_schema.columns where table_name = 'v_onboarding_status');
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0042 self-check FAILED: policy count moved to %.', v_pol;
  end if;

  raise notice '0042 OK: dashboard views created, onboarding extended to 15 columns, 116 policies unchanged.';
end
$$;
