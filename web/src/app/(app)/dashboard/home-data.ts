/**
 * Home's arithmetic, kept apart from the page so each rule can be tested on
 * its own. No React, no Next, no '@/' imports.
 *
 * Every figure here comes from a view PostgreSQL already worked out
 * (v_sales_summary, v_product_attention, fn_menu_prices,
 * v_product_performance). Nothing is re-derived: these only add up days,
 * group rows and choose which figure a card shows.
 *
 * GOVERNING RULE: a missing figure stays missing. A week with no sales has
 * no total (null), not ₦0; a dish with no price has no price, not ₦0.
 */

/** A figure from PostgREST (numeric arrives as a string) as a number, or null. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// THE WEEK
// ---------------------------------------------------------------------------

/** One trading day of v_sales_summary. Kept columns are absent for a role
 *  that may not see costs: the page never asks for them. */
export type SalesDay = {
  sale_date: string
  sale_count: number
  revenue: string | null
  gross_profit?: string | null
  revenue_without_cost?: string | null
}

/** YYYY-MM-DD, n days before a YYYY-MM-DD. Calendar arithmetic, no time zone. */
export function daysBefore(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Mon" for a YYYY-MM-DD. The date is a calendar day, so no time zone applies. */
export function weekday(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export type WeekTotal = {
  /** Sales recorded in the run of days. */
  sales: number
  /** Money in. Null when nothing was sold: "no sales yet", never ₦0. */
  sold: number | null
  /** What was kept, over the sales whose cost is known. Null when no sale in
   *  the run has a known cost. */
  kept: number | null
  /** Some money in the run came from sales with no known cost, so `kept`
   *  covers only part of it. */
  partly: boolean
}

/** Sold and kept over a run of days, added up from the view's own per-day figures. */
export function sumDays(days: SalesDay[], from: string, to: string): WeekTotal {
  const inRange = days.filter((d) => d.sale_date >= from && d.sale_date <= to)
  const sold = inRange.map((d) => num(d.revenue)).filter((n): n is number => n !== null)
  const kept = inRange.map((d) => num(d.gross_profit)).filter((n): n is number => n !== null)
  return {
    sales: inRange.reduce((t, d) => t + (d.sale_count ?? 0), 0),
    sold: sold.length ? round2(sold.reduce((t, n) => t + n, 0)) : null,
    kept: kept.length ? round2(kept.reduce((t, n) => t + n, 0)) : null,
    partly: inRange.some((d) => (num(d.revenue_without_cost) ?? 0) > 0),
  }
}

/** To the kobo, so a sum of 0.1 + 0.2 reads ₦0.30. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type ChartDay = { label: string; sold: number | null; kept: number | null }

/**
 * The seven days ending today, oldest first, as the charts take them. A day
 * with no sales has sold null. Kept is null when the day's cost is not known
 * -- or, with `withKept` false, for every day, for a role that may not see
 * costs (the sold-only chart draws no kept series at all).
 */
export function lastSevenDays(days: SalesDay[], today: string, withKept: boolean): ChartDay[] {
  const byDate = new Map(days.map((d) => [d.sale_date, d]))
  return Array.from({ length: 7 }, (_, i) => {
    const date = daysBefore(today, 6 - i)
    const row = byDate.get(date)
    return {
      label: weekday(date),
      sold: row ? num(row.revenue) : null,
      kept: row && withKept ? num(row.gross_profit) : null,
    }
  })
}

export type Trend = { dir: 'up' | 'down' | 'same'; pct: number }

/**
 * This week against last, as "↑ 12%", "↓ 8%" or "same". Null when there is
 * nothing fair to compare with: a figure missing on either side, or a last
 * week at or below zero, where a percentage means nothing.
 */
export function trend(now: number | null, before: number | null): Trend | null {
  if (now === null || before === null || before <= 0) return null
  const pct = ((now - before) / before) * 100
  const whole = Math.round(Math.abs(pct))
  if (whole === 0) return { dir: 'same', pct: 0 }
  return { dir: pct > 0 ? 'up' : 'down', pct: whole }
}

// ---------------------------------------------------------------------------
// DISHES
// ---------------------------------------------------------------------------

/** One sellable row of v_product_attention: a dish, or a dish in one size. */
export type ProductRow = {
  recipe_id: string
  variant_id: string | null
  product_name: string
  format_name: string | null
  profit: string | null
  recommended_price: string | null
  target_margin: string | null
  state: string
  attention_rank: number
}

const keyOf = (r: { recipe_id: string; variant_id: string | null }) => `${r.recipe_id}:${r.variant_id ?? ''}`

/**
 * One row per dish-and-size. With several sales channels the view repeats a
 * row per channel; the first is kept, which in attention order is the worst.
 */
export function uniqueRows<T extends { recipe_id: string; variant_id: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = keyOf(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Rows grouped by dish, in the order the dishes first appear. */
export function byDish<T extends { recipe_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) out.set(r.recipe_id, [...(out.get(r.recipe_id) ?? []), r])
  return out
}

export type NeedGroup = { recipeId: string; name: string; rows: ProductRow[] }

/**
 * "Needs you": the dishes losing money, under target or ready but not
 * priced (attention_rank 1-3), worst first, one entry per dish so a dish sold
 * in two sizes is one row with one fix. Rows must arrive in attention order.
 */
export function needGroups(rows: ProductRow[]): NeedGroup[] {
  const needing = uniqueRows(rows).filter((r) => r.attention_rank <= 3)
  return [...byDish(needing).values()].map((g) => ({ recipeId: g[0].recipe_id, name: g[0].product_name, rows: g }))
}

export type Dish = { id: string; name: string; photo_path: string | null }

/**
 * Home's grid order: the dish that most needs her first, then by name. A
 * dish the view has no row for (a role that reads no costs) sorts by name.
 */
export function orderDishes(dishes: Dish[], rowsOf: Map<string, ProductRow[]>): Dish[] {
  const rank = (id: string) => Math.min(6, ...(rowsOf.get(id) ?? []).map((r) => r.attention_rank))
  return [...dishes].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
}

/** A dish's one figure for a role that sees costs. */
export type KeepFigure =
  | { kind: 'keep'; amount: number }
  | { kind: 'lose'; amount: number }
  | { kind: 'sizes'; count: number }
  | { kind: 'no_price' }
  | { kind: 'no_cost' }

/**
 * "you keep ₦1,160" for a dish sold one way. A dish in sizes says how many
 * sizes, and its page shows each: two figures would not fit a card, and
 * one would hide the other.
 */
export function keepFigure(rows: ProductRow[]): KeepFigure {
  if (rows.length > 1) return { kind: 'sizes', count: rows.length }
  const r = rows[0]
  if (!r || r.state === 'costing_incomplete') return { kind: 'no_cost' }
  if (r.state === 'no_price_yet') return { kind: 'no_price' }
  const profit = num(r.profit)
  if (profit === null) return { kind: 'no_cost' }
  return profit < 0 ? { kind: 'lose', amount: -profit } : { kind: 'keep', amount: profit }
}

/** The worst state among a dish's sizes: what its dot shows. Rows arrive worst first. */
export function worstState(rows: ProductRow[]): string | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => a.attention_rank - b.attention_rank)[0].state
}

/** One row of fn_menu_prices (0064). */
export type MenuPriceRow = { recipe_id: string; variant_id: string | null; selling_price: string | number | null }

export type PriceFigure = { kind: 'none' } | { kind: 'one'; price: number } | { kind: 'from'; price: number }

/**
 * What a dish sells for, for the sales role: its price, or "from" its lowest
 * size price when the sizes differ. No price recorded stays "no price yet".
 */
export function priceFigure(rows: MenuPriceRow[]): PriceFigure {
  const prices = uniqueRows(rows).map((r) => num(r.selling_price)).filter((n): n is number => n !== null)
  if (prices.length === 0) return { kind: 'none' }
  const low = Math.min(...prices)
  return prices.every((p) => p === low) ? { kind: 'one', price: low } : { kind: 'from', price: low }
}

/**
 * The best sellers, by plates (or pots, or packs) sold, all sizes together.
 * Units, never money: kitchen sees this list, and money in would tell them
 * what a dish sells for.
 */
export function bestSellers(rows: { recipe_id: string | null; units_sold: string | number | null }[], n = 3): string[] {
  const units = new Map<string, number>()
  for (const r of rows) {
    const u = num(r.units_sold)
    if (!r.recipe_id || u === null || u <= 0) continue
    units.set(r.recipe_id, (units.get(r.recipe_id) ?? 0) + u)
  }
  return [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id)
}
