/**
 * Words and shapes for the admin pages. Pure: no React, no Next, no
 * Supabase, so every rule is testable on its own. The database decides every
 * figure; this only chooses how to say it.
 */
// The same word lib/format uses for an absent value. Spelled here rather than
// imported so this module stays runnable under node --test, which cannot
// resolve the @/ alias.
const NOT_ENTERED = 'not entered'

export type Severity = 'info' | 'warn' | 'critical'

export type AlertRow = {
  id: string
  kind: string
  severity: Severity
  subject: string
  summary: string
  detail: Record<string, unknown>
  first_seen: string
  last_seen: string
  resolved_at: string | null
  resolved_by: string | null
  resolution: string | null
  notified_at: string | null
}

const KIND_WORDS: Record<string, string> = {
  billing_failed_permanent: 'Billing event failed permanently',
  billing_stuck: 'Billing event stuck',
  founder_slots_low: 'Founding slots running low',
  founder_slots_exhausted: 'Founding slots exhausted',
  past_due_beyond_grace: 'Past due beyond grace',
  subscription_no_period: 'Subscription without a period end',
  subscription_not_switched_off: 'Old Paystack subscription not switched off',
  superseded_subscription_charged: 'Replaced subscription took a payment (refund it)',
  cancel_not_confirmed: 'Cancel not confirmed by Paystack',
  possible_double_charge: 'Possible double charge',
}

export function alertWords(kind: string): string {
  return KIND_WORDS[kind] ?? kind.replace(/_/g, ' ')
}

// What the admin does about each kind, one line under its group on Alerts.
// The scan closes a condition-based alert itself once the condition clears.
const KIND_ACTIONS: Record<string, string> = {
  billing_failed_permanent: 'Paystack told us about a payment we could not match to an account. Look the reference up in Paystack, check that customer can use the app, then resolve it here.',
  billing_stuck: 'An event has waited over 15 minutes or failed 3 times. Check the webhook is being processed.',
  founder_slots_low: 'Ten or fewer founding places are left. Decide what happens to the founding offer.',
  founder_slots_exhausted: 'Every founding place is taken. Change the pricing words that promise one.',
  past_due_beyond_grace: 'This paying owner is locked out. Contact them about the payment.',
  subscription_no_period: 'A subscription has no paid-until date. Fix the record.',
  subscription_not_switched_off: 'Switch the old subscription off in Paystack so it cannot charge again.',
  superseded_subscription_charged: 'A replaced subscription took a payment. Refund it in Paystack.',
  cancel_not_confirmed: 'Check Paystack and this account’s billing events.',
  possible_double_charge: 'Check Paystack, and refund if the second charge was not meant.',
}

export function alertAction(kind: string): string | null {
  return KIND_ACTIONS[kind] ?? null
}

/** "last_error_code" or "last error code" -> "Last error code"; "account_id" -> "Account ID". */
export function factLabel(key: string): string {
  const words = key.split(/[_\s]+/).filter(Boolean).map((w) => (w === 'id' ? 'ID' : w))
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The first block of a UUID: enough to tell two apart, short enough to read. */
export function shortId(id: string | null | undefined): string {
  if (!id) return NOT_ENTERED
  return id.split('-')[0] ?? id
}

/** "As of 14:05" in Lagos time, whatever the server's own zone. */
export function fmtAsOf(now = new Date()): string {
  return `As of ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })} WAT`
}

/** A calendar day from the database ("2026-10-12") as "12 Oct". */
export function fmtDay(day: string): string {
  const d = new Date(day + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

const lagosDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })
const lagosDayNumber = (d: Date) => Date.parse(lagosDate.format(d) + 'T00:00:00Z') / 86400000

/**
 * Calendar days from now to a date, in Lagos: a trial that ends at 23:59
 * tonight is 0 ("today") all day, not "tomorrow" because 15 hours round up
 * to one. Negative when past; null when absent.
 */
export function calendarDaysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return lagosDayNumber(d) - lagosDayNumber(now)
}

/** "today", "yesterday", "3 days ago", "in 5 days", by the calendar in Lagos. */
export function relDays(iso: string | null | undefined, now = new Date()): string {
  const n = calendarDaysUntil(iso, now)
  if (n === null) return NOT_ENTERED
  if (n === 0) return 'today'
  if (n === -1) return 'yesterday'
  if (n === 1) return 'tomorrow'
  return n < 0 ? `${-n} days ago` : `in ${n} days`
}

/**
 * A share as a whole percentage that never claims 100% while something
 * failed: 300 applied and 1 failed is "99%+", not "100%".
 */
export function shareWords(share: number | null, anyFailed: boolean): string {
  if (share === null) return 'not available'
  const pct = share * 100
  if (anyFailed && pct >= 99.5) return '99%+'
  if (pct > 0 && pct < 1) return 'under 1%'
  return `${Math.round(pct)}%`
}

export function severityTone(s: Severity): 'bad' | 'warn' | 'muted' {
  return s === 'critical' ? 'bad' : s === 'warn' ? 'warn' : 'muted'
}

export function summariseAlerts(rows: AlertRow[]): { open: number; critical: number; warn: number; info: number } {
  const open = rows.filter((r) => r.resolved_at === null)
  return {
    open: open.length,
    critical: open.filter((r) => r.severity === 'critical').length,
    warn: open.filter((r) => r.severity === 'warn').length,
    info: open.filter((r) => r.severity === 'info').length,
  }
}

/** The flat facts of an alert, for a definition list. Nested values are not shown. */
export function alertFacts(detail: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(detail ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) }))
}

export type FounderSlots = { total: number; claimed: number; forfeited: number; reserved: number; free: number }

export function slotWords(s: FounderSlots | null | undefined): string {
  if (!s) return NOT_ENTERED
  return `${s.free} of ${s.total} free · ${s.claimed} claimed · ${s.reserved} reserved · ${s.forfeited} forfeited`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return NOT_ENTERED
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NOT_ENTERED
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return NOT_ENTERED
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NOT_ENTERED
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Whole days from now to a date; negative when past. null when absent. */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

/** Kobo to naira for the money formatter; null stays null. */
export function kobo(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : n / 100
}

/** Sum of a per-day series over the last n days, counting today. */
export function sumLastDays(series: { day: string; accounts: number }[], days: number, now = new Date()): number {
  const since = new Date(now); since.setDate(since.getDate() - (days - 1)); since.setHours(0, 0, 0, 0)
  return series
    .filter((p) => new Date(p.day + 'T00:00:00').getTime() >= since.getTime())
    .reduce((a, p) => a + p.accounts, 0)
}
