-- ============================================================================
-- MENU MASTER NG
-- 0039: two costing models -- portion-based and format-based
--
-- Requires: 0001-0038 applied.
--
-- OWNER DECISION (Phase 4 escalation, Option A with clarification)
--   Menu Master supports TWO valid selling models, and exactly one applies to
--   any given recipe. This is NOT "portion size is optional".
--
--   MODEL 1, PORTION-BASED. The recipe produces discrete servings -- plates,
--   meals, slices, guests. The portion is the commercial unit and its size is
--   a required input.
--
--   MODEL 2, FORMAT-BASED. The recipe produces a measurable batch that the
--   business sells through its own formats -- 1 L, 1.5 L, 2.5 L, 4 L; 500 g;
--   a 6-piece pack. The FORMAT is the commercial unit. Requiring a synthetic
--   portion size merely to satisfy the engine would be inventing an input,
--   and a business selling only by format could not cost anything at all.
--
-- WHAT CHANGES
--   Only which inputs a recipe REQUIRES. A recipe with at least one active
--   sellable format (an active recipe_variant on an active serving_format) no
--   longer requires portion_qty, and no per-portion overhead projection is
--   demanded of it. Nothing else is altered.
--
-- WHAT DOES NOT CHANGE -- and did not need to
--   The format costing engine already implements the approved model exactly:
--       fn_variant_resolved_qty  the format's quantity in the recipe's yield
--                                unit, via the existing unit/conversion
--                                architecture. NULL across incompatible
--                                dimensions -- never a guess.
--       fn_variant_problem       blocks on incompatible dimensions, missing
--                                conversions and unpriced packaging.
--       fn_variant_cost          cost_per_yield_unit x resolved_qty
--                                + packaging (ONCE per sellable unit)
--                                + overhead_rate x resolved_qty
--
--   So batch economics are PROJECTED onto each format, never duplicated. One
--   recipe may carry 1 L, 1.5 L, 2.5 L and 4 L formats without four recipes
--   and without multiplying batch labour or batch overhead into each.
--
--   No dimension is hard-coded. 10 L -> 2.5 L, 10 kg -> 500 g and 100 pieces
--   -> a 6-piece pack all resolve through the same conversion architecture;
--   10 L -> 500 g resolves to NULL and blocks unless the business has itself
--   supplied a conversion making those dimensions convertible.
--
-- PROVENANCE
--   A recipe's basis is derivable and is exposed: a recipe with active
--   sellable formats is format-based, otherwise portion-based. v_recipe_basis
--   (below) states it, so no caller has to infer it.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_variant_cost') then
    raise exception '0039 preflight FAILED: the variant costing engine is missing.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'cost_snapshots' and column_name = 'seq') then
    raise exception '0039 preflight FAILED: 0037/0038 must be applied first.';
  end if;
  if exists (select 1 from pg_views where viewname = 'v_recipe_basis') then
    raise exception '0039 preflight FAILED: v_recipe_basis already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0039 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
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

-- Which model a recipe is costed under, stated rather than inferred by callers.
create view v_recipe_basis with (security_invoker = on) as
select
  r.id            as recipe_id,
  r.account_id,
  r.business_id,
  r.name,
  case when exists (
         select 1 from recipe_variants rv
         join serving_formats sf on sf.id = rv.format_id
        where rv.recipe_id = r.id and rv.is_active and sf.is_active)
       then 'format' else 'portion' end          as costing_basis,
  (select count(*) from recipe_variants rv
    join serving_formats sf on sf.id = rv.format_id
   where rv.recipe_id = r.id and rv.is_active and sf.is_active)::int as active_formats,
  r.portion_qty
from recipes r
where r.deleted_at is null;

comment on view v_recipe_basis is
  'Whether a recipe is costed per portion or per business-defined format. '
  'A recipe with at least one active sellable format is format-based and does '
  'not require a portion size.';

grant select on v_recipe_basis to authenticated;


do $$
declare v_pol int; v_unsafe text;
begin
  if not exists (select 1 from pg_views where viewname = 'v_recipe_basis') then
    raise exception '0039 self-check FAILED: v_recipe_basis was not created.';
  end if;

  -- the option, not the definition: a replaced view silently loses it
  select string_agg(c.relname, ', ') into v_unsafe
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname = 'v_recipe_basis'
     and not coalesce('security_invoker=on' = any(c.reloptions), false);
  if v_unsafe is not null then
    raise exception '0039 self-check FAILED: % lost security_invoker.', v_unsafe;
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0039 self-check FAILED: policy count moved to %.', v_pol;
  end if;

  raise notice '0039 OK: portion/format costing models live, v_recipe_basis created, 116 policies unchanged.';
end
$$;
