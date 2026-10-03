/**
 * A cancelled sale must still show what it was.
 *
 * v_sale_lines ends `where o.voided_at is null and o.status <> 'cancelled'`,
 * which is correct and is why live revenue is right. The detail page read its
 * lines from that view, so a cancelled sale rendered as "Nothing on this sale
 * yet" and 0.00 across the board -- directly contradicting the notice above it
 * promising the record is kept.
 *
 * Requires: next build, `next start -p 3100`, e2e/mock-supabase.mjs on 54321.
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
const CANCELLED = '00000000-0000-0000-0000-000000000061'
const REPLACEMENT = '00000000-0000-0000-0000-000000000062'
const now = Math.floor(Date.now() / 1000)
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = [
  b64u({ alg: 'HS256', typ: 'JWT' }),
  b64u({ sub: '00000000-0000-0000-0000-000000000099', aud: 'authenticated',
    role: 'authenticated', email: 'ada@adakitchen.ng', exp: now + 3600, iat: now,
    iss: 'http://127.0.0.1:54321/auth/v1' }),
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

// --- the cancelled sale detail page ----------------------------------------
const page = await ctx.newPage()
await page.setViewportSize({ width: 1280, height: 1000 })
await page.goto(`${BASE}/sales/${CANCELLED}`, { waitUntil: 'networkidle' })
const body = await page.locator('body').innerText()

check('the sale is shown as cancelled', /Cancelled/.test(body))
check('the cancellation reason is kept', /cancelled: test/i.test(body))

// THE REGRESSION
check('it does NOT claim there is nothing on the sale',
  !/Nothing on this sale yet/i.test(body))
check('the original item is named', /Jollof Rice/.test(body))
check('the original quantity and price are shown', /1 × ₦2,000\.00/.test(body))
check('the original revenue is shown', /₦2,000\.00/.test(body))
check('the frozen cost is shown', /₦1,000\.00/.test(body))
check('the historical figures are labelled as the cancelled original',
  /The original cancelled sale/i.test(body))
check('they are labelled as NOT counted',
  /NOT counted in your revenue, cost or profit/i.test(body))

// linkage
check('the cancelled sale links to its replacement',
  await page.locator(`a[href="/sales/${REPLACEMENT}"]`).count() > 0)

// --- a LIVE sale must be unaffected ----------------------------------------
await page.goto(`${BASE}/sales/00000000-0000-0000-0000-000000000060`, { waitUntil: 'networkidle' })
const draft = await page.locator('body').innerText()
check('a live draft still uses the normal view and its own wording',
  /Nothing on this sale yet/i.test(draft) && !/The original cancelled sale/i.test(draft))

// --- Reports -> Voided sales -----------------------------------------------
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' })
const reports = await page.locator('body').innerText()
check('the voided sale is listed with its reason', /TEST-2/.test(reports) && /test/.test(reports))
check('who cancelled it is shown', /cancelled by you/i.test(reports))
check('the replacement is reachable from the report',
  await page.locator(`a[href="/sales/${REPLACEMENT}"]`).count() > 0)
check('the cancelled sale itself is reachable from the report',
  await page.locator(`a[href="/sales/${CANCELLED}"]`).count() > 0)

await browser.close()
console.log(`\ncancelled-sale-history: pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
