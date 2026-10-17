/**
 * The small sums the buying screens draw: a month's spend, spend by week,
 * purchases by day, and "Rice up 8% since September".
 *
 * Kept free of React, Next and the '@/' alias, so node --test can load it
 * straight from its path (tests/*.test.mts import with a .ts extension).
 *
 * GOVERNING RULE: a missing figure stays missing. A week with nothing
 * recorded is a gap (null), never ₦0, because a week with no purchase on
 * record is not a week she spent nothing. No price is ever guessed here: every
 * figure in comes from her own purchases.
 */

type Figure = number | string | null | undefined

/** A figure as kobo, or null. Amounts are numeric(14,2), so kobo are exact. */
function kobo(v: Figure): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/**
 * The sum of some amounts of money, added in whole kobo so 0.1 + 0.2 is
 * exactly ₦0.30. Null when none of them is known: nothing recorded is not ₦0.
 * Unknown amounts are left out of the sum, so pass only amounts that belong in
 * it (recorded purchases, not drafts or cancelled ones).
 */
export function sumMoney(values: Figure[]): number | null {
  let total = 0
  let any = false
  for (const v of values) {
    const k = kobo(v)
    if (k === null) continue
    total += k
    any = true
  }
  return any ? total / 100 : null
}

/** YYYY-MM-DD to a UTC date at midnight, or null. */
function utc(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The Monday of the week a calendar day falls in. Market weeks start on Monday. */
export function weekStart(day: string): string {
  const d = utc(day)
  if (!d) return day
  const back = (d.getUTCDay() + 6) % 7 // Monday 0 ... Sunday 6
  d.setUTCDate(d.getUTCDate() - back)
  return iso(d)
}

/** The Mondays of the last n weeks, oldest first, ending with this week's. */
export function lastWeeks(today: string, n: number): string[] {
  const start = utc(weekStart(today))
  if (!start || n <= 0) return []
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() - 7 * (n - 1 - i))
    return iso(d)
  })
}

/** The first day of the month a calendar day falls in. */
export function monthStart(day: string): string {
  return /^\d{4}-\d{2}/.test(day) ? `${day.slice(0, 7)}-01` : day
}

/**
 * Spend in each of the last n weeks, oldest first. A week with no recorded
 * purchase is null: a gap in the line, not a drop to zero.
 */
export function spendByWeek(
  rows: { date: string; amount: Figure }[],
  today: string,
  n: number,
): (number | null)[] {
  const weeks = lastWeeks(today, n)
  const byWeek = new Map<string, Figure[]>()
  for (const r of rows) {
    const w = weekStart(r.date)
    if (!weeks.includes(w)) continue
    byWeek.set(w, [...(byWeek.get(w) ?? []), r.amount])
  }
  return weeks.map((w) => sumMoney(byWeek.get(w) ?? []))
}

/** Rows that are already newest first, gathered under their day in the same order. */
export function groupByDay<T extends { purchase_date: string }>(rows: T[]): { day: string; rows: T[] }[] {
  const groups: { day: string; rows: T[] }[] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.day === r.purchase_date) last.rows.push(r)
    else groups.push({ day: r.purchase_date, rows: [r] })
  }
  return groups
}

/**
 * How a price moved across the purchases given (oldest first): the change
 * from the first known price to the last, in percent, and the day of the
 * first. Null with fewer than three known prices, because two purchases are
 * not a trend, and null when the first price is not above zero.
 */
export function priceTrend(points: { day: string; price: number | null }[]): { change: number; since: string } | null {
  const known = points.filter((p): p is { day: string; price: number } =>
    typeof p.price === 'number' && Number.isFinite(p.price))
  if (known.length < 3) return null
  const first = known[0]
  const last = known[known.length - 1]
  if (first.price <= 0) return null
  return { change: ((last.price - first.price) / first.price) * 100, since: first.day }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "since ..." the way she would say it: "4 Oct" within this month,
 * "September" earlier this year, "September 2025" before that.
 */
export function sinceWords(day: string, today: string): string {
  const d = utc(day)
  const t = utc(today)
  if (!d || !t) return day
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (y === t.getUTCFullYear() && m === t.getUTCMonth()) return `${d.getUTCDate()} ${SHORT[m]}`
  if (y === t.getUTCFullYear()) return MONTHS[m]
  return `${MONTHS[m]} ${y}`
}

/**
 * The words for a trend: "up 8%", "down 5%", or "steady" when it moved
 * less than half a percent. `pct` formats the size of the change.
 */
export function trendWords(change: number, pct: (n: number) => string): string {
  if (Math.abs(change) < 0.5) return 'steady'
  return `${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))}`
}

/**
 * A price per base unit said the way the item is bought: per kg for grams,
 * per litre for millilitres, each for pieces. The factors are exact unit
 * definitions within one kind of measure, not a conversion of this item.
 */
export function perBuyingUnit(unitCost: number, baseCode: string | null | undefined): { value: number; per: string } {
  if (baseCode === 'g') return { value: unitCost * 1000, per: 'per kg' }
  if (baseCode === 'ml') return { value: unitCost * 1000, per: 'per litre' }
  if (baseCode === 'unit') return { value: unitCost, per: 'each' }
  return { value: unitCost, per: `per ${baseCode ?? 'unit'}` }
}

/**
 * Names on one line: "Rice, Tomato and Pepper", "Rice, Tomato, Pepper and 4
 * more". Repeated names are said once.
 */
export function nameList(names: string[], show = 3): string {
  const seen = [...new Set(names.filter(Boolean))]
  if (seen.length === 0) return ''
  if (seen.length === 1) return seen[0]
  if (seen.length <= show) return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`
  return `${seen.slice(0, show).join(', ')} and ${seen.length - show} more`
}

/** "12 Oct": a day said short, for chart labels, never "Today". */
export function dayShort(day: string): string {
  const d = utc(day)
  return d ? `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}` : day
}

/** A day from formatDay placed inside a sentence: "put away today", "bought 30 Sep 2026". */
export function inSentence(formatted: string): string {
  return formatted === 'Today' || formatted === 'Yesterday' ? formatted.toLowerCase() : formatted
}
