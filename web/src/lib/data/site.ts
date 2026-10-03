import 'server-only'
import { unstable_cache } from 'next/cache'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  parseAnalytics, parseLanding, parsePrivacy, parseCompany, parseSignIn, showGoogleButton,
  type AnalyticsSettings, type LandingSettings, type PrivacySettings, type CompanyDetails, type SignInSettings,
} from '@/lib/site/settings'

export type SiteSettings = {
  analytics: AnalyticsSettings
  landing: LandingSettings
  privacy: PrivacySettings
  company: CompanyDetails
  signin: SignInSettings
  /** False when 0057 is not applied yet (or the database was unreachable). */
  available: boolean
}

export const SITE_SETTINGS_TAG = 'site-settings'

/**
 * The public website's settings (0057), read as a logged-out visitor would
 * and cached for a minute -- every page carries the pixels, and reading the
 * session cookie here would make every page, /login included, dynamic. The
 * admin's save clears the cache at once (revalidateTag).
 *
 * Only key and value are asked for: updated_by is not granted to clients,
 * so `select *` would be refused. Before 0057 is applied the table does not
 * exist; everything then falls back to what the code ships with -- no
 * pixels, the bundled privacy policy, a landing page without pictures --
 * instead of breaking the page.
 */
const anon = () => createAnonClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

/**
 * A database that answered "no such table" (0057 not applied) is an answer
 * worth caching. A database that could not be reached is not: it throws,
 * which unstable_cache does not store, so the next request tries again. A
 * build that ran while the database was unreachable once cached "no prices"
 * for five minutes.
 */
function unreachable(error: { code?: string } | null): boolean {
  return Boolean(error) && !error?.code
}

const readPublic = unstable_cache(async (): Promise<{ rows: { key: string; value: unknown }[] | null }> => {
  const { data, error } = await anon().from('site_settings').select('key, value')
  if (unreachable(error)) throw new Error('site_settings: database unreachable')
  return { rows: error ? null : (data as { key: string; value: unknown }[]) }
}, ['site-settings-v1'], { revalidate: 60, tags: [SITE_SETTINGS_TAG] })

export async function loadSiteSettings(): Promise<SiteSettings> {
  const { rows } = await readPublic().catch(() => ({ rows: null }))
  const by = (k: string) => rows?.find((r) => r.key === k)?.value ?? {}
  return {
    analytics: parseAnalytics(by('analytics')),
    landing: parseLanding(by('landing')),
    privacy: parsePrivacy(by('privacy')),
    company: parseCompany(by('company')),
    signin: parseSignIn(by('signin')),
    available: rows !== null,
  }
}

/**
 * Whether the Google provider is switched on in Supabase, from the auth
 * server's public settings (the same answer any browser can get). Null when
 * it could not be asked; cached for five minutes, failures not cached.
 */
const readProvider = unstable_cache(async (): Promise<boolean | null> => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { external?: { google?: unknown } } | null
  return body?.external?.google === true
}, ['google-provider-v1'], { revalidate: 300, tags: [SITE_SETTINGS_TAG] })

export async function googleProviderEnabled(): Promise<boolean | null> {
  return readProvider().catch(() => null)
}

/**
 * The same question, asked fresh: for the admin page, which must show the
 * truth the moment Google is switched on in Supabase. (Saving there clears
 * the cached answer the public pages use.)
 */
export async function googleProviderEnabledNow(): Promise<boolean | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { external?: { google?: unknown } } | null
    return body?.external?.google === true
  } catch {
    return null
  }
}

/** Whether the login and signup pages offer "Continue with Google". */
export async function googleSignInShown(): Promise<boolean> {
  const [site, provider] = await Promise.all([loadSiteSettings(), googleProviderEnabled()])
  return showGoogleButton(site.signin, provider)
}

export type PublicPlan = { tier: 'costing' | 'trading'; standard: number | null; founding: number | null }

/**
 * Plan prices for the landing page, as a logged-out visitor may read them
 * (plans is one of anon's five reference tables). Whether founding places
 * remain is NOT public (founder_slots), so the page states standard prices
 * and only says a founding price may be offered.
 */
const readPlans = unstable_cache(async (): Promise<PublicPlan[] | null> => {
  const { data, error } = await anon().from('plans').select('tier, price_tier, price_kobo').eq('is_active', true)
  if (unreachable(error)) throw new Error('plans: database unreachable')
  if (error || !data) return null
  const rows = data as { tier: string; price_tier: string; price_kobo: number }[]
  const price = (tier: string, pt: string) => {
    const r = rows.find((x) => x.tier === tier && x.price_tier === pt)
    return r ? r.price_kobo / 100 : null
  }
  return (['costing', 'trading'] as const).map((tier) => ({
    tier, standard: price(tier, 'standard'), founding: price(tier, 'founding'),
  }))
}, ['public-plans-v1'], { revalidate: 300 })

export async function loadPublicPlans(): Promise<PublicPlan[] | null> {
  return readPlans().catch(() => null)
}

/** The stored values with their dates, for the admin's forms. Never cached. */
export async function loadSiteSettingsRaw(): Promise<Record<string, Record<string, unknown>> | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('site_settings').select('key, value, updated_at')
    .returns<{ key: string; value: Record<string, unknown>; updated_at: string }[]>()
  if (error) return null
  return Object.fromEntries((data ?? []).map((r) => [r.key, { ...r.value, _updated_at: r.updated_at }]))
}
