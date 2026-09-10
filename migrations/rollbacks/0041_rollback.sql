-- Rollback for 0041. Restores the single business-wide overhead basis.
-- Multi-dimension businesses become uncostable in one dimension again.
begin;

CREATE OR REPLACE FUNCTION public.fn_overhead_rate(p_business_id uuid, p_target_unit_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total numeric; v_qty numeric; v_unit uuid; v_basis numeric;
begin
  if p_business_id is null or p_target_unit_id is null then return null; end if;

  select overhead_basis_qty, overhead_basis_unit_id
    into v_qty, v_unit
    from business_settings
   where business_id = p_business_id;

  -- no declared basis is not a rate of zero; it is the absence of a rate
  if v_qty is null or v_unit is null then return null; end if;

  select coalesce(sum(monthly_cost), 0) into v_total
    from overhead_items
   where business_id = p_business_id and is_active;

  -- returns NULL across measurement kinds and for container units with no
  -- universal factor. That NULL is the incompatibility signal; it is never
  -- coerced to a number.
  v_basis := fn_convert_between_units(v_qty, v_unit, p_target_unit_id);
  if v_basis is null or v_basis <= 0 then return null; end if;

  return v_total / v_basis;
end;
$function$;

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
    select sum(monthly_cost) into v_oh_total
    from overhead_items
    where business_id = r.business_id and is_active and monthly_cost is not null;

    -- D1: the overhead ITEMS are the config question. Whether a BASIS exists
    -- is a separate question, with its own problem code below. The deprecated
    -- per-portion denominator is retained on the table but no longer read.
    if v_oh_total is null
       or exists (select 1 from overhead_items
                   where business_id = r.business_id and is_active and monthly_cost is null)
    then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'business_id', r.business_id,
        'problem', 'missing_overhead_config');
      v_overhead := null;
    elsif bs.overhead_basis_qty is null or bs.overhead_basis_unit_id is null then
      -- overhead is enabled but no basis has been declared. Report it by name.
      -- DO NOT fall back to the old denominator: silently switching methodology
      -- is exactly what this migration exists to prevent.
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'business_id', r.business_id,
        'problem', 'missing_overhead_basis');
      v_overhead := null;
    else
      v_oh_rate := fn_overhead_rate(r.business_id, r.yield_unit_id);
      if v_oh_rate is null then
        -- the basis exists but cannot be expressed in this recipe's yield unit:
        -- a litre basis cannot allocate to a recipe sold by the piece. No
        -- cross-kind conversion is invented (D1 option a).
        v_complete := false;
        v_unpriced := v_unpriced || jsonb_build_object(
          'recipe_id', p_recipe_id, 'business_id', r.business_id,
          'problem', 'overhead_basis_incompatible');
        v_overhead := null;
      elsif r.portion_qty is null then
        -- No portion size. For a PORTION-BASED recipe that is incomplete, and
        -- missing_portion_size below records it. For a FORMAT-BASED recipe it
        -- is correct: overhead is allocated per sellable format by
        -- fn_variant_cost as overhead_rate x resolved_qty, so there is no
        -- per-portion figure to compute and none is invented. The rate itself
        -- is resolvable either way -- only this projection of it is absent.
        v_overhead := null;
        if v_sold_by_format then
          v_priced := v_priced + 1;
        end if;
      else
        v_overhead := v_oh_rate * r.portion_qty;
        v_priced   := v_priced + 1;
      end if;
    end if;
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

drop function if exists fn_overhead_problem(uuid, uuid);
drop function if exists fn_overhead_breakdown(uuid, uuid);

alter table overhead_items drop constraint if exists chk_overhead_item_basis_positive;
alter table overhead_items drop constraint if exists chk_overhead_item_basis_pair;
alter table overhead_items drop column if exists basis_unit_id;
alter table overhead_items drop column if exists basis_qty;

commit;
