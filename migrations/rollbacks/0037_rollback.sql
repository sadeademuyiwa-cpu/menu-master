-- Rollback for 0037. Restores the pre-0037 view definitions verbatim, WITH
-- security_invoker restated on each -- a replaced view silently loses it --
-- and drops the tie-breaker column. The ordering ambiguity returns with it.
begin;

create or replace view v_recipe_cost_current with (security_invoker = on) as
 SELECT DISTINCT ON (recipe_id) id,
    account_id,
    business_id,
    recipe_id,
    computed_at,
    costing_method,
    wavg_window_days,
    is_complete,
    required_inputs,
    priced_inputs,
    excluded_inputs,
    unpriced_items,
    ingredient_cost,
    packaging_cost,
    labour_cost,
    overhead_cost,
    batch_cost,
    cost_per_yield_unit,
    cost_per_portion,
    created_by
   FROM cost_snapshots
  ORDER BY recipe_id, computed_at DESC;

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
            WHEN x.is_complete AND p.price IS NOT NULL AND x.cost_per_portion > 0::numeric THEN round(100.0 * (p.price - x.cost_per_portion) / x.cost_per_portion, 2)
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

create or replace view v_costing_blockers with (security_invoker = on) as
 WITH latest AS (
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
 SELECT r.account_id,
    r.business_id,
    r.id AS recipe_id,
    r.name,
    s.required_inputs,
    s.priced_inputs,
    s.excluded_inputs,
    item.value ->> 'problem'::text AS problem,
    item.value ->> 'ingredient_name'::text AS ingredient_name,
    item.value ->> 'unit'::text AS unit_code,
    item.value AS item
   FROM recipes r
     JOIN latest s ON s.recipe_id = r.id
     CROSS JOIN LATERAL jsonb_array_elements(s.unpriced_items) item(value)
  WHERE NOT s.is_complete AND r.deleted_at IS NULL;

create or replace view v_gate2_cutover with (security_invoker = on) as
 WITH latest AS (
         SELECT DISTINCT ON (cost_snapshots.recipe_id) cost_snapshots.recipe_id,
            cost_snapshots.cost_per_portion,
            cost_snapshots.computed_at,
            cost_snapshots.is_complete
           FROM cost_snapshots
          ORDER BY cost_snapshots.recipe_id, cost_snapshots.computed_at DESC
        )
 SELECT rv.account_id,
    rv.business_id,
    rv.id AS variant_id,
    r.id AS recipe_id,
    r.name AS recipe_name,
    f.name AS format_name,
    rv.costing_basis,
    r.portion_qty AS legacy_portion_qty,
    fn_variant_resolved_qty(rv.id) AS resolved_qty,
    s.cost_per_portion AS legacy_cost_per_portion,
    fn_variant_cost(rv.id) AS variant_cost,
    pk.pack_cost AS format_packaging_cost,
    fn_variant_problem(rv.id) AS problem,
    bs.overhead_enabled,
        CASE
            WHEN s.cost_per_portion IS NULL AND fn_variant_cost(rv.id) IS NULL THEN 'BOTH INCOMPLETE'::text
            WHEN s.cost_per_portion IS NULL OR fn_variant_cost(rv.id) IS NULL THEN 'ONE SIDE INCOMPLETE'::text
            WHEN abs(s.cost_per_portion - (fn_variant_cost(rv.id) - pk.pack_cost)) <= 0.000001 THEN
            CASE
                WHEN pk.pack_cost > 0::numeric THEN 'MATCH -- plus new format packaging'::text
                ELSE 'MATCH'::text
            END
            WHEN bs.overhead_enabled THEN 'DIFFERS -- OVERHEAD METHODOLOGY CHANGED BY 0023 (expected)'::text
            ELSE 'MISMATCH'::text
        END AS verdict
   FROM recipe_variants rv
     JOIN recipes r ON r.id = rv.recipe_id
     JOIN serving_formats f ON f.id = rv.format_id
     JOIN business_settings bs ON bs.business_id = rv.business_id
     LEFT JOIN latest s ON s.recipe_id = r.id
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(spk.qty * fn_ingredient_usable_unit_cost(spk.packaging_item_id, rv.business_id)), 0::numeric) AS pack_cost
           FROM serving_format_packaging spk
          WHERE spk.format_id = rv.format_id AND spk.is_cost_bearing) pk
  WHERE r.deleted_at IS NULL;

alter table cost_snapshots drop column if exists seq;

commit;
