/**
 * THE SELLING JOURNEY, IN A REAL BROWSER.
 *
 * Phase 6. Driven against real PostgREST 12.2.3 -> real PostgreSQL 17.6 with
 * migrations 0001-0047 and RLS enabled. Every policy, trigger, generated
 * column and costing function is the one that ships.
 *
 * What this exists to prove, in the place the owner actually reads it:
 *
 *   a draft is not money -- it is not counted, and it says so
 *   the cost freezes when the sale is CONFIRMED, at that moment's prices
 *   nothing an owner does afterwards moves a confirmed sale's figures
 *   a dish with no known cost is reported as unknown, NEVER as N0.00
 *   discounts are visible as discounts, and profit is measured net of them
 *   a confirmed sale is voided and reissued, never edited
 *
 * Nothing here accepts HTTP 200 as evidence.
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const A = { email: `sade-${stamp}@test.ng`, pass: 'correct-horse-battery' }

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function text(page) { return page.locator('body').innerText() }
/* innerText returns text AFTER css text-transform, so an uppercase label reads
   back uppercased. Case is presentational; amounts are compared exactly. */
const has = (body, needle) => body.toLowerCase().includes(needle.toLowerCase())
async function must(page, name, ...needles) {
  const body = await text(page)
  const missing = needles.filter((n) => !has(body, n))
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '')
}
async function mustNot(page, name, ...needles) {
  const body = await text(page)
  const present = needles.filter((n) => has(body, n))
  const context = present.map((n) => {
    const lines = body.split('\n')
    const i = lines.findIndex((l) => has(l, n))
    return `${n} near "${lines.slice(Math.max(0, i - 1), i + 2).join(' / ').trim()}"`
  })
  mark(name, present.length === 0, present.length ? `unexpectedly present -> ${context.join(' ;; ')}` : '')
}
async function pick(scope, selector, needle) {
  const el = scope.locator(selector)
  const value = await el.evaluate(
    (node, n) => Array.from(node.options).find((o) => o.textContent.includes(n))?.value, needle)
  if (!value) throw new Error(`no option containing ${JSON.stringify(needle)} in ${selector}`)
  await el.selectOption(value)
}
const go = async (page, path) =>
  page.goto(path.startsWith('http') ? path : BASE + path, { waitUntil: 'domcontentloaded' })
const submit = async (page, sel) => {
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click(sel)])
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
}
const press = async (scope, page, sel) => {
  await scope.locator(sel).click()
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(700)
}
/** Poll a protected route until the session cookie is actually live. A fixed
 *  sleep passed locally and raced under load. */
async function settled(page, path, needle, tries = 25) {
  for (let i = 0; i < tries; i++) {
    await go(page, path)
    if ((await text(page)).includes(needle)) return
    await page.waitForTimeout(400)
  }
  throw new Error(`session never settled: ${path} never showed ${JSON.stringify(needle)}`)
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const consoleErrors = []
const netFailures = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('requestfailed', (r) => {
  if (r.failure()?.errorText === 'net::ERR_ABORTED' && r.url().startsWith(BASE)) return
  netFailures.push(`${r.url()} ${r.failure()?.errorText}`)
})

// --- a business with one costed dish and one that cannot be costed ----------
await go(page, '/signup')
await page.fill('input[type=email]', A.email)
await page.fill('input[type=password]', A.pass)
await submit(page, 'button[type=submit]')
await settled(page, '/onboarding', 'Set up your business')

await go(page, '/onboarding')
const inputs = page.locator('form input[type=text], form input:not([type])')
await inputs.nth(0).fill('Sade Foods')
await inputs.nth(1).fill('Sade Kitchen')
await submit(page, 'button[type=submit]')
await page.waitForTimeout(1800)

await go(page, '/ingredients')
await page.fill('input[name=name]', `Rice ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await submit(page, 'form button[type=submit]')
await page.locator(`a:has-text("Rice ${stamp}")`).first().click()
await page.waitForTimeout(700)

// 10 kg for N17,000 -> N1.70/g
const buy = page.locator('form:has(input[name=amount])')
await buy.locator('input[name=qty]').fill('10')
await pick(buy, 'select[name=unit_id]', 'kg')
await buy.locator('input[name=amount]').fill('17000')
await press(buy, page, 'button[type=submit]')
await must(page, 'the ingredient is priced from what was actually paid', '₦1.70')

await go(page, '/recipes')
await page.fill('input[name=name]', 'Party Jollof')
await page.fill('input[name=batch_yield_qty]', '4500')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '500')
await submit(page, 'form button[type=submit]')
const jollofUrl = page.url().split('?')[0]
await page.locator('summary:has-text("Add an ingredient")').first().click()
const addLine = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine, 'select[name=ingredient_id]', `Rice ${stamp}`)
await addLine.locator('input[name=qty]').fill('4500')
await pick(addLine, 'select[name=unit_id]', 'g — Gram')
await press(addLine, page, 'button[type=submit]')
await must(page, 'the dish is costed at N850 a portion', '₦850.00')

// A second dish whose only ingredient has never been priced. Its cost is
// unknown, and must stay unknown all the way to the sale.
await go(page, '/ingredients')
await page.fill('input[name=name]', `Mystery Spice ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await submit(page, 'form button[type=submit]')
await go(page, '/recipes')
await page.fill('input[name=name]', 'Mystery Stew')
await page.fill('input[name=batch_yield_qty]', '4000')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '400')
await submit(page, 'form button[type=submit]')
await page.locator('summary:has-text("Add an ingredient")').first().click()
const addLine2 = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine2, 'select[name=ingredient_id]', `Mystery Spice ${stamp}`)
await addLine2.locator('input[name=qty]').fill('4000')
await pick(addLine2, 'select[name=unit_id]', 'g — Gram')
await press(addLine2, page, 'button[type=submit]')

// ===========================================================================
// CUSTOMERS
// ===========================================================================
await go(page, '/customers')
await must(page, 'a business with no customers is told what a customer is for',
  'You can record sales without one')
await page.fill('input[name=name]', 'Mrs Adeyemi')
await page.fill('input[name=company]', 'Adeyemi Events')
await page.fill('input[name=notes]', 'No pepper for the children')
await submit(page, 'form button[type=submit]')
await must(page, 'the customer is saved with what needs remembering',
  'Mrs Adeyemi', 'Adeyemi Events', 'No pepper for the children')
await page.screenshot({ path: 'e2e/shots/p6-customers.png', fullPage: true })

// ===========================================================================
// A DRAFT IS NOT A SALE
// ===========================================================================
await go(page, '/sales')
await must(page, 'a business with no sales is invited to record one, not shown zeros',
  'Record a sale', 'No sales recorded yet')
await mustNot(page, 'and is not greeted by naira zero', '₦0.00')

const start = page.locator('form:has(select[name=customer_id])')
await pick(start, 'select[name=customer_id]', 'Mrs Adeyemi')
await start.locator('input[name=order_no]').fill('Saturday party')
await press(start, page, 'button[type=submit]')
const saleUrl = page.url().split('?')[0]
await must(page, 'the sale opens as a draft and says what that means',
  'Saturday party', 'still a draft', 'not from when you typed it')

const addItem = page.locator('form:has(select[name=product])')
await pick(addItem, 'select[name=product]', 'Party Jollof')
await addItem.locator('input[name=qty]').fill('10')
await addItem.locator('input[name=unit_price]').fill('1500')
await press(addItem, page, 'button[type=submit]')
await must(page, 'the item is on the draft at the price charged', '₦15,000.00')
await must(page, 'and its cost is honestly described as not yet locked in',
  'Not locked in yet')
await mustNot(page, 'a draft line never shows a naira zero cost', '₦0.00')
await page.screenshot({ path: 'e2e/shots/p6-sale-draft.png', fullPage: true })

await go(page, '/sales')
await mustNot(page, 'the draft is NOT counted as money taken', 'Sold today\n₦15,000.00')
await must(page, 'but the owner is told it is waiting on them',
  'Needs your attention', 'Not confirmed')

// ===========================================================================
// THE COST FREEZES AT CONFIRMATION, NOT AT TYPING
// ===========================================================================
// Rice doubles between typing the line and confirming the sale. A second buy
// of 10 kg at N34,000 against the first at N17,000 is a weighted average of
// N2.55/g, so a portion now costs N1,275 -- not the N850 it cost when the line
// was typed.
await go(page, '/ingredients')
await page.locator(`a:has-text("Rice ${stamp}")`).first().click()
await page.waitForTimeout(700)
const buy2 = page.locator('form:has(input[name=amount])')
await buy2.locator('input[name=qty]').fill('10')
await pick(buy2, 'select[name=unit_id]', 'kg')
await buy2.locator('input[name=amount]').fill('34000')
await press(buy2, page, 'button[type=submit]')

await go(page, jollofUrl)
await must(page, 'the dish now costs more, because the rice does', '₦1,275.00')

await go(page, saleUrl)
const confirmForm = page.locator('form:has(button:has-text("Confirm sale"))')
await press(confirmForm, page, 'button[type=submit]')
await must(page, 'confirming locks in what the sale cost, at TODAY\'s prices',
  'Confirmed', '₦12,750.00')
await must(page, 'and reports the profit on it', '₦2,250.00', '15.00%')
await mustNot(page, 'the cost frozen is NOT the cost when the line was typed', '₦8,500.00')
await page.screenshot({ path: 'e2e/shots/p6-sale-confirmed.png', fullPage: true })

await must(page, 'a confirmed sale offers correction by cancelling, not editing',
  'Something is wrong with this sale')
await mustNot(page, 'and offers no way to edit it', 'Add an item')

// ===========================================================================
// DISCOUNTS
//
// Run before the next price rise, so these lines freeze against the same
// N1,275 portion the sale above did and the arithmetic below is checkable by
// hand: 20 x N1,275 = N25,500 of cost against N25,000 kept.
// ===========================================================================
await go(page, '/sales')
const start3 = page.locator('form:has(select[name=customer_id])')
await pick(start3, 'select[name=customer_id]', 'Mrs Adeyemi')
await start3.locator('input[name=order_no]').fill('Discounted party')
await press(start3, page, 'button[type=submit]')
const discUrl = page.url().split('?')[0]

const addItem3 = page.locator('form:has(select[name=product])')
await pick(addItem3, 'select[name=product]', 'Party Jollof')
await addItem3.locator('input[name=qty]').fill('20')
await addItem3.locator('input[name=unit_price]').fill('1500')
await addItem3.locator('input[name=discount_amount]').fill('2000')
await press(addItem3, page, 'button[type=submit]')
await must(page, 'a line discount is shown as a discount, not a lower price',
  '₦30,000.00', 'less ₦2,000.00 off', '₦28,000.00')

const discForm = page.locator('form:has(input[name=order_discount])')
await discForm.locator('input[name=order_discount]').fill('3000')
await press(discForm, page, 'button[type=submit]')
await must(page, 'a discount on the whole sale is shared across its items',
  'share of the order discount', '₦3,000.00', '₦25,000.00')
await page.screenshot({ path: 'e2e/shots/p6-sale-discounts.png', fullPage: true })

const confirm3 = page.locator('form:has(button:has-text("Confirm sale"))')
await press(confirm3, page, 'button[type=submit]')
// 20 portions at N1,275 = N25,500 cost against N25,000 kept: a loss, and the
// page must say so rather than round it away.
await must(page, 'margin is worked out on what was actually taken, after discounts',
  '₦25,000.00', '₦25,500.00', '-₦500.00')

await go(page, '/sales')
await must(page, 'the day\'s figures show what was given away in discounts',
  'Given away in discounts', '₦5,000.00')

// ===========================================================================
// HISTORY DOES NOT MOVE
// ===========================================================================
await go(page, '/ingredients')
await page.locator(`a:has-text("Rice ${stamp}")`).first().click()
await page.waitForTimeout(700)
const buy3 = page.locator('form:has(input[name=amount])')
await buy3.locator('input[name=qty]').fill('10')
await pick(buy3, 'select[name=unit_id]', 'kg')
await buy3.locator('input[name=amount]').fill('200000')
await press(buy3, page, 'button[type=submit]')

await go(page, saleUrl)
await must(page, 'a later price rise leaves the confirmed sale exactly as it was',
  '₦12,750.00', '₦2,250.00', '15.00%')
await go(page, jollofUrl)
await mustNot(page, 'while the dish itself is repriced -- it is the SALE that is frozen',
  '₦1,275.00')

// ===========================================================================
// SOLD WITHOUT A KNOWN COST -- NEVER RENDERED AS ZERO
// ===========================================================================
await go(page, '/sales')
const start2 = page.locator('form:has(select[name=customer_id])')
await start2.locator('input[name=order_no]').fill('Cost unknown case')
await press(start2, page, 'button[type=submit]')
const unknownUrl = page.url().split('?')[0]
const addItem2 = page.locator('form:has(select[name=product])')
await pick(addItem2, 'select[name=product]', 'Mystery Stew')
await addItem2.locator('input[name=qty]').fill('4')
await addItem2.locator('input[name=unit_price]').fill('2000')
await press(addItem2, page, 'button[type=submit]')
const confirm2 = page.locator('form:has(button:has-text("Confirm sale"))')
await press(confirm2, page, 'button[type=submit]')

await must(page, 'a sale of an uncosted dish still confirms, and says what is missing',
  'no known cost', 'Cost not known')
await must(page, 'the money taken is still counted in full', '₦8,000.00')
await must(page, 'but the profit is reported as not known, not as zero',
  'not known yet')
await mustNot(page, 'NOTHING on this sale is rendered as naira zero', '₦0.00')
await page.screenshot({ path: 'e2e/shots/p6-sale-no-cost.png', fullPage: true })

await go(page, '/reports')
await must(page, 'reports say how much of the picture is trustworthy',
  'of revenue has a verified cost', 'Revenue without cost')
await mustNot(page, 'and never show a zero cost for revenue with no cost', '₦0.00')

// ===========================================================================
// VOID AND REISSUE
// ===========================================================================
await go(page, discUrl)
await page.locator('summary:has-text("Something is wrong")').first().click()
const voidForm = page.locator('form:has(input[name=reason])')
await voidForm.locator('input[name=reason]').fill('priced it wrong')
await press(voidForm, page, 'button[type=submit]')
await must(page, 'a confirmed sale is cancelled with a reason, and keeps its record',
  'was cancelled', 'priced it wrong', 'nothing disappears without a trace')

const reissueForm = page.locator('form:has(button:has-text("Start the replacement"))')
await press(reissueForm, page, 'button[type=submit]')
await must(page, 'the replacement is a new draft that points back at the original',
  'replacement sale has been started', 'This replaces an earlier sale')
await page.screenshot({ path: 'e2e/shots/p6-sale-reissued.png', fullPage: true })

// ===========================================================================
// THE CUSTOMER'S OWN PAGE
// ===========================================================================
await go(page, '/customers')
await page.locator('a:has-text("Mrs Adeyemi")').first().click()
await page.waitForTimeout(700)
await must(page, 'a customer page shows what they bought and what it earned',
  'Mrs Adeyemi', 'They have bought', '₦15,000.00', 'No pepper for the children')
await mustNot(page, 'and never a naira zero', '₦0.00')
await page.screenshot({ path: 'e2e/shots/p6-customer.png', fullPage: true })

// ===========================================================================
// A PHONE
// ===========================================================================
for (const [tag, width] of [['360', 360], ['390', 390]]) {
  const ctxM = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true })
  const pageM = await ctxM.newPage()
  await go(pageM, '/login')
  await pageM.fill('input[type=email]', A.email)
  await pageM.fill('input[type=password]', A.pass)
  await submit(pageM, 'button[type=submit]')
  await settled(pageM, '/sales', 'Record a sale')

  const overflow = await pageM.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  mark(`sales page does not scroll sideways at ${width}px`, overflow <= 0, `overflow ${overflow}px`)

  const navCut = await pageM.evaluate(() =>
    Array.from(document.querySelectorAll('nav a'))
      .filter((a) => a.getBoundingClientRect().right > window.innerWidth + 1)
      .map((a) => a.textContent.trim()))
  mark(`every destination is reachable at ${width}px`, navCut.length === 0,
    navCut.length ? `off-screen: ${JSON.stringify(navCut)}` : 'all reachable')

  await pageM.screenshot({ path: `e2e/shots/p6-sales-mobile-${tag}.png`, fullPage: true })
  await go(pageM, saleUrl)
  await must(pageM, `a confirmed sale reads correctly at ${width}px`, '₦12,750.00', '₦2,250.00')
  await pageM.screenshot({ path: `e2e/shots/p6-sale-mobile-${tag}.png`, fullPage: true })
  await go(pageM, '/customers')
  await pageM.screenshot({ path: `e2e/shots/p6-customers-mobile-${tag}.png`, fullPage: true })
  await ctxM.close()
}

// ===========================================================================
// HYGIENE
// ===========================================================================
await go(page, '/sales')
const finalBody = await text(page)
mark('no NaN, undefined or null leaked into the page',
  !/NaN|undefined|\bnull\b/.test(finalBody))
mark('no browser console errors during the journey',
  consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
mark('no failed network requests during the journey',
  netFailures.length === 0, netFailures.slice(0, 3).join(' | '))

await browser.close()
const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} checks passed`)
process.exit(pass === results.length ? 0 : 1)
