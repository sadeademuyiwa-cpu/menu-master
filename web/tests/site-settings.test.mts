/**
 * What the admin types into the website settings ends up on every public
 * page, inside script tags for the pixels. Each value must be exactly the
 * shape it claims to be, or it is not used.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAnalytics, checkAnalyticsInput, anyAnalytics, POSTHOG_DEFAULT_HOST,
  parseLanding, checkLandingInput, safeImageUrl, normaliseWhatsapp,
  parsePrivacy, plainDoc,
  parseCompany, checkCompanyInput, legalEntityWords, legalFooterParts,
  parseSignIn, showGoogleButton,
} from '../src/lib/site/settings.ts'

test('well-formed ids are kept', () => {
  const a = parseAnalytics({
    meta_pixel_id: '1234567890123456', google_ads_id: 'AW-123456789',
    google_ads_signup_label: 'AbC-d_123', ga4_id: 'G-ABC123XYZ',
    posthog_key: 'phc_abcdefghijklmnopqrstuvwxyz0123', posthog_host: 'https://eu.i.posthog.com',
  })
  assert.equal(a.metaPixelId, '1234567890123456')
  assert.equal(a.googleAdsId, 'AW-123456789')
  assert.equal(a.googleAdsSignupLabel, 'AbC-d_123')
  assert.equal(a.ga4Id, 'G-ABC123XYZ')
  assert.equal(a.posthogHost, 'https://eu.i.posthog.com')
  assert.equal(anyAnalytics(a), true)
})

test('anything that could break out of a script tag is dropped', () => {
  const a = parseAnalytics({
    meta_pixel_id: "123');alert(1);//", google_ads_id: 'AW-1"><script>',
    ga4_id: 'G-abc lower', posthog_key: 'phc_<x>', posthog_host: 'javascript:alert(1)',
  })
  assert.deepEqual(
    [a.metaPixelId, a.googleAdsId, a.ga4Id, a.posthogKey],
    [null, null, null, null])
  assert.equal(a.posthogHost, POSTHOG_DEFAULT_HOST)
  assert.equal(anyAnalytics(a), false)
})

test('nothing stored means no tracking at all', () => {
  assert.equal(anyAnalytics(parseAnalytics({})), false)
  assert.equal(anyAnalytics(parseAnalytics(null)), false)
})

test('the admin is told which id is wrong, in words', () => {
  const r = checkAnalyticsInput({ meta_pixel_id: 'fb-123' })
  assert.equal(r.ok, false)
  assert.match((r as { error: string }).error, /Meta Pixel ID/)
  assert.deepEqual(checkAnalyticsInput({ meta_pixel_id: ' 123456 ', ga4_id: '' }),
    { ok: true, value: { meta_pixel_id: '123456' } })
})

test('a conversion label without its Google Ads id is refused', () => {
  const r = checkAnalyticsInput({ google_ads_signup_label: 'AbCdEf' })
  assert.equal(r.ok, false)
})

test('pictures must be https links, nothing else', () => {
  assert.equal(safeImageUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png')
  for (const bad of ['http://x.com/a.png', 'javascript:alert(1)', 'https://x.com/a b.png',
                     'https://x.com/"onerror="x', 'data:image/png;base64,AAA', '', 42,
                     'http://127.0.0.1.evil.example/a.png', 'http://localhost.evil.example/a.png']) {
    assert.equal(safeImageUrl(bad), null, String(bad))
  }
})

test('plain http only for this machine, where local uploads are served', () => {
  const local = 'http://127.0.0.1:54321/storage/v1/object/public/site/logo.png'
  assert.equal(safeImageUrl(local), local)
  assert.equal(safeImageUrl('http://localhost:54321/a.png'), 'http://localhost:54321/a.png')
})

test('a Nigerian WhatsApp number typed locally works', () => {
  assert.equal(normaliseWhatsapp('0801 234 5678'), '2348012345678')
  assert.equal(normaliseWhatsapp('+234 801 234 5678'), '2348012345678')
  assert.equal(normaliseWhatsapp('call me'), null)
  assert.equal(normaliseWhatsapp('123'), null)
})

test('landing content keeps only usable pictures and complete testimonials', () => {
  const l = parseLanding({
    logo_url: 'https://x.com/logo.png',
    hero_image_url: 'javascript:1',
    screenshots: [{ url: 'https://x.com/1.png', caption: 'Costing' }, { url: 'nope' }],
    testimonials: [{ quote: 'It works', name: 'Ada', business: 'Ada Foods' }, { quote: 'No name' }],
    whatsapp: '08012345678',
  })
  assert.equal(l.logoUrl, 'https://x.com/logo.png')
  assert.equal(l.heroImageUrl, null)
  assert.deepEqual(l.screenshots, [{ url: 'https://x.com/1.png', caption: 'Costing' }])
  assert.equal(l.testimonials.length, 1)
  assert.equal(l.whatsapp, '2348012345678')
})

test('the landing form says which row is wrong', () => {
  const r = checkLandingInput({
    screenshots: [{ url: '', caption: '' }, { url: 'not a link', caption: 'x' }],
    testimonials: [],
  })
  assert.equal(r.ok, false)
  assert.match((r as { error: string }).error, /Screenshot 2/)
  const t = checkLandingInput({ screenshots: [], testimonials: [{ quote: 'Great', name: '' }] })
  assert.match((t as { error: string }).error, /Testimonial 1/)
})

test('blank rows on the landing form are ignored, not stored', () => {
  const r = checkLandingInput({
    whatsapp: '',
    screenshots: [{ url: '', caption: '' }],
    testimonials: [{ quote: '', name: '', business: '' }],
  })
  assert.deepEqual(r, { ok: true, value: { screenshots: [], testimonials: [] } })
})

test('a privacy policy is plain text turned into headings, paragraphs and lists', () => {
  const blocks = plainDoc('## Who we are\nWe make software.\nIn Lagos.\n\n- one\n- two\n\n## <script>x</script>')
  assert.deepEqual(blocks, [
    { kind: 'h2', text: 'Who we are' },
    { kind: 'p', text: 'We make software. In Lagos.' },
    { kind: 'ul', items: ['one', 'two'] },
    { kind: 'h2', text: '<script>x</script>' },   // shown as text, never run
  ])
})

test('company details: neutral words until the owner has the facts', () => {
  const none = parseCompany({})
  assert.equal(legalEntityWords(none), 'the team behind Menu Master NG')
  assert.deepEqual(legalFooterParts(none), ['Menu Master NG'])
  const full = parseCompany({ legal_name: 'Ada Foods Ltd', rc_number: '1234567', address: '1 Allen Avenue, Ikeja', support_email: 'help@ada.ng' })
  assert.equal(legalEntityWords(full), 'Ada Foods Ltd (RC 1234567)')
  assert.deepEqual(legalFooterParts(full), ['Ada Foods Ltd (RC 1234567)', '1 Allen Avenue, Ikeja', 'help@ada.ng'])
  assert.equal(parseCompany({ support_email: 'not an email' }).supportEmail, null)
})

test('the company form tidies what it can and names what it cannot', () => {
  assert.deepEqual(checkCompanyInput({ legal_name: ' Ada Foods Ltd ', rc_number: 'RC 1234567', address: '1 Allen Ave\nIkeja', support_email: '' }),
    { ok: true, value: { legal_name: 'Ada Foods Ltd', rc_number: '1234567', address: '1 Allen Ave, Ikeja' } })
  assert.match((checkCompanyInput({ support_email: 'a@b.ng, c@d.ng' }) as { error: string }).error, /Support email/)
  assert.match((checkCompanyInput({ rc_number: '<b>' }) as { error: string }).error, /RC number/)
})

test('the Google button needs the admin\'s switch AND the provider on in Supabase', () => {
  assert.equal(showGoogleButton(parseSignIn({ google: true }), true), true)
  assert.equal(showGoogleButton(parseSignIn({ google: true }), false), false)
  assert.equal(showGoogleButton(parseSignIn({ google: true }), null), false)   // could not ask Supabase
  assert.equal(showGoogleButton(parseSignIn({}), true), false)
  assert.equal(parseSignIn({ google: 'yes' }).google, false)
})

test('an empty policy falls back to the bundled draft', () => {
  assert.deepEqual(parsePrivacy({}), { body: null, effectiveDate: null })
  assert.equal(parsePrivacy({ body: '  ' }).body, null)
  assert.equal(parsePrivacy({ effective_date: 'yesterday' }).effectiveDate, null)
})
