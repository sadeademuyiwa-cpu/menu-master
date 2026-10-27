/**
 * How far each owner has got, and whether they look stuck (0069). The
 * database hands over the facts per account (fn_admin_activation); these rules
 * decide what they mean, so they can be tested and tuned in one place.
 *
 * The thresholds are starting points to tune, not industry figures: Intercom
 * nudges a new user who has not done the key step 2 days after signing up,
 * and Gainsight treats a falling score as the moment to check in.
 *
 * Pure, only `import type`: node --test runs it as it is.
 */

import type { Journey, JourneyVisit } from '@/lib/data/admin'

export type ActivationRow = {
  id: string
  name: string
  created_at: string
  email: string | null
  phone: string | null
  usage_opt_out_at: string | null
  status: string | null
  trial_ends_at: string | null
  price_tier: string | null
  tier: string | null
  entitled: boolean | null
  business_at: string | null
  purchase_at: string | null
  costed_at: string | null
  priced_at: string | null
  sale_at: string | null
  paid_at: string | null
  seen_at: string | null
  signed_in_at: string | null
  active_days_14: number
  refusals_24h: number
  open_help: number
  /** The newest LOW answer of the last 30 days (1-2 of 5, 0-6 of 10), from anyone in the business. */
  low_score: number | null
  low_prompt: string | null
  low_score_at: string | null
  /** The admin's latest check-in that reached them (0068 outcomes reached, opted_out, stopped_offers). */
  last_checkin_at: string | null
}

export type StepKey = 'signed_up' | 'business' | 'purchase' | 'costed' | 'priced' | 'sale' | 'paid'

export const STEPS: { key: StepKey; label: string; at: (r: ActivationRow) => string | null }[] = [
  { key: 'signed_up', label: 'Signed up', at: (r) => r.created_at },
  { key: 'business', label: 'Business set up', at: (r) => r.business_at },
  { key: 'purchase', label: 'First purchase', at: (r) => r.purchase_at },
  { key: 'costed', label: 'First dish costed', at: (r) => r.costed_at },
  { key: 'priced', label: 'Selling price set', at: (r) => r.priced_at },
  { key: 'sale', label: 'First sale', at: (r) => r.sale_at },
  { key: 'paid', label: 'Paid', at: (r) => r.paid_at },
]

const DAY = 86_400_000
const ago = (iso: string | null, now: Date) => (iso ? (now.getTime() - new Date(iso).getTime()) / DAY : null)

/** The Costing plan has no Sales; a trial and Costing + Sales do. */
export const expectsSale = (r: ActivationRow) => r.status === 'trialing' || r.tier !== 'costing'

/**
 * The last step reached in order: the first missing step is where they
 * stopped. A sale is not a step for a Costing plan, so a paying Costing
 * customer has done every step.
 */
export function stoppedAt(r: ActivationRow): { reached: number; next: StepKey | null } {
  // reached: how far along the list the last step reached is (1 = signed up),
  // so STEPS[reached - 1] names it
  let reached = 1
  for (let i = 1; i < STEPS.length; i++) {
    if (STEPS[i].key === 'sale' && !expectsSale(r)) continue
    if (!STEPS[i].at(r)) return { reached, next: STEPS[i].key }
    reached = i + 1
  }
  return { reached, next: null }
}

/**
 * The owner turned screen recording off: there is no "last seen" of hers to
 * judge by -- a staff member's old visit is not hers, and her last sign-in is
 * not renewed by a phone that stays signed in.
 */
export const recordingOff = (r: ActivationRow) => r.usage_opt_out_at !== null

/**
 * A low rating asks for a word for 30 days (the database sends only those),
 * or until a check-in that reached them after it. A missed call does not
 * answer it, and neither does someone else's later good score.
 */
export const LOW_SCORE_DAYS = 30
export function lowScoreOpen(r: ActivationRow, now = new Date()): boolean {
  if (r.low_prompt === null || !isLowScore(r.low_prompt, r.low_score)) return false
  const age = ago(r.low_score_at, now)
  if (age !== null && age > LOW_SCORE_DAYS) return false
  return !(r.last_checkin_at && r.low_score_at && r.last_checkin_at > r.low_score_at)
}

/** For each step: how many accounts got there (in any order), and the share of all signups. */
export function funnel(rows: ActivationRow[]): { key: StepKey; label: string; n: number; pct: number | null }[] {
  const total = rows.length
  return STEPS.map((s) => {
    const n = rows.filter((r) => s.at(r) !== null).length
    return { key: s.key, label: s.label, n, pct: total ? n / total : null }
  })
}

/** When they were last in the app: a screen visit, else a sign-in. */
export function lastSeen(r: ActivationRow): string | null {
  if (r.seen_at && r.signed_in_at) return r.seen_at > r.signed_in_at ? r.seen_at : r.signed_in_at
  return r.seen_at ?? r.signed_in_at
}

const isPaid = (r: ActivationRow) => r.price_tier !== null && r.price_tier !== 'trial'
const trialOver = (r: ActivationRow) => r.status === 'trialing' && r.entitled === false
/** Access has ended. A plan cancelled but still paid up (renewal off) has not. */
const gone = (r: ActivationRow) => r.status === 'expired' || (r.status === 'cancelled' && r.entitled === false)
/** Renewal is off and the paid time is still running: the one most likely to leave. */
const notRenewing = (r: ActivationRow) => r.status === 'cancelled' && r.entitled !== false

/**
 * Why this account may need a word from the admin, most important first.
 * A help request waiting always counts. Otherwise an ended, unpaid trial has
 * its own follow-up list (Paying & trials), and an ended plan needs nothing.
 */
export function stuckReasons(r: ActivationRow, now = new Date()): string[] {
  const out: string[] = []
  if (r.open_help > 0) out.push(r.open_help === 1 ? 'Asked for help' : `Asked for help ${r.open_help} times`)
  if (trialOver(r) || gone(r)) return out

  if (lowScoreOpen(r, now)) out.push(`Unhappy: rated ${r.low_score}${r.low_prompt === 'nps' ? ' of 10' : ' of 5'}`)
  if (r.refusals_24h >= 3) out.push(`Hit ${r.refusals_24h} refusals today`)

  // Setup steps: stopped too long at one.
  const signed = ago(r.created_at, now) ?? 0
  if (!r.business_at && signed > 1) out.push('No business set up after a day')
  else if (r.business_at && !r.purchase_at && (ago(r.business_at, now) ?? 0) > 2) out.push('No purchase recorded')
  else if (r.purchase_at && !r.costed_at && (ago(r.purchase_at, now) ?? 0) > 2) out.push('No dish costed yet')
  else if (r.costed_at && !r.priced_at && (ago(r.costed_at, now) ?? 0) > 2) out.push('No selling price set')
  else if (r.priced_at && !r.sale_at && (ago(r.priced_at, now) ?? 0) > 3 && expectsSale(r)) out.push('No sale recorded yet')

  // Gone quiet -- unless the owner turned recording off, when there is nothing to go by.
  if (recordingOff(r)) return out
  const seen = ago(lastSeen(r), now)
  const quietAfter = isPaid(r) ? 7 : 5
  if (seen !== null && seen > quietAfter && signed > quietAfter) out.push(`Not seen for ${Math.floor(seen)} days`)

  return out
}

/** One word for the list: what the admin should make of this account. */
export function journeyStatus(r: ActivationRow, now = new Date()): { word: string; tone: 'critical' | 'warn' | 'good' | 'neutral' } {
  const reasons = stuckReasons(r, now)
  if (reasons.some((x) => x.startsWith('Asked for help') || x.startsWith('Unhappy'))) return { word: 'Needs you', tone: 'critical' }
  if (trialOver(r)) return { word: 'Trial ended', tone: 'neutral' }
  if (gone(r)) return { word: 'Left', tone: 'neutral' }
  if (notRenewing(r)) return { word: 'Not renewing', tone: 'warn' }
  if (reasons.length) return { word: 'Stuck', tone: 'warn' }
  if ((ago(r.created_at, now) ?? 0) < 1) return { word: 'New', tone: 'neutral' }
  return { word: 'On track', tone: 'good' }
}

/**
 * The "would you recommend us" answers (0-10) as the usual score: the share
 * of 9-10s minus the share of 0-6s, from -100 to 100. Skipped questions are
 * not answers. Null with no answers.
 */
export function npsScore(scores: (number | null)[]): { score: number | null; n: number; promoters: number; passives: number; detractors: number } {
  const s = scores.filter((x): x is number => x !== null)
  const promoters = s.filter((x) => x >= 9).length
  const detractors = s.filter((x) => x <= 6).length
  return {
    score: s.length ? Math.round(((promoters - detractors) / s.length) * 100) : null,
    n: s.length, promoters, passives: s.length - promoters - detractors, detractors,
  }
}

/** The average of the 1-5 "how easy" answers, to one decimal; null with none. */
export function easeAverage(scores: (number | null)[]): { avg: number | null; n: number; hard: number } {
  const s = scores.filter((x): x is number => x !== null)
  return {
    avg: s.length ? Math.round((s.reduce((a, x) => a + x, 0) / s.length) * 10) / 10 : null,
    n: s.length,
    hard: s.filter((x) => x <= 2).length,
  }
}

/** A rating is low enough to follow up: 1-2 of 5, or 0-6 of 10. */
export function isLowScore(prompt: string, score: number | null): boolean {
  if (score === null) return false
  return prompt === 'nps' ? score <= 6 : score <= 2
}

/** What the admin sends back to a help request, written for them to edit. */
export function helpReply(o: { ref: string; screen: string; asked: string | null }): string {
  const about = o.asked ? ` about "${o.asked.length > 80 ? `${o.asked.slice(0, 77)}…` : o.asked}"` : ''
  return `Hello, this is Menu Master. You asked for help on ${o.screen}${about} (ref ${o.ref}). `
}

// --- one owner's story -------------------------------------------------------

/**
 * One owner's story, newest first, for /admin/journeys/[id] (0069): the setup
 * steps they reached, each time they used the app (as one line per session,
 * the screens in order), where they were refused or hit an error, what they
 * asked for, how they rated it, and each check-in the admin made.
 *
 * The screen names and durations come in as functions, so this file stays
 * free of runtime imports.
 */
export type TimelineEntry = {
  at: string
  kind: 'step' | 'session' | 'refusal' | 'crash' | 'help' | 'help_seen' | 'feedback' | 'checkin'
  title: string
  detail?: string
  tone: 'good' | 'warn' | 'critical' | 'neutral'
}

type Words = { nameOf: (screen: string | null, path: string) => string; duration: (seconds: number) => string }

/** The screens of one session, in order, a repeat in a row shown once. */
export function sessionTrail(visits: JourneyVisit[], nameOf: Words['nameOf'], max = 12): string {
  const names: string[] = []
  for (const v of [...visits].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const n = nameOf(v.screen, v.path)
    if (names[names.length - 1] !== n) names.push(n)
  }
  if (names.length <= max) return names.join(' → ')
  return `${names.slice(0, max).join(' → ')} → … ${names.length - max} more`
}

const DEVICE: Record<string, string> = { phone: 'a phone', tablet: 'a tablet', desktop: 'a computer' }
const lagosDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
/** A page load can stay open for days: it is split where 30 minutes passed with nothing, or the day changed. */
export const USE_GAP_MS = 30 * 60_000
export function uses(session: JourneyVisit[]): JourneyVisit[][] {
  const out: JourneyVisit[][] = []
  for (const v of [...session].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const cur = out[out.length - 1]
    const prev = cur?.[cur.length - 1]
    const split = !prev || new Date(v.started_at).getTime() - new Date(prev.last_seen_at).getTime() > USE_GAP_MS
      || lagosDay(v.started_at) !== lagosDay(prev.started_at)
    if (split) out.push([v]); else cur.push(v)
  }
  return out
}
const PROMPT: Record<string, string> = {
  first_dish: 'how easy costing the first dish was', first_sale: 'how easy recording a sale was', nps: 'how likely they are to recommend us',
}

export function buildTimeline(j: Journey, act: ActivationRow | null, { nameOf, duration }: Words): TimelineEntry[] {
  const out: TimelineEntry[] = []

  if (act) {
    for (const s of STEPS) {
      const at = s.at(act)
      if (at) out.push({ at, kind: 'step', title: s.label, tone: s.key === 'paid' ? 'good' : 'neutral' })
    }
  }

  const sessions = new Map<string, JourneyVisit[]>()
  for (const v of j.visits) sessions.set(v.session_id, [...(sessions.get(v.session_id) ?? []), v])
  for (const vs of [...sessions.values()].flatMap(uses)) {
    const start = vs.reduce((a, v) => (v.started_at < a ? v.started_at : a), vs[0].started_at)
    const active = vs.reduce((a, v) => a + (v.active_seconds ?? 0), 0)
    const who = j.members.length > 1 ? j.members.find((m) => m.user_id === vs[0].user_id)?.email ?? null : null
    out.push({
      at: start, kind: 'session', tone: 'neutral',
      title: `Used the app for ${duration(active)} on ${DEVICE[vs[0].device] ?? 'a device'}${who ? ` (${who})` : ''}`,
      detail: sessionTrail(vs, nameOf),
    })
  }

  for (const e of j.events) {
    const where = nameOf(e.screen, e.path)
    if (e.kind === 'refusal') out.push({ at: e.at, kind: 'refusal', tone: 'warn', title: `Refused on ${where}`, detail: e.code ? `Words: ${e.code.replace(/_/g, ' ')}` : undefined })
    else if (e.kind === 'crash') out.push({ at: e.at, kind: 'crash', tone: 'critical', title: `Hit an error on ${where}`, detail: e.code ? `Code ${e.code}` : undefined })
    else out.push({ at: e.at, kind: 'help_seen', tone: 'neutral', title: e.kind === 'help_video' ? `Watched the help video on ${where}` : `Opened Help on ${where}` })
  }

  for (const h of j.help) {
    out.push({
      at: h.created_at, kind: 'help', tone: h.status === 'open' ? 'critical' : 'neutral',
      title: `${h.channel === 'whatsapp' ? 'Opened WhatsApp for help' : 'Asked for help'} on ${nameOf(h.screen, h.path)} (H${h.id}, ${h.status})`,
      detail: h.message ?? undefined,
    })
  }

  for (const f of j.feedback) {
    const scale = f.prompt === 'nps' ? 10 : 5
    const low = isLowScore(f.prompt, f.score)
    out.push({
      at: f.created_at, kind: 'feedback', tone: low ? 'warn' : 'neutral',
      title: f.score === null ? `Put off the question on ${PROMPT[f.prompt] ?? f.prompt}` : `Rated ${PROMPT[f.prompt] ?? f.prompt}: ${f.score} of ${scale}`,
      detail: f.comment ?? undefined,
    })
  }

  for (const c of j.checkins) {
    out.push({ at: c.done_at, kind: 'checkin', tone: 'good', title: `You got in touch (${c.channel}): ${c.outcome.replace(/_/g, ' ')}`, detail: c.note ?? undefined })
  }

  return out.sort((a, b) => b.at.localeCompare(a.at))
}
