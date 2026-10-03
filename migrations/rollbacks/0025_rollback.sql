-- ============================================================================
-- 0025 ROLLBACK -- restores the pre-Phase-5 read paths
--
-- Puts v_price_check and fn_freeze_sale_cost back to their EXACT pre-0025
-- definitions, captured from a live post-0024 database, and removes the
-- variant snapshot writer and the completeness constraint.
--
-- WHAT IT DOES TO DATA
--   Nothing is deleted. Variant-keyed cost_snapshots rows written by 0025
--   REMAIN -- they are immutable by 0001 and this rollback does not touch them.
--   After rolling back, the legacy freeze path ignores them, so a sale made
--   against a variant keeps the cost it froze at the time. That is the correct
--   behaviour: a frozen cost is history and history is not rewritten.
--
--   v_price_check must be DROPPED and recreated rather than replaced, because
--   CREATE OR REPLACE VIEW cannot remove the three columns 0025 appended.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 53 then
    raise exception '0025 rollback FAILED: expected 53 fn_* functions, found %. '
                    'A later migration is present; reverse that first.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0025 rollback: % variant-keyed snapshot(s) will be left in place, '
               'unread by the restored legacy path.',
    (select count(*) from cost_snapshots where variant_id is not null);
end
$$;

alter table cost_snapshots drop constraint if exists chk_complete_requires_resolution;
drop function if exists fn_compute_variant_cost_snapshot(uuid, date);
drop view if exists v_price_check;

create or replace view v_price_check with (security_invoker = on) as  WITH latest AS (
         SELECT DISTINCT ON (cost_snapshots.recipe_id) cost_snapshots.id,
            cost_snapshots.account_id,
            cost_snapshots.business_id,
            cost_snapshots.recipe_id,
            cost_snapshots.computed_at,
            cost_snapshots.costing_method,
            cost_snapshots.wavg_window_days,
            cost_snapshots.is_complete,
            cost_snapshots.required_inputs,
            cost_snapshots.priced_inputs,
            cost_snapshots.excluded_inputs,
            cost_snapshots.unpriced_items,
            cost_snapshots.ingredient_cost,
            cost_snapshots.packaging_cost,
            cost_snapshots.labour_cost,
            cost_snapshots.overhead_cost,
            cost_snapshots.batch_cost,
            cost_snapshots.cost_per_yield_unit,
            cost_snapshots.cost_per_portion,
            cost_snapshots.created_by,
            cost_snapshots.floor_batch_cost,
            cost_snapshots.floor_cost_per_yield_unit,
            cost_snapshots.floor_cost_per_portion
           FROM cost_snapshots
          ORDER BY cost_snapshots.recipe_id, cost_snapshots.computed_at DESC
        )
 SELECT r.id AS recipe_id,
    r.business_id,
    r.account_id,
    r.name,
    ch.id AS channel_id,
    ch.name AS channel_name,
    COALESCE(s.is_complete, false) AS is_complete,
    s.required_inputs,
    s.priced_inputs,
    s.excluded_inputs,
    COALESCE(s.unpriced_items, '[]'::jsonb) AS unpriced_items,
    s.floor_cost_per_portion AS cost_floor_per_portion,
    s.cost_per_portion,
    p.price AS selling_price,
        CASE
            WHEN s.is_complete AND p.price IS NOT NULL THEN round(p.price - s.cost_per_portion, 2)
            ELSE NULL::numeric
        END AS profit,
        CASE
            WHEN s.is_complete AND p.price IS NOT NULL AND p.price > 0::numeric THEN round(100.0 * (p.price - s.cost_per_portion) / p.price, 2)
            ELSE NULL::numeric
        END AS margin_pct,
        CASE
            WHEN s.is_complete AND s.cost_per_portion IS NOT NULL AND COALESCE(ch.target_margin, bs.default_target_margin) < 100::numeric THEN ceil(s.cost_per_portion / (1::numeric - COALESCE(ch.target_margin, bs.default_target_margin) / 100.0) / bs.price_rounding_to) * bs.price_rounding_to
            ELSE NULL::numeric
        END AS recommended_price,
    COALESCE(ch.target_margin, bs.default_target_margin) AS target_margin,
    bs.price_rounding_to,
    ch.commission_pct
   FROM recipes r
     JOIN business_settings bs ON bs.business_id = r.business_id
     LEFT JOIN latest s ON s.recipe_id = r.id
     LEFT JOIN channels ch ON ch.business_id = r.business_id AND ch.is_active
     LEFT JOIN LATERAL ( SELECT rp.price
           FROM recipe_prices rp
          WHERE rp.recipe_id = r.id AND (rp.channel_id IS NULL OR rp.channel_id = ch.id) AND rp.effective_from <= CURRENT_DATE
          ORDER BY rp.effective_from DESC, rp.created_at DESC
         LIMIT 1) p ON true
  WHERE r.kind = 'dish'::recipe_kind AND r.deleted_at IS NULL;
;
grant select on v_price_check to authenticated;

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

  select * into s
  from cost_snapshots
  where recipe_id = new.recipe_id
  order by computed_at desc
  limit 1;

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
$function$

;

do $$
declare v_fns int; v_rels int; v_src text; v_cols int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  if v_fns <> 52 or v_rels <> 49 then
    raise exception '0025 rollback self-check FAILED: % / %, expected 52 / 49.',
      v_fns, v_rels;
  end if;

  select prosrc into v_src from pg_proc where proname='fn_freeze_sale_cost';
  if v_src like '%variant_id = new.variant_id%' then
    raise exception '0025 rollback self-check FAILED: the repointed freeze survived.';
  end if;

  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='v_price_check';
  if v_cols <> 20 then
    raise exception '0025 rollback self-check FAILED: v_price_check has % columns, '
                    'expected the original 20.', v_cols;
  end if;

  raise notice '0025 ROLLBACK OK: back to 52 fn_* / 49 relations; v_price_check '
               'restored to 20 columns; the legacy freeze path is back.';
end
$$;
