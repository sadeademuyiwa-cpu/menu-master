-- ============================================================================
-- MENU MASTER NG
-- 0036: markup alongside margin
--
-- Requires: 0001-0035 applied.
--
-- WHY
--   business_settings.show_markup_alongside has existed since 0001 -- the
--   product has always intended to offer markup as well as margin -- but no
--   object ever computed it, so the setting controlled nothing.
--
--   Margin and markup answer different questions and are routinely confused:
--       margin = profit / SELLING PRICE      (what share of the price you keep)
--       markup = profit / COST               (how much you added to your cost)
--   A dish costing N850 sold at N1,500 is a 43.33% margin and a 76.47% markup.
--   Showing one and labelling it the other would misprice a menu, so markup is
--   computed here, in the same view and with the same completeness guard as
--   margin, rather than divided out in the browser.
--
--   NULL unless the recipe is complete AND a price is set AND the cost is
--   above zero. An incomplete cost yields no markup, exactly as it yields no
--   margin.
--
-- SECURITY_INVOKER IS RESTATED DELIBERATELY.
--   CREATE OR REPLACE VIEW does not preserve reloptions: omitting
--   `with (security_invoker = on)` silently RESETS it, and the view then runs
--   with the definer's rights. An earlier draft of this migration did exactly
--   that and opened a cross-tenant read on v_price_check -- tests/023 caught
--   it. A definition fingerprint does NOT detect this, because pg_views.definition
--   excludes reloptions; the self-check below asserts the option itself.
--
-- APPEND ONLY. Every existing column of v_price_check keeps its name, type and
-- position; markup_pct is added at the end. Nothing else in the definition is
-- altered -- the body below is the deployed definition, extracted verbatim.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_views where viewname = 'v_price_check') then
    raise exception '0036 preflight FAILED: v_price_check is missing.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'v_price_check' and column_name = 'markup_pct') then
    raise exception '0036 preflight FAILED: markup_pct already exists.';
  end if;
  if (select count(*) from information_schema.columns
       where table_name = 'v_price_check') <> 23 then
    raise exception '0036 preflight FAILED: v_price_check has % columns, expected 23.',
      (select count(*) from information_schema.columns where table_name = 'v_price_check');
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0036 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

create or replace view v_price_check with (security_invoker = on) as
 WITH recipe_latest AS (
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
            cost_snapshots.floor_cost_per_portion,
            cost_snapshots.variant_id,
            cost_snapshots.resolved_qty,
            cost_snapshots.resolved_unit_id,
            cost_snapshots.basis_used,
            cost_snapshots.format_packaging_cost
           FROM cost_snapshots
          WHERE cost_snapshots.variant_id IS NULL
          ORDER BY cost_snapshots.recipe_id, cost_snapshots.computed_at DESC
        ), variant_latest AS (
         SELECT DISTINCT ON (cost_snapshots.variant_id) cost_snapshots.id,
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
            cost_snapshots.floor_cost_per_portion,
            cost_snapshots.variant_id,
            cost_snapshots.resolved_qty,
            cost_snapshots.resolved_unit_id,
            cost_snapshots.basis_used,
            cost_snapshots.format_packaging_cost
           FROM cost_snapshots
          WHERE cost_snapshots.variant_id IS NOT NULL
          ORDER BY cost_snapshots.variant_id, cost_snapshots.computed_at DESC
        ), rows AS (
         SELECT r.id AS recipe_id,
            r.business_id,
            r.account_id,
            r.name,
            rv.id AS variant_id,
            f.name AS format_name,
            vl.resolved_qty,
            COALESCE(vl.is_complete, false) AS is_complete,
            vl.required_inputs,
            vl.priced_inputs,
            vl.excluded_inputs,
            COALESCE(vl.unpriced_items, '[]'::jsonb) AS unpriced_items,
            vl.floor_cost_per_portion,
            vl.cost_per_portion
           FROM recipes r
             JOIN recipe_variants rv ON rv.recipe_id = r.id AND rv.is_active
             JOIN serving_formats f ON f.id = rv.format_id
             LEFT JOIN variant_latest vl ON vl.variant_id = rv.id
          WHERE r.kind = 'dish'::recipe_kind AND r.deleted_at IS NULL
        UNION ALL
         SELECT r.id,
            r.business_id,
            r.account_id,
            r.name,
            NULL::uuid AS uuid,
            NULL::text AS text,
            NULL::numeric AS "numeric",
            COALESCE(rl.is_complete, false) AS "coalesce",
            rl.required_inputs,
            rl.priced_inputs,
            rl.excluded_inputs,
            COALESCE(rl.unpriced_items, '[]'::jsonb) AS "coalesce",
            rl.floor_cost_per_portion,
            rl.cost_per_portion
           FROM recipes r
             LEFT JOIN recipe_latest rl ON rl.recipe_id = r.id
          WHERE r.kind = 'dish'::recipe_kind AND r.deleted_at IS NULL AND NOT (EXISTS ( SELECT 1
                   FROM recipe_variants rv
                  WHERE rv.recipe_id = r.id AND rv.is_active))
        )
 SELECT x.recipe_id,
    x.business_id,
    x.account_id,
    x.name,
    ch.id AS channel_id,
    ch.name AS channel_name,
    x.is_complete,
    x.required_inputs,
    x.priced_inputs,
    x.excluded_inputs,
    x.unpriced_items,
    x.floor_cost_per_portion AS cost_floor_per_portion,
    x.cost_per_portion,
    p.price AS selling_price,
        CASE
            WHEN x.is_complete AND p.price IS NOT NULL THEN round(p.price - x.cost_per_portion, 2)
            ELSE NULL::numeric
        END AS profit,
        CASE
            WHEN x.is_complete AND p.price IS NOT NULL AND p.price > 0::numeric THEN round(100.0 * (p.price - x.cost_per_portion) / p.price, 2)
            ELSE NULL::numeric
        END AS margin_pct,
        CASE
            WHEN x.is_complete AND x.cost_per_portion IS NOT NULL AND COALESCE(ch.target_margin, bs.default_target_margin) < 100::numeric THEN ceil(x.cost_per_portion / (1::numeric - COALESCE(ch.target_margin, bs.default_target_margin) / 100.0) / bs.price_rounding_to) * bs.price_rounding_to
            ELSE NULL::numeric
        END AS recommended_price,
    COALESCE(ch.target_margin, bs.default_target_margin) AS target_margin,
    bs.price_rounding_to,
    ch.commission_pct,
    x.variant_id,
    x.format_name,
    x.resolved_qty,
        CASE
            WHEN (x.is_complete AND (p.price IS NOT NULL) AND (x.cost_per_portion > (0)::numeric))
            THEN round(((100.0 * (p.price - x.cost_per_portion)) / x.cost_per_portion), 2)
            ELSE NULL::numeric
        END AS markup_pct
   FROM rows x
     JOIN business_settings bs ON bs.business_id = x.business_id
     LEFT JOIN channels ch ON ch.business_id = x.business_id AND ch.is_active
     LEFT JOIN LATERAL ( SELECT rp.price
           FROM recipe_prices rp
          WHERE rp.recipe_id = x.recipe_id AND (rp.channel_id IS NULL OR rp.channel_id = ch.id) AND (rp.variant_id IS NULL OR rp.variant_id = x.variant_id) AND rp.effective_from <= CURRENT_DATE
          ORDER BY (rp.variant_id IS NOT NULL) DESC, rp.effective_from DESC, rp.created_at DESC
         LIMIT 1) p ON true;

do $$
declare v_cols int; v_pol int;
begin
  select count(*) into v_cols from information_schema.columns where table_name = 'v_price_check';
  if v_cols <> 24 then
    raise exception '0036 self-check FAILED: v_price_check has % columns, expected 24.', v_cols;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'v_price_check' and column_name = 'markup_pct') then
    raise exception '0036 self-check FAILED: markup_pct was not added.';
  end if;
  if not exists (select 1 from pg_class
                  where relname = 'v_price_check'
                    and 'security_invoker=on' = any(reloptions)) then
    raise exception '0036 self-check FAILED: v_price_check lost security_invoker. '
                    'It would read across tenants.';
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0036 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0036 OK: markup_pct added, v_price_check has 24 columns, 116 policies unchanged.';
end
$$;
