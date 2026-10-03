/**
 * THE PUBLIC WEBSITE, IN A REAL BROWSER.
 *
 * Needs a database with 0057 (site_settings), e.g. one built with
 * scripts/setup_db.ps1 -WithProposed. Proves:
 *
 *   a visitor lands on the landing page, can read prices and the privacy
 *   policy, and every way in leads to signup
 *   a platform admin edits the pixels, the landing content and the privacy
 *   policy, and a bad value is refused with a reason
 *   no advert tag loads until the visitor presses Accept; "No thanks" is
 *   remembered and loads nothing
 *   after Accept, the moments the ads optimise for reach the Meta pixel
 *   a signed-in owner opening the site goes to their app
 *
 * Third-party tags are intercepted: nothing leaves this machine.
 * Screenshots of the landing page go to $SHOTS_DIR (default e2e/shots-site).
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync } from 'node:fs'
import { onboardBusiness, finishSetup } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const SHOTS = process.env.SHOTS_DIR ?? new URL('./shots-site/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })
const stamp = Date.now()
const ADMIN = { email: `site-admin-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const B = { email: `site-visitor-${stamp}@test.ng`, pass: 'correct-horse-battery' }

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const has = (body, needle) => body.toLowerCase().includes(needle.toLowerCase())
/**
 * Waits up to 5 s for what it expects: the toast that confirms a save can
 * appear a moment before the page under it re-renders, so reading once as
 * soon as the toast shows raced. A real failure still fails.
 */
async function must(page, name, ...needles) {
  const start = Date.now()
  let missing = needles
  for (;;) {
    const body = await page.locator('body').innerText()
    missing = needles.filter((n) => !has(body, n))
    if (!missing.length || Date.now() - start > 5000) break
    await page.waitForTimeout(250)
  }
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)} at ${page.url()}` : '')
}
async function mustNot(page, name, ...needles) {
  const body = await page.locator('body').innerText()
  const present = needles.filter((n) => has(body, n))
  mark(name, present.length === 0, present.length ? `unexpectedly present ${JSON.stringify(present)}` : '')
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
}
async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await settle(page)
}
const path = (page) => new URL(page.url()).pathname
/** Waits until the page body shows a text (a notice renders after the URL changes). */
async function waitText(page, needle, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (has(await page.locator('body').innerText(), needle)) return true
    await page.waitForTimeout(300)
  }
  return false
}
async function noSideScroll(page, name) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  mark(name, over <= 1, `overflow ${over}px`)
}

/** Intercepts every third-party tag; records which were asked for. */
async function guard(context) {
  const asked = []
  await context.route(/connect\.facebook\.net|googletagmanager\.com|posthog\.com|facebook\.com\/tr/, (route) => {
    asked.push(route.request().url())
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  })
  return asked
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const browser = await chromium.launch()

async function signUp(page, who) {
  await go(page, '/signup')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/onboarding', { timeout: 60000 })
}

try {
  await db.query(`update site_settings set value = '{}'::jsonb`)

  // --- 1. a visitor, before anything is configured ----------------------------
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const vAsked = await guard(visitor)
  const v = await visitor.newPage()
  await go(v, '/')
  // dev_local builds before the database API starts, so the page built then
  // has no prices; the first request after a minute rebuilds it in the
  // background. Give it that one rebuild. (On Vercel the build can reach
  // the database.)
  for (let i = 0; i < 15 && !has(await v.locator('body').innerText(), '/month'); i++) {
    await v.waitForTimeout(5000)
    await v.reload({ waitUntil: 'domcontentloaded' })
    await settle(v)
  }
  mark('the site opens on the landing page, not the login', path(v) === '/', v.url())
  await must(v, 'the landing page says what it does, for whom, and the offer',
    'Know what every plate really costs', 'Nigerian food businesses', '14 days free', 'No card needed')
  await must(v, 'it shows both plans with their monthly price', 'Costing + Sales', '/month', 'Pricing')
  await must(v, 'and links to the legal pages', 'Terms', 'Privacy', 'Refunds')
  await noSideScroll(v, 'the landing page fits a phone without sideways scrolling')
  await v.screenshot({ path: `${SHOTS}/landing-phone-top.png` })
  await v.screenshot({ path: `${SHOTS}/landing-phone-full.png`, fullPage: true })
  mark('with nothing configured there is no cookie notice', (await v.locator('.mm-consent').count()) === 0)
  mark('and no advert tag is requested', vAsked.length === 0, vAsked.join(', '))

  const ctas = await v.locator('a[href="/signup"]').count()
  mark('every main button leads to signup', ctas >= 4, `${ctas} links`)
  await v.locator('.lp-hero a[href="/signup"]').first().click()
  await v.waitForURL('**/signup', { timeout: 30000 })
  mark('the hero button opens signup', path(v) === '/signup')

  await go(v, '/privacy')
  await must(v, 'the privacy policy is public and complete (the draft)',
    'Privacy policy', 'Who we are', 'Nigeria Data Protection Act', 'Your rights', 'Cookies')
  for (const p of ['/terms', '/refunds', '/privacy']) {
    await go(v, p)
    await mustNot(v, `${p} shows no unfilled placeholder before the company details are entered`, '[', 'to be supplied')
  }
  await go(v, '/terms')
  await must(v, 'until then the terms name "the team behind Menu Master NG"', 'the team behind Menu Master NG')

  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await guard(desktop)
  const d = await desktop.newPage()
  await go(d, '/')
  await d.screenshot({ path: `${SHOTS}/landing-desktop-top.png` })
  await d.screenshot({ path: `${SHOTS}/landing-desktop-full.png`, fullPage: true })
  await noSideScroll(d, 'the landing page fits a laptop')
  await desktop.close()

  // --- 2. the admin edits the website -----------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await guard(adminCtx)
  const a = await adminCtx.newPage()
  await signUp(a, ADMIN)
  await onboardBusiness(a, BASE, { business: 'Site Admin Kitchen' })
  await finishSetup(a, BASE)
  await db.query(`insert into platform_admins (user_id, reason)
                  select id, 'journey-site' from auth.users where email = $1`, [ADMIN.email])

  await go(a, '/')
  mark('a signed-in owner opening the site goes to the app', path(a) === '/dashboard', a.url())

  await go(a, '/admin/site')
  await must(a, 'Admin → Website has all five editors',
    'Company details', 'Sign in with Google', 'Tracking pixels', 'Landing page', 'Privacy policy')

  // --- company details ------------------------------------------------------
  await a.fill('input[name=support_email]', 'help@kitchen')
  await a.click('button:has-text("Save company details")')
  await waitText(a, 'Support email:')
  await must(a, 'a support email that is not an address is refused, with the reason', 'Support email: one address')
  await a.fill('input[name=legal_name]', 'Journey Foods Ltd')
  await a.fill('input[name=rc_number]', 'RC 1234567')
  await a.fill('textarea[name=address]', '1 Allen Avenue, Ikeja, Lagos')
  await a.fill('input[name=support_email]', 'help@journeyfoods.ng')
  await a.click('button:has-text("Save company details")')
  await waitText(a, 'Company details saved')
  await go(a, '/terms')
  await must(a, 'the terms now name the company and its RC number',
    'between you and Journey Foods Ltd (RC 1234567)', 'help@journeyfoods.ng')
  await must(a, 'and the footer carries the address',
    'Journey Foods Ltd (RC 1234567) · 1 Allen Avenue, Ikeja, Lagos · help@journeyfoods.ng')
  await go(a, '/refunds')
  await must(a, 'refunds points to the support email', 'Write to help@journeyfoods.ng within 14 days')

  // --- Google sign-in -------------------------------------------------------
  await go(a, '/admin/site')
  await must(a, 'the admin sees whether Google is on in Supabase, and the values to paste',
    'Not on in Supabase yet', 'Authorised redirect URI', '/auth/v1/callback', 'Copy')
  await a.check('input[name=google]')
  await a.click('button:has-text("Save sign-in")')
  await waitText(a, 'Sign-in saved')
  await must(a, 'switching it on here is saved', 'Switched on here')
  const pre = await browser.newContext()
  const preP = await pre.newPage()
  await go(preP, '/login')
  mark('while Supabase has Google off, the login page does not offer it (no broken button)',
    (await preP.locator('text=Continue with Google').count()) === 0)
  await pre.close()

  await a.fill('input[name=meta_pixel_id]', 'fb-123')
  await a.click('button:has-text("Save tracking")')
  await waitText(a, 'does not look right')
  await must(a, 'a malformed pixel id is refused with the reason', 'Meta Pixel ID does not look right')

  await a.fill('input[name=meta_pixel_id]', '123456789012345')
  await a.fill('input[name=ga4_id]', 'G-TEST1234')
  await a.click('button:has-text("Save tracking")')
  await waitText(a, 'Tracking saved')
  await must(a, 'valid ids are saved', 'Tracking saved')
  // With pixels on, the cookie notice now shows here too, over the bottom
  // of the screen, until it is answered.
  mark('once pixels are set, the admin is asked about cookies too', await a.locator('.mm-consent').isVisible())
  await a.click('.mm-consent button:has-text("No thanks")')

  await a.locator('summary:has-text("Screenshots")').click()
  await a.fill('input[name=shot_url_0]', 'not a link')
  await a.click('button:has-text("Save landing page")')
  await waitText(a, 'Screenshot 1:')
  await must(a, 'a screenshot that is not a link is refused, naming the row', 'Screenshot 1')

  await a.fill('input[name=whatsapp]', '0801 234 5678')
  if (!(await a.locator('textarea[name=t_quote_0]').isVisible())) await a.locator('summary:has-text("Testimonials")').click()
  await a.fill('textarea[name=t_quote_0]', 'I finally know what my jollof costs me.')
  await a.fill('input[name=t_name_0]', 'Test Customer')
  await a.fill('input[name=t_business_0]', 'Test Kitchen, Lagos')
  if (!(await a.locator('input[name=shot_url_0]').isVisible())) await a.locator('summary:has-text("Screenshots")').click()
  await a.fill('input[name=shot_url_0]', '')
  await a.click('button:has-text("Save landing page")')
  await waitText(a, 'Landing page saved')
  await must(a, 'the landing content is saved', 'Landing page saved')

  const policy = await a.locator('textarea[name=body]').inputValue()
  mark('the privacy editor starts from the draft', policy.includes('## Who we are'))
  await a.fill('textarea[name=body]', policy + '\n\n## Journey heading\nA line the journey added.')
  await a.click('button:has-text("Save privacy policy")')
  await waitText(a, 'Privacy policy saved')
  await go(a, '/privacy')
  await must(a, 'the saved policy is what /privacy shows', 'Journey heading', 'A line the journey added.')

  await go(a, '/?preview=1')
  await must(a, 'the admin can preview the landing page with the new content',
    'I finally know what my jollof costs me.', 'Test Customer', 'WhatsApp us')
  const wa = await a.locator('a.lp-wa').getAttribute('href')
  mark('the WhatsApp button uses the number in international form', (wa ?? '').startsWith('https://wa.me/2348012345678'), wa ?? 'none')
  await go(a, '/more')
  const help = await a.locator('a:has-text("Ask us on WhatsApp")').getAttribute('href').catch(() => null)
  mark('owners get the same WhatsApp number as help, in More', (help ?? '').startsWith('https://wa.me/2348012345678'), help ?? 'none')

  // --- 2b. pictures uploaded from the admin (0059) --------------------------------
  // A 1x1 PNG, as a phone would hand over a real one.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await go(a, '/admin/site')
  const logoPicker = a.locator('input[type=file][aria-label="Choose a picture for Logo"]')
  await logoPicker.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') })
  await waitText(a, 'Use a PNG, JPEG or WebP picture.', 5000)
  await must(a, 'a file that is not a picture is refused before it is sent', 'Use a PNG, JPEG or WebP picture.')
  await logoPicker.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
  await waitText(a, 'Uploaded. Press Save', 15000)
  const logoUrl = await a.locator('input[name=logo_url]').inputValue()
  mark('the admin uploads a logo, and its address fills itself in',
    /\/storage\/v1\/object\/public\/site\/logo-[a-z0-9]+-[0-9a-f]{8}\.png$/.test(logoUrl), logoUrl)
  await a.click('button:has-text("Save landing page")')
  await waitText(a, 'Landing page saved')
  await go(a, '/?preview=1')
  const shown = await a.locator('header img').first()
  const loadedOk = await shown.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false)
  mark('the uploaded logo is on the landing page, and loads',
    (await shown.getAttribute('src').catch(() => null)) === logoUrl && loadedOk, logoUrl)

  // The rule is in the database, not the page: a customer's own session
  // cannot upload, whatever it sends.
  {
    const { createHmac, randomUUID } = await import('node:crypto')
    const who = randomUUID()
    await db.query('insert into auth.users (id, email) values ($1, $2)', [who, `upload-probe-${stamp}@test.ng`])
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const h = b64({ alg: 'HS256', typ: 'JWT' })
    const p = b64({ sub: who, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })
    const secret = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
    const jwt = `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`
    const r = await fetch('http://127.0.0.1:54321/storage/v1/object/site/customer-upload.png', {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'image/png' }, body: png,
    })
    mark('a customer\'s session cannot upload to the website\'s pictures (403)', r.status === 403, String(r.status))
  }

  // --- 3. consent ----------------------------------------------------------------
  const noCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const noAsked = await guard(noCtx)
  const n = await noCtx.newPage()
  await go(n, '/')
  mark('with pixels set, a new visitor is asked first', await n.locator('.mm-consent').isVisible())
  await n.screenshot({ path: `${SHOTS}/landing-consent.png` })
  mark('and nothing is loaded before they answer', noAsked.length === 0, noAsked.join(', '))
  await n.click('.mm-consent button:has-text("No thanks")')
  await n.reload({ waitUntil: 'domcontentloaded' })
  await settle(n)
  mark('"No thanks" is remembered', (await n.locator('.mm-consent').count()) === 0)
  mark('and loads no advert tag', noAsked.length === 0, noAsked.join(', '))
  await noCtx.close()

  const yesCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const yesAsked = await guard(yesCtx)
  const y = await yesCtx.newPage()
  await go(y, '/?utm_source=facebook&utm_campaign=journey')
  const src = (await yesCtx.cookies()).find((c) => c.name === 'mm_src')
  mark('the advert that brought the visitor is kept for signup', Boolean(src?.value), src?.value ?? 'no cookie')
  await y.click('.mm-consent button:has-text("Accept")')
  await y.waitForTimeout(1200)
  mark('after Accept the Meta and Google tags load', yesAsked.some((u) => u.includes('fbevents.js')) && yesAsked.some((u) => u.includes('googletagmanager')), yesAsked.join(', '))
  const fbq = async () => y.evaluate(() => (window.fbq?.queue ?? []).map((a) => Array.from(a).slice(0, 2).join(':')))
  let q = await fbq()
  mark('the pixel is set up with the admin\'s id, privately (no autoConfig)',
    q.includes('init:123456789012345') && q.includes('set:autoConfig'), q.join(' | '))
  mark('the landing visit is reported', q.includes('track:ViewContent') && q.includes('track:PageView'), q.join(' | '))

  await go(y, '/signup')
  await y.fill('input[type=email]', B.email)
  await y.fill('input[type=password]', B.pass)
  await y.click('button:has-text("Create account")')
  await y.waitForURL('**/onboarding', { timeout: 60000 })
  await y.waitForTimeout(800)
  q = await fbq()
  mark('a new account reaches Meta as CompleteRegistration', q.includes('track:CompleteRegistration'), q.join(' | '))

  await onboardBusiness(y, BASE, { business: 'Visitor Kitchen' })
  await finishSetup(y, BASE)
  await y.waitForTimeout(2500)
  q = await fbq()
  mark('finishing setup reaches Meta as StartTrial (raised on the server)', q.includes('track:StartTrial'), q.join(' | '))
  mark('the first purchase is reported too', q.includes('trackCustom:first_purchase_recorded'), q.join(' | '))
  const leftover = (await yesCtx.cookies()).find((c) => c.name === 'mm_evt')
  mark('the server-to-browser event cookie is cleared once read', !leftover?.value, leftover?.value ?? '')

  // A customer who is not an admin cannot open the editor.
  await go(y, '/admin/site')
  mark('a customer cannot open Admin → Website', path(y) !== '/admin/site', y.url())
  await yesCtx.close()

  // --- 4. switching the pixels off takes effect at once --------------------------
  // Through the admin page, not the database: saving clears every cached page.
  await go(a, '/admin/site')
  for (const f of ['meta_pixel_id', 'ga4_id']) await a.fill(`input[name=${f}]`, '')
  await a.click('button:has-text("Save tracking")')
  await waitText(a, 'Tracking saved')
  const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const offAsked = await guard(offCtx)
  const o = await offCtx.newPage()
  for (const p of ['/', '/signup', '/login']) {
    await go(o, p)
    if ((await o.locator('.mm-consent').count()) > 0) { mark(`with pixels cleared, ${p} no longer asks`, false); break }
  }
  mark('with the pixels cleared, no page asks about cookies and no tag loads',
    (await o.locator('.mm-consent').count()) === 0 && offAsked.length === 0, offAsked.join(', '))
  await offCtx.close()

  // --- 5. leave the website as it was -----------------------------------------
  // Reset in the database, then one admin save: a save clears every cached
  // page, so the next visitor (and the next run) sees the defaults at once.
  await db.query(`update site_settings set value = '{}'::jsonb`)
  await go(a, '/admin/site')
  await a.click('button:has-text("Save sign-in")')
  await waitText(a, 'Sign-in saved')
  await go(a, '/terms')
  await must(a, 'after a save, the public pages show the reset details at once', 'the team behind Menu Master NG')
  await adminCtx.close()
  await visitor.close()
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await db.query(`update site_settings set value = '{}'::jsonb`).catch(() => {})
  await browser.close()
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
