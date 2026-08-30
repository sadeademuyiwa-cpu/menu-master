-- Rollback for 0040. Restores fn_variant_problem verbatim. Count- and
-- container-yield businesses become uncostable again with it.

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
    -- a container unit has no universal factor, and a recipe has no ingredient
    -- against which to look one up. Correct behaviour: it cannot resolve.
    if v_from_factor is null then
      return 'capacity_unit_unconvertible';
    end if;
  else
    if v.sellable_qty is null or v.sellable_unit_id is null then
      return 'missing_sellable_quantity';
    end if;
    select kind, factor_to_base into v_from_kind, v_from_factor
      from units where id = v.sellable_unit_id;
    if v_from_kind is distinct from v_to_kind or v_from_factor is null then
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
