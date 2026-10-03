/**
 * The sale line price: it must never be recorded as zero by accident, and the
 * price the product already sells for should be offered.
 *
 * On 2026-09-02 a live sale of TEST BEEF DISH at 2,000 naira was stored as a
 * FREE item: the price field submitted empty, and Number('') is 0.
 *
 * Requires: next build, `next start -p 3100`, e2e/mock-supabase.mjs on 54321.
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
const ORDER = '00000000-0000-0000-0000-000000000060'
const now = Math.floor(Date.now() / 1000)
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = [
  b64u({ alg: 'HS256', typ: 'JWT' }),
  b64u({
    sub: '00000000-0000-0000-0000-000000000099', aud: 'authenticated',
    role: 'authenticated', email: 'ada@adakitchen.ng', exp: now + 3600,
    iat: now, iss: 'http://127.0.0.1:54321/auth/v1',
  }),
  'signature',
].join('.')

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`) }
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.addCookies([{
  name: 'sb-127-auth-token',
  value: JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_at: now + 3600,
    refresh_token: 'r', user: { id: '00000000-0000-0000-0000-000000000099' } }),
  domain: '127.0.0.1', path: '/',
}])

const page = await ctx.newPage()
await page.setViewportSize({ width: 1280, height: 900 })
await page.goto(`${BASE}/sales/${ORDER}`, { waitUntil: 'domcontentloaded' })

const product = page.locator('select[name="product"]')
const price = page.locator('input[name="unit_price"]')

check('the add-item form is on an unconfirmed sale', await product.count() === 1)
check('the price starts empty, not zero', (await price.inputValue()) === '',
  `got "${await price.inputValue()}"`)

// PREFILL: choosing the dish offers the price it already sells for.
await product.selectOption({ label: 'Jollof Rice' })
const filled = await price.inputValue()
check('choosing a product offers its known selling price', filled === '2000.00',
  `got "${filled}"`)

// OVERRIDE: the owner can still charge something else.
await price.fill('1500')
check('the offered price can be overridden', (await price.inputValue()) === '1500')

// and a later product change must not wipe what they typed
await product.selectOption({ label: 'Something not on your menu' })
check('a price the owner typed is not overwritten', (await price.inputValue()) === '1500',
  `got "${await price.inputValue()}"`)

// BLANK: the field can be cleared, and submitting it must be refused rather
// than recorded as a free item.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.locator('select[name="product"]').selectOption({ label: 'Jollof Rice' })
await page.locator('input[name="unit_price"]').fill('')
await page.locator('input[name="qty"]').fill('1')
await page.locator('form:has(select[name="product"]) button[type="submit"]').click()
// The outcome rides on the URL -- withNotice puts it there so it survives a
// refresh -- and is then rendered on the page. Assert both.
await page.waitForURL(/notice=/, { timeout: 10_000 }).catch(() => {})
await page.waitForLoadState('networkidle')
const notice = decodeURIComponent(new URL(page.url()).search)
check('a blank price is refused, not stored as zero',
  /Enter what you charged for one/i.test(notice), `URL was ${page.url()}`)
const body = await page.locator('body').innerText()
check('the refusal is shown to the owner, not just in the URL',
  /Enter what you charged for one/i.test(body),
  body.slice(0, 160).replace(/\n/g, ' '))
check('no free line was created', !/1 × ₦0\.00/.test(body))

await browser.close()
console.log(`\nsale-price-prefill: pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
