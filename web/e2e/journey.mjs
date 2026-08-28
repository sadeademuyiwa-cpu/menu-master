/**
 * THE REAL CUSTOMER JOURNEY.
 *
 * Driven in a real browser against real PostgREST 12.2.3 -> real PostgreSQL
 * 17.6 with migrations 0001-0032 and RLS enabled. Nothing about the data plane
 * is a fixture: every policy, trigger, generated column and costing function is
 * the one that ships.
 *
 * Nothing here accepts HTTP 200 as evidence. Every step asserts the values a
 * customer would actually read.
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const A = { email: `ada-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const B = { email: `bola-${stamp}@test.ng`, pass: 'correct-horse-battery' }

const results = []
const t0 = Date.now()
let steps = 0
const mark = (name, ok, detail = '') => {
  results.push({ name, ok, detail, atMs: Date.now() - t0, steps })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function text(page) { return page.locator('body').innerText() }
async function must(page, name, ...needles) {
  const body = await text(page)
  const missing = needles.filter((n) => !body.includes(n))
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '')
  return missing.length === 0
}
async function mustNot(page, name, ...needles) {
  const body = await text(page)
  const present = needles.filter((n) => body.includes(n))
  mark(name, present.length === 0, present.length ? `unexpectedly present ${JSON.stringify(present)}` : '')
}
/** Playwright needs an exact label; the unit list is data, so match on text. */
async function pick(scope, selector, needle) {
  const el = scope.locator(selector)
  const value = await el.evaluate(
    (node, n) => Array.from(node.options).find((o) => o.textContent.includes(n))?.value,
    needle,
  )
  if (!value) throw new Error(`no option containing ${JSON.stringify(needle)} in ${selector}`)
  await el.selectOption(value)
}

const go = async (page, path) => {
  steps++
  const url = path.startsWith('http') ? path : BASE + path
  await page.goto(url, { waitUntil: 'domcontentloaded' })
}
const submit = async (page, selector) => {
  steps++
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click(selector)])
  await page.waitForTimeout(400)
}

async function signUp(page, who) {
  await go(page, '/signup')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await submit(page, 'button[type=submit]')
  await page.waitForTimeout(600)
}
async function logIn(page, who) {
  await go(page, '/login')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await submit(page, 'button[type=submit]')
  await page.waitForTimeout(600)
}
async function onboard(page, account, business) {
  await go(page, '/onboarding')
  const inputs = page.locator('form input[type=text], form input:not([type])')
  await inputs.nth(0).fill(account)
  await inputs.nth(1).fill(business)
  await submit(page, 'button[type=submit]')
  await page.waitForTimeout(1500)   // the RPC clones ~180 catalogue items
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const consoleErrors = []
const netFailures = []

// ===========================================================================
// DESKTOP — the full first-time journey
// ===========================================================================
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('requestfailed', (r) => {
  // A scripted run navigates faster than a person, so in-flight document and
  // RSC-prefetch requests to our own origin get cancelled. That is the
  // framework working. Anything else -- and any abort against the API -- counts.
  if (r.failure()?.errorText === 'net::ERR_ABORTED' && r.url().startsWith(BASE)) return
  netFailures.push(`${r.url()} ${r.failure()?.errorText}`)
})

await signUp(page, A)
mark('signup completes and lands inside the app', !page.url().includes('/login'), page.url())

await onboard(page, 'Ada Foods', 'Ada Kitchen')
await must(page, 'onboarding reaches the dashboard', 'Menu Master NG')
const tFirstStep = Date.now() - t0

// --- ingredient -------------------------------------------------------------
await go(page, '/ingredients')
await page.fill('input[name=name]', `Ofada Rice ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await submit(page, 'form button[type=submit]')
await must(page, 'the new ingredient appears in the list', `Ofada Rice ${stamp}`)
const tFirstIngredient = Date.now() - t0
const stepsFirstIngredient = steps

// Click the LIST LINK, not the confirmation notice that also carries the name.
steps++
await page.locator(`a:has-text("Ofada Rice ${stamp}")`).first().click()
await page.waitForTimeout(600)
await must(page, 'the ingredient page opens', `Ofada Rice ${stamp}`, 'Record a purchase', 'Local measurements')
const ingUrl = page.url().split('?')[0]

// --- 3. missing conversion is a blocker, not a guess -------------------------
const buyForm = page.locator('form:has(input[name=amount])')
await buyForm.locator('input[name=qty]').fill('2')
await pick(buyForm, 'select[name=unit_id]', 'paint')
await buyForm.locator('input[name=amount]').fill('9000')
steps++
await buyForm.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await must(page, 'a purchase in an unknown local unit is REFUSED with a plain explanation',
  'does not know how much of the base unit')
await mustNot(page, 'no cost is invented for the refused purchase', '₦0.00', 'NaN')

// --- 2. conversion, then the purchase ---------------------------------------
const convForm = page.locator('form:has(input[name=qty_in_base])')
await pick(convForm, 'select[name=unit_id]', 'paint')
await convForm.locator('input[name=qty_in_base]').fill('4000')
steps++
await convForm.locator('button[type=submit]').click()
await page.waitForTimeout(800)
await must(page, 'the local measurement is saved', '1 paint =', '4000')

const buyForm2 = page.locator('form:has(input[name=amount])')
await buyForm2.locator('input[name=qty]').fill('2')
await pick(buyForm2, 'select[name=unit_id]', 'paint')
await buyForm2.locator('input[name=amount]').fill('9000')
steps++
await buyForm2.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await must(page, 'the purchase records and Postgres derives the unit cost', '₦1.13', '8000 g')
const tFirstPricedIngredient = Date.now() - t0
const stepsFirstPriced = steps

// --- recipe -----------------------------------------------------------------
await go(page, '/recipes')
await page.fill('input[name=name]', 'Ofada Special')
await page.fill('input[name=batch_yield_qty]', '4000')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '500')
await submit(page, 'form button[type=submit]')
await must(page, 'the recipe is created and opens', 'Ofada Special', 'Ingredients used')
const recipeUrl = page.url().split('?')[0]
const tFirstRecipe = Date.now() - t0
const stepsFirstRecipe = steps

// --- 1. a complete, costed recipe -------------------------------------------
const addLine = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine, 'select[name=ingredient_id]', `Ofada Rice ${stamp}`)
await addLine.locator('input[name=qty]').fill('2000')
await pick(addLine, 'select[name=unit_id]', 'g — Gram')
steps++
await addLine.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await must(page, 'THE FIRST VALUE MOMENT: a real cost and a real cost per portion',
  '₦2,250.00', '₦281.25')
const tFirstCost = Date.now() - t0
const stepsFirstCost = steps

// --- 5/6. selling price and margin ------------------------------------------
const priceForm = page.locator('form').last()
await priceForm.locator('input[name=price]').fill('500')
steps++
await priceForm.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await must(page, 'margin and profit appear from v_price_check', '43.75%', '₦218.75')
const tFirstMargin = Date.now() - t0
const stepsFirstMargin = steps

// --- 2. a missing price blocks, and NAMES the item ---------------------------
await go(page, '/ingredients')
await page.fill('input[name=name]', `Palm Oil ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'ml — Millilitre')
await submit(page, 'form button[type=submit]')
await go(page, recipeUrl)
const addLine2 = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine2, 'select[name=ingredient_id]', `Palm Oil ${stamp}`)
await addLine2.locator('input[name=qty]').fill('100')
await pick(addLine2, 'select[name=unit_id]', 'ml — Millilitre')
steps++
await addLine2.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await must(page, 'an unpriced ingredient blocks the cost and names the item',
  'cannot be costed yet', `Palm Oil ${stamp}`, 'no purchase price recorded')
await mustNot(page, 'no cost or margin is shown while incomplete', '₦2,250.00', '43.75%')

// remove it again so the rest of the journey has a complete recipe
const removeForms = page.locator('form:has(input[name=line_id])')
const n = await removeForms.count()
steps++
await removeForms.nth(n - 1).locator('button[type=submit]').click()
await page.waitForTimeout(900)
await must(page, 'removing the unpriced line restores the cost', '₦2,250.00')

// --- 4. edit a quantity, recompute ------------------------------------------
const qtyForm = page.locator('form:has(input[name=line_id])').first()
await qtyForm.locator('input[name=qty]').fill('4000')
steps++
await qtyForm.locator('button[type=submit]').first().click()
await page.waitForTimeout(1000)
await must(page, 'editing the quantity recomputes the authoritative cost', '₦4,500.00', '₦562.50')
await mustNot(page, 'the stale cost is gone', '₦2,250.00')
// The margin must follow the cost. At ₦500 a portion costing ₦562.50 now loses
// money, and the product has to say so rather than keep showing the old 43.75%.
await must(page, 'the margin follows the cost and turns negative',
  '-12.50%', 'selling this below what it costs')
await mustNot(page, 'the stale margin is gone', '43.75%')

// --- 5. persistence after refresh -------------------------------------------
steps++
await page.reload({ waitUntil: 'domcontentloaded' })
await must(page, 'the recomputed cost survives a refresh', '₦4,500.00', '₦562.50')

// --- 7. direct URL ----------------------------------------------------------
await go(page, recipeUrl)
await must(page, 'the recipe opens from a direct URL', 'Ofada Special', '₦4,500.00')

// --- 8. validation ----------------------------------------------------------
const addLine3 = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine3, 'select[name=ingredient_id]', `Ofada Rice ${stamp}`)
await addLine3.locator('input[name=qty]').fill('0')
steps++
await addLine3.locator('button[type=submit]').click()
await page.waitForTimeout(900)
const afterZero = await text(page)
mark('a zero quantity is refused with a readable message',
  /greater than zero/i.test(afterZero), afterZero.match(/.{0,60}greater than zero.{0,20}/i)?.[0] ?? 'no message')

// --- 6. persistence across logout / login -----------------------------------
await go(page, '/account')
await must(page, 'the account page reports the live trial from the database',
  'free trial', 'Free Trial', 'trialing')
await ctx.clearCookies()
await go(page, recipeUrl)
mark('a logged-out visitor is sent to the login page', page.url().includes('/login'), page.url())

await logIn(page, A)
await go(page, recipeUrl)
await must(page, 'after logging back in the same authoritative figures return',
  'Ofada Special', '₦4,500.00', '₦562.50', '-12.50%')

// ===========================================================================
// TENANT ISOLATION — a second real account, through the browser
// ===========================================================================
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const pageB = await ctxB.newPage()
await signUp(pageB, B)
await onboard(pageB, 'Bola Foods', 'Bola Kitchen')

await go(pageB, recipeUrl)
await mustNot(pageB, 'account B cannot read account A\'s recipe',
  'Ofada Special', '₦4,500.00')
await go(pageB, ingUrl)
await mustNot(pageB, 'account B cannot read account A\'s ingredient or its prices',
  `Ofada Rice ${stamp}`, '₦1.13')
await go(pageB, '/recipes')
await mustNot(pageB, 'account B\'s recipe list contains none of account A\'s work', 'Ofada Special')
await ctxB.close()

// ===========================================================================
// MOBILE — the value moment on a phone
// ===========================================================================
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } })
const pageM = await ctxM.newPage()
await logIn(pageM, A)
await go(pageM, recipeUrl)
await must(pageM, 'mobile shows the cost, the portion cost and the margin',
  '₦4,500.00', '₦562.50', '-12.50%')
const overflow = await pageM.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
mark('no horizontal overflow on a 390px viewport', overflow === 0, `${overflow}px`)
await pageM.screenshot({ path: 'e2e/shots/real-mobile-recipe.png', fullPage: true })
await go(pageM, '/ingredients')
await must(pageM, 'mobile ingredient list renders', `Ofada Rice ${stamp}`)
await pageM.screenshot({ path: 'e2e/shots/real-mobile-ingredients.png', fullPage: true })
await ctxM.close()

await page.screenshot({ path: 'e2e/shots/real-desktop-recipe.png', fullPage: true })

// ===========================================================================
// HYGIENE
// ===========================================================================
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
console.log(JSON.stringify({
  msToOnboarded: tFirstStep,
  msToFirstIngredient: tFirstIngredient, stepsToFirstIngredient: stepsFirstIngredient,
  msToFirstPricedIngredient: tFirstPricedIngredient, stepsToFirstPriced: stepsFirstPriced,
  msToFirstRecipe: tFirstRecipe, stepsToFirstRecipe: stepsFirstRecipe,
  msToFirstCost: tFirstCost, stepsToFirstCost: stepsFirstCost,
  msToFirstMargin: tFirstMargin, stepsToFirstMargin: stepsFirstMargin,
}, null, 2))
process.exit(pass === results.length ? 0 : 1)
