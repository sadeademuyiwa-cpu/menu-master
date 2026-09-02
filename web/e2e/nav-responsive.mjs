/**
 * The primary navigation must sit in the header on a desktop and at the bottom
 * on a phone -- and never both at once.
 *
 * Before this test the bar was `fixed bottom-0 sm:static`, which on a desktop
 * did not move it into the header; it simply left it below the page content,
 * so the application read as a stretched phone.
 *
 * Requires: next build, `next start -p 3100`, and e2e/mock-supabase.mjs on 54321.
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const jwt = [
  b64u({ alg: 'HS256', typ: 'JWT' }),
  b64u({
    sub: '00000000-0000-0000-0000-000000000099', aud: 'authenticated',
    role: 'authenticated', email: 'ada@adakitchen.ng', exp: now + 3600,
    iat: now, iss: 'http://127.0.0.1:54321/auth/v1',
  }),
  'signature',
].join('.')

const DESTINATIONS = ['Home', 'Sales', 'Purchases', 'Recipes', 'More']
let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`) }
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.addCookies([{
  name: 'sb-127-auth-token', value: JSON.stringify({ access_token: jwt, token_type: 'bearer',
    expires_at: now + 3600, refresh_token: 'r', user: { id: '00000000-0000-0000-0000-000000000099' } }),
  domain: '127.0.0.1', path: '/',
}])

for (const [label, width, height, expectHeaderNav] of [
  ['desktop', 1280, 800, true],
  ['tablet',  900,  800, true],
  ['mobile',  390,  844, false],
]) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width, height })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })

  const headerNav = page.locator('header nav[aria-label="Primary"]')
  const bottomNav = page.locator('body > div > nav[aria-label="Primary"]')

  const headerVisible = await headerNav.isVisible().catch(() => false)
  const bottomVisible = await bottomNav.isVisible().catch(() => false)

  check(`${label}: header nav ${expectHeaderNav ? 'shown' : 'hidden'}`,
    headerVisible === expectHeaderNav,
    `header nav visible=${headerVisible}, expected ${expectHeaderNav}`)
  check(`${label}: bottom bar ${expectHeaderNav ? 'hidden' : 'shown'}`,
    bottomVisible === !expectHeaderNav,
    `bottom nav visible=${bottomVisible}, expected ${!expectHeaderNav}`)

  // NEVER both. This is the duplication the brief forbids.
  check(`${label}: the navigation is not duplicated on this viewport`,
    !(headerVisible && bottomVisible))

  // Every destination survives, in the one nav that is showing.
  const shown = headerVisible ? headerNav : bottomNav
  const labels = (await shown.locator('a').allTextContents()).map((t) => t.trim())
  check(`${label}: all five destinations present`,
    DESTINATIONS.every((d) => labels.includes(d)), labels.join('|'))

  if (expectHeaderNav) {
    // The point of the change: on a desktop the nav must be ABOVE the content,
    // not stranded under it.
    const navBox = await headerNav.boundingBox()
    const mainBox = await page.locator('main').boundingBox()
    check(`${label}: navigation sits above the page content`,
      navBox !== null && mainBox !== null && navBox.y < mainBox.y,
      `nav.y=${navBox?.y} main.y=${mainBox?.y}`)
  }
  await page.close()
}

await browser.close()
console.log(`\nnav-responsive: pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
