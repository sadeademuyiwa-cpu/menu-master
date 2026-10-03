/**
 * What the public website says, as the platform admin set it (0057).
 *
 * Kept free of React, Next and Supabase so every rule is tested directly.
 *
 * Every value is checked TWICE: when the admin saves it (so a typo is caught
 * with a message), and again when a page uses it (so a value that reached the
 * database some other way still cannot become script on a public page). A
 * value that fails the second check is simply not used.
 */

// --- analytics ---------------------------------------------------------------

export type AnalyticsSettings = {
  metaPixelId: string | null
  googleAdsId: string | null
  /** Google Ads conversion label for a new account. */
  googleAdsSignupLabel: string | null
  /** Google Ads conversion label for a paid subscription. */
  googleAdsPurchaseLabel: string | null
  ga4Id: string | null
  posthogKey: string | null
  posthogHost: string
}

export const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com'

const ANALYTICS_RULES = {
  meta_pixel_id: { re: /^\d{5,20}$/, label: 'Meta Pixel ID', example: '1234567890123456' },
  google_ads_id: { re: /^AW-\d{6,15}$/, label: 'Google Ads ID', example: 'AW-123456789' },
  google_ads_signup_label: { re: /^[A-Za-z0-9_-]{4,64}$/, label: 'Sign-up conversion label', example: 'AbCdEfGhIj' },
  google_ads_purchase_label: { re: /^[A-Za-z0-9_-]{4,64}$/, label: 'Purchase conversion label', example: 'KlMnOpQrSt' },
  ga4_id: { re: /^G-[A-Z0-9]{4,20}$/, label: 'Google Analytics ID', example: 'G-ABC123XYZ' },
  posthog_key: { re: /^phc_[A-Za-z0-9]{20,80}$/, label: 'PostHog project key', example: 'phc_…' },
  posthog_host: { re: /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i, label: 'PostHog host', example: POSTHOG_DEFAULT_HOST },
} as const

export type AnalyticsField = keyof typeof ANALYTICS_RULES
export const ANALYTICS_FIELDS = Object.keys(ANALYTICS_RULES) as AnalyticsField[]
export const analyticsFieldLabel = (f: AnalyticsField) => ANALYTICS_RULES[f].label
export const analyticsFieldExample = (f: AnalyticsField) => ANALYTICS_RULES[f].example

function pick(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== 'object') return null
  const v = (raw as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function valid(field: AnalyticsField, v: string | null): string | null {
  return v !== null && ANALYTICS_RULES[field].re.test(v) ? v : null
}

/** The stored value, keeping only ids that are exactly the expected shape. */
export function parseAnalytics(raw: unknown): AnalyticsSettings {
  return {
    metaPixelId: valid('meta_pixel_id', pick(raw, 'meta_pixel_id')),
    googleAdsId: valid('google_ads_id', pick(raw, 'google_ads_id')),
    googleAdsSignupLabel: valid('google_ads_signup_label', pick(raw, 'google_ads_signup_label')),
    googleAdsPurchaseLabel: valid('google_ads_purchase_label', pick(raw, 'google_ads_purchase_label')),
    ga4Id: valid('ga4_id', pick(raw, 'ga4_id')),
    posthogKey: valid('posthog_key', pick(raw, 'posthog_key')),
    posthogHost: valid('posthog_host', pick(raw, 'posthog_host')) ?? POSTHOG_DEFAULT_HOST,
  }
}

export function anyAnalytics(a: AnalyticsSettings): boolean {
  return Boolean(a.metaPixelId || a.googleAdsId || a.ga4Id || a.posthogKey)
}

/**
 * What the admin typed, checked. Blank means "not used". Returns the object
 * to store, or the first problem in words.
 */
export function checkAnalyticsInput(input: Record<string, string | null | undefined>):
  { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const value: Record<string, string> = {}
  for (const f of ANALYTICS_FIELDS) {
    const v = (input[f] ?? '').trim()
    if (!v) continue
    if (!ANALYTICS_RULES[f].re.test(v)) {
      return { ok: false, error: `${ANALYTICS_RULES[f].label} does not look right. It should look like ${ANALYTICS_RULES[f].example}.` }
    }
    value[f] = v
  }
  if ((value.google_ads_signup_label || value.google_ads_purchase_label) && !value.google_ads_id) {
    return { ok: false, error: 'A conversion label needs the Google Ads ID (AW-…) it belongs to.' }
  }
  return { ok: true, value }
}

// --- landing -----------------------------------------------------------------

export type Screenshot = { url: string; caption: string }
export type Testimonial = { quote: string; name: string; business: string }

export type LandingSettings = {
  logoUrl: string | null
  heroImageUrl: string | null
  screenshots: Screenshot[]
  testimonials: Testimonial[]
  /** International digits only, e.g. 2348012345678. */
  whatsapp: string | null
}

export const MAX_SCREENSHOTS = 6
export const MAX_TESTIMONIALS = 6

/**
 * An https link to a picture. No quotes, spaces or angle brackets. Plain
 * http is accepted only for this machine (127.0.0.1, localhost): that is
 * where the local stand-in for Supabase Storage serves uploads from.
 */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s.length > 600 || !/^https?:\/\/[^\s"'<>\\]+$/.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol === 'https:') return u.toString()
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u.toString()
    return null
  } catch {
    return null
  }
}

/**
 * A WhatsApp number as wa.me wants it: country code and number, digits only.
 * A Nigerian number typed the local way (080…) becomes 23480…
 */
export function normaliseWhatsapp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let d = v.replace(/[\s()+-]/g, '')
  if (!/^\d+$/.test(d)) return null
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1)
  return d.length >= 10 && d.length <= 15 ? d : null
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : ''

export function parseLanding(raw: unknown): LandingSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const shots = Array.isArray(r.screenshots) ? r.screenshots : []
  const quotes = Array.isArray(r.testimonials) ? r.testimonials : []
  return {
    logoUrl: safeImageUrl(r.logo_url),
    heroImageUrl: safeImageUrl(r.hero_image_url),
    screenshots: shots
      .map((s) => ({ url: safeImageUrl((s as Record<string, unknown>)?.url), caption: text((s as Record<string, unknown>)?.caption, 120) }))
      .filter((s): s is Screenshot => s.url !== null)
      .slice(0, MAX_SCREENSHOTS),
    testimonials: quotes
      .map((t) => {
        const o = (t ?? {}) as Record<string, unknown>
        return { quote: text(o.quote, 400), name: text(o.name, 80), business: text(o.business, 120) }
      })
      .filter((t) => t.quote && t.name)
      .slice(0, MAX_TESTIMONIALS),
    whatsapp: normaliseWhatsapp(r.whatsapp),
  }
}

/** What the admin typed on the landing form, checked, ready to store. */
export function checkLandingInput(input: {
  logo_url?: string; hero_image_url?: string; whatsapp?: string
  screenshots: { url?: string; caption?: string }[]
  testimonials: { quote?: string; name?: string; business?: string }[]
}): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {}
  for (const [k, label] of [['logo_url', 'Logo'], ['hero_image_url', 'Main picture']] as const) {
    const v = (input[k] ?? '').trim()
    if (!v) continue
    if (!safeImageUrl(v)) return { ok: false, error: `${label}: paste a full https:// link to the picture.` }
    value[k] = v
  }
  const wa = (input.whatsapp ?? '').trim()
  if (wa) {
    const n = normaliseWhatsapp(wa)
    if (!n) return { ok: false, error: 'WhatsApp number: use digits only, like 08012345678 or 2348012345678.' }
    value.whatsapp = n
  }
  const shots: Screenshot[] = []
  for (const [i, s] of input.screenshots.entries()) {
    const url = (s.url ?? '').trim()
    const caption = (s.caption ?? '').trim()
    if (!url && !caption) continue
    if (!safeImageUrl(url)) return { ok: false, error: `Screenshot ${i + 1}: paste a full https:// link to the picture.` }
    shots.push({ url, caption: caption.slice(0, 120) })
  }
  value.screenshots = shots.slice(0, MAX_SCREENSHOTS)
  const quotes: Testimonial[] = []
  for (const [i, t] of input.testimonials.entries()) {
    const quote = (t.quote ?? '').trim()
    const name = (t.name ?? '').trim()
    const business = (t.business ?? '').trim()
    if (!quote && !name && !business) continue
    if (!quote || !name) return { ok: false, error: `Testimonial ${i + 1}: it needs both what they said and their name.` }
    quotes.push({ quote: quote.slice(0, 400), name: name.slice(0, 80), business: business.slice(0, 120) })
  }
  value.testimonials = quotes.slice(0, MAX_TESTIMONIALS)
  return { ok: true, value }
}

// --- company details -----------------------------------------------------------

/**
 * Who stands behind the service, as the legal pages state it. Every field is
 * optional until the owner has the facts; the pages use neutral words for
 * what is missing instead of printing a placeholder.
 */
export type CompanyDetails = {
  legalName: string | null
  rcNumber: string | null
  address: string | null
  supportEmail: string | null
}

const PLAIN_EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/

export function parseCompany(raw: unknown): CompanyDetails {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const email = text(r.support_email, 254)
  return {
    legalName: text(r.legal_name, 160) || null,
    rcNumber: text(r.rc_number, 40) || null,
    address: text(r.address, 300) || null,
    supportEmail: PLAIN_EMAIL.test(email) ? email : null,
  }
}

export function checkCompanyInput(input: { legal_name?: string; rc_number?: string; address?: string; support_email?: string }):
  { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const value: Record<string, string> = {}
  const name = (input.legal_name ?? '').trim()
  if (name) value.legal_name = name.slice(0, 160)
  const rc = (input.rc_number ?? '').trim().replace(/^RC\s*/i, '')
  if (rc) {
    if (!/^[A-Za-z0-9 /-]{1,40}$/.test(rc)) return { ok: false, error: 'RC number: letters, digits and dashes only, like 1234567.' }
    value.rc_number = rc
  }
  const address = (input.address ?? '').trim().replace(/\s*\n\s*/g, ', ')
  if (address) value.address = address.slice(0, 300)
  const email = (input.support_email ?? '').trim()
  if (email) {
    if (!PLAIN_EMAIL.test(email) || email.length > 254) return { ok: false, error: 'Support email: one address, like help@menumasterng.com.' }
    value.support_email = email
  }
  return { ok: true, value }
}

/**
 * The words the legal pages use. "the team behind Menu Master NG" until a
 * legal name is given; the RC number follows the name when there is one.
 */
export function legalEntityWords(c: CompanyDetails): string {
  if (!c.legalName) return 'the team behind Menu Master NG'
  return c.rcNumber ? `${c.legalName} (RC ${c.rcNumber})` : c.legalName
}

/** The footer line under every legal page: only what is known. */
export function legalFooterParts(c: CompanyDetails): string[] {
  return [c.legalName ? legalEntityWords(c) : 'Menu Master NG', c.address, c.supportEmail]
    .filter((p): p is string => Boolean(p))
}

// --- sign-in -----------------------------------------------------------------

/** The admin's switch for "Continue with Google" (the provider itself is set up in Supabase). */
export type SignInSettings = { google: boolean }

export function parseSignIn(raw: unknown): SignInSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { google: r.google === true }
}

/**
 * The Google button shows only when the admin has switched it on AND
 * Supabase says the Google provider is enabled. Either alone would show a
 * button that leads to an error page.
 */
export function showGoogleButton(s: SignInSettings, providerEnabled: boolean | null): boolean {
  return s.google && providerEnabled === true
}

// --- privacy -----------------------------------------------------------------

export type PrivacySettings = { body: string | null; effectiveDate: string | null }

export function parsePrivacy(raw: unknown): PrivacySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const body = typeof r.body === 'string' && r.body.trim() ? r.body.slice(0, 60000) : null
  const date = typeof r.effective_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.effective_date) ? r.effective_date : null
  return { body, effectiveDate: date }
}

/**
 * A policy written as plain text, as blocks to render: "## " starts a
 * heading, "- " a bullet, a blank line ends a paragraph. Rendered as React
 * elements, never as HTML, so nothing typed here can run as script.
 */
export type DocBlock =
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }

export function plainDoc(body: string): DocBlock[] {
  const blocks: DocBlock[] = []
  let para: string[] = []
  let list: string[] | null = null
  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', text: para.join(' ') }); para = [] } }
  const flushList = () => { if (list) { blocks.push({ kind: 'ul', items: list }); list = null } }
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) { flushPara(); flushList(); continue }
    if (line.startsWith('## ')) { flushPara(); flushList(); blocks.push({ kind: 'h2', text: line.slice(3).trim() }); continue }
    if (line.startsWith('- ')) { flushPara(); (list ??= []).push(line.slice(2).trim()); continue }
    flushList()
    para.push(line)
  }
  flushPara(); flushList()
  return blocks
}
