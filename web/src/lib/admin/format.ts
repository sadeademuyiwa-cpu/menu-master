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
}

export function alertWords(kind: string): string {
  return KIND_WORDS[kind] ?? kind.replace(/_/g, ' ')
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
