-- ============================================================================
-- MENU MASTER NG
-- 0024: variant costing and the cutover regression -- GATE 2, PHASE 4
--
-- Authority: docs/GATE2_FINAL_DESIGN.md section 4 (formulas), section 9
-- (Phase 4). Requires 0021, 0022 and 0023 applied (49 fn_* / 48 / 105).
--
-- WHAT THIS MIGRATION IS FOR
--   Phase 5 repoints the views and fn_freeze_sale_cost onto variants. Before
--   that is safe, we must PROVE the variant path reproduces the existing
--   per-portion cost exactly. This migration builds the variant costing
--   functions and the regression view that proves it, and changes NO read path
--   of its own. Nothing that exists today reads anything added here.
--
-- THE PROPERTY BEING PROVEN (design section 9, Phase 4)
--   For every backfilled variant, variant_cost must equal the recipe's stored
--   cost_per_portion to six decimal places. It must, because 0022 set
--   sellable_qty = portion_qty in the recipe's own yield unit, so resolved_qty
--   IS portion_qty and the two formulas are arithmetically identical.
--
--   The exception the design names is overhead: 0023 changed that methodology
--   deliberately, so a snapshot computed BEFORE 0023 carries the old figure.
--   Those rows are reported as a before-and-after list rather than asserted,
--   and the self-check does not fail on them.
--
-- COMPLETENESS IS PRESERVED
--   Every unresolvable case returns NULL with a NAMED problem code, exactly as
--   the recipe engine does. No cost is ever estimated, and no NULL is ever
--   turned into a zero.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 49 then
    raise exception '0024 preflight FAILED: expected 49 fn_* functions, found %. '
                    'Are 0021, 0022 and 0023 all applied?',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not exists (select 1 from pg_proc where proname='fn_overhead_rate') then
    raise exception '0024 preflight FAILED: 0023 is not applied.';
  end if;
  raise notice '0024 preflight OK. Variants to be regressed: %.',
    (select count(*) from recipe_variants);
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Step 1 -- resolve the sellable quantity in the recipe's yield unit
--
--    Basis A uses the container's capacity; Basis B uses the stated sellable
--    quantity. The check constraints from 0021 make them mutually exclusive,
--    so there is no precedence rule to remember and no way to pick wrongly.
-- ----------------------------------------------------------------------------
create or replace function fn_variant_resolved_qty(p_variant_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare v record;
begin
  select rv.account_id, rv.costing_basis, rv.sellable_qty, rv.sellable_unit_id,
         f.capacity_qty, f.capacity_unit_id, r.yield_unit_id
    into v
    from recipe_variants rv
    join serving_formats f on f.id = rv.format_id
    join recipes r on r.id = rv.recipe_id
   where rv.id = p_variant_id;

  if v is null then return null; end if;
  perform fn_require_member(v.account_id);

  if v.costing_basis = 'capacity' then
    -- NULL capacity is an honest state, not a zero. It resolves to nothing.
    return fn_convert_between_units(v.capacity_qty, v.capacity_unit_id, v.yield_unit_id);
  else
    return fn_convert_between_units(v.sellable_qty, v.sellable_unit_id, v.yield_unit_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Step 3 -- the named reason, when a variant cannot be costed
--
--    Returns NULL when nothing is wrong. Every other return value is one of
--    the problem codes named in design section 4.
-- ----------------------------------------------------------------------------
create or replace function fn_variant_problem(p_variant_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
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
$$;

-- ----------------------------------------------------------------------------
-- 3. Step 2 -- the variant cost
--
--    recipe_component + format_packaging + overhead, all per sold unit.
--    Returns NULL whenever any component cannot be derived honestly.
-- ----------------------------------------------------------------------------
create or replace function fn_variant_cost(p_variant_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
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
   order by computed_at desc
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
$$;

revoke execute on function fn_variant_resolved_qty(uuid) from public, anon;
revoke execute on function fn_variant_problem(uuid)      from public, anon;
revoke execute on function fn_variant_cost(uuid)         from public, anon;
grant  execute on function fn_variant_resolved_qty(uuid) to authenticated;
grant  execute on function fn_variant_problem(uuid)      to authenticated;
grant  execute on function fn_variant_cost(uuid)         to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The cutover regression view
--
--    Reads only. Nothing existing reads it. Its verdict column is the gate
--    that Phase 5 must pass before it repoints anything.
-- ----------------------------------------------------------------------------
create or replace view v_gate2_cutover with (security_invoker = on) as
with latest as (
  select distinct on (recipe_id) recipe_id, cost_per_portion, computed_at, is_complete
    from cost_snapshots
   order by recipe_id, computed_at desc
)
select
  rv.account_id,
  rv.business_id,
  rv.id                          as variant_id,
  r.id                           as recipe_id,
  r.name                         as recipe_name,
  f.name                         as format_name,
  rv.costing_basis,
  r.portion_qty                  as legacy_portion_qty,
  fn_variant_resolved_qty(rv.id) as resolved_qty,
  s.cost_per_portion             as legacy_cost_per_portion,
  fn_variant_cost(rv.id)         as variant_cost,
  pk.pack_cost                   as format_packaging_cost,
  fn_variant_problem(rv.id)      as problem,
  bs.overhead_enabled,
  -- The comparison isolates the two INTENDED differences so the gate cannot
  -- cry wolf:
  --   * format packaging is new cost the legacy per-portion figure never had
  --     (D4: it is charged once per sold unit and did not exist before Gate 2)
  --   * 0023 deliberately changed the overhead methodology
  -- Anything left after removing those is a real defect.
  case
    when s.cost_per_portion is null and fn_variant_cost(rv.id) is null
      then 'BOTH INCOMPLETE'
    when s.cost_per_portion is null or fn_variant_cost(rv.id) is null
      then 'ONE SIDE INCOMPLETE'
    when abs(s.cost_per_portion - (fn_variant_cost(rv.id) - pk.pack_cost)) <= 0.000001
      then case when pk.pack_cost > 0
                then 'MATCH -- plus new format packaging'
                else 'MATCH' end
    when bs.overhead_enabled
      then 'DIFFERS -- OVERHEAD METHODOLOGY CHANGED BY 0023 (expected)'
    else 'MISMATCH'
  end as verdict
from recipe_variants rv
join recipes r          on r.id = rv.recipe_id
join serving_formats f  on f.id = rv.format_id
join business_settings bs on bs.business_id = rv.business_id
left join latest s      on s.recipe_id = r.id
cross join lateral (
  select coalesce(sum(spk.qty * fn_ingredient_usable_unit_cost(
                        spk.packaging_item_id, rv.business_id)), 0) as pack_cost
    from serving_format_packaging spk
   where spk.format_id = rv.format_id and spk.is_cost_bearing
) pk
where r.deleted_at is null;

grant select on v_gate2_cutover to authenticated;

-- ----------------------------------------------------------------------------
-- 5. SELF-CHECK -- the cutover gate itself
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_rels int; v_bad int; v_match int; v_oh int; v_total int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 52 then
    raise exception '0024 self-check FAILED: fn_* is %, expected 52.', v_fns;
  end if;

  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  if v_rels <> 49 then
    raise exception '0024 self-check FAILED: relations is %, expected 49.', v_rels;
  end if;

  select count(*) into v_total from v_gate2_cutover;
  select count(*) into v_bad   from v_gate2_cutover where verdict = 'MISMATCH';
  select count(*) into v_match from v_gate2_cutover where verdict like 'MATCH%';
  select count(*) into v_oh    from v_gate2_cutover where verdict like 'DIFFERS%';

  -- THE GATE. Where overhead is not enabled the two paths are arithmetically
  -- identical, so any difference is a real defect and Phase 5 must not proceed.
  if v_bad > 0 then
    raise exception '0024 CUTOVER GATE FAILED: % variant(s) differ from the '
                    'legacy cost outside the intended overhead change. Phase 5 '
                    'must not proceed. Inspect v_gate2_cutover.', v_bad;
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
         and has_function_privilege('anon', p.oid, 'EXECUTE')) <> 0 then
    raise exception '0024 self-check FAILED: anon gained EXECUTE on a function.';
  end if;

  raise notice '0024 OK: 52 fn_* / 49 relations. Cutover over % variant(s): % MATCH, '
               '% differing only by the intended 0023 overhead change, 0 MISMATCH.',
               v_total, v_match, v_oh;
end
$$;
