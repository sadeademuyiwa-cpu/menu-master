-- ============================================================================
-- MENU MASTER NG
-- 0022: backfill default serving formats and variants -- GATE 2, PHASE 2
--
-- Authority: docs/GATE2_FINAL_DESIGN.md section 9, Phase 2.
-- Requires: 0021 applied (47 fn_* / 48 relations / 105 policies).
--
-- WHAT IT DOES, exactly as the design specifies
--   For each business owning at least one live recipe with a non-null
--   portion_qty:
--     * one serving_formats row named 'Default', capacity_qty NULL and
--       capacity_unit_id NULL -- NO CONTAINER IS INFERRED (locked rule 4)
--     * one recipe_variants row per such recipe:
--         costing_basis   = 'explicit_qty'
--         sellable_qty    = recipes.portion_qty      (exact, not approximate)
--         sellable_unit_id= recipes.yield_unit_id
--
--   This is exact rather than approximate because portion_qty already IS a
--   quantity of recipe output expressed in the yield unit (GATE2A finding F1).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * A recipe with portion_qty IS NULL gets NO variant. Nothing is invented,
--     and a null is never turned into a quantity.
--   * A soft-deleted recipe (deleted_at is not null) gets no variant.
--   * No capacity is set on the Default format, ever.
--   * portion_qty is neither read as a container size nor dropped.
--   * No costing behaviour changes. Phase 5 repoints the engine, not this.
--
-- IDEMPOTENT. Re-running inserts nothing further. Additive throughout.
--
-- NOTE ON PRODUCTION: at the time of writing production holds zero tenant
-- rows, so this migration is a no-op there. It exists and is tested because
-- correctness cannot depend on a table happening to be empty.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 47 then
    raise exception '0022 preflight FAILED: expected 47 fn_* functions, found %. '
                    'Is 0021 applied?',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  if to_regclass('public.recipe_variants') is null
     or to_regclass('public.serving_formats') is null then
    raise exception '0022 preflight FAILED: 0021 is not applied.';
  end if;

  raise notice '0022 preflight OK. Eligible recipes: %, businesses: %.',
    (select count(*) from recipes where portion_qty is not null and deleted_at is null),
    (select count(distinct business_id) from recipes
      where portion_qty is not null and deleted_at is null);
end
$$;

-- ----------------------------------------------------------------------------
-- 1. One 'Default' format per eligible business, with NO capacity
-- ----------------------------------------------------------------------------
insert into serving_formats (account_id, business_id, name, description)
select distinct r.account_id, r.business_id, 'Default',
       'Created by the Gate 2 backfill. Capacity is deliberately not set: '
       'no container size was ever recorded, and none is assumed.'
  from recipes r
 where r.portion_qty is not null
   and r.deleted_at is null
   and not exists (
         select 1 from serving_formats f
          where f.business_id = r.business_id
            and lower(f.name) = 'default');

-- ----------------------------------------------------------------------------
-- 2. One explicit-quantity variant per eligible recipe
-- ----------------------------------------------------------------------------
insert into recipe_variants (account_id, business_id, recipe_id, format_id,
                             costing_basis, sellable_qty, sellable_unit_id)
select r.account_id, r.business_id, r.id, f.id,
       'explicit_qty', r.portion_qty, r.yield_unit_id
  from recipes r
  join serving_formats f
    on f.business_id = r.business_id
   and lower(f.name) = 'default'
 where r.portion_qty is not null
   and r.deleted_at is null
   and not exists (
         select 1 from recipe_variants v
          where v.recipe_id = r.id
            and v.format_id = f.id);

-- ----------------------------------------------------------------------------
-- 2. SELF-CHECK -- prove the backfill is exact, complete and inventive of nothing
-- ----------------------------------------------------------------------------
do $$
declare
  v_eligible int; v_variants int; v_bad int; v_cap int; v_sub int; v_null int;
begin
  select count(*) into v_eligible from recipes
   where portion_qty is not null and deleted_at is null;

  select count(*) into v_variants from recipe_variants v
    join serving_formats f on f.id = v.format_id and lower(f.name) = 'default';

  if v_variants <> v_eligible then
    raise exception '0022 self-check FAILED: % eligible recipe(s) but % default '
                    'variant(s).', v_eligible, v_variants;
  end if;

  -- every backfilled quantity must equal portion_qty EXACTLY, in the yield unit
  select count(*) into v_bad
    from recipe_variants v
    join serving_formats f on f.id = v.format_id and lower(f.name) = 'default'
    join recipes r on r.id = v.recipe_id
   where v.costing_basis <> 'explicit_qty'
      or v.sellable_qty is distinct from r.portion_qty
      or v.sellable_unit_id is distinct from r.yield_unit_id;
  if v_bad > 0 then
    raise exception '0022 self-check FAILED: % variant(s) do not reproduce '
                    'portion_qty exactly in the yield unit.', v_bad;
  end if;

  -- no capacity may have been invented for a Default format
  select count(*) into v_cap from serving_formats
   where lower(name) = 'default'
     and (capacity_qty is not null or capacity_unit_id is not null);
  if v_cap > 0 then
    raise exception '0022 self-check FAILED: % Default format(s) carry a '
                    'capacity. No container size may be inferred.', v_cap;
  end if;

  -- a recipe with no portion_qty must have received nothing
  select count(*) into v_null
    from recipes r
    join recipe_variants v on v.recipe_id = r.id
   where r.portion_qty is null;
  if v_null > 0 then
    raise exception '0022 self-check FAILED: % variant(s) exist for recipes '
                    'with no portion_qty. A NULL was turned into a quantity.', v_null;
  end if;

  -- visible, not silent: sub-recipes are backfilled only if the owner gave
  -- them a portion_qty. The design says "each recipe with a non-null
  -- portion_qty" and this migration does not add a rule of its own.
  select count(*) into v_sub
    from recipe_variants v join recipes r on r.id = v.recipe_id
   where r.kind = 'sub_recipe';

  raise notice '0022 OK: % variant(s) across % business(es), all reproducing '
               'portion_qty exactly; % Default format(s), none with a capacity; '
               '% sub-recipe variant(s).',
    v_variants,
    (select count(*) from serving_formats where lower(name)='default'),
    (select count(*) from serving_formats where lower(name)='default'),
    v_sub;
end
$$;
