/**
 * SETUP THAT CAN BE SKIPPED, AND EVERY STEP OPENED AGAIN TO CHANGE.
 *
 * Proves, in a real browser:
 *   "Skip setup for now" lets a new owner into the app, and Home and More
 *   bring them back to it
 *   the steps are tabs: finished ones open, later ones do not
 *   each finished step shows what was entered, ready to change, and the
 *   change sticks: the business renamed, the purchase corrected (the original
 *   kept as cancelled), the dish changed and re-costed, the price changed
 *
 * Numbers: 1 kg of salt for N600 is N0.60/g; the dish uses 100 g per pot of
 * 10 plates, so N6.00 a plate. Corrected to N1,200: N12.00 a plate. Pot
 * changed to 5 plates: N24.00 a plate.
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { onboardBusiness, finishSetup, openDetails } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const A = { email: `setupnav-${stamp}@test.ng`, pass: 'correct-horse-battery' }

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const has = (body, needle) => body.toLowerCase().includes(needle.toLowerCase())
async function must(page, name, ...needles) {
  const start = Date.now()
  let missing = needles
  for (;;) {
    const body = await page.locator('body').innerText()
    missing = needles.filter((n) => !has(body, n))
    if (!missing.length || Date.now() - start > 8000) break
    await page.waitForTimeout(250)
  }
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)} at ${page.url()}` : '')
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(400)
}
async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await settle(page)
}
const path = (page) => new URL(page.url()).pathname
const tabLink = (page, label) => page.locator(`nav[aria-label="Setup steps"] a:has-text("${label}")`)

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

try {
  // --- a new owner, skipping -------------------------------------------------
  await go(page, '/signup')
  await page.fill('input[type=email]', A.email)
  await page.fill('input[type=password]', A.pass)
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/onboarding', { timeout: 60000 })
  await onboardBusiness(page, BASE, { business: 'Navi Kitchen' })

  await must(page, 'setup offers "Skip setup for now" and shows the steps as tabs',
    'Skip setup for now', 'Your business', 'What you paid', 'Your first dish', 'Your price')
  mark('a finished step is a tab you can open', (await tabLink(page, 'Your business').count()) === 1)
  mark('a step not reached yet is not', (await tabLink(page, 'Your first dish').count()) === 0)

  await page.click('button:has-text("Skip setup for now")')
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
  await must(page, 'skipping lands on Home, which says how to come back', 'Setup skipped', 'Continue guided setup')
  await go(page, '/recipes')
  mark('after skipping, the app is open (no forced return to setup)', path(page) === '/recipes', page.url())
  await go(page, '/more')
  await must(page, 'More has a Setup guide', 'Setup guide')

  // Another device: the skip is kept on the login, not only in this browser.
  const other = await browser.newContext()
  const p2 = await other.newPage()
  await p2.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await p2.waitForTimeout(1500)
  await p2.fill('input[type=email]', A.email)
  await p2.fill('input[type=password]', A.pass)
  await p2.click('button:has-text("Log in")')
  await p2.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await p2.goto(BASE + '/recipes', { waitUntil: 'domcontentloaded' })
  await settle(p2)
  mark('the skip holds on another device too', new URL(p2.url()).pathname === '/recipes', p2.url())
  await other.close()

  // --- back to it: the business tab -------------------------------------------
  await go(page, '/start')
  await tabLink(page, 'Your business').click()
  await page.waitForURL('**/start?step=business', { timeout: 30000 })
  await settle(page)
  const nameNow = await page.locator('input[name=name]').inputValue()
  mark('the business step shows what was entered', nameNow === 'Navi Kitchen', nameNow)
  await page.fill('input[name=name]', 'Navi Kitchen Renamed')
  await page.check('input[name=business_type][value=baker]')
  await page.click('button:has-text("Save and continue")')
  await page.waitForURL('**/start?step=purchase**', { timeout: 30000 })
  const { rows: [biz] } = await db.query(
    `select b.name, b.type from businesses b join memberships m on m.account_id = b.account_id
       join auth.users u on u.id = m.user_id where u.email = $1`, [A.email])
  mark('the business is renamed and its type changed', biz?.name === 'Navi Kitchen Renamed' && biz?.type === 'baker', JSON.stringify(biz))

  // --- finish the rest ---------------------------------------------------------
  await finishSetup(page, BASE, { dish: 'Navi pepper soup', price: '500' })
  await must(page, 'setup finishes as before', 'all set')
  for (const t of ['Your business', 'What you paid', 'Your first dish', 'Your price']) {
    mark(`once finished, "${t}" can be opened`, (await tabLink(page, t).count()) === 1)
  }

  // --- what you paid: correct it -------------------------------------------------
  await tabLink(page, 'What you paid').click()
  await page.waitForURL('**/start?step=purchase', { timeout: 30000 })
  await must(page, 'the purchase step shows what was recorded', 'Salt', '1 kg', '₦600.00', 'Correct what you entered')
  await openDetails(page, 'Correct what you entered')
  const amount = page.locator('form:has(input[name=purchase_id]) input[name=amount]').first()
  mark('the correction form opens with what was entered', (await amount.inputValue()) === '600', await amount.inputValue())
  await amount.fill('1200')
  await page.click('button:has-text("Save the correction")')
  await page.waitForURL('**/start?step=dish**', { timeout: 30000 })
  await must(page, 'the correction is confirmed', 'Purchase corrected')
  const { rows: purchases } = await db.query(
    `select p.status, sum(l.amount)::numeric as amount from purchases p
       join purchase_lines l on l.purchase_id = p.id
       join memberships m on m.account_id = p.account_id join auth.users u on u.id = m.user_id
      where u.email = $1 group by p.id, p.status order by min(p.created_at)`, [A.email])
  mark('the original is kept as cancelled and the corrected one stands',
    purchases.length === 2 && purchases[0].status === 'reversed' && purchases[1].status === 'posted' && Number(purchases[1].amount) === 1200,
    JSON.stringify(purchases))

  // --- the price step shows the corrected cost --------------------------------------
  await tabLink(page, 'Your price').click()
  await page.waitForURL('**/start?step=price', { timeout: 30000 })
  await must(page, 'the price step shows the corrected cost (N12.00 a plate)', '₦12.00')
  const priceNow = await page.locator('input[name=price]').inputValue()
  mark('and the price you set, ready to change', priceNow === '500', priceNow)

  // --- your first dish: change it -------------------------------------------------
  await tabLink(page, 'Your first dish').click()
  await page.waitForURL('**/start?step=dish', { timeout: 30000 })
  const dishName = await page.locator('input[name=name]').inputValue()
  const plates = await page.locator('input[name=plates]').inputValue()
  const saltQty = await page.locator('li.mm-card', { hasText: 'Salt' }).locator('input[name=qty]').inputValue()
  mark('the dish step shows what was entered', dishName === 'Navi pepper soup' && plates === '10' && saltQty === '100',
    `${dishName} / ${plates} / ${saltQty}`)
  await page.fill('input[name=plates]', '5')
  await page.click('button:has-text("Save and work out the cost")')
  await page.waitForURL('**/start?step=price**', { timeout: 30000 })
  await must(page, 'the changed dish is re-costed (N24.00 a plate)', 'Dish saved', '₦24.00')

  // --- your price: change it -----------------------------------------------------
  await page.fill('input[name=price]', '900')
  await page.click('button:has-text("Save my price")')
  await page.waitForURL('**/start?step=done**', { timeout: 30000 })
  await must(page, 'the new price is saved and shown', 'Price saved', '₦900.00')

  // --- back and next ---------------------------------------------------------------
  await go(page, '/start?step=dish')
  const back = page.locator('a:has-text("Back")')
  const next = page.locator('a:has-text("Next")')
  mark('each step has Back and Next', (await back.count()) >= 1 && (await next.count()) >= 1)
  await back.first().click()
  await page.waitForURL('**/start?step=purchase', { timeout: 30000 })
  mark('Back goes to the step before', path(page) === '/start')
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
