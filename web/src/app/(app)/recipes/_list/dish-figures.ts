/**
 * The Dishes list's one figure per dish, its coloured dot and its filter.
 *
 * Kept free of React, Next and '@/' imports so each rule can be tested on its
 * own. Nothing here works a figure out: the states, profits and prices all
 * come from the database (v_product_attention for the roles that see costs,
 * fn_menu_prices for sales, 0064). This only chooses which figure a row shows.
 *
 * GOVERNING RULE: a missing figure stays missing. A dish with no price says
 * "No price yet", one whose cost is not complete says so; neither is ever ₦0.
 */

/** A figure from PostgREST (numeric arrives as a string) as a number, or null. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** One sellable row of v_product_attention: a dish, or a dish in one size. */
export type AttentionRow = {
  recipe_id: string
  variant_id: string | null
  profit: string | number | null
  state: string
  attention_rank: number
}

/** One row of fn_menu_prices (0064). */
export type MenuPriceRow = {
  recipe_id: string
  variant_id: string | null
  selling_price: string | number | null
}

const keyOf = (r: { recipe_id: string; variant_id: string | null }) => `${r.recipe_id}:${r.variant_id ?? ''}`

/**
 * Rows grouped by dish, one per dish-and-size. With several sales channels
 * the views repeat a row per channel; sorted by attention first, the row kept
 * is the worst, so a dish is never shown healthier than it is.
 */
export function rowsByDish<T extends { recipe_id: string; variant_id: string | null; attention_rank?: number }>(
  rows: T[],
): Map<string, T[]> {
  const seen = new Set<string>()
  const out = new Map<string, T[]>()
  const ordered = [...rows].sort((a, b) => (a.attention_rank ?? 0) - (b.attention_rank ?? 0))
  for (const r of ordered) {
    const k = keyOf(r)
    if (seen.has(k)) continue
    seen.add(k)
    out.set(r.recipe_id, [...(out.get(r.recipe_id) ?? []), r])
  }
  return out
}

export type Tone = 'good' | 'warn' | 'bad' | 'muted'

/**
 * The dot's colour and what it means, for a screen reader and a long press.
 * Not finished is not wrong: a missing price or cost is an empty ring, never
 * amber or red (the same rule as productState in lib/format).
 */
export function stateDot(state: string | null | undefined): { tone: Tone; label: string } {
  switch (state) {
    case 'healthy':      return { tone: 'good', label: 'At or above your target' }
    case 'below_target': return { tone: 'warn', label: 'Below your target' }
    case 'losing_money': return { tone: 'bad', label: 'Selling for less than it costs' }
    case 'no_price_yet': return { tone: 'muted', label: 'No price yet' }
    default:             return { tone: 'muted', label: 'Cost incomplete' }
  }
}

/** The worst state among a dish's sizes: what its dot shows. */
export function worstState(rows: AttentionRow[]): string | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => a.attention_rank - b.attention_rank)[0].state
}

/** A dish's one figure, for a role that sees costs. */
export type KeepFigure =
  | { kind: 'keep'; amount: number }
  | { kind: 'lose'; amount: number }
  | { kind: 'sizes'; count: number }
  | { kind: 'no_price' }
  | { kind: 'no_cost' }

/**
 * "you keep ₦1,160" for a dish sold one way. A dish in sizes says how many,
 * and the dish page and Prices show each: two figures would not fit a row,
 * and one would hide the other.
 */
export function keepFigure(rows: AttentionRow[]): KeepFigure {
  if (rows.length > 1) return { kind: 'sizes', count: rows.length }
  const r = rows[0]
  if (!r || r.state === 'costing_incomplete') return { kind: 'no_cost' }
  if (r.state === 'no_price_yet') return { kind: 'no_price' }
  const profit = num(r.profit)
  if (profit === null) return { kind: 'no_cost' }
  return profit < 0 ? { kind: 'lose', amount: -profit } : { kind: 'keep', amount: profit }
}

export type DishGroup = 'ready' | 'attention'

/**
 * Which filter chip a dish falls under. Ready: every size at or above the
 * target. Needs attention: anything else a customer can buy -- a loss, under
 * target, no price, or a cost still missing figures. A part made for other
 * dishes (kind sub_recipe) is in neither; it is only under All.
 */
export function dishGroup(rows: AttentionRow[], kind: string | null | undefined): DishGroup | null {
  if (kind === 'sub_recipe' && rows.length === 0) return null
  return rows.length > 0 && rows.every((r) => r.state === 'healthy') ? 'ready' : 'attention'
}

export type PriceFigure = { kind: 'none' } | { kind: 'one'; price: number } | { kind: 'from'; price: number }

/**
 * What a dish sells for, for the sales role: its price, or "from" its lowest
 * size price when the sizes differ. No price recorded stays "no price yet".
 */
export function priceFigure(rows: MenuPriceRow[]): PriceFigure {
  const prices = rows.map((r) => num(r.selling_price)).filter((n): n is number => n !== null)
  if (prices.length === 0) return { kind: 'none' }
  const low = Math.min(...prices)
  return prices.every((p) => p === low) ? { kind: 'one', price: low } : { kind: 'from', price: low }
}
