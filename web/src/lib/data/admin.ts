import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { googleProviderEnabled, googleProviderEnabledNow, loadSiteSettingsRaw } from '@/lib/data/site'
import { parseAnalytics, parseCompany, parseLanding, parsePrivacy, parseSignIn } from '@/lib/site/settings'
import { HELP_SCREENS, parseHelpVideos } from '@/lib/site/help-videos'
import type { AlertRow, FounderSlots } from '@/lib/admin/format'
import type { WebsiteFacts } from '@/lib/admin/website'
import type { ActivationRow } from '@/lib/admin/journeys'

/**
 * The platform administrator's reads.
 *
 * Every function here is a SECURITY DEFINER function in the database that
 * opens with fn_require_platform_admin() -- it refuses a non-admin with 42501
 * before it reads anything. The layout's isPlatformAdmin() check is a
 * courtesy that keeps a customer from seeing an empty admin shell; it is not
 * the lock. If the function is absent (0053-0055 not yet applied) these
 * return null and the pages say so.
 *
 * Each read is wrapped in React's cache(): the admin layout counts open
 * alerts and paying accounts for its sidebar, and the page below it often
 * reads the same thing; within one request it is asked once.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_is_platform_admin')
  return !error && data === true
})

export type BillingHealth = {
  days: number
  since: string
  events_by_day: { day: string; status: string; n: number }[]
  totals: Record<string, number>
  signature_rejections: number
  reconciliation: {
    received_at: string; event_type: string | null; reference: string | null
    provider_event_id: string | null; account_id: string | null; status: string
    last_error_code: string | null; last_error: string | null; attempts: number
  }[]
  anomalies: {
    subscription_id: string; account_id: string; status: string; anomaly: string
    trial_ends_at?: string | null; current_period_end?: string | null
  }[]
}

export type SubscriptionRow = {
  account_id: string; account_name: string; owner_email: string | null
  plan_id: string; plan_name: string; tier: string; price_tier: string
  status: string; trial_ends_at: string | null; current_period_end: string | null
  price_kobo: number | null; founding_price_active: boolean; cancel_at_period_end: boolean
  founder_seq: number | null; created_at: string; entitled: boolean
}

export type Subscriptions = {
  rows: SubscriptionRow[]
  by_status: Record<string, number>
  founder_slots: FounderSlots
}

export type Signups = {
  days: number
  since: string
  total_accounts: number
  per_day: { day: string; accounts: number }[]
  accounts_without_business: { account_id: string; name: string; created_at: string; owner_email: string | null }[]
  trials_ending_soon: { account_id: string; name: string; trial_ends_at: string; owner_email: string | null }[]
  users_without_account: number
}

export type Alerts = { open: number; critical: number; rows: AlertRow[] }

/** fn_admin_checkins_due (0068): who to contact now, and every owner's number. */
export type CheckinDue = {
  account_id: string; name: string; created_at: string; owner_email: string | null
  phone: string | null; phone_confirmed: boolean; phone_wrong: boolean; marketing_ok: boolean
  reason: 'welcome' | 'day3' | 'trial_end' | 'payment_failed'; trial_ends_at: string | null
  last_kind: string | null; last_outcome: string | null; last_at: string | null
}
export type CheckinContact = {
  account_id: string; name: string; owner_email: string | null
  phone: string | null; phone_confirmed: boolean; phone_wrong: boolean; marketing_ok: boolean; opted_out: boolean
  last_kind: string | null; last_outcome: string | null; last_at: string | null
}
export type Checkins = { due: CheckinDue[]; contacts: CheckinContact[]; new_30d: number; new_30d_with_phone: number }

/** fn_admin_live (0069): each person's latest screen in the last 30 minutes. */
export type LiveRow = {
  user_id: string; email: string | null; account_id: string | null; business: string | null
  screen: string | null; path: string; device: 'phone' | 'tablet' | 'desktop'
  started_at: string; last_seen_at: string; active_seconds: number
  state: 'active' | 'idle' | 'hidden' | 'left'; live: boolean
  plan_status: string | null; price_tier: string | null
}
export type Live = {
  live: number; recent: number; today: number; rows: LiveRow[]
  by_screen: { screen: string | null; path: string; n: number }[]
}

/** fn_admin_journey (0069): one account, from signup to now. */
export type JourneyVisit = {
  id: string; session_id: string; user_id: string; screen: string | null; path: string; device: string
  started_at: string; last_seen_at: string; active_seconds: number; state: string
}
export type JourneyEvent = { kind: 'refusal' | 'help_open' | 'help_video' | 'crash'; screen: string | null; path: string; code: string | null; at: string; user_id: string }
export type JourneyHelp = {
  id: number; screen: string | null; path: string; channel: 'message' | 'whatsapp'; message: string | null
  status: HelpStatus; note: string | null; created_at: string; handled_at: string | null; user_id: string
}
export type JourneyFeedback = { prompt: FeedbackPrompt; score: number | null; comment: string | null; screen: string | null; created_at: string }
export type Journey = {
  account: { id: string; name: string; created_at: string }
  members: { user_id: string; email: string | null; role: string; phone: string | null; opted_out_usage: boolean }[]
  visits: JourneyVisit[]; events: JourneyEvent[]; help: JourneyHelp[]; feedback: JourneyFeedback[]
  checkins: { kind: string; channel: string; outcome: string; note: string | null; done_at: string }[]
}

/** fn_admin_help (0069): help asked for in the app, the short questions' answers, where people get refused. */
export type HelpStatus = 'open' | 'replied' | 'resolved'
export type FeedbackPrompt = 'first_dish' | 'first_sale' | 'nps'
export type HelpRequest = {
  id: number; account_id: string | null; business: string | null; email: string | null; phone: string | null
  screen: string | null; path: string; channel: 'message' | 'whatsapp'; message: string | null; device: string | null
  status: HelpStatus; note: string | null; created_at: string; handled_at: string | null
}
export type FeedbackRow = {
  prompt: FeedbackPrompt; score: number | null; comment: string | null; screen: string | null
  created_at: string; account_id: string | null; business: string | null; email: string | null
}
export type HelpAndFeedback = {
  /** Every open request, then up to 200 answered in the last 30 days. */
  requests: HelpRequest[]; open_count: number
  /** The last 90 days' answers shown (up to 300); the figures come from scores. */
  feedback: FeedbackRow[]
  /** Every answer of the last 90 days: times asked, answered, and the scores. */
  scores: { asked: number; answered: number; nps: number[]; ease: number[] }
  refusals: { screen: string | null; path: string; n: number; people: number }[]
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(fn, args)
  if (error || data === null || data === undefined) return null
  return data as T
}

export const adminBillingHealth = cache((days: number) => rpc<BillingHealth>('fn_admin_billing_health', { p_days: days }))
export const adminSubscriptions = cache(() => rpc<Subscriptions>('fn_admin_subscriptions'))
export const adminSignups = cache((days: number) => rpc<Signups>('fn_admin_signups', { p_days: days }))
export const adminAlerts = cache((openOnly: boolean) => rpc<Alerts>('fn_admin_alerts', { p_open_only: openOnly }))
/** Null before 0068: the pages then simply show no check-ins and no numbers. */
export const adminCheckins = cache(() => rpc<Checkins>('fn_admin_checkins_due'))
/** Null before 0069: the pages say so and the Overview leaves the panels out. */
export const adminLive = cache(() => rpc<Live>('fn_admin_live'))
export const adminActivation = cache(() => rpc<ActivationRow[]>('fn_admin_activation'))
/** One account's row, for its journey page: reads that account only. */
export const adminActivationOf = cache((accountId: string) => rpc<ActivationRow[]>('fn_admin_activation', { p_account_id: accountId }))
export const adminJourney = cache((accountId: string) => rpc<Journey>('fn_admin_journey', { p_account_id: accountId }))
export const adminHelp = cache(() => rpc<HelpAndFeedback>('fn_admin_help'))

/** The stored website settings with their dates, read once per request. */
export const adminSiteRaw = cache(() => loadSiteSettingsRaw())

/**
 * When a setting was last SAVED. The rows exist from the migration on, with
 * an empty value; only a value with something in it has been saved.
 */
export function savedAt(o: Record<string, unknown> | undefined): string | null {
  return o && typeof o._updated_at === 'string' && Object.keys(o).some((k) => k !== '_updated_at') ? o._updated_at : null
}

/**
 * The website as a visitor gets it, for the admin's status lines and to-do
 * list. `fresh` asks Supabase about Google this moment (the sign-in page);
 * elsewhere the five-minute answer the public pages use is enough.
 */
export async function adminWebsiteFacts(fresh = false): Promise<{ raw: Record<string, Record<string, unknown>>; facts: WebsiteFacts } | null> {
  const [raw, provider] = await Promise.all([adminSiteRaw(), fresh ? googleProviderEnabledNow() : googleProviderEnabled()])
  if (!raw) return null
  return {
    raw,
    facts: {
      company: parseCompany(raw.company ?? {}),
      analytics: parseAnalytics(raw.analytics ?? {}),
      landing: parseLanding(raw.landing ?? {}),
      privacy: parsePrivacy(raw.privacy ?? {}),
      signin: parseSignIn(raw.signin ?? {}),
      provider,
      help: raw.help ? { set: Object.keys(parseHelpVideos(raw.help)).length, total: HELP_SCREENS.length } : null,
      saved: { company: savedAt(raw.company), privacy: savedAt(raw.privacy) },
    },
  }
}
