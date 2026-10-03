-- Rollback for 0046.
--
-- Restores the three functions to their 0045 text before dropping the columns
-- and the component type they depend on, then removes the provenance columns.
--
-- Note what this cannot undo: snapshots written while 0046 was in force keep
-- their component detail until the columns are dropped, at which point the
-- detail is gone for good. The frozen totals are untouched.
begin;

create or replace function fn_variant_cost(p_variant_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $fn$
declare
  v record; v_qty numeric; v_cpyu numeric; v_pack numeric;
  v_oh_rate numeric; v_oh numeric; v_problem text;
begin
  select rv.account_id, rv.business_id, rv.recipe_id, rv.format_id,
         r.yield_unit_id
    into v
    from recipe_variants rv
    join recipes r on r.id = rv.recipe_id
   where rv.id = p_variant_id;

  if v is null then return null; end if;
  perform fn_require_cost_access(v.account_id);

  v_problem := fn_variant_problem(p_variant_id);
  if v_problem is not null then return null; end if;

  v_qty := fn_variant_resolved_qty(p_variant_id);
  if v_qty is null then return null; end if;

  -- the existing engine's figure, unchanged: it already carries ingredients,
  -- sub-recipes, purchase yield, cooking yield and labour over effective yield
  select cost_per_yield_unit into v_cpyu
    from cost_snapshots
   where recipe_id = v.recipe_id
   order by computed_at desc, seq desc
   limit 1;
  if v_cpyu is null then return null; end if;

  -- D4: format packaging is consumed once per sold unit and is NOT multiplied
  -- by the resolved quantity. No rows means no cost -- a true zero, not a NULL
  -- coerced into one.
  select coalesce(sum(spk.qty * fn_ingredient_usable_unit_cost(
                        spk.packaging_item_id, v.business_id)), 0)
    into v_pack
    from serving_format_packaging spk
   where spk.format_id = v.format_id
     and spk.is_cost_bearing;

  -- D1: overhead scales with output
  v_oh_rate := fn_overhead_rate(v.business_id, v.yield_unit_id);
  if v_oh_rate is null then
    if (select overhead_enabled from business_settings where business_id = v.business_id) then
      return null;      -- enabled but unresolvable: incomplete, never zero
    end if;
    v_oh := 0;          -- genuinely disabled: a true zero
  else
    v_oh := v_oh_rate * v_qty;
  end if;

  return v_cpyu * v_qty + v_pack + v_oh;
end;
$fn$;

create or replace function fn_compute_variant_cost_snapshot(p_variant_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $fn$
declare
  v record; base cost_snapshots%rowtype;
  v_qty numeric; v_cost numeric; v_problem text; v_pack numeric;
  v_complete boolean; v_unpriced jsonb; v_id uuid;
begin
  select rv.account_id, rv.business_id, rv.recipe_id, rv.format_id,
         rv.costing_basis, r.yield_unit_id
    into v
    from recipe_variants rv
    join recipes r on r.id = rv.recipe_id
   where rv.id = p_variant_id;
  if v is null then
    raise exception 'Variant % does not exist', p_variant_id;
  end if;
  perform fn_require_cost_access(v.account_id);

  select * into base from cost_snapshots
   where recipe_id = v.recipe_id and variant_id is null
   order by computed_at desc, seq desc limit 1;
  if not found then
    raise exception 'Recipe % has no cost snapshot yet. Compute the recipe '
                    'cost before the variant cost.', v.recipe_id;
  end if;

  v_problem := fn_variant_problem(p_variant_id);
  v_qty     := fn_variant_resolved_qty(p_variant_id);
  v_cost    := fn_variant_cost(p_variant_id);

  select coalesce(sum(spk.qty * fn_ingredient_usable_unit_cost(
                        spk.packaging_item_id, v.business_id)), 0)
    into v_pack
    from serving_format_packaging spk
   where spk.format_id = v.format_id and spk.is_cost_bearing;

  -- Completeness propagates upward exactly as it does for sub-recipes: a
  -- variant is complete only if its own basis resolves AND the recipe beneath
  -- it is complete.
  v_complete := base.is_complete and v_problem is null and v_cost is not null;
  v_unpriced := coalesce(base.unpriced_items, '[]'::jsonb);
  if v_problem is not null then
    v_unpriced := v_unpriced || jsonb_build_object(
      'variant_id', p_variant_id, 'problem', v_problem);
  end if;

  insert into cost_snapshots (
      account_id, business_id, recipe_id, computed_at,
      costing_method, wavg_window_days,
      is_complete, required_inputs, priced_inputs, excluded_inputs, unpriced_items,
      ingredient_cost, packaging_cost, labour_cost, overhead_cost,
      batch_cost, cost_per_yield_unit, cost_per_portion,
      floor_batch_cost, floor_cost_per_yield_unit, floor_cost_per_portion,
      created_by,
      variant_id, resolved_qty, resolved_unit_id, basis_used, format_packaging_cost)
  values (
      v.account_id, v.business_id, v.recipe_id, now(),
      base.costing_method, base.wavg_window_days,
      v_complete, base.required_inputs, base.priced_inputs, base.excluded_inputs,
      v_unpriced,
      base.ingredient_cost, base.packaging_cost, base.labour_cost, base.overhead_cost,
      base.batch_cost, base.cost_per_yield_unit,
      v_cost,                                   -- cost per SOLD UNIT, not per portion
      base.floor_batch_cost, base.floor_cost_per_yield_unit, base.floor_cost_per_portion,
      auth.uid(),
      p_variant_id, v_qty, v.yield_unit_id, v.costing_basis, v_pack)
  returning id into v_id;

  return v_id;
end;
$fn$;

create or replace function fn_compute_recipe_cost_snapshot(p_recipe_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_created_by uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $fn$
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
$fn$;

alter table cost_snapshots
  drop column if exists portion_qty_at_snapshot,
  drop column if exists variant_overhead_cost;

drop function if exists fn_variant_cost_components(uuid);
drop type if exists variant_cost_components;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'cost_snapshots'
                and column_name in ('portion_qty_at_snapshot','variant_overhead_cost')) then
    raise exception '0046 rollback FAILED: a provenance column survived.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'fn_variant_cost_components')
   or exists (select 1 from pg_type where typname = 'variant_cost_components') then
    raise exception '0046 rollback FAILED: the component function or type survived.';
  end if;
  raise notice '0046 rollback OK: provenance columns removed, functions restored.';
end
$$;

commit;
