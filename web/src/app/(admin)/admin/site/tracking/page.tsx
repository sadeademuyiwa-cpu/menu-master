import { adminWebsiteFacts } from '@/lib/data/admin'
import { Notice, Field } from '@/components/ui'
import { Button } from '@/components/button'
import {
  analyticsFieldExample, analyticsFieldLabel, POSTHOG_DEFAULT_HOST, type AnalyticsField, type AnalyticsSettings,
} from '@/lib/site/settings'
import { AdminPage, FieldPanel, Pill, SaveBar, SettingsSection, ViewOnSite } from '../../_ui/kit'
import { saveAnalytics } from '../actions'
import { SiteNotice, stampWords, unavailable, UP } from '../_shared'

export const dynamic = 'force-dynamic'

const HELP: Record<AnalyticsField, string> = {
  meta_pixel_id: 'Meta Events Manager → Data sources → your pixel. Digits only.',
  google_ads_id: 'Google Ads → Goals → Conversions → a conversion → Tag setup. Starts with AW-.',
  google_ads_signup_label: 'From the same tag: the part after the slash in send_to, for your "Sign-up" conversion.',
  google_ads_purchase_label: 'The same, for your "Purchase" or "Subscribe" conversion.',
  ga4_id: 'Google Analytics → Admin → Data streams → your site. Starts with G-.',
  posthog_key: 'PostHog → Project settings → Project API key. Starts with phc_.',
  posthog_host: `Leave blank for the US cloud (${POSTHOG_DEFAULT_HOST}). EU cloud: https://eu.i.posthog.com`,
}

/** One tool per section; one Save for them all. */
const TOOLS: { title: string; what: string; fields: AnalyticsField[]; on: (a: AnalyticsSettings) => boolean }[] = [
  { title: 'Meta (Facebook and Instagram ads)', what: 'Counts visits, sign-ups and purchases for your Meta ads.',
    fields: ['meta_pixel_id'], on: (a) => !!a.metaPixelId },
  { title: 'Google Ads', what: 'Counts sign-ups and purchases from your Google ads. The two labels are what make a conversion count.',
    fields: ['google_ads_id', 'google_ads_signup_label', 'google_ads_purchase_label'], on: (a) => !!a.googleAdsId },
  { title: 'Google Analytics', what: 'Visits and pages, in Google Analytics 4.',
    fields: ['ga4_id'], on: (a) => !!a.ga4Id },
  { title: 'PostHog', what: 'Visits and product events, in PostHog.',
    fields: ['posthog_key', 'posthog_host'], on: (a) => !!a.posthogKey },
]

const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')

export default async function AdminSiteTracking(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const site = await adminWebsiteFacts()
  if (!site) return <AdminPage title="Tracking pixels" up={UP}><Notice>{unavailable}</Notice></AdminPage>

  const raw = site.raw.analytics ?? {}
  const a = site.facts.analytics
  const anyOn = TOOLS.some((t) => t.on(a))

  return (
    <AdminPage up={UP} title="Tracking pixels"
               description="Ad and analytics tags load only for visitors who press Accept on the cookie notice. Leave a box empty to switch that tool off."
               meta={anyOn ? 'New visitors see the cookie notice.' : 'No tool is on, so visitors see no cookie notice.'}
               actions={<ViewOnSite href="/?preview=1">View the website</ViewOnSite>}>
      <SiteNotice notice={notice} view={{ href: '/?preview=1', label: 'See the website' }} />

      <form action={saveAnalytics}>
        {TOOLS.map((t) => (
          <SettingsSection key={t.title} title={t.title} description={t.what}
                           now={<Pill tone={t.on(a) ? 'good' : 'neutral'}>{t.on(a) ? 'On, after Accept' : 'Off'}</Pill>}>
            <FieldPanel>
              {t.fields.map((f) => (
                <Field key={f} label={analyticsFieldLabel(f)}>
                  <input name={f} defaultValue={str(raw, f)} placeholder={analyticsFieldExample(f)}
                         autoComplete="off" spellCheck={false} className="mm-input mt-1 font-mono" />
                  <span className="ad-field-help">{HELP[f]}</span>
                </Field>
              ))}
            </FieldPanel>
          </SettingsSection>
        ))}
        <SaveBar stamp={stampWords(raw)}>
          <Button busyLabel="Saving…">Save tracking</Button>
        </SaveBar>
      </form>
    </AdminPage>
  )
}
