-- ============================================================================
-- MENU MASTER NG
-- 0008: snapshot propagation and the pricing gate
--
-- A price change writes a NEW snapshot for every affected recipe, including
-- parents that use the ingredient through a sub recipe. Old snapshots are
-- never touched, so last month's margin stays exactly what it was.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which recipes depend on an ingredient, directly or through sub recipes
-- ----------------------------------------------------------------------------

create or replace function fn_recipes_using_ingredient(p_ingredient_id uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with recursive direct as (
    select distinct rl.recipe_id
    from recipe_lines rl
    where rl.ingredient_id = p_ingredient_id
  ),
  ascend as (
    select recipe_id from direct
    union
    select rl.recipe_id
    from recipe_lines rl
    join ascend a on rl.sub_recipe_id = a.recipe_id
  )
  select distinct a.recipe_id
  from ascend a
  join recipes r on r.id = a.recipe_id
  where r.deleted_at is null;
$$;

-- ----------------------------------------------------------------------------
-- 2. Recompute
-- ----------------------------------------------------------------------------

create or replace function fn_recompute_recipes_for_ingredient(
  p_ingredient_id uuid, p_as_of date default current_date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_n integer := 0;
begin
  for v_id in select * from fn_recipes_using_ingredient(p_ingredient_id) loop
    perform fn_compute_recipe_cost_snapshot(v_id, p_as_of, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function fn_trg_price_change_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform fn_recompute_recipes_for_ingredient(
    coalesce(new.ingredient_id, old.ingredient_id), current_date);
  return null;
end;
$$;

create trigger trg_ingredient_prices_recompute
  after insert or update on ingredient_prices
  for each row execute function fn_trg_price_change_recompute();

create trigger trg_conversion_recompute
  after insert or update or delete on ingredient_unit_conversions
  for each row execute function fn_trg_price_change_recompute();

-- Yield is a costing input. Changing it must produce new snapshots.
create or replace function fn_trg_ingredient_change_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.purchase_yield_pct is distinct from old.purchase_yield_pct
     or new.base_unit_id is distinct from old.base_unit_id then
    perform fn_recompute_recipes_for_ingredient(new.id, current_date);
  end if;
  return null;
end;
$$;

create trigger trg_ingredients_recompute
  after update on ingredients
  for each row execute function fn_trg_ingredient_change_recompute();

-- ----------------------------------------------------------------------------
-- 3. THE PRICING GATE
-- Rebuilt on the floor columns. profit, margin_pct and recommended_price are
-- NULL whenever the current snapshot is incomplete. There is no code path,
-- screen or export that can produce them otherwise.
-- ----------------------------------------------------------------------------

drop view if exists v_price_check;

create view v_price_check with (security_invoker = on) as
with latest as (
  select distinct on (recipe_id) *
  from cost_snapshots
  order by recipe_id, computed_at desc
)
select
  r.id                          as recipe_id,
  r.business_id,
  r.account_id,
  r.name,
  ch.id                         as channel_id,
  ch.name                       as channel_name,

  -- Completeness reporting, always visible
  coalesce(s.is_complete, false) as is_complete,
  s.required_inputs,
  s.priced_inputs,
  s.excluded_inputs,
  coalesce(s.unpriced_items, '[]'::jsonb) as unpriced_items,

  -- The floor is shown whether complete or not. It is labelled as a floor.
  s.floor_cost_per_portion      as cost_floor_per_portion,

  -- GATED. NULL unless complete.
  s.cost_per_portion,
  p.price                       as selling_price,

  case when s.is_complete and p.price is not null
       then round(p.price - s.cost_per_portion, 2) end                       as profit,

  case when s.is_complete and p.price is not null and p.price > 0
       then round(100.0 * (p.price - s.cost_per_portion) / p.price, 2) end   as margin_pct,

  case when s.is_complete and s.cost_per_portion is not null
        and coalesce(ch.target_margin, bs.default_target_margin) < 100
       then ceil(
              (s.cost_per_portion
                 / (1 - coalesce(ch.target_margin, bs.default_target_margin) / 100.0))
              / bs.price_rounding_to
            ) * bs.price_rounding_to
  end                                                                        as recommended_price,

  coalesce(ch.target_margin, bs.default_target_margin) as target_margin,
  bs.price_rounding_to,
  ch.commission_pct
from recipes r
join business_settings bs on bs.business_id = r.business_id
left join latest s on s.recipe_id = r.id
left join channels ch on ch.business_id = r.business_id and ch.is_active
left join lateral (
  select rp.price
  from recipe_prices rp
  where rp.recipe_id = r.id
    and (rp.channel_id is null or rp.channel_id = ch.id)
    and rp.effective_from <= current_date
  order by rp.effective_from desc, rp.created_at desc
  limit 1
) p on true
where r.kind = 'dish' and r.deleted_at is null;

comment on view v_price_check is
  'Database level pricing gate. profit, margin_pct and recommended_price are '
  'NULL unless the current cost snapshot is complete. The UI cannot override this.';

-- ----------------------------------------------------------------------------
-- 4. What is stopping each dish from costing
-- ----------------------------------------------------------------------------

create or replace view v_costing_blockers with (security_invoker = on) as
with latest as (
  select distinct on (recipe_id) * from cost_snapshots
  order by recipe_id, computed_at desc
)
select
  r.account_id, r.business_id, r.id as recipe_id, r.name,
  s.required_inputs, s.priced_inputs, s.excluded_inputs,
  item ->> 'problem'          as problem,
  item ->> 'ingredient_name'  as ingredient_name,
  item ->> 'unit'             as unit_code,
  item
from recipes r
join latest s on s.recipe_id = r.id
cross join lateral jsonb_array_elements(s.unpriced_items) as item
where not s.is_complete and r.deleted_at is null;
