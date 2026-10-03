-- ============================================================================
-- MENU MASTER NG
-- 0041: overhead allocation per dimension, without double counting
--
-- Requires: 0001-0040 applied.
--
-- THE LIMITATION THIS REMOVES
--   0023 gave the business ONE overhead basis: a single quantity and unit for
--   the whole business. That was a real advance -- overhead per unit of
--   declared output rather than per ambiguous "serving" -- but a business
--   producing in more than one dimension could configure only one of them.
--   A litre basis blocked every gram-yield recipe, so a kitchen selling soup
--   AND bread could not cost both. Proven in tests/029 check 35.
--
-- THE ARCHITECTURE CHOSEN, AND WHY
--   Each OVERHEAD ITEM may declare its own basis; items that do not declare
--   one inherit the business default. Two nullable columns on a table that
--   already exists. No new table, no data migration, and every existing
--   configuration keeps its exact present behaviour because every item
--   inherits the single business basis it already had.
--
--   Items sharing a basis unit already behave as a pool, so a pool needs no
--   table of its own.
--
-- WHY NOT THE ALTERNATIVES
--   A separate overhead_pools table: a pool is (name, amounts, basis), and
--     overhead_items is already a per-business list of named amounts. A pool
--     table adds a second place to enforce RLS and forces existing items into
--     a synthetic default pool for no behavioural gain. Premature.
--   Recipe- or category-level allocation profiles: needs a mapping table plus
--     a join, and the mapping restates the dimension the recipe's yield unit
--     already carries. Storing a derivable fact twice invites drift -- the
--     defect 0040 had just corrected.
--   Nothing existing: the schema has no pool, profile or allocation structure.
--
-- DOUBLE COUNTING IS PREVENTED BY CONSTRUCTION
--   Every naira lives in exactly one overhead item, and every item allocates
--   through exactly one basis. There is no path by which one item allocates
--   through two bases, so no configuration can allocate the same money twice.
--   A business wanting N600,000 spread over both litres and kilograms must
--   SPLIT it into items that sum to N600,000; it cannot apply N600,000 to
--   each. The reconciliation invariant -- sum of item costs equals configured
--   overhead -- therefore holds by the shape of the data, not by a check.
--
-- WHAT BLOCKS, AND WHAT IS SCOPE
--   no effective basis at all            -> missing_overhead_basis   BLOCK
--   an item with no monthly cost         -> missing_overhead_config  BLOCK
--   an item INHERITING the business basis
--     into an incompatible dimension     -> overhead_basis_incompatible BLOCK
--   an item with its OWN basis in another
--     dimension                          -> not allocated to this recipe
--
--   The last case is not a silent omission: the business declared that this
--   item is allocated per litre, so a gram-yield recipe is outside its scope
--   by explicit configuration, and fn_overhead_breakdown states it item by
--   item. Where the business has NOT decided -- an item inheriting a default
--   that does not fit -- the engine still refuses rather than guessing.
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'overhead_items' and column_name = 'basis_qty') then
    raise exception '0041 preflight FAILED: overhead_items.basis_qty already exists.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_overhead_rate') then
    raise exception '0041 preflight FAILED: fn_overhead_rate is missing.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0041 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

alter table overhead_items
  add column basis_qty     numeric(14,3),
  add column basis_unit_id uuid references units(id);

alter table overhead_items
  add constraint chk_overhead_item_basis_pair
  check ((basis_qty is null) = (basis_unit_id is null));

alter table overhead_items
  add constraint chk_overhead_item_basis_positive
  check (basis_qty is null or basis_qty > 0);

comment on column overhead_items.basis_qty is
  'How much output this item is spread across. NULL inherits the business '
  'default from business_settings. Never a rate, always a quantity.';
comment on column overhead_items.basis_unit_id is
  'The unit of basis_qty. Paired with basis_qty by constraint.';

-- ----------------------------------------------------------------------------
-- PROVENANCE. One row per active overhead item, saying exactly what it
-- contributes to a recipe measured in p_target_unit_id and why.
-- ----------------------------------------------------------------------------
create or replace function fn_overhead_breakdown(
  p_business_id uuid,
  p_target_unit_id uuid)
returns table (
  item_id       uuid,
  item_name     text,
  monthly_cost  numeric,
  basis_qty     numeric,
  basis_unit    text,
  basis_source  text,     -- 'item' | 'business'
  basis_in_target numeric,
  rate          numeric,
  applies       boolean,
  reason        text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_account_id uuid; v_def_qty numeric; v_def_unit uuid;
begin
  select account_id, overhead_basis_qty, overhead_basis_unit_id
    into v_account_id, v_def_qty, v_def_unit
  from business_settings where business_id = p_business_id;
  if v_account_id is null then return; end if;

  perform fn_require_cost_access(v_account_id);   -- AUTHORIZATION

  return query
  select oi.id,
         oi.name,
         oi.monthly_cost,
         coalesce(oi.basis_qty, v_def_qty),
         u.code,
         case when oi.basis_qty is not null then 'item' else 'business' end,
         b.converted,
         case when oi.monthly_cost is not null and b.converted > 0
              then oi.monthly_cost / b.converted end,
         (oi.monthly_cost is not null and b.converted > 0),
         case
           when oi.monthly_cost is null                      then 'no monthly cost recorded'
           when coalesce(oi.basis_qty, v_def_qty) is null    then 'no basis declared'
           when b.converted is null and oi.basis_qty is not null
                then 'allocated in another measurement, so not applied here'
           when b.converted is null                          then 'business basis cannot be expressed in this unit'
           else null
         end
    from overhead_items oi
    left join units u
      on u.id = coalesce(oi.basis_unit_id, v_def_unit)
    cross join lateral (
      select fn_convert_between_units(
               coalesce(oi.basis_qty, v_def_qty),
               coalesce(oi.basis_unit_id, v_def_unit),
               p_target_unit_id) as converted
    ) b
   where oi.business_id = p_business_id
     and oi.is_active
   order by oi.name;
end;
$$;

comment on function fn_overhead_breakdown(uuid, uuid) is
  'Item-by-item provenance: which overhead contributed, on what basis, at what '
  'rate, and where it did not apply and why.';

-- ----------------------------------------------------------------------------
-- WHY OVERHEAD CANNOT BE COSTED, or NULL if it can.
-- ----------------------------------------------------------------------------
create or replace function fn_overhead_problem(
  p_business_id uuid,
  p_target_unit_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_account_id uuid; v_enabled boolean; r record; v_any boolean := false;
begin
  select account_id, overhead_enabled into v_account_id, v_enabled
  from business_settings where business_id = p_business_id;
  if v_account_id is null then return null; end if;
  if not coalesce(v_enabled, false) then return null; end if;

  perform fn_require_cost_access(v_account_id);

  for r in select * from fn_overhead_breakdown(p_business_id, p_target_unit_id) loop
    v_any := true;
    if r.monthly_cost is null then return 'missing_overhead_config'; end if;
    if r.basis_qty is null    then return 'missing_overhead_basis';  end if;
    -- An item INHERITING the business basis into a dimension it cannot express
    -- means the business has not decided. Refuse rather than guess.
    if r.basis_in_target is null and r.basis_source = 'business' then
      return 'overhead_basis_incompatible';
    end if;
  end loop;

  -- Enabled with no active items at all is a declaration of zero overhead,
  -- not an unknown: there is nothing to allocate.
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- THE RATE: the sum of each item's own rate. An item scoped to another
-- dimension contributes nothing here, which is the business's configuration.
-- ----------------------------------------------------------------------------
create or replace function fn_overhead_rate(
  p_business_id uuid,
  p_target_unit_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_rate numeric;
begin
  if p_business_id is null or p_target_unit_id is null then return null; end if;
  if fn_overhead_problem(p_business_id, p_target_unit_id) is not null then
    return null;                      -- blocked: never a zero
  end if;

  select coalesce(sum(rate) filter (where applies), 0)
    into v_rate
  from fn_overhead_breakdown(p_business_id, p_target_unit_id);

  return v_rate;
end;
$$;

CREATE OR REPLACE FUNCTION public.fn_compute_recipe_cost_snapshot(p_recipe_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_created_by uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r recipes%rowtype; bs business_settings%rowtype; core recipe_cost_result;
  v_overhead numeric := 0; v_oh_total numeric; v_oh_rate numeric;
  v_sold_by_format boolean;
  v_required integer; v_priced integer; v_unpriced jsonb; v_complete boolean;
  v_floor_pp numeric; v_snapshot uuid;
begin
  select * into r from recipes where id = p_recipe_id and deleted_at is null;
  if not found then raise exception 'Recipe % not found', p_recipe_id; end if;

  perform fn_require_cost_access(r.account_id);   -- AUTHORIZATION

  select * into bs from business_settings where business_id = r.business_id;
  if not found then
    raise exception 'Business settings missing for business %', r.business_id;
  end if;

  core := fn__recipe_cost_core(p_recipe_id, p_as_of, 0);

  v_required := core.required_inputs;
  v_priced   := core.priced_inputs;
  v_unpriced := core.unpriced_items;
  v_complete := core.is_complete;

  -- MODEL 1 vs MODEL 2 (owner decision, Phase 4 escalation).
  -- A recipe sold through its own business-defined formats does not need a
  -- portion size: the FORMAT is the commercial unit, and fn_variant_cost
  -- allocates the batch economics to each format. A recipe with no active
  -- sellable format is portion-based and still requires one. This is not
  -- "portion is optional" -- exactly one basis applies, and which one is
  -- determined here rather than guessed.
  select exists (
    select 1
      from recipe_variants rv
      join serving_formats sf on sf.id = rv.format_id
     where rv.recipe_id = p_recipe_id
       and rv.is_active
       and sf.is_active
  ) into v_sold_by_format;

  if bs.overhead_enabled then
    v_required := v_required + 1;

    -- 0041: the reason now comes from fn_overhead_problem, which reads each
    -- overhead item's OWN basis and falls back to the business default. The
    -- decision is made once, in one place, rather than re-derived here.
    declare v_oh_problem text;
    begin
      v_oh_problem := fn_overhead_problem(r.business_id, r.yield_unit_id);
      if v_oh_problem is not null then
        v_complete := false;
        v_unpriced := v_unpriced || jsonb_build_object(
          'recipe_id', p_recipe_id, 'business_id', r.business_id,
          'problem', v_oh_problem);
        v_overhead := null;
      else
        v_oh_rate := fn_overhead_rate(r.business_id, r.yield_unit_id);
        if r.portion_qty is null then
          -- No portion size. For a FORMAT-BASED recipe that is correct:
          -- overhead is allocated per format by fn_variant_cost as
          -- overhead_rate x resolved_qty, so there is no per-portion figure
          -- to compute and none is invented.
          v_overhead := null;
          if v_sold_by_format then
            v_priced := v_priced + 1;
          end if;
        else
          v_overhead := v_oh_rate * r.portion_qty;
          v_priced   := v_priced + 1;
        end if;
      end if;
    end;
  end if;

  if r.kind = 'dish' and not v_sold_by_format then
    -- MODEL 1, portion-based: the portion is the commercial unit, so its size
    -- is a required input.
    v_required := v_required + 1;
    if r.portion_qty is null then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'problem', 'missing_portion_size');
    else
      v_priced := v_priced + 1;
    end if;
  end if;
  -- MODEL 2, format-based: no portion input is required and none is invented.
  -- Whether each format can actually be costed is decided per format by
  -- fn_variant_problem, which blocks on incompatible dimensions, missing
  -- conversions and unpriced packaging. A recipe can therefore be complete
  -- while one of its formats is not, which is the truth of the situation.

  if core.priced_inputs = 0 then
    v_floor_pp := null;
  elsif core.cost_per_yield_unit is not null and r.portion_qty is not null then
    v_floor_pp := core.cost_per_yield_unit * r.portion_qty + coalesce(v_overhead, 0);
  else
    v_floor_pp := null;
  end if;

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
    case when v_complete then core.batch_cost end,
    case when v_complete then core.cost_per_yield_unit end,
    case when v_complete then v_floor_pp end,
    case when core.priced_inputs > 0 then core.batch_cost end,
    case when core.priced_inputs > 0 then core.cost_per_yield_unit end,
    v_floor_pp,
    p_created_by)
  returning id into v_snapshot;

  return v_snapshot;
end;
$function$;

do $$
declare v_pol int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'overhead_items' and column_name = 'basis_unit_id') then
    raise exception '0041 self-check FAILED: the per-item basis was not added.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_overhead_breakdown') then
    raise exception '0041 self-check FAILED: fn_overhead_breakdown is missing.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_overhead_item_basis_pair') then
    raise exception '0041 self-check FAILED: the basis pair constraint is missing.';
  end if;
  if pg_get_functiondef((select oid from pg_proc where proname='fn_compute_recipe_cost_snapshot' and prokind='f'))
     !~ 'fn_overhead_problem' then
    raise exception '0041 self-check FAILED: the engine does not use fn_overhead_problem.';
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0041 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0041 OK: per-item overhead basis live, provenance exposed, 116 policies unchanged.';
end
$$;
