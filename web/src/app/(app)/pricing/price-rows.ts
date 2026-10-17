/**
 * The Prices table's rows, kept free of React, Next and '@/' imports so each
 * rule can be tested on its own.
 *
 * Every figure comes from v_price_check (0037) as PostgreSQL worked it out:
 * the cost, the price, what one portion keeps and the suggested price. The
 * only thing decided here is the row's state, and it is the SAME rule as
 * v_product_attention's CASE (the view built on v_price_check), so a size
 * reads the same here as on Home and on Dishes:
 *
 *   not complete               costing_incomplete
 *   no selling price           no_price_yet
 *   keeps less than nothing    losing_money
 *   margin under the target    below_target
 *   otherwise                  healthy
 *
 * GOVERNING RULE: a missing figure stays missing (null), never 0.
 */

export type PriceCheckRow = {
  recipe_id: string
  name: string
  variant_id: string | null
  format_name: string | null
  channel_id: string | null
  channel_name: string | null
  is_complete: boolean
  cost_per_portion: string | number | null
  selling_price: string | number | null
  profit: string | number | null
  margin_pct: string | number | null
  recommended_price: string | number | null
  target_margin: string | number | null
  commission_pct: string | number | null
}

export type PriceState = 'costing_incomplete' | 'no_price_yet' | 'losing_money' | 'below_target' | 'healthy'

/** A figure from PostgREST (numeric arrives as a string) as a number, or null. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * v_product_attention's state for one row. Its SQL compares with NULLs, and a
 * comparison with a NULL is not true, so a missing margin or target falls
 * through to healthy there; it does here too.
 */
export function priceState(r: Pick<PriceCheckRow, 'is_complete' | 'selling_price' | 'profit' | 'margin_pct' | 'target_margin'>): PriceState {
  if (!r.is_complete) return 'costing_incomplete'
  if (num(r.selling_price) === null) return 'no_price_yet'
  const profit = num(r.profit)
  if (profit !== null && profit < 0) return 'losing_money'
  const margin = num(r.margin_pct)
  const target = num(r.target_margin)
  if (margin !== null && target !== null && margin < target) return 'below_target'
  return 'healthy'
}

export type PriceRow = PriceCheckRow & { state: PriceState; key: string; label: string }

/**
 * One row per dish-and-size. With one sales channel -- every business today
 * -- that is one row each; with several, each channel keeps its own row and
 * its name, because a price can differ by channel.
 */
export function priceRows(rows: PriceCheckRow[]): PriceRow[] {
  const channels = new Set(rows.map((r) => r.channel_id ?? ''))
  const several = channels.size > 1
  const seen = new Set<string>()
  const out: PriceRow[] = []
  for (const r of rows) {
    const key = `${r.recipe_id}:${r.variant_id ?? ''}${several ? `:${r.channel_id ?? ''}` : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const parts = [r.format_name, several ? r.channel_name : null].filter(Boolean)
    out.push({ ...r, state: priceState(r), key, label: parts.length ? `${r.name}, ${parts.join(', ')}` : r.name })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || (a.format_name ?? '').localeCompare(b.format_name ?? ''))
}

export type PriceFilter = '' | 'low' | 'none'

/** Below target (a loss counts), and no price yet: the two the chips pick out. */
export function inFilter(r: { state: PriceState }, f: PriceFilter): boolean {
  if (f === 'low') return r.state === 'losing_money' || r.state === 'below_target'
  if (f === 'none') return r.state === 'no_price_yet'
  return true
}

/** A suggested price is offered only where it helps: under target, at a loss, or not priced yet. */
export function offersPrice(r: { state: PriceState; recommended_price: string | number | null }): number | null {
  if (r.state !== 'losing_money' && r.state !== 'below_target' && r.state !== 'no_price_yet') return null
  const p = num(r.recommended_price)
  return p !== null && p > 0 ? p : null
}

/** The one target every row shares, or null when channels set different ones. */
export function sharedTarget(rows: { target_margin: string | number | null }[]): number | null {
  const targets = new Set(rows.map((r) => num(r.target_margin)).filter((n): n is number => n !== null))
  return targets.size === 1 ? [...targets][0] : null
}
