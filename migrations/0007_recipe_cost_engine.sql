-- ============================================================================
-- MENU MASTER NG
-- 0007: recipe cost engine
--
-- RECIPE -> LINES -> INGREDIENTS/SUB RECIPES -> CONVERSION -> PURCHASE YIELD
--   -> OWN ACCOUNT PRICE -> INGREDIENT COST -> PACKAGING -> LABOUR
--   -> OVERHEAD -> COOKING YIELD -> BATCH COST -> PER YIELD UNIT
--   -> PER PORTION -> COMPLETENESS GATE -> IMMUTABLE SNAPSHOT
--
-- Nothing here coalesces NULL to zero. A missing price, conversion, labour
-- rate, portion size or overhead configuration makes the snapshot incomplete
-- and is reported by name in unpriced_items.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Floor columns
-- The floor is always computed and stored. The gated figure is NULL unless
-- the snapshot is complete, so no caller can route around the gate.
-- ----------------------------------------------------------------------------

alter table cost_snapshots
  add column floor_batch_cost         numeric(18,4),
  add column floor_cost_per_yield_unit numeric(18,6),
  add column floor_cost_per_portion   numeric(18,4);

comment on column cost_snapshots.cost_per_portion is
  'NULL unless is_complete. Use floor_cost_per_portion for the incomplete floor.';

-- ----------------------------------------------------------------------------
-- 2. Cycle prevention
-- A recipe may not contain itself, directly or through any chain.
-- ----------------------------------------------------------------------------

create or replace function fn_prevent_recipe_cycle()
returns trigger language plpgsql as $$
declare v_cycle boolean;
begin
  if new.sub_recipe_id is null then
    return new;
  end if;

  if new.sub_recipe_id = new.recipe_id then
    raise exception 'A recipe cannot contain itself' using errcode='check_violation';
  end if;

  -- Would new.recipe_id already be reachable from new.sub_recipe_id?
  with recursive descend as (
    select rl.sub_recipe_id as rid, 1 as depth
    from recipe_lines rl
    where rl.recipe_id = new.sub_recipe_id and rl.sub_recipe_id is not null
    union all
    select rl.sub_recipe_id, d.depth + 1
    from recipe_lines rl
    join descend d on rl.recipe_id = d.rid
    where rl.sub_recipe_id is not null and d.depth < 20
  )
  select exists (select 1 from descend where rid = new.recipe_id) into v_cycle;

  if v_cycle then
    raise exception 'Circular sub recipe: % already contains %',
      new.sub_recipe_id, new.recipe_id using errcode='check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_recipe_lines_no_cycle
  before insert or update on recipe_lines
  for each row execute function fn_prevent_recipe_cycle();

-- ----------------------------------------------------------------------------
-- 3. Unit to unit conversion, for sub recipe quantities
-- Sub recipes have no ingredient, so only universal ratios apply.
-- ----------------------------------------------------------------------------

create or replace function fn_convert_between_units(
  p_qty numeric, p_from_unit uuid, p_to_unit uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  fk unit_kind; ff numeric; tk unit_kind; tf numeric;
begin
  if p_qty is null or p_from_unit is null or p_to_unit is null then return null; end if;
  if p_from_unit = p_to_unit then return p_qty; end if;
  select kind, factor_to_base into fk, ff from units where id = p_from_unit;
  select kind, factor_to_base into tk, tf from units where id = p_to_unit;
  if fk is null or tk is null or fk <> tk then return null; end if;
  if ff is null or tf is null or tf = 0 then return null; end if;
  return p_qty * ff / tf;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Usable ingredient cost, purchase yield applied
--
--   1 kg costs N5,000, yield 70 percent  ->  700 g usable
--   cost per usable gram = 5000 / 700, not 5000 / 1000
-- ----------------------------------------------------------------------------

create or replace function fn_ingredient_usable_unit_cost(
  p_ingredient_id uuid, p_business_id uuid, p_as_of date default current_date)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare v_cost numeric; v_yield numeric;
begin
  v_cost := fn_ingredient_unit_cost(p_ingredient_id, p_business_id, p_as_of);
  if v_cost is null then return null; end if;
  select purchase_yield_pct into v_yield from ingredients where id = p_ingredient_id;
  if v_yield is null or v_yield <= 0 then return null; end if;
  return v_cost / (v_yield / 100.0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. The recursive core
-- Returns costs for ONE BATCH of the recipe plus completeness accounting.
-- Writes nothing. The public function writes the snapshot.
-- ----------------------------------------------------------------------------

create type recipe_cost_result as (
  ingredient_cost      numeric,
  packaging_cost       numeric,
  labour_cost          numeric,
  batch_cost           numeric,
  cost_per_yield_unit  numeric,
  required_inputs      integer,
  priced_inputs        integer,
  excluded_inputs      integer,
  unpriced_items       jsonb,
  is_complete          boolean
);

create or replace function fn__recipe_cost_core(
  p_recipe_id uuid,
  p_as_of     date,
  p_depth     integer default 0
)
returns recipe_cost_result
language plpgsql stable security definer set search_path = public
as $$
declare
  res         recipe_cost_result;
  r           recipes%rowtype;
  line        record;
  lab         record;
  v_base      numeric;
  v_unitcost  numeric;
  v_linecost  numeric;
  sub         recipe_cost_result;
  v_subqty    numeric;
  v_kind      item_kind;
  v_name      text;
  v_unitcode  text;
  v_eff_yield numeric;
begin
  res.ingredient_cost := 0;
  res.packaging_cost  := 0;
  res.labour_cost     := 0;
  res.required_inputs := 0;
  res.priced_inputs   := 0;
  res.excluded_inputs := 0;
  res.unpriced_items  := '[]'::jsonb;
  res.is_complete     := true;

  if p_depth > 10 then
    res.is_complete := false;
    res.unpriced_items := res.unpriced_items || jsonb_build_object(
      'recipe_id', p_recipe_id, 'problem', 'sub_recipe_nesting_too_deep');
    return res;
  end if;

  select * into r from recipes where id = p_recipe_id and deleted_at is null;
  if not found then
    res.is_complete := false;
    res.unpriced_items := res.unpriced_items || jsonb_build_object(
      'recipe_id', p_recipe_id, 'problem', 'recipe_not_found');
    return res;
  end if;

  -- ---------------- recipe lines ----------------
  for line in
    select rl.*, i.name as ing_name, i.kind as ing_kind, u.code as unit_code
    from recipe_lines rl
    left join ingredients i on i.id = rl.ingredient_id
    left join units u on u.id = rl.unit_id
    where rl.recipe_id = p_recipe_id
  loop
    -- Deliberate exclusion. Counted separately, never treated as missing.
    if not line.is_cost_bearing then
      res.excluded_inputs := res.excluded_inputs + 1;
      continue;
    end if;

    res.required_inputs := res.required_inputs + 1;

    if line.ingredient_id is not null then
      v_name     := line.ing_name;
      v_kind     := line.ing_kind;
      v_unitcode := line.unit_code;

      v_base := fn_resolve_qty_to_base(line.ingredient_id, line.qty, line.unit_id);
      if v_base is null then
        res.is_complete := false;
        res.unpriced_items := res.unpriced_items || jsonb_build_object(
          'recipe_id',       p_recipe_id,
          'recipe_line_id',  line.id,
          'ingredient_id',   line.ingredient_id,
          'ingredient_name', v_name,
          'unit',            v_unitcode,
          'problem',         'missing_conversion');
        continue;
      end if;

      v_unitcost := fn_ingredient_usable_unit_cost(line.ingredient_id, r.business_id, p_as_of);
      if v_unitcost is null then
        res.is_complete := false;
        res.unpriced_items := res.unpriced_items || jsonb_build_object(
          'recipe_id',       p_recipe_id,
          'recipe_line_id',  line.id,
          'ingredient_id',   line.ingredient_id,
          'ingredient_name', v_name,
          'problem',         'missing_price');
        continue;
      end if;

      v_linecost := v_base * v_unitcost;
      if v_kind = 'packaging' then
        res.packaging_cost := res.packaging_cost + v_linecost;
      else
        res.ingredient_cost := res.ingredient_cost + v_linecost;
      end if;
      res.priced_inputs := res.priced_inputs + 1;

    else
      -- ---------------- sub recipe ----------------
      sub := fn__recipe_cost_core(line.sub_recipe_id, p_as_of, p_depth + 1);

      -- Completeness propagates upward, always
      if not sub.is_complete then
        res.is_complete := false;
        res.unpriced_items := res.unpriced_items || sub.unpriced_items;
        continue;
      end if;

      select fn_convert_between_units(line.qty, line.unit_id, rr.yield_unit_id)
        into v_subqty
      from recipes rr where rr.id = line.sub_recipe_id;

      if v_subqty is null or sub.cost_per_yield_unit is null then
        res.is_complete := false;
        res.unpriced_items := res.unpriced_items || jsonb_build_object(
          'recipe_id',      p_recipe_id,
          'recipe_line_id', line.id,
          'sub_recipe_id',  line.sub_recipe_id,
          'problem',        'missing_conversion');
        continue;
      end if;

      res.ingredient_cost := res.ingredient_cost + (v_subqty * sub.cost_per_yield_unit);
      res.priced_inputs   := res.priced_inputs + 1;
    end if;
  end loop;

  -- ---------------- labour ----------------
  for lab in
    select rl2.hours, lr.rate_per_hour, lr.name, lr.id as rate_id
    from recipe_labour rl2
    join labour_rates lr on lr.id = rl2.labour_rate_id
    where rl2.recipe_id = p_recipe_id
  loop
    res.required_inputs := res.required_inputs + 1;
    if lab.rate_per_hour is null then
      res.is_complete := false;
      res.unpriced_items := res.unpriced_items || jsonb_build_object(
        'recipe_id',      p_recipe_id,
        'labour_rate_id', lab.rate_id,
        'labour_name',    lab.name,
        'problem',        'missing_labour_rate');
    else
      res.labour_cost := res.labour_cost + (lab.hours * lab.rate_per_hour);
      res.priced_inputs := res.priced_inputs + 1;
    end if;
  end loop;

  -- ---------------- batch and yield ----------------
  res.batch_cost := res.ingredient_cost + res.packaging_cost + res.labour_cost;

  v_eff_yield := r.batch_yield_qty * (r.cooking_yield_pct / 100.0);
  if v_eff_yield is null or v_eff_yield <= 0 then
    res.is_complete := false;
    res.unpriced_items := res.unpriced_items || jsonb_build_object(
      'recipe_id', p_recipe_id, 'problem', 'invalid_yield');
    res.cost_per_yield_unit := null;
  else
    res.cost_per_yield_unit := res.batch_cost / v_eff_yield;
  end if;

  return res;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Public entry point: compute and write an immutable snapshot
-- ----------------------------------------------------------------------------

create or replace function fn_compute_recipe_cost_snapshot(
  p_recipe_id  uuid,
  p_as_of      date default current_date,
  p_created_by uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r            recipes%rowtype;
  bs           business_settings%rowtype;
  core         recipe_cost_result;
  v_overhead   numeric := 0;
  v_oh_total   numeric;
  v_required   integer;
  v_priced     integer;
  v_unpriced   jsonb;
  v_complete   boolean;
  v_floor_pp   numeric;
  v_snapshot   uuid;
begin
  select * into r from recipes where id = p_recipe_id and deleted_at is null;
  if not found then
    raise exception 'Recipe % not found', p_recipe_id;
  end if;

  select * into bs from business_settings where business_id = r.business_id;
  if not found then
    raise exception 'Business settings missing for business %', r.business_id;
  end if;

  core := fn__recipe_cost_core(p_recipe_id, p_as_of, 0);

  v_required := core.required_inputs;
  v_priced   := core.priced_inputs;
  v_unpriced := core.unpriced_items;
  v_complete := core.is_complete;

  -- ---------------- overhead ----------------
  if bs.overhead_enabled then
    v_required := v_required + 1;
    select sum(monthly_cost) into v_oh_total
    from overhead_items
    where business_id = r.business_id and is_active and monthly_cost is not null;

    if bs.expected_monthly_units is null or bs.expected_monthly_units <= 0
       or v_oh_total is null
       or exists (select 1 from overhead_items
                   where business_id = r.business_id and is_active and monthly_cost is null)
    then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id,
        'business_id', r.business_id,
        'problem', 'missing_overhead_config');
      v_overhead := null;
    else
      v_overhead := v_oh_total / bs.expected_monthly_units;
      v_priced   := v_priced + 1;
    end if;
  end if;

  -- ---------------- portion ----------------
  if r.kind = 'dish' then
    v_required := v_required + 1;
    if r.portion_qty is null then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'problem', 'missing_portion_size');
    else
      v_priced := v_priced + 1;
    end if;
  end if;

  -- ---------------- floor cost per portion ----------------
  -- A floor of zero is not a floor, it is noise. When NOTHING is priced we
  -- know nothing, and "your cost is at least N0.00" would be false comfort.
  -- In that case the floor is NULL and the UI shows the missing item list.
  if core.priced_inputs = 0 then
    v_floor_pp := null;
  elsif core.cost_per_yield_unit is not null and r.portion_qty is not null then
    v_floor_pp := core.cost_per_yield_unit * r.portion_qty + coalesce(v_overhead, 0);
  else
    v_floor_pp := null;
  end if;

  -- Final safety net: any recorded problem forces incompleteness
  if jsonb_array_length(v_unpriced) > 0 then
    v_complete := false;
  end if;

  insert into cost_snapshots (
    account_id, business_id, recipe_id, computed_at,
    costing_method, wavg_window_days,
    is_complete, required_inputs, priced_inputs, excluded_inputs, unpriced_items,
    ingredient_cost, packaging_cost, labour_cost, overhead_cost,
    batch_cost, cost_per_yield_unit, cost_per_portion,
    floor_batch_cost, floor_cost_per_yield_unit, floor_cost_per_portion,
    created_by)
  values (
    r.account_id, r.business_id, p_recipe_id, now(),
    bs.costing_method, bs.wavg_window_days,
    v_complete, v_required, v_priced, core.excluded_inputs, v_unpriced,
    core.ingredient_cost, core.packaging_cost, core.labour_cost, v_overhead,
    -- Gated columns: NULL unless complete
    case when v_complete then core.batch_cost end,
    case when v_complete then core.cost_per_yield_unit end,
    case when v_complete then v_floor_pp end,
    -- Floor columns: what IS known, or NULL when nothing is known
    case when core.priced_inputs > 0 then core.batch_cost end,
    case when core.priced_inputs > 0 then core.cost_per_yield_unit end,
    v_floor_pp,
    p_created_by)
  returning id into v_snapshot;

  return v_snapshot;
end;
$$;

comment on function fn_compute_recipe_cost_snapshot(uuid, date, uuid) is
  'Computes and writes a new immutable cost snapshot. Never modifies an '
  'existing one. Gated cost columns are NULL unless every required cost '
  'bearing input is priced and resolvable.';
