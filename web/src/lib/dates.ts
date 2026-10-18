/**
 * "Today", as the owner's calendar says it.
 *
 * Kept free of React and Next so it is tested directly.
 *
 * WHY THIS EXISTS
 *   Dates were defaulted with new Date().toISOString().slice(0, 10), which is
 *   the date in UTC. Lagos is UTC+1, so between midnight and 1 am every new
 *   sale and purchase was dated yesterday, and "Sold today" looked for the
 *   wrong day.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Lagos'

/** YYYY-MM-DD in the business's time zone. */
export function localToday(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * The day something was paid, as typed: '' is today; otherwise a real
 * YYYY-MM-DD that is not after today. null for anything else. A purchase
 * dated next month has not happened, and costing (as of today) would skip it
 * while the screen said "recorded"; 2026-02-30 would reach the database as a
 * raw error.
 */
export function paidDay(
  raw: string | null | undefined,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): string | null {
  const t = String(raw ?? '').trim()
  const today = localToday(now, timeZone)
  if (t === '') return today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, m, d] = t.split('-').map(Number)
  const real = new Date(Date.UTC(y, m - 1, d))
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) return null
  return t <= today ? t : null
}

/**
 * A date the way the owner would say it: "Today", "Yesterday", "11 Oct 2026".
 *
 * WHY THIS EXISTS
 *   Lists showed the database's own `2026-10-11`. Nobody writes a date that
 *   way on a receipt or in a notebook, and on a 360px phone it reads as a
 *   code. One helper, used by every list, so no page can fall back to ISO.
 *
 * Accepts a bare YYYY-MM-DD (a sale or purchase date -- no time zone, taken as
 * a calendar day) or a full timestamp (taken in the business's time zone).
 * Returns '' for nothing, so a caller can join it with ' · ' and lose nothing.
 */
export function formatDay(
  iso: string | null | undefined,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const day = calendarDay(iso, timeZone)
  if (!day) return ''
  const today = localToday(now, timeZone)
  if (day === today) return 'Today'
  if (day === localToday(new Date(now.getTime() - 86_400_000), timeZone)) return 'Yesterday'
  return dayWords(day)
}

/**
 * "11 Oct 2026, 14:05" for a timestamp; '' for nothing. The day is always
 * spelled out: a moment is a record of when, and "Today, 14:05" would change
 * meaning tomorrow.
 */
export function formatMoment(
  iso: string | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(t)
  return `${dayWords(localToday(t, timeZone))}, ${time}`
}

/** "11 Oct 2026" from YYYY-MM-DD. */
function dayWords(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const words = new Intl.DateTimeFormat('en-NG', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
  // en-NG gives "11 Oct 2026" already; the replace guards against a runtime
  // that inserts a comma ("11 Oct, 2026").
  return words.replace(',', '')
}

/** The YYYY-MM-DD a value falls on, or null when it is not a date at all. */
function calendarDay(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return localToday(t, timeZone)
}
