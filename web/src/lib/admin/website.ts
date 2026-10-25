/**
 * What the public website shows right now, area by area, and what is still
 * missing -- worked out from the same settings the website itself reads.
 * Pure: the page parses the settings (lib/site/settings.ts) and hands them
 * in; only `import type` here, so node --test runs it as it is.
 */
import type { AnalyticsSettings, CompanyDetails, LandingSettings, PrivacySettings, SignInSettings } from '../site/settings'

export type WebsiteFacts = {
  company: CompanyDetails
  analytics: AnalyticsSettings
  landing: LandingSettings
  privacy: PrivacySettings
  signin: SignInSettings
  /** Google switched on in Supabase; null when Supabase could not be asked. */
  provider: boolean | null
  /** Help videos set, of how many screens; null before 0065. */
  help: { set: number; total: number } | null
  /** When each area was last saved; null if never. */
  saved: { company: string | null; privacy: string | null }
}

export type AreaKey = 'company' | 'signin' | 'tracking' | 'landing' | 'privacy' | 'help'

/**
 * How much a gap matters, in the order the admin should fix them:
 * reach -- a customer with a problem cannot reach you;
 * legal -- the legal pages are vaguer than they should be;
 * extra -- the website works, it could do more.
 */
export type Priority = 'reach' | 'legal' | 'extra'

export type CheckItem = {
  key: string
  area: AreaKey
  priority: Priority
  label: string
  done: boolean
  /** What a visitor gets while it is missing. */
  missing: string
}

const ORDER: Record<Priority, number> = { reach: 0, legal: 1, extra: 2 }

/**
 * The website's to-do list, the most important first. Optional extras (a
 * logo of your own, Google sign-in while switched off) are not on it: the
 * defaults are fine.
 */
export function websiteChecklist(f: WebsiteFacts): CheckItem[] {
  const a = f.analytics
  const c = f.company
  // Either channel lets a customer write; only with neither is it urgent.
  const noWay = customersCannotReach(f)
  const items: CheckItem[] = [
    { key: 'support_email', area: 'company', priority: noWay ? 'reach' : 'legal', label: 'Support email', done: !!c.supportEmail,
      missing: f.landing.whatsapp ? 'Terms and Refunds point to your WhatsApp number instead' : 'Terms and Refunds point to "our support team", with no address' },
    { key: 'whatsapp', area: 'landing', priority: noWay ? 'reach' : 'extra', label: 'WhatsApp number', done: !!f.landing.whatsapp,
      missing: 'No WhatsApp button on the website, and no "Ask us" in the app' },
    { key: 'legal_name', area: 'company', priority: 'legal', label: 'Legal company name', done: !!c.legalName,
      missing: 'The legal pages say "the team behind Menu Master NG"' },
    { key: 'address', area: 'company', priority: 'legal', label: 'Business address', done: !!c.address,
      missing: 'Left out of the legal pages' },
    { key: 'privacy', area: 'privacy', priority: 'legal', label: 'Privacy policy saved', done: f.privacy.body !== null,
      missing: '/privacy shows the built-in draft' },
  ]
  if (c.rcNumber && !c.legalName) {
    items.push({ key: 'rc_alone', area: 'company', priority: 'legal', label: 'Legal name for the RC number', done: false,
      missing: 'The RC number shows only after a legal name, so it appears nowhere' })
  }
  if (privacyStale(f)) {
    items.push({ key: 'privacy_stale', area: 'privacy', priority: 'legal', label: 'Privacy policy matches the company details', done: false,
      missing: 'The policy text does not give the company details saved since; it keeps the old ones' })
  }
  if (f.signin.google) {
    items.push({ key: 'google', area: 'signin', priority: 'extra', label: 'Google sign-in showing', done: f.provider === true,
      missing: 'Switched on here but not in Supabase, so the button is hidden' })
  }
  items.push({ key: 'tracking', area: 'tracking', priority: 'extra', label: 'A tracking tool', done: !!(a.metaPixelId || a.googleAdsId || a.ga4Id || a.posthogKey),
    missing: 'No cookie notice, and no ad or visitor measurement' })
  if (a.googleAdsId) {
    const uncounted = [!a.googleAdsSignupLabel && 'sign-ups', !a.googleAdsPurchaseLabel && 'purchases'].filter(Boolean).join(' or ')
    items.push({ key: 'ads_labels', area: 'tracking', priority: 'extra', label: 'Google Ads conversion labels', done: !uncounted,
      missing: `The Ads tag loads but counts no ${uncounted || 'conversions'}` })
  }
  items.push(
    { key: 'hero', area: 'landing', priority: 'extra', label: 'Main picture', done: !!f.landing.heroImageUrl,
      missing: 'A drawn example dish shows instead' },
    { key: 'screenshots', area: 'landing', priority: 'extra', label: 'Screenshots of the app', done: f.landing.screenshots.length > 0,
      missing: '"Inside the app" is hidden' },
    { key: 'testimonials', area: 'landing', priority: 'extra', label: 'Customer testimonials', done: f.landing.testimonials.length > 0,
      missing: '"From our customers" is hidden' },
  )
  if (f.help) {
    items.push({ key: 'help', area: 'help', priority: 'extra', label: `Help videos for every screen (${f.help.set} of ${f.help.total})`,
      done: f.help.set >= f.help.total, missing: 'Screens without a video show no Help button' })
  }
  return items.map((it, i) => ({ it, i })).sort((x, y) => ORDER[x.it.priority] - ORDER[y.it.priority] || x.i - y.i).map((x) => x.it)
}

/** No support email and no WhatsApp: a customer with a problem has nowhere to write. */
export function customersCannotReach(f: WebsiteFacts): boolean {
  return !f.company.supportEmail && !f.landing.whatsapp
}

/**
 * The saved policy no longer gives the company's details. Judged by what the
 * text says, not by save times: saving Company details again unchanged moves
 * its date on, and a policy that already names the company, its address and
 * its support email is still right.
 */
export function privacyStale(f: WebsiteFacts): boolean {
  const body = f.privacy.body
  if (body === null || !f.saved.company || !f.saved.privacy || f.saved.company <= f.saved.privacy) return false
  const c = f.company
  return [c.legalName, c.address, c.supportEmail].some((s) => s !== null && !body.includes(s))
}

export type AreaTone = 'good' | 'warn' | 'neutral'

export type Area = {
  key: AreaKey
  title: string
  href: string
  tone: AreaTone
  status: string
  /** One line: what a visitor sees now. */
  now: string
  /** This area's own open items, most important first. */
  gaps: CheckItem[]
}

const SITE = '/admin/site'

const listWords = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** The six areas the admin controls, each with its state in a word, a line, and its gaps. */
export function websiteAreas(f: WebsiteFacts, checklist = websiteChecklist(f)): Area[] {
  const c = f.company
  const companySet = [c.legalName, c.rcNumber, c.address, c.supportEmail].filter(Boolean).length
  const a = f.analytics
  const tools = [a.metaPixelId && 'Meta', a.googleAdsId && 'Google Ads', a.ga4Id && 'Google Analytics', a.posthogKey && 'PostHog']
    .filter((t): t is string => !!t)
  const l = f.landing
  const custom = [l.logoUrl, l.heroImageUrl, l.whatsapp].filter(Boolean).length + (l.screenshots.length ? 1 : 0) + (l.testimonials.length ? 1 : 0)
  const showing = f.signin.google && f.provider === true
  const gaps = (k: AreaKey) => checklist.filter((i) => i.area === k && !i.done)
  const stale = privacyStale(f)

  const areas: Area[] = [
    {
      key: 'company', title: 'Company details', href: `${SITE}/company`,
      tone: companySet === 4 ? 'good' : 'warn',
      status: companySet === 4 ? 'Complete' : companySet === 0 ? 'Not set' : `${companySet} of 4 set`,
      now: c.legalName
        ? `The legal pages name ${c.legalName}${c.supportEmail ? ` and give ${c.supportEmail}` : ''}`
        : 'The legal pages say "the team behind Menu Master NG"',
      gaps: gaps('company'),
    },
    {
      key: 'signin', title: 'Sign in with Google', href: `${SITE}/sign-in`,
      tone: showing ? 'good' : f.signin.google ? 'warn' : 'neutral',
      status: showing ? 'Live' : f.signin.google ? 'Waiting on Supabase' : 'Off',
      now: showing ? '"Continue with Google" shows on log in and sign up' : 'Log in and sign up offer email and password only',
      gaps: gaps('signin'),
    },
    {
      key: 'tracking', title: 'Tracking pixels', href: `${SITE}/tracking`,
      tone: tools.length ? 'good' : 'neutral',
      status: tools.length ? `${tools.length} on` : 'Off',
      now: tools.length
        ? `New visitors see the cookie notice; ${listWords(tools)} load after Accept`
        : 'No cookie notice; nothing is measured',
      gaps: gaps('tracking'),
    },
    {
      key: 'landing', title: 'Landing page', href: `${SITE}/landing`,
      tone: custom ? 'good' : 'neutral',
      status: custom ? 'Your content' : 'Defaults',
      now: [
        l.heroImageUrl ? 'Your main picture' : 'A drawn example dish',
        l.screenshots.length ? `${l.screenshots.length} screenshot${l.screenshots.length === 1 ? '' : 's'}` : 'no screenshots',
        l.testimonials.length ? `${l.testimonials.length} testimonial${l.testimonials.length === 1 ? '' : 's'}` : 'no testimonials',
        l.whatsapp ? 'a WhatsApp button' : 'no WhatsApp',
      ].join(' · '),
      gaps: gaps('landing'),
    },
    {
      key: 'privacy', title: 'Privacy policy', href: `${SITE}/privacy`,
      tone: f.privacy.body === null || stale ? 'warn' : 'good',
      status: f.privacy.body === null ? 'Draft' : stale ? 'Check it' : 'Live',
      now: f.privacy.body === null
        ? '/privacy shows the built-in draft'
        : `/privacy shows your text${f.privacy.effectiveDate ? `, in effect from ${fmtIsoDay(f.privacy.effectiveDate)}` : ''}`,
      gaps: gaps('privacy'),
    },
  ]
  if (f.help) {
    const { set, total } = f.help
    areas.push({
      key: 'help', title: 'Help videos', href: '/admin/help',
      tone: set >= total ? 'good' : 'neutral',
      status: `${set} of ${total}`,
      now: set === 0 ? 'No screen shows a Help button' : `${set} screen${set === 1 ? ' shows' : 's show'} a Help button`,
      gaps: gaps('help'),
    })
  }
  return areas
}

function fmtIsoDay(day: string): string {
  const d = new Date(day + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}
