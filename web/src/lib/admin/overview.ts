/**
 * The admin's figures and its "Needs attention" queue. Pure, like format.ts:
 * every figure comes from what the fn_admin_* reads already return, nothing
 * here asks the database for more, and nothing is estimated.
 *
 * Only `import type` from elsewhere: node --test runs this file as it is,
 * and it cannot resolve an import without its extension.
 *
 * Two facts about subscriptions shape everything below (0066):
 *   - a trial that has ended KEEPS status 'trialing'; only the entitlement
 *     verdict says it is over (fn_my_entitlement: trialing + not entitled =
 *     'trial_ended');
 *   - a paid subscription can stay 'active' after its paid-until date when a
 *     renewal was not recorded. 'active' keeps access on status alone
 *     (fn_account_is_entitled: "a stale row is OUR gap"), so it is overdue,
 *     not locked. Access is lost only after a failed payment's grace days
 *     ('past_due' past fn_payment_failure_grace()).
 */
import type { AlertRow, Severity } from './format'

/** The fields of an fn_admin_subscriptions row this module reads. */
export type SubRow = {
  account_id: string
  account_name: string
  price_tier: string
  status: string
  trial_ends_at: string | null
  current_period_end: string | null
  price_kobo: number | null
  cancel_at_period_end: boolean
  created_at: string
  entitled: boolean
}

const DAY = 86400000
const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

const isPaid = (r: SubRow) => r.price_tier !== 'trial'
const passed = (iso: string | null, now: Date) => iso !== null && new Date(iso).getTime() < now.getTime()

/**
 * Where a paid subscription stands, worst first:
 *   locked     -- paid plan, but no access: a failed payment past its grace days
 *   past_due   -- a payment failed; still in its grace days
 *   overdue    -- paid-until date passed, no renewal recorded, still has access
 *   cancelling -- renewal switched off; access runs to the paid-until date.
 *                 Paystack's subscription.not_renew stores this as status
 *                 'cancelled' with cancel_at_period_end (0050/0051), and
 *                 fn_account_is_entitled keeps access while the date is ahead.
 *   ok
 */
export type PayState = 'locked' | 'past_due' | 'overdue' | 'cancelling' | 'ok'
const PAY_RANK: Record<PayState, number> = { locked: 0, past_due: 1, overdue: 2, cancelling: 3, ok: 4 }

export function payState(r: SubRow, now = new Date()): PayState {
  if (r.status === 'cancelled' && r.entitled) return 'cancelling'
  if (!r.entitled) return 'locked'
  if (r.status === 'past_due') return 'past_due'
  if (passed(r.current_period_end, now)) return 'overdue'
  if (r.cancel_at_period_end) return 'cancelling'
  return 'ok'
}

/**
 * The paid plans that count as paying: active, a payment failed but not yet
 * given up on, or cancelled but paid up to a date still ahead. One definition
 * for every "paying" count and list, so the pages never disagree.
 */
export function paidRows<T extends SubRow>(rows: T[]): T[] {
  return rows.filter((r) => isPaid(r) && (r.status === 'active' || r.status === 'past_due' || (r.status === 'cancelled' && r.entitled)))
}

/** A sum of plan prices, with the ones that have no price counted apart, never as ₦0. */
export function priceSum(rows: SubRow[]): { kobo: number | null; unpriced: number } {
  const priced = rows.filter((r) => r.price_kobo !== null)
  return {
    // Nothing to add up is a real ₦0; plans with no price at all is not known.
    kobo: rows.length > 0 && priced.length === 0 ? null : priced.reduce((a, r) => a + (r.price_kobo as number), 0),
    unpriced: rows.length - priced.length,
  }
}

/**
 * What the paying plans are worth a month, in kobo (periods are one month,
 * 0051). It is the plans' value, not money seen to arrive.
 */
export function monthlyValue(rows: SubRow[], now = new Date()): { kobo: number | null; accounts: number; unpriced: number; notRenewed: number } {
  const paying = paidRows(rows)
  return {
    ...priceSum(paying),
    accounts: paying.length,
    notRenewed: paying.filter((r) => payState(r, now) === 'overdue').length,
  }
}

/** Monthly value that may not come in: a failed payment, locked out, or set to cancel. */
export function valueAtRisk(rows: SubRow[], now = new Date()): { kobo: number | null; unpriced: number; accounts: number } {
  const risky = paidRows(rows).filter((r) => ['locked', 'past_due', 'cancelling'].includes(payState(r, now)))
  return { ...priceSum(risky), accounts: risky.length }
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY)

/**
 * The four lists the Subscriptions page shows, each in the order a person
 * should read it: the ones that need something first.
 */
export function subscriptionBuckets<T extends SubRow>(rows: T[], now = new Date()): {
  paying: T[]; trials: T[]; trialEnded: T[]; ended: T[]
} {
  const paying = paidRows(rows)
    .sort((a, b) => PAY_RANK[payState(a, now)] - PAY_RANK[payState(b, now)] || time(a.current_period_end) - time(b.current_period_end))
  const trials = rows.filter((r) => !isPaid(r) && r.status === 'trialing' && r.entitled)
    .sort((a, b) => time(a.trial_ends_at) - time(b.trial_ends_at))
  const trialEnded = rows.filter((r) => !isPaid(r) && r.status === 'trialing' && !r.entitled)
    .sort((a, b) => time(b.trial_ends_at) - time(a.trial_ends_at))
  const taken = new Set<T>([...paying, ...trials, ...trialEnded])
  const ended = rows.filter((r) => !taken.has(r)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  return { paying, trials, trialEnded, ended }
}

/** Trials still running, how many of them end within `days`, and how many ended unpaid. */
export function trialCounts(rows: SubRow[], days = 7, now = new Date()): { running: number; endingSoon: number; endedUnpaid: number } {
  const trial = rows.filter((r) => !isPaid(r) && r.status === 'trialing')
  const running = trial.filter((r) => r.entitled)
  const soon = running.filter((r) => {
    if (!r.trial_ends_at) return false
    const d = (new Date(r.trial_ends_at).getTime() - now.getTime()) / DAY
    return d >= 0 && d <= days
  })
  return { running: running.length, endingSoon: soon.length, endedUnpaid: trial.length - running.length }
}

// --- signups -------------------------------------------------------------------

// The database groups days by UTC date (created_at::date), so these do too.
const utcDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The per-day series with the empty days put back. fn_admin_signups returns
 * only days that had a signup, so a chart drawn from it would close the gaps.
 * Oldest first, ending today.
 */
export function fillDays(series: { day: string; accounts: number }[], days: number, now = new Date()): { day: string; n: number }[] {
  const by = new Map(series.map((p) => [p.day, p.accounts]))
  const out: { day: string; n: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = utcDay(new Date(now.getTime() - i * DAY))
    out.push({ day: key, n: by.get(key) ?? 0 })
  }
  return out
}

/** Signups in the last seven days, and in the seven before them. */
export function weekOverWeek(series: { day: string; accounts: number }[], now = new Date()): { thisWeek: number; lastWeek: number } {
  const filled = fillDays(series, 14, now)
  const sum = (xs: { n: number }[]) => xs.reduce((a, p) => a + p.n, 0)
  return { thisWeek: sum(filled.slice(7)), lastWeek: sum(filled.slice(0, 7)) }
}

/** Signups today (UTC day), from the same series. */
export function signupsToday(series: { day: string; accounts: number }[], now = new Date()): number {
  return series.find((p) => p.day === utcDay(now))?.accounts ?? 0
}

/** Accounts that went on to set up a business, of all accounts. */
export function setUpCount(totalAccounts: number, withoutBusiness: number): { done: number; total: number } {
  return { done: Math.max(0, totalAccounts - withoutBusiness), total: totalAccounts }
}

// --- billing -------------------------------------------------------------------

/** Applied events out of those that either applied or failed; null with none. */
export function billingSuccessRate(totals: Record<string, number>): number | null {
  const applied = totals.applied ?? 0
  const failed = (totals.failed_permanent ?? 0) + (totals.failed_transient ?? 0)
  return applied + failed === 0 ? null : applied / (applied + failed)
}

// --- alerts --------------------------------------------------------------------

export type AlertGroup = {
  kind: string
  severity: Severity
  rows: AlertRow[]
  /** The earliest first_seen in the group. */
  oldest: string
}

/** Alerts by kind, the most severe and then the largest group first. */
export function groupAlerts(rows: AlertRow[]): AlertGroup[] {
  const by = new Map<string, AlertRow[]>()
  for (const r of rows) by.set(r.kind, [...(by.get(r.kind) ?? []), r])
  return [...by.entries()].map(([kind, rs]) => ({
    kind,
    severity: rs.reduce<Severity>((s, r) => (RANK[r.severity] < RANK[s] ? r.severity : s), 'info'),
    rows: [...rs].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.last_seen.localeCompare(a.last_seen)),
    oldest: rs.reduce((m, r) => (r.first_seen < m ? r.first_seen : m), rs[0].first_seen),
  })).sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.rows.length - a.rows.length)
}

// --- the queue -----------------------------------------------------------------

export type AttentionTone = 'critical' | 'warn' | 'info'

export type Attention = {
  key: string
  tone: AttentionTone
  title: string
  detail: string
  href: string
  action: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const names = (xs: { name: string }[]) =>
  xs.slice(0, 2).map((x) => x.name).join(', ') + (xs.length > 2 ? ` and ${xs.length - 2} more` : '')

/**
 * Everything on the platform that wants a person, most urgent first. The
 * words come in through `say` so this module stays free of runtime imports.
 *
 * An account appears once: when the subscriptions already show a payment
 * problem, the scan's "past due beyond grace" alert says the same thing and
 * is folded into that row rather than listed again.
 */
export function attentionItems(input: {
  alerts: AlertRow[]
  subs: SubRow[]
  trialsEndingSoon: { name: string }[]
  stalled: { name: string; created_at: string }[]
  /** null: the website settings could not be read at all. */
  website: { missing: string[]; unreachable: boolean } | null
  /** Owners due a check-in (0068), one row per reason; absent before it. */
  checkinsDue?: { reason: string; account_id: string }[]
  /** Help asked for in the app and not answered yet (0069); absent before it. */
  helpOpen?: { business: string | null; created_at: string }[]
  /** Owners whose low rating of the last 30 days nobody has answered (lib/admin/journeys.ts, 0069). */
  lowRatings?: { business: string | null }[]
  /** Owners stuck at a step or gone quiet (lib/admin/journeys.ts), help and low ratings aside (0069). */
  stuck?: { name: string }[]
  say: { alert: (kind: string) => string; money: (naira: number) => string; ago: (iso: string) => string }
  now?: Date
}): Attention[] {
  const { say } = input
  const now = input.now ?? new Date()
  const items: Attention[] = []

  const paid = paidRows(input.subs)
  const locked = paid.filter((r) => payState(r, now) === 'locked')
  const pastDue = paid.filter((r) => payState(r, now) === 'past_due')
  const overdue = paid.filter((r) => payState(r, now) === 'overdue')
  const covered = locked.length + pastDue.length > 0

  for (const g of groupAlerts(input.alerts.filter((a) => a.resolved_at === null))) {
    if (covered && g.kind === 'past_due_beyond_grace') continue
    const n = g.rows.length
    items.push({
      key: `alert-${g.kind}`,
      tone: g.severity,
      title: n > 1 ? `${n} × ${say.alert(g.kind)}` : say.alert(g.kind),
      detail: n > 1 ? `The first one ${say.ago(g.oldest)}` : g.rows[0].summary,
      href: `/admin/alerts#kind-${g.kind}`,
      action: 'Open alerts',
    })
  }

  if (locked.length) {
    items.push({
      key: 'locked',
      tone: 'critical',
      title: `${plural(locked.length, 'paying customer is', 'paying customers are')} locked out`,
      detail: `A payment failed and the grace days have run out · ${names(locked.map((r) => ({ name: r.account_name })))}`,
      href: '/admin/subscriptions#paying',
      action: 'See who',
    })
  }
  if (pastDue.length) {
    // Only prices that are known are added; an unknown one is said, never ₦0.
    const sum = priceSum(pastDue)
    const risk = sum.kobo === null
      ? 'An unknown amount a month at risk'
      : `${say.money(sum.kobo / 100)} a month at risk${sum.unpriced ? `, and ${sum.unpriced} without a price` : ''}`
    items.push({
      key: 'past-due',
      tone: 'warn',
      title: `${plural(pastDue.length, 'payment', 'payments')} failed`,
      detail: `${risk}; still inside the grace days · ${names(pastDue.map((r) => ({ name: r.account_name })))}`,
      href: '/admin/subscriptions#paying',
      action: 'See who',
    })
  }
  if (overdue.length) {
    items.push({
      key: 'overdue',
      tone: 'warn',
      title: `${plural(overdue.length, 'renewal', 'renewals')} not recorded`,
      detail: `Past the paid-until date with no renewal recorded; they keep access meanwhile. Check Paystack · ${names(overdue.map((r) => ({ name: r.account_name })))}`,
      href: '/admin/subscriptions#paying',
      action: 'See who',
    })
  }

  if (input.website === null) {
    items.push({
      key: 'website-down',
      tone: 'critical',
      title: 'The website settings cannot be read',
      detail: 'Every public page is using its built-in defaults',
      href: '/admin/site',
      action: 'Open website',
    })
  } else if (input.website.missing.length) {
    const m = input.website.missing
    items.push({
      key: 'website',
      tone: input.website.unreachable ? 'warn' : 'info',
      title: input.website.unreachable
        ? 'Customers cannot reach you from the website'
        : `Website: ${plural(m.length, 'thing', 'things')} not set`,
      detail: m.slice(0, 3).join(' · ') + (m.length > 3 ? ` · and ${m.length - 3} more` : ''),
      href: '/admin/site',
      action: 'Open website',
    })
  }

  const due = input.checkinsDue ?? []
  if (due.length) {
    const count = (reason: string) => due.filter((d) => d.reason === reason).length
    const parts = [
      count('payment_failed') && `${count('payment_failed')} failed payment`,
      count('trial_end') && `${count('trial_end')} trial ending`,
      count('welcome') && `${count('welcome')} new`,
      count('day3') && `${count('day3')} on day 3`,
    ].filter(Boolean)
    // One owner can be due for two reasons; they are one person to message.
    const owners = new Set(due.map((d) => d.account_id)).size
    items.push({
      key: 'checkins',
      tone: 'info',
      title: `${plural(owners, 'owner', 'owners')} to check in with`,
      detail: `${parts.join(' · ')} · the WhatsApp message is written for you`,
      href: '/admin/signups#checkins',
      action: 'Check in',
    })
  }

  const help = input.helpOpen ?? []
  if (help.length) {
    const oldest = help.reduce((a, h) => (h.created_at < a ? h.created_at : a), help[0].created_at)
    items.push({
      key: 'help',
      tone: 'warn',
      title: `${plural(help.length, 'help request is', 'help requests are')} waiting for an answer`,
      detail: `The oldest ${say.ago(oldest)} · ${names(help.map((h) => ({ name: h.business ?? 'no business yet' })))}`,
      href: '/admin/feedback#requests',
      action: 'Answer',
    })
  }
  const low = input.lowRatings ?? []
  if (low.length) {
    items.push({
      key: 'low-ratings',
      tone: 'info',
      title: `${plural(low.length, 'owner', 'owners')} rated the app low and have not heard from you`,
      detail: `Worth a message to ask what was hard · ${names(low.map((h) => ({ name: h.business ?? 'no business yet' })))}`,
      href: '/admin/journeys',
      action: 'See who',
    })
  }
  const stuck = input.stuck ?? []
  if (stuck.length) {
    items.push({
      key: 'stuck',
      tone: 'info',
      title: `${plural(stuck.length, 'owner looks', 'owners look')} stuck`,
      detail: `Stopped at a setup step or gone quiet · ${names(stuck)}`,
      href: '/admin/journeys',
      action: 'See who',
    })
  }

  const ended = input.subs.filter((r) => !isPaid(r) && r.status === 'trialing' && !r.entitled)
  if (ended.length) {
    items.push({
      key: 'trial-ended',
      tone: 'info',
      title: `${plural(ended.length, 'trial', 'trials')} ended without paying`,
      detail: `Worth a message · ${names(ended.map((r) => ({ name: r.account_name })))}`,
      href: '/admin/subscriptions#trial-ended',
      action: 'Follow up',
    })
  }

  if (input.trialsEndingSoon.length) {
    items.push({
      key: 'trials',
      tone: 'info',
      title: `${plural(input.trialsEndingSoon.length, 'trial ends', 'trials end')} within 7 days`,
      detail: names(input.trialsEndingSoon),
      href: '/admin/signups#trials',
      action: 'See trials',
    })
  }

  const since = now.getTime() - 30 * DAY
  const stalled = input.stalled.filter((a) => new Date(a.created_at).getTime() >= since)
  if (stalled.length) {
    items.push({
      key: 'stalled',
      tone: 'info',
      title: `${plural(stalled.length, 'new account has', 'new accounts have')} no business set up`,
      detail: `Signed up in the last 30 days · ${names(stalled)}`,
      href: '/admin/signups#stalled',
      action: 'See signups',
    })
  }

  const rank: Record<AttentionTone, number> = { critical: 0, warn: 1, info: 2 }
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank[a.it.tone] - rank[b.it.tone] || a.i - b.i).map((x) => x.it)
}
