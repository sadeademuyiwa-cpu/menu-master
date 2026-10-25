import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { googleProviderEnabled, googleProviderEnabledNow, loadSiteSettingsRaw } from '@/lib/data/site'
import { parseAnalytics, parseCompany, parseLanding, parsePrivacy, parseSignIn } from '@/lib/site/settings'
import { HELP_SCREENS, parseHelpVideos } from '@/lib/site/help-videos'
import type { AlertRow, FounderSlots } from '@/lib/admin/format'
import type { WebsiteFacts } from '@/lib/admin/website'

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
