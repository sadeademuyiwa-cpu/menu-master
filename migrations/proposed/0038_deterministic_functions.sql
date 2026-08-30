-- ============================================================================
-- MENU MASTER NG
-- 0038: finish the deterministic-snapshot fix, in the functions
--
-- Requires: 0001-0037 applied.
--
-- WHAT 0037 MISSED
--   0037 made "the latest cost snapshot" deterministic in the four VIEWS that
--   resolve it. Three FUNCTIONS resolve it the same way and were not touched,
--   so they still ordered by computed_at alone. computed_at is now(), which is
--   transaction start, so two snapshots written for one recipe in a single
--   transaction tie and the winner is arbitrary.
--
--       fn_variant_cost                  -- what a sellable format costs
--       fn_compute_variant_cost_snapshot -- writes a variant snapshot
--       fn_freeze_sale_cost              -- FREEZES cost onto a sale
--
--   fn_freeze_sale_cost is the serious one. It writes the cost of goods onto a
--   sale permanently, and the schema treats frozen sale costs as immutable
--   history. A tie there does not merely display a wrong number, it records
--   one, and the record is the thing later margin reporting is built on.
--
--   Reachable exactly as in 0037: fn_post_purchase writes one ingredient_prices
--   row per line inside one transaction, and ingredient_prices carries a
--   recompute trigger, so a purchase covering two ingredients used by the same
--   recipe recomputes it twice and ties.
--
-- THE FIX
--   The same tie-breaker 0037 introduced: order by computed_at desc, seq desc.
--   Nothing else in any of the three functions is altered -- the bodies below
--   are the deployed definitions with only that ordering changed.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'cost_snapshots' and column_name = 'seq') then
    raise exception '0038 preflight FAILED: 0037 must be applied first (seq is missing).';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0038 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public.fn_variant_cost(p_variant_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_compute_variant_cost_snapshot(p_variant_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_freeze_sale_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s cost_snapshots%rowtype;
begin
  if new.recipe_id is null then
    new.cost_snapshot_id  := null;
    new.unit_cost_at_sale := null;
    return new;
  end if;

  if new.variant_id is not null then
    -- what was actually sold is the variant, so that is what is frozen
    select * into s
    from cost_snapshots
    where variant_id = new.variant_id
    order by computed_at desc, seq desc
    limit 1;
  else
    -- unchanged legacy path: recipe-level snapshots only
    select * into s
    from cost_snapshots
    where recipe_id = new.recipe_id and variant_id is null
    order by computed_at desc, seq desc
    limit 1;
  end if;

  -- The gate applies here too. An incomplete cost is not a cost.
  if not found or not s.is_complete or s.cost_per_portion is null then
    new.cost_snapshot_id  := null;
    new.unit_cost_at_sale := null;
  else
    new.cost_snapshot_id  := s.id;
    new.unit_cost_at_sale := s.cost_per_portion;
  end if;

  return new;
end;
$function$;

do $$
declare v_bad text; v_pol int;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~* 'order by computed_at desc'
     and pg_get_functiondef(p.oid) !~* 'order by computed_at desc, seq desc';
  if v_bad is not null then
    raise exception '0038 self-check FAILED: % still pick a snapshot without a tie-breaker.', v_bad;
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0038 self-check FAILED: policy count moved to %.', v_pol;
  end if;

  raise notice '0038 OK: 3 functions now tie-break on seq, 116 policies unchanged.';
end
$$;
