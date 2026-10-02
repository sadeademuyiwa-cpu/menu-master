/**
 * The moments worth measuring, and what each ad and analytics tool calls
 * them.
 *
 * Kept free of React and the browser so the mapping is tested directly. No
 * event carries anything a customer entered -- no names, amounts of their
 * sales, dish names or email addresses. The only value sent is the price of
 * the plan someone chose to pay for, which is our own number.
 */
import type { AnalyticsSettings } from '@/lib/site/settings'

export const APP_EVENTS = [
  'landing_view',
  'sign_up',
  'email_confirmed',
  'business_created',
  'first_purchase_recorded',
  'setup_completed',
  'sale_recorded',
  'receipt_shared',
  'checkout_started',
  'subscription_activated',
  'trial_ended_seen',
] as const

export type AppEvent = (typeof APP_EVENTS)[number]

/** Our own figures only: a plan's monthly price, in naira. */
export type EventProps = { value?: number; plan?: string; method?: string }

export function isAppEvent(x: unknown): x is AppEvent {
  return typeof x === 'string' && (APP_EVENTS as readonly string[]).includes(x)
}

function cleanProps(p: unknown): EventProps {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  const out: EventProps = {}
  if (typeof o.value === 'number' && Number.isFinite(o.value) && o.value >= 0 && o.value < 10_000_000) out.value = o.value
  if (typeof o.plan === 'string' && /^[a-z_]{1,32}$/.test(o.plan)) out.plan = o.plan
  if (typeof o.method === 'string' && /^[a-z_]{1,32}$/.test(o.method)) out.method = o.method
  return out
}

// --- Meta Pixel ----------------------------------------------------------------

/** fbq('track' | 'trackCustom', name, params). Standard events where Meta has one. */
export function metaCall(e: AppEvent, p: EventProps = {}): ['track' | 'trackCustom', string, Record<string, unknown>] {
  const money = p.value !== undefined ? { value: p.value, currency: 'NGN' } : {}
  switch (e) {
    case 'landing_view': return ['track', 'ViewContent', { content_name: 'landing' }]
    case 'sign_up': return ['track', 'CompleteRegistration', p.method ? { method: p.method } : {}]
    case 'setup_completed': return ['track', 'StartTrial', { value: 0, currency: 'NGN' }]
    case 'checkout_started': return ['track', 'InitiateCheckout', { ...money, ...(p.plan ? { content_name: p.plan } : {}) }]
    case 'subscription_activated': return ['track', 'Subscribe', { ...money, ...(p.plan ? { content_name: p.plan } : {}) }]
    default: return ['trackCustom', e, { ...p }]
  }
}

// --- Google Ads ----------------------------------------------------------------

/** The conversion to report, when the admin has set its label. */
export function googleAdsConversion(e: AppEvent, a: AnalyticsSettings, p: EventProps = {}):
  { send_to: string; value?: number; currency?: string } | null {
  if (!a.googleAdsId) return null
  const label = e === 'sign_up' ? a.googleAdsSignupLabel
    : e === 'subscription_activated' ? a.googleAdsPurchaseLabel
    : null
  if (!label) return null
  return {
    send_to: `${a.googleAdsId}/${label}`,
    ...(p.value !== undefined ? { value: p.value, currency: 'NGN' } : {}),
  }
}

// --- events raised on the server -------------------------------------------------

/**
 * A server action cannot run browser code, so what it wants measured rides
 * to the next page in a short-lived cookie, base64url-encoded JSON so it
 * needs no cookie escaping. The browser reads it once and clears it.
 */
export const EVENT_COOKIE = 'mm_evt'

/** JSON in a cookie without cookie escaping: base64url is cookie-safe. */
function toB64url(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): string {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)))
}

export type Queued = { e: AppEvent; p: EventProps }

export function encodeQueue(q: Queued[]): string {
  return toB64url(JSON.stringify(q.slice(-5)))
}

/** Whatever is in the cookie, keeping only real events with clean props. */
export function decodeQueue(v: string | null | undefined): Queued[] {
  if (!v || !/^[A-Za-z0-9_-]{1,2000}$/.test(v)) return []
  try {
    const raw = JSON.parse(fromB64url(v))
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x) => x && isAppEvent(x.e))
      .map((x) => ({ e: x.e as AppEvent, p: cleanProps(x.p) }))
      .slice(-5)
  } catch {
    return []
  }
}

// --- where the visitor came from -------------------------------------------------

/**
 * The advert or link that brought someone, from the first page they opened
 * (utm_* tags, Google's gclid, Meta's fbclid). Kept in a first-party session
 * cookie and saved with the new account only if they accepted cookies; never
 * sent to an advertiser.
 */
export const SOURCE_COOKIE = 'mm_src'
const SOURCE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'] as const
export type Source = Partial<Record<(typeof SOURCE_KEYS)[number] | 'landing', string>>

export function sourceFromUrl(url: URL): Source | null {
  const out: Source = {}
  for (const k of SOURCE_KEYS) {
    const v = url.searchParams.get(k)
    if (v && v.trim()) out[k] = v.trim().slice(0, 150)
  }
  if (Object.keys(out).length === 0) return null
  out.landing = url.pathname.slice(0, 100)
  return out
}

export function encodeSource(s: Source): string {
  return toB64url(JSON.stringify(s))
}

export function decodeSource(v: string | null | undefined): Source | null {
  if (!v || !/^[A-Za-z0-9_-]{1,3000}$/.test(v)) return null
  try {
    const raw = JSON.parse(fromB64url(v)) as Record<string, unknown>
    const out: Source = {}
    for (const k of [...SOURCE_KEYS, 'landing'] as const) {
      const x = raw?.[k]
      if (typeof x === 'string' && x) out[k] = x.slice(0, 150)
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
