-- ============================================================================
-- MENU MASTER NG
-- 0023: overhead basis -- GATE 2, PHASE 3 (D1, option a)
--
-- Authority: docs/GATE2_FINAL_DESIGN.md sections 5, 9 (Phase 3) and 11.
-- Requires: 0021 and 0022 applied (47 fn_* / 48 relations / 105 policies).
--
-- THE CHANGE
--   Overhead stops being "monthly total / expected_monthly_units per portion"
--   and becomes "monthly total per YIELD UNIT of declared output":
--
--       overhead_rate    = monthly_overhead_total
--                          / convert(overhead_basis_qty, basis_unit -> yield_unit)
--       portion_overhead = overhead_rate * portion_qty
--
--   The basis is an explicit, stored, auditable declaration -- "we expect
--   10,000 litres of output per month" -- rather than an ambiguous count in
--   which a 500ml pack and a 10L bowl absorbed identical overhead.
--
-- WHAT HAPPENS WHEN THE BASIS IS ABSENT OR INCOMPATIBLE
--   missing_overhead_basis        overhead_enabled but no basis declared
--   overhead_basis_incompatible   basis unit cannot express this yield unit
--
--   In both cases overhead is NULL and the snapshot is INCOMPLETE. There is no
--   fallback to expected_monthly_units: silently switching methodology is the
--   thing this migration exists to prevent, and no cross-kind conversion is
--   ever invented.
--
-- SCOPE
--   Production has ZERO businesses with overhead_enabled (G2 preflight row 30),
--   so no live business changes behaviour today. expected_monthly_units is
--   RETAINED and deprecated -- it is simply no longer read. Nothing is dropped.
--   Phase 4 (0024) is where the before/after comparison is produced.
--
-- fn_compute_recipe_cost_snapshot is replaced from its LIVE definition with
-- only the overhead branch altered, so every other line is byte-faithful to
-- what 0012 deployed.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 47 then
    raise exception '0023 preflight FAILED: expected 47 fn_* functions, found %. '
                    'Are 0021 and 0022 applied?',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='business_settings'
                    and column_name='overhead_basis_qty') then
    raise exception '0023 preflight FAILED: 0021 did not add overhead_basis_qty.';
  end if;

  if exists (select 1 from business_settings
              where (overhead_basis_qty is null) <> (overhead_basis_unit_id is null)) then
    raise exception '0023 preflight FAILED: % business(es) hold half a basis. '
                    'Fix them before adding the pair constraint.',
      (select count(*) from business_settings
        where (overhead_basis_qty is null) <> (overhead_basis_unit_id is null));
  end if;

  raise notice '0023 preflight OK. Businesses with overhead enabled: %.',
    (select count(*) from business_settings where overhead_enabled);
end
$$;

-- ----------------------------------------------------------------------------
-- 1. The basis is both-or-neither, and positive when present
-- ----------------------------------------------------------------------------
alter table business_settings
  add constraint chk_overhead_basis_pair
  check ((overhead_basis_qty is null) = (overhead_basis_unit_id is null));

alter table business_settings
  add constraint chk_overhead_basis_positive
  check (overhead_basis_qty is null or overhead_basis_qty > 0);

-- ----------------------------------------------------------------------------
-- 2. The rate. NULL whenever it cannot be derived honestly.
-- ----------------------------------------------------------------------------
create or replace function fn_overhead_rate(
  p_business_id uuid, p_target_unit_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
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
$$;

-- Internal. The engine calls it; clients do not.
revoke execute on function fn_overhead_rate(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The pre-flight the design asks for (section 11, point 2)
--
--   "report how many recipes would become incomplete under the chosen basis,
--    so the owner sees the cost of the choice first."
-- ----------------------------------------------------------------------------
create or replace function fn_overhead_basis_preflight(
  p_business_id uuid, p_basis_qty numeric, p_basis_unit_id uuid)
returns table (recipes_total int, would_resolve int, would_block int)
language plpgsql stable security definer set search_path = public
as $$
declare v_account uuid;
begin
  select account_id into v_account from businesses where id = p_business_id;
  if v_account is null then
    raise exception 'Business % does not exist', p_business_id;
  end if;
  perform fn_require_cost_access(v_account);

  return query
  with live as (
    select r.id, r.yield_unit_id
      from recipes r
     where r.business_id = p_business_id
       and r.deleted_at is null
       and r.kind = 'dish'
  )
  select count(*)::int,
         count(*) filter (
           where fn_convert_between_units(p_basis_qty, p_basis_unit_id, l.yield_unit_id)
                 is not null)::int,
         count(*) filter (
           where fn_convert_between_units(p_basis_qty, p_basis_unit_id, l.yield_unit_id)
                 is null)::int
    from live l;
end;
$$;

revoke execute on function fn_overhead_basis_preflight(uuid, numeric, uuid)
  from public, anon;
grant execute on function fn_overhead_basis_preflight(uuid, numeric, uuid)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The engine, replaced from its live definition with ONLY the overhead
--    branch altered
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_compute_recipe_cost_snapshot(p_recipe_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_created_by uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r recipes%rowtype; bs business_settings%rowtype; core recipe_cost_result;
  v_overhead numeric := 0; v_oh_total numeric; v_oh_rate numeric;
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
        -- no portion size, so no per-portion overhead. missing_portion_size
        -- below already accounts for the incompleteness.
        v_overhead := null;
      else
        v_overhead := v_oh_rate * r.portion_qty;
        v_priced   := v_priced + 1;
      end if;
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
$function$;

-- ----------------------------------------------------------------------------
-- 5. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_src text;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 49 then
    raise exception '0023 self-check FAILED: fn_* is %, expected 49.', v_fns;
  end if;

  select prosrc into v_src from pg_proc
   where pronamespace='public'::regnamespace and proname='fn_compute_recipe_cost_snapshot';

  if v_src like '%bs.expected_monthly_units%' then
    raise exception '0023 self-check FAILED: the engine still reads '
                    'expected_monthly_units. The old methodology survived.';
  end if;
  if v_src not like '%missing_overhead_basis%'
     or v_src not like '%overhead_basis_incompatible%' then
    raise exception '0023 self-check FAILED: the engine does not report both '
                    'overhead problem codes by name.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='business_settings'
                    and column_name='expected_monthly_units') then
    raise exception '0023 self-check FAILED: expected_monthly_units was dropped. '
                    'It is retained and deprecated, never dropped.';
  end if;

  if not exists (select 1 from pg_constraint where conname='chk_overhead_basis_pair')
     or not exists (select 1 from pg_constraint where conname='chk_overhead_basis_positive') then
    raise exception '0023 self-check FAILED: a basis constraint is missing.';
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
         and has_function_privilege('anon', p.oid, 'EXECUTE')) <> 0 then
    raise exception '0023 self-check FAILED: anon gained EXECUTE on a function.';
  end if;

  raise notice '0023 OK: 49 fn_*; overhead recovered per yield unit against an '
               'explicit basis; both problem codes reported by name; '
               'expected_monthly_units retained and no longer read.';
end
$$;
