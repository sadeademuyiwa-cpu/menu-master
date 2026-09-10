import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { AlertRow, FounderSlots } from '@/lib/admin/format'

/**
 * The platform administrator's reads.
 *
 * Every function here is a SECURITY DEFINER function in the database that
 * opens with fn_require_platform_admin() -- it refuses a non-admin with 42501
 * before it reads anything. The layout's isPlatformAdmin() check is a
 * courtesy that keeps a customer from seeing an empty admin shell; it is not
 * the lock. If the function is absent (0053-0055 not yet applied) these
 * return null and the pages say so.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_is_platform_admin')
  return !error && data === true
}

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
  anomalies: { subscription_id: string; account_id: string; status: string; anomaly: string }[]
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

export const adminBillingHealth = (days = 30) => rpc<BillingHealth>('fn_admin_billing_health', { p_days: days })
export const adminSubscriptions = () => rpc<Subscriptions>('fn_admin_subscriptions')
export const adminSignups = (days = 30) => rpc<Signups>('fn_admin_signups', { p_days: days })
export const adminAlerts = (openOnly = true) => rpc<Alerts>('fn_admin_alerts', { p_open_only: openOnly })
