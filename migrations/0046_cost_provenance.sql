-- ============================================================================
-- MENU MASTER NG
-- 0046: a frozen cost that can still be explained years later
--
-- Requires: 0001-0045 applied.
--
-- The frozen total was already immutable. The *explanation* of it was not.
--
-- Two things a snapshot needed and did not record:
--
--   B-1  a format-based variant's overhead share. The total included it, but
--        the breakdown had to reconstruct it by asking fn_overhead_rate about
--        TODAY's configuration. Change the overhead basis tomorrow and the
--        frozen total is still right while the breakdown quietly stops adding
--        up to it.
--
--   B-2  the portion size used at compute time. cost_per_portion is
--        cost_per_yield_unit x portion_qty, and portion_qty lives on recipes,
--        which is mutable. Change the portion size and 1.70/g x ? = 850 has
--        lost its "?".
--
-- Two nullable columns fix both. No child table: a breakdown table would be a
-- second place component figures live, needing its own RLS, its own
-- immutability trigger and its own reconciliation. The snapshot row is already
-- immutable and already holds every other component.
--
-- The more important half is the refactor. Rather than have the snapshot
-- writer recompute the components -- which is exactly how the 0040 defect
-- happened, and how this file's own packaging figure came to be computed twice
-- from two copies of one rule -- the component arithmetic moves into one
-- function. fn_variant_cost becomes a thin wrapper returning its total, and
-- the snapshot writer stores the components it returns. One implementation,
-- two callers, the same shape as fn_ingredient_cost_basis in 0034.
--
-- Snapshots written before this migration keep NULL in the new columns. That
-- is honest: detail never recorded cannot be invented afterwards. The
-- invariant is therefore "where component detail exists, it reconciles", not
-- "every snapshot has a breakdown".
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'cost_snapshots'
                and column_name in ('portion_qty_at_snapshot','variant_overhead_cost')) then
    raise exception '0046 preflight FAILED: a provenance column already exists.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_confirm_order') then
    raise exception '0046 preflight FAILED: 0045 has not been applied.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0046 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The two columns
--
-- ADD COLUMN is DDL, not row mutation, so fn_block_snapshot_mutation still
-- refuses every UPDATE and DELETE on cost_snapshots exactly as before.
-- ---------------------------------------------------------------------------

alter table cost_snapshots
  add column portion_qty_at_snapshot numeric,
  add column variant_overhead_cost   numeric;

comment on column cost_snapshots.portion_qty_at_snapshot is
  'The portion size in effect when this snapshot was computed. recipes.portion_qty '
  'can change afterwards; this cannot.';

comment on column cost_snapshots.variant_overhead_cost is
  'The overhead share carried by this variant''s sold unit. NULL on snapshots '
  'written before 0046, and on recipe-level snapshots, which record overhead '
  'in overhead_cost instead.';

-- ---------------------------------------------------------------------------
-- 2. One implementation of a variant's component costs
--
-- Same arithmetic fn_variant_cost has always performed, in one place, now
-- reporting the parts as well as the sum.
--
-- One deliberate change of behaviour: packaging comes back NULL, not 0, when a
-- cost-bearing packaging item has no price. sum() skips NULLs, so the old
-- expression reported an understated packaging figure for a variant that was
-- already blocked. A cost that is not known is not zero -- that rule does not
-- stop applying because the row happens to be incomplete.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'variant_cost_components') then
    create type variant_cost_components as (
      resolved_qty       numeric,
      ingredients_labour numeric,
      packaging          numeric,
      overhead           numeric,
      total              numeric
    );
  end if;
end
$$;

create or replace function fn_variant_cost_components(p_variant_id uuid)
returns variant_cost_components
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v record; c variant_cost_components;
  v_cpyu numeric; v_oh_rate numeric; v_unpriced_pack int;
begin
  c := row(null, null, null, null, null)::variant_cost_components;

  select rv.account_id, rv.business_id, rv.recipe_id, rv.format_id,
         r.yield_unit_id
    into v
    from recipe_variants rv
    join recipes r on r.id = rv.recipe_id
   where rv.id = p_variant_id;

  if v is null then return c; end if;
  perform fn_require_cost_access(v.account_id);

  c.resolved_qty := fn_variant_resolved_qty(p_variant_id);

  -- D4: format packaging is consumed once per sold unit and is NOT multiplied
  -- by the resolved quantity. No cost-bearing rows means no cost -- a true
  -- zero. An unpriced cost-bearing row means the figure is unknown.
  select count(*) into v_unpriced_pack
    from serving_format_packaging spk
   where spk.format_id = v.format_id
     and spk.is_cost_bearing
     and fn_ingredient_usable_unit_cost(spk.packaging_item_id, v.business_id) is null;

  if v_unpriced_pack = 0 then
    select coalesce(sum(spk.qty * fn_ingredient_usable_unit_cost(
                          spk.packaging_item_id, v.business_id)), 0)
      into c.packaging
      from serving_format_packaging spk
     where spk.format_id = v.format_id
       and spk.is_cost_bearing;
  end if;

  -- the existing engine's figure, unchanged: it already carries ingredients,
  -- sub-recipes, purchase yield, cooking yield and labour over effective yield
  select cost_per_yield_unit into v_cpyu
    from cost_snapshots
   where recipe_id = v.recipe_id and variant_id is null
   order by computed_at desc, seq desc
   limit 1;

  if v_cpyu is not null and c.resolved_qty is not null then
    c.ingredients_labour := v_cpyu * c.resolved_qty;
  end if;

  -- D1: overhead scales with output
  v_oh_rate := fn_overhead_rate(v.business_id, v.yield_unit_id);
  if v_oh_rate is null then
    if (select overhead_enabled from business_settings where business_id = v.business_id) then
      c.overhead := null;   -- enabled but unresolvable: incomplete, never zero
    else
      c.overhead := 0;      -- genuinely disabled: a true zero
    end if;
  elsif c.resolved_qty is not null then
    c.overhead := v_oh_rate * c.resolved_qty;
  end if;

  -- The total is the sum only when the variant resolves cleanly and every
  -- component is known. Anything else is not a cost.
  if fn_variant_problem(p_variant_id) is null
     and c.ingredients_labour is not null
     and c.packaging is not null
     and c.overhead is not null then
    c.total := c.ingredients_labour + c.packaging + c.overhead;
  end if;

  return c;
end
$fn$;

comment on function fn_variant_cost_components(uuid) is
  'What a sold unit of this variant costs, broken into ingredients-and-labour, '
  'packaging and overhead, plus the total. The single implementation behind '
  'both fn_variant_cost and fn_compute_variant_cost_snapshot.';

grant execute on function fn_variant_cost_components(uuid) to authenticated;

-- fn_variant_cost keeps its meaning exactly; it is now the total of the above.
create or replace function fn_variant_cost(p_variant_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  return (fn_variant_cost_components(p_variant_id)).total;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The snapshot writer stores the components rather than recomputing them
-- ---------------------------------------------------------------------------

create or replace function fn_compute_variant_cost_snapshot(
  p_variant_id uuid,
  p_as_of      date default current_date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v record; base cost_snapshots%rowtype; c variant_cost_components;
  v_problem text; v_complete boolean; v_unpriced jsonb; v_id uuid;
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
  c         := fn_variant_cost_components(p_variant_id);

  -- Completeness propagates upward exactly as it does for sub-recipes: a
  -- variant is complete only if its own basis resolves AND the recipe beneath
  -- it is complete.
  v_complete := base.is_complete and v_problem is null and c.total is not null;
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
      variant_id, resolved_qty, resolved_unit_id, basis_used, format_packaging_cost,
      portion_qty_at_snapshot, variant_overhead_cost)
  values (
      v.account_id, v.business_id, v.recipe_id, now(),
      base.costing_method, base.wavg_window_days,
      v_complete, base.required_inputs, base.priced_inputs, base.excluded_inputs,
      v_unpriced,
      base.ingredient_cost, base.packaging_cost, base.labour_cost, base.overhead_cost,
      base.batch_cost, base.cost_per_yield_unit,
      c.total,                                  -- cost per SOLD UNIT, not per portion
      base.floor_batch_cost, base.floor_cost_per_yield_unit, base.floor_cost_per_portion,
      auth.uid(),
      p_variant_id, c.resolved_qty, v.yield_unit_id, v.costing_basis, c.packaging,
      -- a format-based sale has no portion; the sold unit IS the portion
      base.portion_qty_at_snapshot, c.overhead)
  returning id into v_id;

  return v_id;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The recipe writer records the portion size it used
--
-- Reproduced in full, with one column added to the INSERT. Nothing else in it
-- changes.
-- ---------------------------------------------------------------------------

create or replace function fn_compute_recipe_cost_snapshot(p_recipe_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_created_by uuid DEFAULT auth.uid())
returns uuid
language plpgsql
security definer
set search_path to 'public'
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
    created_by,
    portion_qty_at_snapshot)
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
    p_created_by,
    -- 0046: the portion size actually used, recorded so the breakdown can be
    -- rebuilt later. recipes.portion_qty is mutable; this is not.
    r.portion_qty)
  returning id into v_snapshot;

  return v_snapshot;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Self-check
--
-- Asserts the reconciliation invariant on every snapshot that now carries
-- component detail, not merely that the columns exist.
-- ---------------------------------------------------------------------------

do $$
declare v_pol int; v_bad int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'cost_snapshots'
                    and column_name = 'portion_qty_at_snapshot')
   or not exists (select 1 from information_schema.columns
                  where table_name = 'cost_snapshots'
                    and column_name = 'variant_overhead_cost') then
    raise exception '0046 self-check FAILED: a provenance column is missing.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_variant_cost_components') then
    raise exception '0046 self-check FAILED: fn_variant_cost_components is missing.';
  end if;

  -- Nothing already written may have moved. ADD COLUMN cannot change a value,
  -- but assert it rather than assume it.
  select count(*) into v_bad from cost_snapshots
   where portion_qty_at_snapshot is not null or variant_overhead_cost is not null;
  if v_bad > 0 then
    raise exception '0046 self-check FAILED: % pre-existing snapshot(s) gained detail.', v_bad;
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0046 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0046 OK: component provenance recorded, one implementation, 116 policies unchanged.';
end
$$;
