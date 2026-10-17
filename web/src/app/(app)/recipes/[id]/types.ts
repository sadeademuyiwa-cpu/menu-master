/** The rows the dish page reads, as PostgREST returns them (numerics as strings). */

export type Unit = { id: string; code: string; name: string; kind: string }

/**
 * One line of what goes into the dish. For the roles that may see costs it is
 * a v_recipe_line_costs row. For everyone else it is read from recipe_lines
 * and every cost field is null: v_recipe_line_costs raises for them
 * (fn_require_cost_access), and a quantity is not a cost.
 */
export type Line = {
  line_id: string
  ingredient_id: string | null
  sub_recipe_id: string | null
  item_name: string | null
  item_kind: 'ingredient' | 'packaging' | null
  is_cost_bearing: boolean
  recipe_qty: string
  recipe_unit: string | null
  /** Only on the plain read; the costed view gives the unit's code. */
  unit_id?: string | null
  base_unit: string | null
  base_qty: string | null
  unit_cost: string | null
  line_cost: string | null
  purchase_qty_base: string | null
  purchase_amount: string | null
  purchase_date: string | null
  purchase_count: number | null
  cost_basis: string | null
  /** Null on the plain read: whether a line is costed is cost information. */
  problem: 'ok' | 'missing_price' | 'missing_conversion' | 'excluded' | 'sub_recipe' | null
}

/**
 * One entry of cost_snapshots.unpriced_items: a thing that stops the cost.
 * A size's own problem (0046, fn_compute_variant_cost_snapshot) carries its
 * variant_id; the dish's own entries never do.
 */
export type UnpricedItem = {
  problem?: string | null
  ingredient_name?: string | null
  unit?: string | null
  variant_id?: string | null
}

/** The dish's OWN cost snapshot (variant_id null), not a size's. */
export type Snapshot = {
  is_complete: boolean
  unpriced_items: UnpricedItem[] | null
  required_inputs: number; priced_inputs: number; excluded_inputs: number
  ingredient_cost: string | null; packaging_cost: string | null
  labour_cost: string | null; overhead_cost: string | null
  batch_cost: string | null; cost_per_yield_unit: string | null; cost_per_portion: string | null
}

export type PriceCheck = {
  recipe_id: string; is_complete: boolean
  selling_price: string | null; profit: string | null
  margin_pct: string | null; recommended_price: string | null; target_margin: string | null
  markup_pct: string | null
  variant_id: string | null; format_name: string | null; resolved_qty: string | null
  cost_per_portion: string | null
}

export type Blocker = { problem: string; ingredient_name: string | null; unit_code: string | null; item: string | null }

/**
 * What stops the dish's own cost, from its own snapshot. v_costing_blockers
 * is not used: it reads the newest snapshot of any kind, and for a dish sold
 * in sizes that is usually the last size's, so one size's missing packaging
 * price would read as the whole dish blocked. A size's own problem is left to
 * that size's row, which v_price_check marks on its own.
 */
export function dishBlockers(s: Pick<Snapshot, 'is_complete' | 'unpriced_items'> | null | undefined): Blocker[] {
  if (!s || s.is_complete) return []
  return (s.unpriced_items ?? []).flatMap((x) => x && !x.variant_id && x.problem
    ? [{ problem: x.problem, ingredient_name: x.ingredient_name ?? null, unit_code: x.unit ?? null, item: null }]
    : [])
}

export type Settings = {
  default_target_margin: string | null
  overhead_enabled: boolean
  price_rounding_to: string | null
  show_markup_alongside: boolean
}

export type MenuPrice = { recipe_id: string; variant_id: string | null; selling_price: string | null }

export type Format = { id: string; name: string; capacity_qty: string | null; capacity_unit: { code: string } | null }

export type Variant = { id: string; is_active: boolean; format: Format | null }

/** rate_per_hour is read only for the roles that may see costs. */
export type LabourLine = {
  id: string
  hours: string
  rate: { id: string; name: string; rate_per_hour?: string | null } | null
}

export const n = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v)
