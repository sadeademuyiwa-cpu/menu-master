-- ============================================================================
-- MENU MASTER NG
-- 0040: a format stated in the recipe's own unit must resolve
--
-- Requires: 0001-0039 applied.
--
-- THE DEFECT (P1)
--   fn_variant_problem decided whether a format could be costed by testing
--   units.factor_to_base itself, rather than asking fn_variant_resolved_qty.
--   Container units carry no universal factor by design -- a paint of rice and
--   a paint of beans are different weights -- so the test refused them.
--
--   That is right across DIFFERENT units and wrong when the format is stated
--   in the SAME unit the recipe yields in. piece -> piece is the identity; it
--   needs no factor. fn_variant_resolved_qty already returned the correct
--   quantity while fn_variant_problem refused the very same variant, so
--   fn_variant_cost returned NULL and the format could not be costed at all.
--
--   Reached by any business whose output is counted rather than weighed or
--   measured: 100 rolls sold in 6-piece packs, wraps sold by the wrap, bowls
--   sold by the bowl. Proven: resolved_qty = 6 while problem =
--   'capacity_unit_unconvertible'.
--
-- ROOT CAUSE
--   Two implementations of one rule. The convertibility question belongs to
--   the resolver; the problem check now asks it instead of re-deriving it, so
--   they cannot disagree again. Reason codes are unchanged, so callers and UI
--   copy keep working: 'capacity_unit_incompatible' still means the dimensions
--   differ, 'capacity_unit_unconvertible' still means no conversion exists.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_variant_resolved_qty') then
    raise exception '0040 preflight FAILED: fn_variant_resolved_qty is missing.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0040 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public.fn_variant_problem(p_variant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record; v_from_kind unit_kind; v_to_kind unit_kind;
  v_from_factor numeric; v_unpriced int;
begin
  select rv.account_id, rv.business_id, rv.costing_basis, rv.sellable_qty,
         rv.sellable_unit_id, rv.format_id,
         f.capacity_qty, f.capacity_unit_id,
         r.yield_unit_id, r.id as recipe_id
    into v
    from recipe_variants rv
    join serving_formats f on f.id = rv.format_id
    join recipes r on r.id = rv.recipe_id
   where rv.id = p_variant_id;

  if v is null then return 'variant_not_found'; end if;
  perform fn_require_member(v.account_id);

  select kind into v_to_kind from units where id = v.yield_unit_id;

  if v.costing_basis = 'capacity' then
    if v.capacity_qty is null or v.capacity_unit_id is null then
      return 'format_missing_capacity';
    end if;
    select kind, factor_to_base into v_from_kind, v_from_factor
      from units where id = v.capacity_unit_id;
    if v_from_kind is distinct from v_to_kind then
      return 'capacity_unit_incompatible';
    end if;
    -- ASK THE RESOLVER, do not re-derive convertibility here.
    --
    -- This previously refused whenever the format's unit had no universal
    -- factor_to_base, on the reasoning that a container unit cannot resolve.
    -- That is true across DIFFERENT units, but not when the format is stated
    -- in the SAME unit the recipe yields in: piece -> piece is the identity
    -- and needs no factor. fn_variant_resolved_qty already returned the right
    -- answer while this check refused it, so a business selling 100 rolls in
    -- 6-piece packs -- any count- or container-yield business -- was blocked
    -- from costing anything. Two implementations of one rule had drifted.
    if fn_variant_resolved_qty(p_variant_id) is null then
      return 'capacity_unit_unconvertible';
    end if;
  else
    if v.sellable_qty is null or v.sellable_unit_id is null then
      return 'missing_sellable_quantity';
    end if;
    select kind, factor_to_base into v_from_kind, v_from_factor
      from units where id = v.sellable_unit_id;
    if v_from_kind is distinct from v_to_kind then
      return 'sellable_unit_incompatible';
    end if;
    -- Same correction on the explicit-quantity basis.
    if fn_variant_resolved_qty(p_variant_id) is null then
      return 'sellable_unit_incompatible';
    end if;
  end if;

  -- a format packaging item with no price blocks the variant, exactly as an
  -- unpriced ingredient blocks the recipe
  select count(*) into v_unpriced
    from serving_format_packaging spk
   where spk.format_id = v.format_id
     and spk.is_cost_bearing
     and fn_ingredient_usable_unit_cost(spk.packaging_item_id, v.business_id) is null;
  if v_unpriced > 0 then
    return 'missing_packaging_price';
  end if;

  return null;
end;
$function$;

do $$
declare v_pol int;
begin
  if pg_get_functiondef((select oid from pg_proc where proname='fn_variant_problem' and prokind='f'))
     !~ 'fn_variant_resolved_qty' then
    raise exception '0040 self-check FAILED: fn_variant_problem still re-derives convertibility.';
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0040 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0040 OK: fn_variant_problem defers to the resolver, 116 policies unchanged.';
end
$$;
