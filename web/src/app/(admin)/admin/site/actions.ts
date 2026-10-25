'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { loadSiteSettingsRaw, SITE_SETTINGS_TAG } from '@/lib/data/site'
import { describeWriteError, withNotice } from '@/lib/data/context'
import {
  ANALYTICS_FIELDS, checkAnalyticsInput, checkCompanyInput, checkLandingInput, parseCompany,
  MAX_SCREENSHOTS, MAX_TESTIMONIALS,
} from '@/lib/site/settings'
import { privacyDraft, PRIVACY_DRAFT_DATE } from '@/lib/site/privacy-draft'

/*
 * The Website pages' saves. Every export of a 'use server' file is an
 * endpoint, so only the five actions are exported: save() stays private --
 * exported, it would write any key without the check*Input rules -- and each
 * action names its own page to come back to, never one taken from the form.
 */

type Key = 'analytics' | 'landing' | 'privacy' | 'company' | 'signin'

async function save(key: Key, value: Record<string, unknown>, here: string, done: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('fn_admin_set_site_setting', { p_key: key, p_value: value })
  // Every page carries the pixels; the landing and privacy pages carry the
  // rest. Clear the cached settings and every page built from them.
  revalidateTag(SITE_SETTINGS_TAG)
  revalidatePath('/', 'layout')
  redirect(withNotice(here, describeWriteError(error) ?? done))
}

export async function saveCompany(formData: FormData) {
  const here = '/admin/site/company'
  const s = (k: string) => String(formData.get(k) ?? '')
  const checked = checkCompanyInput({
    legal_name: s('legal_name'), rc_number: s('rc_number'), address: s('address'), support_email: s('support_email'),
  })
  if (!checked.ok) redirect(withNotice(here, checked.error))
  await save('company', checked.value, here,
    'Company details saved. Terms and Refunds show them now, and so does the footer of every legal page.')
}

export async function saveSignIn(formData: FormData) {
  const here = '/admin/site/sign-in'
  const on = formData.get('google') === 'on'
  await save('signin', { google: on }, here, on
    ? 'Sign-in saved. "Continue with Google" shows once Google is switched on in Supabase.'
    : 'Sign-in saved. "Continue with Google" is hidden.')
}

export async function saveAnalytics(formData: FormData) {
  const here = '/admin/site/tracking'
  const input = Object.fromEntries(ANALYTICS_FIELDS.map((f) => [f, String(formData.get(f) ?? '')]))
  const checked = checkAnalyticsInput(input)
  if (!checked.ok) redirect(withNotice(here, checked.error))
  await save('analytics', checked.value, here, 'Tracking saved. It applies to visitors who accept cookies.')
}

export async function saveLanding(formData: FormData) {
  const here = '/admin/site/landing'
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
  if (!checked.ok) redirect(withNotice(here, checked.error))
  await save('landing', checked.value, here, 'Landing page saved.')
}

export async function savePrivacy(formData: FormData) {
  const here = '/admin/site/privacy'
  const restore = formData.get('restore') === '1'
  const company = parseCompany((await loadSiteSettingsRaw())?.company ?? {})
  // Control characters other than newlines and tabs are dropped: they have
  // no place in a policy and only confuse whoever reads it next.
  const body = restore ? privacyDraft(company) : String(formData.get('body') ?? '')
    .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 60000)
  const date = restore ? PRIVACY_DRAFT_DATE : String(formData.get('effective_date') ?? '')
  if (!body.trim()) redirect(withNotice(here, 'The privacy policy cannot be empty. Use "Start again from the draft" instead.'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(withNotice(here, 'Give the date this version takes effect.'))
  await save('privacy', { body, effective_date: date }, here,
    restore ? 'Privacy policy reset to the draft.' : 'Privacy policy saved. It is live at /privacy.')
}
