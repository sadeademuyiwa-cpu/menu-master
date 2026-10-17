/**
 * Reports' arithmetic on dates and rows, kept free of React, Next and '@/'
 * imports so each rule can be tested on its own.
 *
 * Every money figure comes from a view PostgreSQL already worked out
 * (v_sales_summary by day, v_profit_by_period by month, v_profit_by_product
 * by dish). Nothing is re-derived here: these choose the month, lay its days
 * out and order the dishes.
 *
 * GOVERNING RULE: a missing figure stays missing. A day with no sales has no
 * bar; a day whose cost is not known has a dashed one; never a zero.
 */

/** A figure from PostgREST (numeric arrives as a string) as a number, or null. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** "2026-10" from "2026-10-17". */
export function monthOf(day: string): string {
  return day.slice(0, 7)
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** The month asked for in the address, if it is a real one and not in the future; else `fallback`. */
export function pickMonth(raw: string | null | undefined, fallback: string): string {
  return typeof raw === 'string' && MONTH_RE.test(raw) && raw <= fallback ? raw : fallback
}

/** First and last calendar day of a month, and how many days it has. */
export function monthRange(month: string): { start: string; end: string; days: number } {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, '0')}`, days }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

/** "October", or "October 2025" when it is not this year. */
export function monthName(month: string, thisMonth: string): string {
  const [y, m] = month.split('-').map(Number)
  const name = MONTHS[m - 1] ?? month
  return month.slice(0, 4) === thisMonth.slice(0, 4) ? name : `${name} ${y}`
}

/**
 * The months to offer as chips: this month, then the most recent months that
 * had sales, newest first, at most `max`.
 */
export function monthChoices(periods: string[], thisMonth: string, max = 3): string[] {
  const seen = new Set<string>([thisMonth])
  const out = [thisMonth]
  for (const p of periods.map(monthOf).sort().reverse()) {
    if (out.length >= max) break
    if (p > thisMonth || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** One trading day of v_sales_summary, with only the columns the role may read. */
export type DayRow = {
  sale_date: string
  sale_count: number | null
  revenue?: string | number | null
  gross_profit?: string | number | null
}

export type MonthDay = { day: number; date: string; sold: number | null; kept: number | null }

/**
 * Every day of the month in order, so the chart keeps one scale and shows how
 * far the month has got. A day with no row has sold null (no bar). Kept is
 * null when the day's cost is not known -- or, with `withKept` false, on every
 * day, for a role that may not see costs (the chart then draws no kept series).
 */
export function monthDays(rows: DayRow[], month: string, withKept: boolean): MonthDay[] {
  const { days } = monthRange(month)
  const byDate = new Map(rows.map((r) => [r.sale_date, r]))
  return Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    const r = byDate.get(date)
    return { day: i + 1, date, sold: r ? num(r.revenue) : null, kept: r && withKept ? num(r.gross_profit) : null }
  })
}

/** Sales recorded over the days given: a count, never money, so any role may see it. */
export function saleCount(rows: DayRow[]): number {
  return rows.reduce((t, r) => t + (r.sale_count ?? 0), 0)
}

export type DishBar = { id: string; name: string; value: number | null }

/**
 * The dishes as bars, biggest first, at most `max`. A dish whose figure is
 * not known yet goes last, so the bars that can be compared sit together.
 */
export function dishBars(rows: DishBar[], max = 8): DishBar[] {
  return [...rows]
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.name.localeCompare(b.name))
    .slice(0, max)
}

/** How much of the money in had a known cost: every sale, none of them, or some. */
export type Coverage = 'all' | 'none' | 'part'

/**
 * Which of the three a month (or a dish) is, read from the money and never
 * from the percentage. The views round cost_coverage_pct to two places, so a
 * month with ₦10 uncosted out of ₦250,000 arrives as 100.00, and one with a
 * sliver of cost as 0.00; deciding on that figure made the page say "Every
 * sale had a known cost" beside money with no cost.
 *
 * `kept` is gross_profit, which the views leave null exactly when no sale
 * had a cost. `uncosted` is the money with no known cost (null when not
 * read); without it the percentage is all there is, and a missing one is
 * never taken as complete.
 */
export function coverageOf(kept: number | null, uncosted: number | null, pct: number | null): Coverage {
  if (kept === null) return 'none'
  if (uncosted !== null) return uncosted > 0 ? 'part' : 'all'
  return pct !== null && pct >= 100 ? 'all' : 'part'
}

/**
 * The coverage percentage in words that agree with coverageOf: 100% only when
 * every sale had a cost, 0% only when none did. In between, rounding never
 * reaches either end -- 99.6 is "99%", 0.04 is "under 1%" -- so a sentence
 * cannot say "100%" and then name money with no cost.
 */
export function coveragePercent(pct: number | null, coverage: Coverage, absent: string): string {
  if (pct === null) return absent
  if (coverage === 'all') return '100%'
  if (coverage === 'none') return '0%'
  if (pct > 99) return '99%'
  if (pct < 1) return 'under 1%'
  return `${Math.round(pct)}%`
}

/** "99% of revenue has a verified cost", for a row of the figures. */
export function coverageNote(pct: number | null, coverage: Coverage): string {
  return pct === null ? 'coverage unknown' : `${coveragePercent(pct, coverage, '')} of revenue has a verified cost`
}
