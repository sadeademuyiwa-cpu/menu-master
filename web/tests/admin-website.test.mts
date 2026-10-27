import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customersCannotReach, websiteAreas, websiteChecklist, type WebsiteFacts } from '../src/lib/admin/website.ts'
import { adminCrumbs, adminTitle, isCurrent } from '../src/lib/admin/nav.ts'
import { factLabel, relDays, shareWords, shortId } from '../src/lib/admin/format.ts'
import { privacyStale } from '../src/lib/admin/website.ts'

const empty = (): WebsiteFacts => ({
  company: { legalName: null, rcNumber: null, address: null, supportEmail: null },
  analytics: { metaPixelId: null, googleAdsId: null, googleAdsSignupLabel: null, googleAdsPurchaseLabel: null, ga4Id: null, posthogKey: null, posthogHost: 'https://us.i.posthog.com' },
  landing: { logoUrl: null, heroImageUrl: null, screenshots: [], testimonials: [], whatsapp: null },
  privacy: { body: null, effectiveDate: null },
  signin: { google: false },
  provider: null,
  help: { set: 0, total: 27 },
  saved: { company: null, privacy: null },
})

test('an empty website puts "customers cannot reach you" first, then the legal pages, then extras', () => {
  const list = websiteChecklist(empty())
  assert.deepEqual(list.slice(0, 2).map((i) => i.key), ['support_email', 'whatsapp'])
  assert.deepEqual([...new Set(list.map((i) => i.priority))], ['reach', 'legal', 'extra'])
  assert.ok(list.every((i) => !i.done))
  assert.equal(customersCannotReach(empty()), true)
})

test('one contact channel is enough: only with neither is it "customers cannot reach you"', () => {
  const f = empty()
  f.company.supportEmail = 'help@j.ng'
  const list = websiteChecklist(f)
  assert.ok(!list.some((i) => i.priority === 'reach'))
  assert.equal(list.find((i) => i.key === 'whatsapp')?.priority, 'extra')
  assert.equal(customersCannotReach(f), false)
})

test('the Google Ads gap names the conversion that is not counted', () => {
  const f = empty()
  f.analytics.googleAdsId = 'AW-123456789'
  f.analytics.googleAdsSignupLabel = 'AbCdEfGhIj'
  assert.equal(websiteChecklist(f).find((i) => i.key === 'ads_labels')?.missing, 'The Ads tag loads but counts no purchases')
})

test('optional extras are not to-dos until they are switched on', () => {
  const keys = (f: WebsiteFacts) => websiteChecklist(f).map((i) => i.key)
  assert.ok(!keys(empty()).includes('google'))
  assert.ok(!keys(empty()).includes('ads_labels'))
  const f = empty()
  f.signin.google = true
  f.analytics.googleAdsId = 'AW-123456789'
  assert.ok(keys(f).includes('google'))
  assert.ok(keys(f).includes('ads_labels'))
})

test('an RC number without a legal name, and a policy older than the company details, are flagged', () => {
  const f = empty()
  f.company.rcNumber = '1234567'
  f.company.address = 'Ikeja'  // saved after the policy, which does not give it
  f.privacy.body = '## Who we are'
  f.saved = { company: '2026-10-20T10:00:00Z', privacy: '2026-10-02T10:00:00Z' }
  const keys = websiteChecklist(f).filter((i) => !i.done).map((i) => i.key)
  assert.ok(keys.includes('rc_alone'))
  assert.ok(keys.includes('privacy_stale'))
  assert.equal(websiteAreas(f).find((a) => a.key === 'privacy')?.status, 'Check it')
})

test('each area says what visitors see now and carries its own gaps', () => {
  const f = empty()
  f.company = { legalName: 'Journey Foods Ltd', rcNumber: '1', address: 'Ikeja', supportEmail: 'help@j.ng' }
  f.analytics.ga4Id = 'G-ABC123'
  f.signin.google = true
  f.provider = true
  const areas = Object.fromEntries(websiteAreas(f).map((a) => [a.key, a]))
  assert.equal(areas.company.status, 'Complete')
  assert.deepEqual(areas.company.gaps, [])
  assert.equal(areas.signin.status, 'Live')
  assert.equal(areas.tracking.status, '1 on')
  assert.match(areas.tracking.now, /Google Analytics load after Accept/)
  assert.equal(areas.landing.status, 'Defaults')
  assert.deepEqual(areas.landing.gaps.map((g) => g.key), ['whatsapp', 'hero', 'screenshots', 'testimonials'])
  assert.equal(areas.help.status, '0 of 27')
})

test('saving the same company details again does not make the policy stale', () => {
  const f = empty()
  f.company = { legalName: 'Journey Foods Ltd', rcNumber: null, address: 'Ikeja', supportEmail: 'help@j.ng' }
  f.privacy.body = 'Run by Journey Foods Ltd, Ikeja. Write to help@j.ng.'
  f.saved = { company: '2026-10-20T10:00:00Z', privacy: '2026-10-02T10:00:00Z' }
  assert.equal(privacyStale(f), false)
  f.company.supportEmail = 'care@j.ng'
  assert.equal(privacyStale(f), true)
})

test('before 0065 there is no help area and no help to-do', () => {
  const f = empty()
  f.help = null
  assert.ok(!websiteAreas(f).some((a) => a.key === 'help'))
  assert.ok(!websiteChecklist(f).some((i) => i.key === 'help'))
})

test('the admin trail names each page, and Website pages one level deeper', () => {
  assert.deepEqual(adminCrumbs('/admin').map((c) => c.label), ['Admin', 'Overview'])
  assert.deepEqual(adminCrumbs('/admin/billing').map((c) => c.label), ['Admin', 'Paystack log'])
  assert.deepEqual(adminCrumbs('/admin/journeys/3f2504e0-4f89-11d3-9a0c-0305e82c3301').map((c) => c.label), ['Admin', 'Journeys'])
  assert.equal(adminTitle('/admin/live'), 'Admin · Live now · Menu Master NG')
  assert.equal(adminTitle('/admin/feedback'), 'Admin · Help & feedback · Menu Master NG')
  assert.deepEqual(adminCrumbs('/admin/site/landing').map((c) => c.label), ['Admin', 'Website', 'Landing page'])
  assert.equal(adminTitle('/admin/site/privacy'), 'Admin · Privacy policy · Menu Master NG')
})

test('Overview lights only on /admin; the others light for their pages below', () => {
  assert.equal(isCurrent('/admin', '/admin'), true)
  assert.equal(isCurrent('/admin', '/admin/alerts'), false)
  assert.equal(isCurrent('/admin/site', '/admin/site/company'), true)
  assert.equal(isCurrent('/admin/site', '/admin/signups'), false)
})

test('machine words read as words', () => {
  assert.equal(factLabel('last_error_code'), 'Last error code')
  assert.equal(factLabel('event id'), 'Event ID')
  assert.equal(shortId('0a9f12bc-1111-2222-3333-444455556666'), '0a9f12bc')
  const now = new Date('2026-10-25T12:00:00Z')
  assert.equal(relDays('2026-10-25T08:00:00Z', now), 'today')
  assert.equal(relDays('2026-10-22T12:00:00Z', now), '3 days ago')
  assert.equal(relDays('2026-10-30T12:00:00Z', now), 'in 5 days')
  // Trials end 23:59:59 Lagos (22:59:59 UTC). At 09:00 Lagos that is tonight, not "tomorrow".
  const nine = new Date('2026-10-25T08:00:00Z')
  assert.equal(relDays('2026-10-25T22:59:59Z', nine), 'today')
  assert.equal(relDays('2026-10-24T22:59:59Z', nine), 'yesterday')
  assert.equal(relDays('2026-10-25T00:30:00Z', new Date('2026-10-25T13:30:00Z')), 'today')
})

test('a share never claims 100% while something failed', () => {
  assert.equal(shareWords(300 / 301, true), '99%+')
  assert.equal(shareWords(1, false), '100%')
  assert.equal(shareWords(0.75, true), '75%')
  assert.equal(shareWords(null, false), 'not available')
})
