import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { loadSiteSettingsRaw, googleProviderEnabledNow, SITE_SETTINGS_TAG } from '@/lib/data/site'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Card, SectionHeading, Notice, Field, Disclosure, Badge } from '@/components/ui'
import { Button } from '@/components/button'
import { ImageField } from '@/components/image-field'
import { CopyValue } from '@/components/copy-value'
import {
  ANALYTICS_FIELDS, analyticsFieldLabel, analyticsFieldExample, checkAnalyticsInput,
  checkLandingInput, parseLanding, MAX_SCREENSHOTS, MAX_TESTIMONIALS, POSTHOG_DEFAULT_HOST,
  checkCompanyInput, parseCompany, parseSignIn, showGoogleButton,
  type AnalyticsField,
} from '@/lib/site/settings'
import { privacyDraft, PRIVACY_DRAFT_DATE } from '@/lib/site/privacy-draft'
import { fmtDateTime } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const HERE = '/admin/site'

async function save(key: 'analytics' | 'landing' | 'privacy' | 'company' | 'signin', value: Record<string, unknown>, done: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('fn_admin_set_site_setting', { p_key: key, p_value: value })
  // Every page carries the pixels; the landing and privacy pages carry the
  // rest. Clear the cached settings and every page built from them.
  revalidateTag(SITE_SETTINGS_TAG)
  revalidatePath('/', 'layout')
  redirect(withNotice(HERE, describeWriteError(error) ?? done))
}

async function saveCompany(formData: FormData) {
  'use server'
  const s = (k: string) => String(formData.get(k) ?? '')
  const checked = checkCompanyInput({
    legal_name: s('legal_name'), rc_number: s('rc_number'), address: s('address'), support_email: s('support_email'),
  })
  if (!checked.ok) redirect(withNotice(HERE, checked.error))
  await save('company', checked.value, 'Company details saved. Terms, Refunds and Privacy now show them.')
}

async function saveSignIn(formData: FormData) {
  'use server'
  const on = formData.get('google') === 'on'
  await save('signin', { google: on }, on
    ? 'Sign-in saved. "Continue with Google" shows once Google is switched on in Supabase.'
    : 'Sign-in saved. "Continue with Google" is hidden.')
}

async function saveAnalytics(formData: FormData) {
  'use server'
  const input = Object.fromEntries(ANALYTICS_FIELDS.map((f) => [f, String(formData.get(f) ?? '')]))
  const checked = checkAnalyticsInput(input)
  if (!checked.ok) redirect(withNotice(HERE, checked.error))
  await save('analytics', checked.value, 'Tracking saved. It applies to visitors who accept cookies.')
}

async function saveLanding(formData: FormData) {
  'use server'
  const s = (k: string) => String(formData.get(k) ?? '')
  const checked = checkLandingInput({
    logo_url: s('logo_url'),
    hero_image_url: s('hero_image_url'),
    whatsapp: s('whatsapp'),
    screenshots: Array.from({ length: MAX_SCREENSHOTS }, (_, i) => ({ url: s(`shot_url_${i}`), caption: s(`shot_caption_${i}`) })),
    testimonials: Array.from({ length: MAX_TESTIMONIALS }, (_, i) => ({
      quote: s(`t_quote_${i}`), name: s(`t_name_${i}`), business: s(`t_business_${i}`),
    })),
  })
  if (!checked.ok) redirect(withNotice(HERE, checked.error))
  await save('landing', checked.value, 'Landing page saved.')
}

async function savePrivacy(formData: FormData) {
  'use server'
  const restore = formData.get('restore') === '1'
  const company = parseCompany((await loadSiteSettingsRaw())?.company ?? {})
  // Control characters other than newlines and tabs are dropped: they have
  // no place in a policy and only confuse whoever reads it next.
  const body = restore ? privacyDraft(company) : String(formData.get('body') ?? '')
    .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 60000)
  const date = restore ? PRIVACY_DRAFT_DATE : String(formData.get('effective_date') ?? '')
  if (!body.trim()) redirect(withNotice(HERE, 'The privacy policy cannot be empty. Use "Start again from the draft" instead.'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(withNotice(HERE, 'Give the date this version takes effect.'))
  await save('privacy', { body, effective_date: date },
    restore ? 'Privacy policy reset to the draft.' : 'Privacy policy saved. It is live at /privacy.')
}

const ANALYTICS_HELP: Record<AnalyticsField, string> = {
  meta_pixel_id: 'Meta Events Manager → Data sources → your pixel. Digits only.',
  google_ads_id: 'Google Ads → Goals → Conversions → a conversion → Tag setup. Starts with AW-.',
  google_ads_signup_label: 'From the same tag: the part after the slash in send_to, for your "Sign-up" conversion.',
  google_ads_purchase_label: 'The same, for your "Purchase" or "Subscribe" conversion.',
  ga4_id: 'Google Analytics → Admin → Data streams → your site. Starts with G-.',
  posthog_key: 'PostHog → Project settings → Project API key. Starts with phc_.',
  posthog_host: `Leave blank for the US cloud (${POSTHOG_DEFAULT_HOST}). EU cloud: https://eu.i.posthog.com`,
}

export default async function AdminSite(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const [raw, provider] = await Promise.all([loadSiteSettingsRaw(), googleProviderEnabledNow()])
  if (!raw) return <Notice>Website settings are not available on this database yet (0057).</Notice>

  const companyRaw = raw.company ?? {}
  const company = parseCompany(companyRaw)
  const signin = parseSignIn(raw.signin ?? {})
  const googleShown = showGoogleButton(signin, provider)
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://menumasterng.com').replace(/\/$/, '')
  const siteHost = new URL(site).hostname
  const origins = [site, ...(/^(www\.|localhost$|\d+\.\d+\.\d+\.\d+$)/.test(siteHost) ? [] : [site.replace('://', '://www.')])]
  const supabaseCallback = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`

  const a = raw.analytics ?? {}
  const landingRaw = raw.landing ?? {}
  const landing = parseLanding(landingRaw)
  const privacy = raw.privacy ?? {}
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const shots = Array.isArray(landingRaw.screenshots) ? (landingRaw.screenshots as Record<string, string>[]) : []
  const quotes = Array.isArray(landingRaw.testimonials) ? (landingRaw.testimonials as Record<string, string>[]) : []
  // The rows exist from the migration on; only a saved value has a "last saved".
  const stamp = (o: Record<string, unknown>) =>
    typeof o._updated_at === 'string' && Object.keys(o).some((k) => k !== '_updated_at')
      ? `Last saved ${fmtDateTime(o._updated_at)}` : 'Not saved yet'
  const bad = notice && /not|cannot|needs|look right|paste|give|could/i.test(notice)

  return (
    <div className="space-y-8">
      {notice && <Notice tone={bad ? 'warn' : 'info'}>{notice}</Notice>}

      {/* --- company ------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="Shown on Terms, Refunds and Privacy, and under them. Leave anything you do not have yet empty: the pages use neutral words instead, never a placeholder.">
          Company details
        </SectionHeading>
        <Card>
          <form action={saveCompany} className="space-y-4">
            <Field label="Legal company name">
              <input name="legal_name" defaultValue={str(companyRaw, 'legal_name')} placeholder="As registered with CAC" className="mm-input mt-1" />
            </Field>
            <Field label="RC number">
              <input name="rc_number" defaultValue={str(companyRaw, 'rc_number')} placeholder="1234567" className="mm-input mt-1" />
            </Field>
            <Field label="Business address">
              <textarea name="address" defaultValue={str(companyRaw, 'address')} rows={2} placeholder="Street, area, city, state" className="mm-input mt-1" />
            </Field>
            <Field label="Support email">
              <input name="support_email" type="email" defaultValue={str(companyRaw, 'support_email')} placeholder="help@menumasterng.com" className="mm-input mt-1" />
              <span className="mt-1 block text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                Where customers write about billing, refunds and their data. Empty: the pages point to your WhatsApp number, if set.
              </span>
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                {stamp(companyRaw)} · <Link href="/terms" className="underline" target="_blank">See /terms</Link>
              </span>
              <Button busyLabel="Saving…">Save company details</Button>
            </div>
          </form>
        </Card>
      </section>

      {/* --- Google sign-in -------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="Owners who sign in with Google skip the confirmation email. The button appears only when Google is switched on in Supabase AND here, so it can never lead to an error page.">
          Sign in with Google
        </SectionHeading>
        <Card>
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={provider === true ? 'good' : provider === false ? 'warn' : 'muted'}>
                {provider === true ? 'On in Supabase' : provider === false ? 'Not on in Supabase yet' : 'Could not ask Supabase'}
              </Badge>
              <Badge tone={signin.google ? 'good' : 'muted'}>{signin.google ? 'Switched on here' : 'Switched off here'}</Badge>
              <span style={{ color: 'var(--mm-muted)' }}>
                The button is <strong>{googleShown ? 'showing' : 'hidden'}</strong> on log in and sign up.
              </span>
            </div>

            <Disclosure summary="How to set it up (paste these values)" open={provider !== true}>
              <ol className="list-decimal space-y-4 pl-5 text-sm">
                <li className="space-y-2">
                  <p><strong>Google Cloud</strong> → APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Web application.</p>
                  {origins.map((o, i) => <CopyValue key={o} label={`Authorised JavaScript origin ${i + 1}`} value={o} />)}
                  <CopyValue label="Authorised redirect URI" value={supabaseCallback} />
                </li>
                <li className="space-y-2">
                  <p><strong>Google Cloud</strong> → OAuth consent screen: app name Menu Master NG; scopes email, profile, openid.</p>
                  <CopyValue label="Authorised domain" value={siteHost} />
                  <CopyValue label="Privacy policy link" value={`${site}/privacy`} />
                  <CopyValue label="Terms of service link" value={`${site}/terms`} />
                </li>
                <li>
                  <p><strong>Supabase</strong> → Authentication → Sign In / Providers → Google: switch on, paste the Client ID and Client Secret from step 1, save.</p>
                </li>
                <li className="space-y-2">
                  <p><strong>Supabase</strong> → Authentication → URL Configuration → Redirect URLs: add</p>
                  <CopyValue label="Redirect URL" value={`${site}/**`} />
                </li>
                <li><p>Switch it on below. The first badge turns green within five minutes of step 3.</p></li>
              </ol>
            </Disclosure>

            <form action={saveSignIn} className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
                <input type="checkbox" name="google" defaultChecked={signin.google} className="h-5 w-5" />
                Offer “Continue with Google” on log in and sign up
              </label>
              <Button busyLabel="Saving…">Save sign-in</Button>
            </form>
          </div>
        </Card>
      </section>

      {/* --- tracking ------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionHeading sub="Ad and analytics tags load only for visitors who press Accept on the cookie notice. Leave a box empty to switch that tool off.">
          Tracking pixels
        </SectionHeading>
        <Card>
          <form action={saveAnalytics} className="space-y-4">
            {ANALYTICS_FIELDS.map((f) => (
              <Field key={f} label={analyticsFieldLabel(f)}>
                <input name={f} defaultValue={str(a, f)} placeholder={analyticsFieldExample(f)}
                       autoComplete="off" spellCheck={false} className="mm-input mt-1 font-mono" />
                <span className="mt-1 block text-[13px]" style={{ color: 'var(--mm-muted)' }}>{ANALYTICS_HELP[f]}</span>
              </Field>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>{stamp(a)}</span>
              <Button busyLabel="Saving…">Save tracking</Button>
            </div>
          </form>
        </Card>
      </section>

      {/* --- landing ------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="Upload a picture from this phone or computer (PNG, JPEG or WebP, up to 2 MB), or paste a link to one. Nothing changes on the website until you press Save. Anything left empty is simply not shown.">
          Landing page
        </SectionHeading>
        <Card>
          <form action={saveLanding} className="space-y-4">
            <ImageField name="logo_url" label="Logo" prefix="logo"
                        defaultValue={str(landingRaw, 'logo_url')} placeholder="https://…/logo.png" />
            <ImageField name="hero_image_url" label="Main picture (beside the headline)" prefix="hero"
                        defaultValue={str(landingRaw, 'hero_image_url')} placeholder="https://…/app-on-phone.png"
                        help="A phone screenshot of the app works best. Empty: a drawn preview of a costed dish is shown instead." />
            <Field label="WhatsApp number for questions">
              <input name="whatsapp" defaultValue={str(landingRaw, 'whatsapp')} placeholder="08012345678" inputMode="tel" className="mm-input mt-1" />
            </Field>

            <Disclosure summary={`Screenshots (${landing.screenshots.length} of ${MAX_SCREENSHOTS})`} open={landing.screenshots.length > 0}>
              <div className="space-y-5">
                {Array.from({ length: MAX_SCREENSHOTS }, (_, i) => (
                  <div key={i} className="space-y-1">
                    <ImageField name={`shot_url_${i}`} prefix={`screen-${i + 1}`}
                                defaultValue={shots[i]?.url ?? ''} placeholder={`Screenshot ${i + 1}: https://…`} />
                    <input name={`shot_caption_${i}`} defaultValue={shots[i]?.caption ?? ''} placeholder="Caption" aria-label={`Screenshot ${i + 1} caption`} className="mm-input" />
                  </div>
                ))}
              </div>
            </Disclosure>

            <Disclosure summary={`Testimonials (${landing.testimonials.length} of ${MAX_TESTIMONIALS})`} open={landing.testimonials.length > 0}>
              <div className="space-y-5">
                {Array.from({ length: MAX_TESTIMONIALS }, (_, i) => (
                  <div key={i} className="space-y-2">
                    <textarea name={`t_quote_${i}`} defaultValue={quotes[i]?.quote ?? ''} rows={2} placeholder={`Testimonial ${i + 1}: what they said`} aria-label={`Testimonial ${i + 1} quote`} className="mm-input" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input name={`t_name_${i}`} defaultValue={quotes[i]?.name ?? ''} placeholder="Their name" aria-label={`Testimonial ${i + 1} name`} className="mm-input" />
                      <input name={`t_business_${i}`} defaultValue={quotes[i]?.business ?? ''} placeholder="Business, city" aria-label={`Testimonial ${i + 1} business`} className="mm-input" />
                    </div>
                  </div>
                ))}
                <p className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                  Only real customers, in their own words, with their permission.
                </p>
              </div>
            </Disclosure>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                {stamp(landingRaw)} · <Link href="/?preview=1" className="underline" target="_blank">See the landing page</Link>
              </span>
              <Button busyLabel="Saving…">Save landing page</Button>
            </div>
          </form>
        </Card>
      </section>

      {/* --- privacy ------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub='Plain text. A line starting "## " is a heading, "- " a bullet point, and an empty line starts a new paragraph.'>
          Privacy policy
        </SectionHeading>
        <Card>
          {!str(privacy, 'body') && (
            <p className="mb-3 text-sm" style={{ color: 'var(--mm-muted)' }}>
              Not saved yet: /privacy shows the draft below, built from the company details above. Read it, then save.
            </p>
          )}
          <form action={savePrivacy} className="space-y-4">
            <Field label="Takes effect on">
              <input type="date" name="effective_date" required
                     defaultValue={str(privacy, 'effective_date') || PRIVACY_DRAFT_DATE} className="mm-input mt-1 max-w-[12rem]" />
            </Field>
            <Field label="Policy text">
              <textarea name="body" rows={22} defaultValue={str(privacy, 'body') || privacyDraft(company)} className="mm-input mt-1 text-[14px] leading-6" />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                {stamp(privacy)} · <Link href="/privacy" className="underline" target="_blank">See /privacy</Link>
              </span>
              <span className="flex flex-wrap gap-2">
                <Button variant="quiet" name="restore" value="1" busyLabel="Resetting…">Start again from the draft</Button>
                <Button busyLabel="Saving…">Save privacy policy</Button>
              </span>
            </div>
          </form>
        </Card>
      </section>
    </div>
  )
}
