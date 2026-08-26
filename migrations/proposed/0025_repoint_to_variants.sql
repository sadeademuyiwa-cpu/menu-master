-- ============================================================================
-- MENU MASTER NG
-- 0025: repoint views and the sale freeze onto variants -- GATE 2, PHASE 5
--
-- Authority: docs/GATE2_FINAL_DESIGN.md section 9 (Phase 5), sections 2.5 and 4.
-- Requires: 0021-0024 applied (52 fn_* / 49 relations / 105 policies).
--
-- THIS IS THE ONLY GATE 2 MIGRATION THAT CHANGES AN EXISTING READ PATH.
-- Exactly three things change, and nothing else:
--
--   1. v_price_check        becomes variant-aware
--   2. fn_freeze_sale_cost  freezes the VARIANT cost when a sale names one
--   3. cost_snapshots       gains chk_complete_requires_resolution, scoped to
--                           variant-keyed rows (see the note in section 3)
--
-- THE COMPATIBILITY PROPERTY, enforced by the self-check below
--   A recipe with NO variants produces exactly the v_price_check row it
--   produces today, and a sale with NO variant_id freezes exactly the cost it
--   freezes today. Variant rows are ADDED where variants exist; nothing that
--   works today changes shape or value.
--
-- NOT CHANGED BY THIS MIGRATION
--   No table is created or dropped. No column is dropped. No RLS policy is
--   added, removed or altered. No grant to anon or authenticated changes. No
--   auth object, onboarding function, reference data row or Gate 1 guard is
--   touched. recipes.portion_qty and business_settings.expected_monthly_units
--   remain retained and deprecated -- dropping them is a separate later
--   migration, explicitly out of scope.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 52 then
    raise exception '0025 preflight FAILED: expected 52 fn_* functions, found %. '
                    'Are 0021-0024 all applied?',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  if not exists (select 1 from pg_proc where proname='fn_variant_cost') then
    raise exception '0025 preflight FAILED: 0024 is not applied.';
  end if;

  -- THE CUTOVER GATE. Phase 5 must not repoint anything while a variant still
  -- disagrees with the legacy figure outside the two intended differences.
  if (select count(*) from v_gate2_cutover where verdict = 'MISMATCH') > 0 then
    raise exception '0025 preflight FAILED: the 0024 cutover gate is not clean '
                    '-- % variant(s) MISMATCH. Repointing now would move live '
                    'costing onto a path that does not reproduce the old one.',
      (select count(*) from v_gate2_cutover where verdict = 'MISMATCH');
  end if;

  raise notice '0025 preflight OK. Cutover clean; % variant(s) in scope.',
    (select count(*) from recipe_variants);
end
$$;

-- ----------------------------------------------------------------------------
-- 1. The variant snapshot writer
--
--    A variant-keyed snapshot records what was sold, in what quantity, under
--    which basis, so any historical figure can be reconstructed (design 2.5,
--    "keying and explainability"). It derives its component figures from the
--    recipe's own latest snapshot -- the engine is NOT reimplemented here.
-- ----------------------------------------------------------------------------
create or replace function fn_compute_variant_cost_snapshot(
  p_variant_id uuid, p_as_of date default current_date)
returns uuid
language plpgsql security definer set search_path = public
as $$
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
   order by computed_at desc limit 1;
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
$$;

revoke execute on function fn_compute_variant_cost_snapshot(uuid, date) from public, anon;
grant  execute on function fn_compute_variant_cost_snapshot(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The sale freeze, repointed
--
--    A sale naming a variant freezes the VARIANT's cost. A sale naming only a
--    recipe behaves exactly as it does today, byte for byte. The completeness
--    gate is unchanged in both branches: an incomplete cost is not a cost.
-- ----------------------------------------------------------------------------
create or replace function fn_freeze_sale_cost()
returns trigger
language plpgsql security definer set search_path = public
as $$
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
    order by computed_at desc
    limit 1;
  else
    -- unchanged legacy path: recipe-level snapshots only
    select * into s
    from cost_snapshots
    where recipe_id = new.recipe_id and variant_id is null
    order by computed_at desc
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
$$;

-- ----------------------------------------------------------------------------
-- 3. Completeness requires a resolved quantity -- scoped, deliberately
--
--    Design section 3 states `is_complete implies resolved_qty is not null` on
--    cost_snapshots. It CANNOT hold for recipe-level rows: a sub-recipe has no
--    portion and no sold quantity, yet its snapshot is legitimately complete.
--    0021 tried to add it unscoped and broke the costing engine outright --
--    every completely-costed recipe failed to snapshot.
--
--    Scoped to variant-keyed rows the rule is exactly what the design means: a
--    VARIANT claiming completeness must have resolved the quantity it sells.
-- ----------------------------------------------------------------------------
alter table cost_snapshots
  add constraint chk_complete_requires_resolution
  check (variant_id is null or not is_complete or resolved_qty is not null);

-- ----------------------------------------------------------------------------
-- 4. v_price_check, repointed
--
--    One row per ACTIVE variant where variants exist; otherwise exactly the
--    recipe-level row this view produces today, with variant_id NULL. The
--    price is the one attached to that variant, falling back to the legacy
--    recipe-level price.
--
--    The economics are UNCHANGED: same profit, same margin, same recommended
--    price formula, same refusal to offer any of them when incomplete. Only
--    the row's identity and its cost source move.
-- ----------------------------------------------------------------------------
create or replace view v_price_check with (security_invoker = on) as
with recipe_latest as (
  select distinct on (recipe_id) *
    from cost_snapshots where variant_id is null
   order by recipe_id, computed_at desc
),
variant_latest as (
  select distinct on (variant_id) *
    from cost_snapshots where variant_id is not null
   order by variant_id, computed_at desc
),
rows as (
  -- variant rows
  select r.id as recipe_id, r.business_id, r.account_id, r.name,
         rv.id as variant_id, f.name as format_name,
         vl.resolved_qty,
         coalesce(vl.is_complete, false) as is_complete,
         vl.required_inputs, vl.priced_inputs, vl.excluded_inputs,
         coalesce(vl.unpriced_items, '[]'::jsonb) as unpriced_items,
         vl.floor_cost_per_portion, vl.cost_per_portion
    from recipes r
    join recipe_variants rv on rv.recipe_id = r.id and rv.is_active
    join serving_formats f on f.id = rv.format_id
    left join variant_latest vl on vl.variant_id = rv.id
   where r.kind = 'dish' and r.deleted_at is null
  union all
  -- recipe rows, only where the recipe has no active variant at all
  select r.id, r.business_id, r.account_id, r.name,
         null::uuid, null::text,
         null::numeric,
         coalesce(rl.is_complete, false),
         rl.required_inputs, rl.priced_inputs, rl.excluded_inputs,
         coalesce(rl.unpriced_items, '[]'::jsonb),
         rl.floor_cost_per_portion, rl.cost_per_portion
    from recipes r
    left join recipe_latest rl on rl.recipe_id = r.id
   where r.kind = 'dish' and r.deleted_at is null
     and not exists (select 1 from recipe_variants rv
                      where rv.recipe_id = r.id and rv.is_active)
)
-- COLUMN ORDER IS LOAD-BEARING. CREATE OR REPLACE VIEW cannot rename or
-- reorder an existing column, and every current consumer indexes by position.
-- The twenty existing columns keep their exact order and meaning; the three
-- Gate 2 columns are APPENDED at the end.
select
  x.recipe_id, x.business_id, x.account_id, x.name,
  ch.id as channel_id, ch.name as channel_name,
  x.is_complete, x.required_inputs, x.priced_inputs, x.excluded_inputs,
  x.unpriced_items,
  x.floor_cost_per_portion as cost_floor_per_portion,
  x.cost_per_portion,
  p.price as selling_price,
  case when x.is_complete and p.price is not null
       then round(p.price - x.cost_per_portion, 2) end as profit,
  case when x.is_complete and p.price is not null and p.price > 0
       then round(100.0 * (p.price - x.cost_per_portion) / p.price, 2) end as margin_pct,
  case when x.is_complete and x.cost_per_portion is not null
        and coalesce(ch.target_margin, bs.default_target_margin) < 100
       then ceil(x.cost_per_portion
                 / (1 - coalesce(ch.target_margin, bs.default_target_margin) / 100.0)
                 / bs.price_rounding_to) * bs.price_rounding_to end as recommended_price,
  coalesce(ch.target_margin, bs.default_target_margin) as target_margin,
  bs.price_rounding_to,
  ch.commission_pct,
  -- appended by 0025
  x.variant_id,
  x.format_name,
  x.resolved_qty
from rows x
join business_settings bs on bs.business_id = x.business_id
left join channels ch on ch.business_id = x.business_id and ch.is_active
left join lateral (
  select rp.price from recipe_prices rp
   where rp.recipe_id = x.recipe_id
     and (rp.channel_id is null or rp.channel_id = ch.id)
     and (rp.variant_id is null or rp.variant_id = x.variant_id)
     and rp.effective_from <= current_date
   order by (rp.variant_id is not null) desc,   -- a variant price wins
            rp.effective_from desc, rp.created_at desc
   limit 1) p on true;

-- ----------------------------------------------------------------------------
-- 5. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_rels int; v_pols int; v_src text; v_anon int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  select count(*) into v_pols from pg_policies where schemaname='public';

  if v_fns <> 53 then
    raise exception '0025 self-check FAILED: fn_* is %, expected 53.', v_fns;
  end if;
  if v_rels <> 49 then
    raise exception '0025 self-check FAILED: relations is %, expected 49. '
                    'This migration replaces a view; it must not add one.', v_rels;
  end if;
  if v_pols <> 105 then
    raise exception '0025 self-check FAILED: policies is %, expected 105. '
                    'This migration must not touch RLS.', v_pols;
  end if;

  select prosrc into v_src from pg_proc where proname='fn_freeze_sale_cost';
  if v_src not like '%variant_id = new.variant_id%' then
    raise exception '0025 self-check FAILED: the sale freeze was not repointed.';
  end if;

  if not exists (select 1 from pg_constraint where conname='chk_complete_requires_resolution') then
    raise exception '0025 self-check FAILED: chk_complete_requires_resolution missing.';
  end if;

  -- the deprecated legacy columns must still be there
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='recipes'
                    and column_name='portion_qty')
     or not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='business_settings'
                       and column_name='expected_monthly_units') then
    raise exception '0025 self-check FAILED: a deprecated legacy column was dropped.';
  end if;

  select count(distinct table_name) into v_anon
    from information_schema.role_table_grants
   where grantee='anon' and table_schema='public';
  if v_anon <> 5 then
    raise exception '0025 self-check FAILED: anon reads % table(s), expected 5.', v_anon;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
         and has_function_privilege('anon', p.oid, 'EXECUTE')) <> 0 then
    raise exception '0025 self-check FAILED: anon gained EXECUTE on a function.';
  end if;

  raise notice '0025 OK: 53 fn_* / 49 relations / 105 policies. v_price_check and '
               'fn_freeze_sale_cost repointed; legacy columns retained; anon '
               'surface unchanged.';
end
$$;
