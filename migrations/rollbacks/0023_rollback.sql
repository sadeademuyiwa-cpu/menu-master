-- ============================================================================
-- 0023 ROLLBACK -- restores the pre-Phase-3 overhead methodology
--
-- Puts fn_compute_recipe_cost_snapshot back to its EXACT 0012 definition,
-- captured from a live database before 0023 was applied, and removes the two
-- basis constraints and the two functions 0023 added.
--
-- Safe: 0023 stored nothing. Overhead is recomputed on the next snapshot, and
-- historical snapshots keep the overhead figure that produced them -- they are
-- immutable by 0001 and this rollback does not touch them. After rolling back,
-- a recipe recomputed under the old methodology may report a different
-- overhead than the snapshot beside it. That is a true record of a methodology
-- change, not a defect.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 49 then
    raise exception '0023 rollback FAILED: expected 49 fn_* functions, found %. '
                    'A later migration is present; reverse that first.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0023 rollback: % business(es) currently declare an overhead basis.',
    (select count(*) from business_settings where overhead_basis_qty is not null);
end
$$;

alter table business_settings drop constraint if exists chk_overhead_basis_pair;
alter table business_settings drop constraint if exists chk_overhead_basis_positive;

CREATE OR REPLACE FUNCTION public.fn_compute_recipe_cost_snapshot(p_recipe_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_created_by uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r recipes%rowtype; bs business_settings%rowtype; core recipe_cost_result;
  v_overhead numeric := 0; v_oh_total numeric;
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
        'recipe_id', p_recipe_id, 'business_id', r.business_id,
        'problem', 'missing_overhead_config');
      v_overhead := null;
    else
      v_overhead := v_oh_total / bs.expected_monthly_units;
      v_priced   := v_priced + 1;
    end if;
  end if;

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
$function$

;

drop function if exists fn_overhead_basis_preflight(uuid, numeric, uuid);
drop function if exists fn_overhead_rate(uuid, uuid);

do $$
declare v_fns int; v_src text;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 47 then
    raise exception '0023 rollback self-check FAILED: fn_* is %, expected 47.', v_fns;
  end if;

  select prosrc into v_src from pg_proc
   where pronamespace='public'::regnamespace and proname='fn_compute_recipe_cost_snapshot';
  if v_src not like '%bs.expected_monthly_units%' then
    raise exception '0023 rollback self-check FAILED: the old engine was not restored.';
  end if;
  if v_src like '%missing_overhead_basis%' then
    raise exception '0023 rollback self-check FAILED: Phase 3 logic survived.';
  end if;

  raise notice '0023 ROLLBACK OK: back to 47 fn_*; the 0012 engine and the '
               'per-portion denominator are restored; the basis columns from '
               '0021 remain, unread and harmless.';
end
$$;
