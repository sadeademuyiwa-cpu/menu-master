-- ============================================================================
-- MENU MASTER NG
-- 0005: unit conversion engine
--
-- One resolver, used by purchasing and by costing. It returns NULL when the
-- conversion cannot be established from data this account entered. It never
-- guesses, and it never falls back to a "typical" weight.
--
-- A paint of rice and a paint of beans are different masses. The resolver
-- looks up the conversion by (ingredient, unit), never by unit alone.
-- ============================================================================

create or replace function fn_resolve_qty_to_base(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_unit_id       uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_acct        uuid;
  v_base_unit   uuid;
  v_base_kind   unit_kind;
  v_base_factor numeric;
  v_kind        unit_kind;
  v_factor      numeric;
  v_unit_acct   uuid;
  v_specific    numeric;
begin
  if p_ingredient_id is null or p_unit_id is null or p_qty is null then
    return null;
  end if;

  select i.account_id, i.base_unit_id into v_acct, v_base_unit
  from ingredients i where i.id = p_ingredient_id and i.deleted_at is null;

  if v_base_unit is null then
    return null;                      -- unknown ingredient, resolve nothing
  end if;

  -- Same unit as the base: nothing to convert
  if p_unit_id = v_base_unit then
    return p_qty;
  end if;

  select u.kind, u.factor_to_base, u.account_id
    into v_kind, v_factor, v_unit_acct
  from units u where u.id = p_unit_id;

  if v_kind is null then
    return null;                      -- unknown unit
  end if;

  -- Account scoping: a unit is usable only if global, or owned by the
  -- same account as the ingredient.
  if v_unit_acct is not null and v_unit_acct <> v_acct then
    return null;
  end if;

  select u.kind, u.factor_to_base into v_base_kind, v_base_factor
  from units u where u.id = v_base_unit;

  -- CASE 1: universal ratio within the same measurement kind.
  -- 1 kg = 1000 g, 1 litre = 1000 ml, 1 dozen = 12 units.
  if v_factor is not null and v_kind = v_base_kind and coalesce(v_base_factor,0) > 0 then
    return p_qty * v_factor / v_base_factor;
  end if;

  -- CASE 2: container units, and any unit crossing measurement kinds.
  -- These MUST come from this account's own ingredient specific conversion.
  select c.qty_in_base into v_specific
  from ingredient_unit_conversions c
  where c.ingredient_id = p_ingredient_id
    and c.unit_id       = p_unit_id
    and c.account_id    = v_acct;

  if v_specific is null then
    return null;                      -- CASE 3: not knowable. Say so.
  end if;

  return p_qty * v_specific;
end;
$$;

comment on function fn_resolve_qty_to_base(uuid, numeric, uuid) is
  'Resolves a quantity to an ingredient base unit. Returns NULL when the '
  'conversion is not established by this account. Never estimates.';

-- ----------------------------------------------------------------------------
-- Diagnostic: does a given (ingredient, unit) pair resolve at all?
-- ----------------------------------------------------------------------------

create or replace function fn_can_resolve_unit(p_ingredient_id uuid, p_unit_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select fn_resolve_qty_to_base(p_ingredient_id, 1, p_unit_id) is not null;
$$;

-- ----------------------------------------------------------------------------
-- v_missing_unit_conversions, rebuilt.
--
-- The 0003 version only matched ingredients whose names happened to equal a
-- catalogue entry, so a custom ingredient could never surface a missing
-- conversion. This version reports three sources, ranked by urgency:
--
--   blocking_recipe    a recipe line already uses this unit and cannot cost
--   blocking_purchase  a draft purchase line uses it and cannot post
--   suggested          the catalogue says this item is commonly bought this way
-- ----------------------------------------------------------------------------

drop view if exists v_missing_unit_conversions;

create view v_missing_unit_conversions with (security_invoker = on) as
with needed as (
  select rl.account_id, rl.ingredient_id, rl.unit_id, 'blocking_recipe'::text as reason
  from recipe_lines rl
  where rl.ingredient_id is not null and rl.is_cost_bearing
  union
  select pl.account_id, pl.ingredient_id, pl.unit_id, 'blocking_purchase'
  from purchase_lines pl
  join purchases p on p.id = pl.purchase_id
  where p.status = 'draft'
  union
  select i.account_id, i.id, u.id, 'suggested'
  from ingredients i
  join catalog_ingredients ci on lower(ci.name) = lower(i.name)
  join units u on u.account_id is null
              and u.code = any(ci.common_units)
              and u.factor_to_base is null
  where i.deleted_at is null
)
select distinct on (n.ingredient_id, n.unit_id)
  n.account_id,
  n.ingredient_id,
  i.name  as ingredient_name,
  n.unit_id,
  u.code  as unit_code,
  u.name  as unit_name,
  n.reason
from needed n
join ingredients i on i.id = n.ingredient_id and i.deleted_at is null
join units u on u.id = n.unit_id
where fn_resolve_qty_to_base(n.ingredient_id, 1, n.unit_id) is null
order by n.ingredient_id, n.unit_id,
         case n.reason when 'blocking_recipe' then 1
                       when 'blocking_purchase' then 2
                       else 3 end;
