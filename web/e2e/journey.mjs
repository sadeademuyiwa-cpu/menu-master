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
import { fileURLToPath } from 'node:url'
import { onboardBusiness, finishSetup, newDish, openDetails, pickItem, createItemInPicker } from './setup-helper.mjs'

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
/**
 * innerText returns text AFTER CSS text-transform, so a heading styled
 * `uppercase` reads back as "COST PER PORTION" and a literal match fails on
 * copy that is in fact present. Case is presentational here; the words are the
 * assertion. Everything else stays exact -- amounts and percentages are
 * compared character for character.
 */
const has = (body, needle) => needle instanceof RegExp
  ? needle.test(body)
  : body.toLowerCase().includes(needle.toLowerCase())
/**
 * A naira zero standing in for a number. money() prints whole naira now, so
 * a zero reads "₦0" as well as the old "₦0.00"; both are caught. A real small
 * amount ("₦0.60 of salt") is not.
 */
const ZERO_NAIRA = /₦0(?:\.00)?(?![\d.,])/
/**
 * A page that a save re-renders can be read before the new render lands: a
 * fixed pause after the click raced under load. So a check waits up to 5 s
 * for what it expects -- a real failure still fails, five seconds later --
 * and every wait is recorded, so a slowdown shows up in the summary instead
 * of hiding behind the retry.
 */
const waits = []
async function readUntil(page, needles, ms = 5000) {
  const start = Date.now()
  let body = await text(page)
  let missing = needles.filter((n) => !has(body, n))
  while (missing.length && Date.now() - start < ms) {
    await page.waitForTimeout(250)
    body = await text(page)
    missing = needles.filter((n) => !has(body, n))
  }
  if (!missing.length) waits.push(Date.now() - start)
  return { body, missing }
}
async function must(page, name, ...needles) {
  await rendered(page)
  const { body, missing } = await readUntil(page, needles)
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '')
  // What the page actually said, so a failure can be read without a rerun.
  if (missing.length) console.log('      page said: ' + body.replace(/\s+/g, ' ').slice(0, 600))
  return missing.length === 0
}
async function mustNot(page, name, ...needles) {
  await rendered(page)
  const body = await text(page)
  const present = needles.filter((n) => has(body, n))
  // Report WHERE a forbidden value appeared. "unexpectedly present" alone sent
  // me guessing once; the surrounding line says whether it is a recipe total
  // (a real fault) or a labelled per-line figure (not one).
  const context = present.map((n) => {
    const line = body.split('\n').find((l) => has(l, n)) ?? ''
    const i = body.split('\n').findIndex((l) => has(l, n))
    const near = body.split('\n').slice(Math.max(0, i - 2), i + 2).join(' / ')
    return `${n} in "${line.trim()}" [context: ${near.trim()}]`
  })
  mark(name, present.length === 0, present.length ? `unexpectedly present -> ${context.join(' ;; ')}` : '')
}
/**
 * mustNot, reading the page with some parts left out. The dish page's "What
 * one portion is made of" bar (.mm-chart) shows each ingredient's own share --
 * a per-line figure, like the line costs -- so a recipe-level check reads
 * everything except that bar, and the bar is checked on its own.
 */
async function mustNotOutside(page, name, skip, ...needles) {
  await rendered(page)
  const body = await page.evaluate((sel) => {
    const hidden = [...document.querySelectorAll(sel)]
    const was = hidden.map((el) => el.style.display)
    hidden.forEach((el) => { el.style.display = 'none' })
    const t = document.body.innerText
    hidden.forEach((el, i) => { el.style.display = was[i] })
    return t
  }, skip)
  const present = needles.filter((n) => has(body, n))
  const context = present.map((n) => {
    const line = body.split('\n').find((l) => has(l, n)) ?? ''
    return `${n} in "${line.trim()}"`
  })
  mark(name, present.length === 0, present.length ? `unexpectedly present -> ${context.join(' ;; ')}` : '')
}
/**
 * A dish ingredient is a short row now; tapping it opens a sheet (a <dialog>)
 * with where its cost came from and the forms to change or remove it.
 */
async function openLine(page, itemName) {
  steps++
  await page.locator('li', { hasText: itemName }).locator('button[aria-haspopup=dialog]').first().click()
  await page.locator('dialog[open]').first().waitFor({ state: 'visible', timeout: 10000 })
  return page.locator('dialog[open]').first()
}
async function closeSheet(page) {
  await page.keyboard.press('Escape')
  await page.locator('dialog[open]').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
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

/**
 * Every page streams its body behind an in-page Suspense boundary, so
 * DOMContentLoaded can fire with the skeleton in the document and the real
 * content following. "Rendered" therefore means the skeleton has left, not
 * that the document has loaded. Resolves at once when no skeleton is present.
 */
const rendered = (page) =>
  page.locator('[aria-label="Loading"]').first()
    .waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})

const go = async (page, path) => {
  steps++
  const url = path.startsWith('http') ? path : BASE + path
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await rendered(page)
}
/**
 * A submit is over when the button stops being busy, not when the network
 * goes quiet. On a server-action redirect the router briefly aborts and
 * re-fetches the new page's payload, so "quiet" can arrive a second before
 * the new content does; the Button's aria-busy clears exactly when the
 * transition commits. Resolves at once for a form that was never busy.
 */
const settledForm = (page) =>
  page.locator('button[aria-busy="true"]').first()
    .waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})

const submit = async (page, selector) => {
  steps++
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click(selector)])
  await page.waitForLoadState('networkidle').catch(() => {})
  await settledForm(page)
  await rendered(page)
  await page.waitForTimeout(400)
}

async function signUp(page, who) {
  await go(page, '/signup')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await submit(page, 'button[type=submit]')
  // The auth cookie is written by a server action. Poll a protected route
  // until it actually renders for this user rather than sleeping and hoping:
  // a fixed delay passed locally and raced under load.
  await settled(page, '/onboarding', 'Tell us about your business')
}
/** Navigate until the page proves the session is live, or fail loudly.
 *  25 tries, not 15: the first run against a cold database took longer than
 *  six seconds to write the auth cookie and the harness, not the product,
 *  failed. */
/**
 * Record a sale / Record a purchase lead Home: before the dishes, with their
 * top in the first half-screen. 'ok', or what is wrong instead.
 */
async function homeLeads(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 0)
    const qa = document.querySelector('[data-quick-actions]')
    if (!qa) return 'no quick actions'
    const dishes = document.getElementById('home-dishes')
    if (dishes && !(qa.compareDocumentPosition(dishes) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'after the dishes'
    const top = qa.getBoundingClientRect().top
    return top < window.innerHeight / 2 ? 'ok' : `${Math.round(top)}px down`
  })
}
async function settled(page, path, needle, tries = 25) {
  for (let i = 0; i < tries; i++) {
    await go(page, path)
    const body = await text(page)
    if (body.includes(needle)) return true
    await page.waitForTimeout(400)
  }
  throw new Error(`session never settled: ${path} never showed ${JSON.stringify(needle)}`)
}
async function logIn(page, who) {
  await go(page, '/login')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await submit(page, 'button[type=submit]')
  // The header names the business now, not the app; the primary nav is the
  // one thing every signed-in page carries.
  await settled(page, '/dashboard', 'Purchases')
}
/** The account takes the business's name now; `account` is kept for call sites. */
async function onboard(page, _account, business) {
  await onboardBusiness(page, BASE, { business })
  // Setup is compulsory: one priced dish before the rest of the app opens.
  await finishSetup(page, BASE)
  await go(page, '/dashboard')
  await rendered(page)
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const consoleErrors = []
const netFailures = []

// ===========================================================================
// DESKTOP — the full first-time journey
// ===========================================================================
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
// Irreversible buttons ask once (components/confirm-submit.tsx). Playwright
// dismisses dialogs by default, which would silently cancel every removal.
ctx.on('dialog', (d) => d.accept())
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
mark('signup completes and lands inside the app', (await text(page)).includes('Tell us about your business'), page.url())

await onboard(page, 'Ada Foods', 'Ada Kitchen')
await must(page, 'onboarding reaches the dashboard', 'Ada Kitchen')

// PHASE 5: a first-time owner is told what to do, not shown a wall of zeros.
await must(page, 'a brand new business gets a guided next step, not an empty dashboard',
  'Getting started', 'Next', 'Record your first sale')
await mustNot(page, 'and is not greeted by zero naira everywhere', ZERO_NAIRA)
await mustNot(page, 'no database words reach the owner',
  'allocation basis', 'basis dimension', 'snapshot', 'provenance',
  'recipe basis', 'reconciliation', 'variant resolver', 'NULL')
await page.screenshot({ path: 'e2e/shots/p5-dashboard-new.png', fullPage: true })
const tFirstStep = Date.now() - t0

// --- ingredient -------------------------------------------------------------
await go(page, '/ingredients')
await openDetails(page, 'Add your own item')
await page.fill('input[name=name]', `Ofada Rice ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'Weight — grams')
await submit(page, 'form button[type=submit]')
await must(page, 'the new ingredient appears in the list', `Ofada Rice ${stamp}`)
const tFirstIngredient = Date.now() - t0
const stepsFirstIngredient = steps

// Click the LIST LINK, not the confirmation notice that also carries the name.
steps++
await page.locator(`a:has-text("Ofada Rice ${stamp}")`).first().click()
await page.waitForTimeout(600)
await settledForm(page)
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
await settledForm(page)
await must(page, 'a purchase in an unknown local unit is REFUSED with a plain explanation',
  'does not know how much one of those holds')
await page.screenshot({ path: 'e2e/shots/rc-ingredient-unknown-unit.png', fullPage: true })
await mustNot(page, 'no cost is invented for the refused purchase', ZERO_NAIRA, 'NaN')

// --- 2. conversion, then the purchase ---------------------------------------
await openDetails(page, 'Add a local measure')
const convForm = page.locator('form:has(input[name=qty_in_base])')
await pick(convForm, 'select[name=unit_id]', 'paint')
await convForm.locator('input[name=qty_in_base]').fill('4000')
steps++
await convForm.locator('button[type=submit]').click()
await page.waitForTimeout(800)
await settledForm(page)
await must(page, 'the local measurement is saved', '1 paint =', '4000')

const buyForm2 = page.locator('form:has(input[name=amount])')
await buyForm2.locator('input[name=qty]').fill('2')
await pick(buyForm2, 'select[name=unit_id]', 'paint')
await buyForm2.locator('input[name=amount]').fill('9000')
steps++
await buyForm2.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await settledForm(page)
// Quantities are stored in the base unit but shown the way a person bought
// them: 8,000 g is 8 kg. The derived unit cost is unchanged.
await must(page, 'the purchase records and Postgres derives the unit cost', '₦1.13', '8 kg')
const tFirstPricedIngredient = Date.now() - t0
const stepsFirstPriced = steps

// --- recipe -----------------------------------------------------------------
await newDish(page, BASE, { name: 'Ofada Special', batch: '4000', unit: 'g — Gram', portion: '500' })
await must(page, 'the recipe is created and opens', 'Ofada Special', 'What goes in')
const recipeUrl = page.url().split('?')[0]
const tFirstRecipe = Date.now() - t0
const stepsFirstRecipe = steps

// --- 1. a complete, costed recipe -------------------------------------------
await openDetails(page, 'Add an ingredient')
const addLine = page.locator('form:has([data-picker=ingredient_id])')
await pickItem(addLine, 'ingredient_id', `Ofada Rice ${stamp}`)
await addLine.locator('input[name=qty]').fill('2000')
await pick(addLine, 'select[name=unit_id]', 'g — Gram')
steps++
await addLine.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await settledForm(page)
// N281.25 a portion, shown as N281: whole naira from N100 up.
await must(page, 'THE FIRST VALUE MOMENT: cost per portion, above the fold',
  'Cost per portion', '₦281')
await page.screenshot({ path: 'e2e/shots/rc-desktop-costed.png', fullPage: true })
const tFirstCost = Date.now() - t0
const stepsFirstCost = steps

// --- 5/6. selling price and margin ------------------------------------------
// Found by its field, not its position: a costed dish with no price now asks
// for the price straight under the numbers, as its next step.
// Not the hidden price inside a "Use ₦X" confirm sheet: the one she types in.
const priceForm = page.locator('form:has(input[name=price]:not([type=hidden]))').first()
await priceForm.locator('input[name=price]').fill('500')
steps++
await priceForm.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await settledForm(page)
// 500 - 281.25 = 218.75 kept, shown as N219; 43.75% as 44%.
await must(page, 'profit, margin and a plain-language verdict appear',
  'You keep', '₦219', '44%', 'Healthy')
const tFirstMargin = Date.now() - t0
const stepsFirstMargin = steps

// --- 2. a missing price blocks, and NAMES the item ---------------------------
await go(page, '/ingredients')
await openDetails(page, 'Add your own item')
await page.fill('input[name=name]', `Palm Oil ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'Volume — millilitres')
await submit(page, 'form button[type=submit]')
await go(page, recipeUrl)
await openDetails(page, 'Add an ingredient')
const addLine2 = page.locator('form:has([data-picker=ingredient_id])')
await pickItem(addLine2, 'ingredient_id', `Palm Oil ${stamp}`)
await addLine2.locator('input[name=qty]').fill('100')
await pick(addLine2, 'select[name=unit_id]', 'ml — Millilitre')
steps++
await addLine2.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await settledForm(page)
await must(page, 'an unpriced ingredient blocks the cost and NAMES the item',
  'Cost incomplete', `Palm Oil ${stamp}`, 'has no purchase price')
// The engine counts portion size as a required input, so a "priced of required"
// ratio shows a number the owner cannot account for on screen.
await mustNot(page, 'the blocker count does not cite items the page never shows',
  '2 of 3 items', 'of 3 items are ready')
await page.screenshot({ path: 'e2e/shots/rc-desktop-missing-price.png', fullPage: true })
// While a recipe is incomplete, no RECIPE-LEVEL figure may appear: not the cost
// per portion, not the batch cost, not the profit, not the margin. A per-line
// cost is a different thing and is deliberately still shown -- ₦2,250.00 is the
// true cost of the rice line, derived from the owner's own purchase, and
// hiding it would hide what they already know. The blocker names what is
// missing; the lines show what is not.
// The "What one portion is made of" bar shows the rice line's own share
// (N281 a portion) beside a hatched "not known yet" for the palm oil: per-line
// figures, read on their own below. Everything else on the page must carry no
// recipe-level figure.
await mustNotOutside(page, 'no recipe cost, profit or margin is shown while incomplete', '.mm-chart',
  '₦281', '₦219', '44%', 'Cost per portion', 'Profit per portion', 'You keep', 'you would keep')
const bar = (await page.locator('.mm-chart').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
mark('the portion bar names the unknown part and gives no total while incomplete',
  has(bar, `Palm Oil ${stamp}`) && has(bar, 'not known yet') && /One portion in all not known yet/i.test(bar), bar.slice(0, 200))
await must(page, 'the priced line still shows its own true cost while incomplete', '₦2,250')
// Where the line's cost came from is in its sheet now.
await openLine(page, `Ofada Rice ${stamp}`)
// Said the way it is bought: ₦1.125 a gram is ₦1,125 per kg.
await must(page, 'and its sheet says where that cost came from', '₦1,125 per kg', 'You bought 8 kg for ₦9,000')
await closeSheet(page)
await mustNot(page, 'and no naira zero stands in for the unknown cost', ZERO_NAIRA)

// remove it again so the rest of the journey has a complete recipe
const palmSheet = await openLine(page, `Palm Oil ${stamp}`)
await palmSheet.locator('button:has-text("Remove from this dish")').click()
await page.waitForTimeout(900)
await settledForm(page)
await must(page, 'removing the unpriced line restores the cost', '₦2,250', 'Cost per portion', '₦281')

// --- 4. edit a quantity, recompute ------------------------------------------
const riceSheet = await openLine(page, `Ofada Rice ${stamp}`)
await riceSheet.locator('input[name=qty]').fill('4000')
await riceSheet.locator('button:has-text("Save")').click()
await page.waitForTimeout(1000)
await settledForm(page)
// 4000 g of rice at N1.125/g is N4,500 a batch; 500 g of a 4000 g batch is
// N562.50 a portion, shown as N563 (whole naira from N100 up).
await must(page, 'editing the quantity recomputes the authoritative cost', '₦4,500', '₦563')
await mustNot(page, 'the stale cost is gone', '₦2,250', '₦281')
// The margin must follow the cost. At ₦500 a portion costing ₦562.50 now loses
// money, and the product has to say so rather than keep showing the old 44%.
// (-12.5% shows as -13%: a half rounds away from zero, as PostgreSQL does.)
await must(page, 'the margin follows the cost and turns negative',
  '-13%', 'Loss', 'less than it costs you to make')
await page.screenshot({ path: 'e2e/shots/rc-desktop-below-cost.png', fullPage: true })
await mustNot(page, 'the stale margin is gone', '44%', '₦219')

// --- full costing view -------------------------------------------------------
await go(page, recipeUrl + '?view=pro')
await must(page, 'the full costing view shows the batch breakdown',
  'Every cost', 'Batch cost', 'Where the batch cost goes', 'Portions per batch')
// Owner rule: a customer must be able to reproduce a purchase-derived cost
// from their own records, and an estimate must never look like a purchase.
await must(page, 'the page states where the unit cost came from, in the units bought',
  'You bought 8 kg for ₦9,000')
// Phase 3: the worksheet's profitability panel, every figure from PostgreSQL.
// Margin and markup are different numbers for the same dish and must both
// appear, correctly labelled, so neither can be mistaken for the other.
await must(page, 'the worksheet shows margin AND markup, distinctly labelled',
  'Profitability, per portion', 'Margin — what you keep, as a share of the price',
  'Markup (added to your cost)', 'Price to hit that target')
await mustNot(page, 'a real purchase is never labelled an estimate',
  'Estimated price')
await page.screenshot({ path: 'e2e/shots/rc-desktop-pro.png', fullPage: true })

// --- PHASE 4: business-defined formats, packaging, labour, overhead ---------
// Nothing here is a Menu Master constant: the business names its own format
// and states its own size, and the engine blocks rather than guesses.
await go(page, '/settings')
await openDetails(page, 'Add a kind of work')
// Scoped: Settings now also carries the business's own name field above.
const workForm = page.locator('details:has(> summary:has-text("Add a kind of work")) form')
await workForm.locator('input[name=name]').fill('Cooking')
await workForm.locator('input[name=rate_per_hour]').fill('500')
await workForm.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await settledForm(page)
await must(page, 'a business can define what it pays per hour', 'Cooking', '₦500 an hour')

await go(page, '/formats')
await openDetails(page, 'Add a size')
await page.fill('input[name=name]', `Family Bowl ${stamp}`)
await page.fill('input[name=capacity_qty]', '2.5')
await pick(page, 'select[name=capacity_unit_id]', 'l — Litre')
await submit(page, 'form button[type=submit]')
await must(page, 'a business can define its own container size', `Family Bowl ${stamp}`, '2.5 l')

await mustNot(page, 'Menu Master ships no catalogue of container sizes',
  '500 ml, 1 L, 1.5 L')

// Next does a client-side navigation here, so domcontentloaded never fires
// again. Wait for the URL to actually become the detail route instead of
// assuming the click landed -- otherwise the assertion reads the list page.
await page.locator(`a:has-text("Family Bowl ${stamp}")`).first().click()
await page.waitForURL(/\/formats\/[0-9a-f-]{36}/, { timeout: 15000 })
await page.waitForLoadState('networkidle').catch(() => {})
await rendered(page)
await page.evaluate(() => document.querySelectorAll('details.mm-info').forEach((d) => { d.open = true }))
await must(page, 'the size explains that packaging is counted once for each one sold',
  'Packaging', 'once for each one')
await page.screenshot({ path: 'e2e/shots/p4-format-detail.png', fullPage: true })

await go(page, '/settings')
await must(page, 'overhead is spread over what the business produces, not a fixed assumption',
  'How much do you make in a month?')

// A non-accountant must be able to split bills across two kinds of output
// without meeting the words "dimension", "basis" or "allocation".
await openDetails(page, 'Add a monthly bill')
// The split-across-outputs option is folded inside the add form (Phase 2):
// most businesses make one kind of thing and never need it.
await openDetails(page, 'Spread this bill across something else?')
await must(page, 'running costs are explained in plain business language',
  'Spread across how much?', 'rent for the soup pots over 600')
await mustNot(page, 'no dimensional-analysis jargon reaches the owner',
  'dimension', 'allocation basis', 'basis unit')

// Scoped to the add form: each bill already listed carries its own edit form.
const ohForm = page.locator('details:has(> summary:has-text("Add a monthly bill")) form')
await ohForm.locator('input[name=name]').fill('Soup pot rent')
await ohForm.locator('input[name=monthly_cost]').fill('300000')
await ohForm.locator('input[name=basis_qty]').fill('600')
await pick(ohForm, 'select[name=basis_unit_id]', 'l — Litre')
steps++
await ohForm.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await settledForm(page)
await must(page, 'a running cost states what it is spread across, in the owner\'s words',
  'Soup pot rent', 'spread across 600 l you make')

await openDetails(page, 'Add a monthly bill')
await openDetails(page, 'Spread this bill across something else?')
const ohForm2 = page.locator('details:has(> summary:has-text("Add a monthly bill")) form')
await ohForm2.locator('input[name=name]').fill('Bakery rent')
await ohForm2.locator('input[name=monthly_cost]').fill('200000')
await ohForm2.locator('input[name=basis_qty]').fill('400')
await pick(ohForm2, 'select[name=basis_unit_id]', 'kg — Kilogram')
steps++
await ohForm2.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await settledForm(page)
await must(page, 'a second cost can be spread across a different kind of output',
  'Bakery rent', 'spread across 400 kg you make')
await page.screenshot({ path: 'e2e/shots/p4-overhead-split.png', fullPage: true })
await mustNot(page, 'the superseded servings-per-month field is gone',
  'Servings you sell in a typical month')
await page.screenshot({ path: 'e2e/shots/p4-settings.png', fullPage: true })

await go(page, recipeUrl + '?view=pro')
await must(page, 'the recipe worksheet offers labour from the business rates', 'Time it takes', 'Add work')

// MODEL 1 vs MODEL 2, on SEPARATE recipes so each is exercised in its own
// right. Attaching a format to the main recipe would switch it to the
// format-based model and its per-portion assertions would stop applying --
// correctly, but it would no longer test the portion model.
await go(page, recipeUrl)
await must(page, 'a recipe with no format is sold by the portion',
  'Sizes you sell this in', 'Sold by the portion')

await newDish(page, BASE, { name: `Format Soup ${stamp}`, batch: '10000', unit: 'ml — Millilitre' })
const fmtRecipeUrl = page.url().split('?')[0]

await openDetails(page, 'Add an ingredient')
const fLine = page.locator('form:has([data-picker=ingredient_id])')
await pickItem(fLine, 'ingredient_id', `Ofada Rice ${stamp}`)
await fLine.locator('input[name=qty]').fill('10000')
await pick(fLine, 'select[name=unit_id]', 'g — Gram')
steps++
await fLine.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await settledForm(page)

// With no format yet this recipe is still MODEL 1, so the engine correctly
// asks for a portion size. That is the point of the two models: the demand
// appears only while the portion is the commercial unit.
await must(page, 'MODEL 1 still applies until a format exists', 'Cost incomplete')

await openDetails(page, 'Sizes you sell this in')
const vForm = page.locator('form:has(select[name=format_id])')
await pick(vForm, 'select[name=format_id]', `Family Bowl ${stamp}`)
steps++
await vForm.locator('button[type=submit]').click()
await page.waitForTimeout(1500)
await settledForm(page)
await rendered(page)
await page.evaluate(() => document.querySelectorAll('details.mm-info').forEach((d) => { d.open = true }))
await must(page, 'attaching a format switches the recipe to selling by size',
  `Family Bowl ${stamp}`, 'Sizes you sell this in', '1 size')
await mustNot(page, 'and it is no longer sold by the portion', 'Sold by the portion')
// 10 kg of rice at N1.125/g is N11,250 for a 10 l batch; a 2.5 l bowl is a
// quarter of it, N2,812.50, plus the bowl's share of the monthly bills set up
// earlier, N1,250 (the engine's variant_overhead_cost): N4,062.50, shown as N4,063.
await must(page, 'each size shows what it costs, from the same batch, ready to price',
  'Costs ₦4,063', 'Your prices', `Price for Family Bowl ${stamp}`)
// MODEL 2 now applies: the format is the commercial unit and no portion size
// was ever supplied, yet nothing is blocked and nothing was invented.
await mustNot(page, 'MODEL 2: no synthetic portion size is demanded',
  'Cost incomplete', 'set how much one portion is')
await page.screenshot({ path: 'e2e/shots/p4-recipe-formats.png', fullPage: true })

// price the size and read back profit, margin and markup for THAT size
const fpForm = page.locator('form:has(input[name=variant_id]):has(input[name=price]:not([type=hidden]))').first()
await fpForm.locator('input[name=price]').fill('7500')
steps++
await fpForm.locator('button[type=submit]').click()
await page.waitForTimeout(1500)
await settledForm(page)
await rendered(page)
// N7,500 - N4,062.50 = N3,437.50 kept, shown as N3,438; 45.83% as 46%.
await must(page, 'a size can be priced and reports its own profit and margin',
  'sells for ₦7,500', 'You keep', '₦3,438', '46%')
await go(page, fmtRecipeUrl)

// --- PHASE 2: the purchase ledger, end to end -------------------------------
// The single-line form on the ingredient page now goes through fn_post_purchase,
// so a real purchase must appear in the ledger and be reversible.
await go(page, '/purchases')
// A recorded row carries no status word now (only drafts and cancellations
// do); it names what was bought and what it came to.
await must(page, 'the purchase the ingredient page recorded appears in the ledger',
  'Purchase history', `Ofada Rice ${stamp}`, '₦9,000')
await mustNot(page, 'and it is recorded, not left as a draft', 'Not recorded yet')

// A full multi-line purchase, entered the way a market run actually happens.
await go(page, '/suppliers')
await openDetails(page, 'Add a supplier or market')
await page.fill('input[name=name]', `Mile 12 ${stamp}`)
await submit(page, 'form button[type=submit]')
await must(page, 'a market can be added as a supplier', `Mile 12 ${stamp}`)

// The whole trip on the purchase screen: item, quantity, unit, what was paid,
// and the market it came from.
await go(page, '/purchases/new')
await must(page, 'a purchase opens on its own screen, ready for items', 'Record a purchase', 'What did you buy?')
await page.waitForTimeout(500)
await pickItem(page, 'Item 1', `Ofada Rice ${stamp}`)
await page.fill('input[aria-label="How much, item 1"]', '25')
await page.selectOption('select[aria-label="Unit, item 1"]', { label: 'kg' })
await page.fill('input[aria-label="Paid, item 1"]', '42000')
await openDetails(page, 'Date, supplier and reference')
await pick(page, 'details select:not([aria-label])', `Mile 12 ${stamp}`)
steps++
await page.click('button:has-text("Record purchase")')
await page.waitForURL(/\/purchases\/[0-9a-f-]{36}/, { timeout: 60000 })
await rendered(page)
await settledForm(page)
const purchaseUrl = page.url().split('?')[0]
await must(page, 'the item is recorded with what was actually paid', '₦42,000', '25 kg')
await must(page, 'recording the purchase reports the prices it updated',
  'Recorded', 'price updated')
await must(page, 'and shows the dishes it re-costed', 'What this changed', 'Ofada Special')
await mustNot(page, 'a recorded purchase is never left as a draft', 'Not recorded yet')

// Reversal: the cost is undone, the record is kept. (Correcting in one step
// is the primary path now -- web/e2e/journey-edit.mjs; this is the plain cancel.)
await must(page, 'a recorded purchase offers a one-step correction', 'Correct this purchase')
await openDetails(page, 'Cancel it without a replacement')
const revForm = page.locator('form:has(input[name=reason])')
await revForm.locator('input[name=reason]').fill('wrong amount')
steps++
await revForm.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await settledForm(page)
await must(page, 'a purchase can be cancelled with a reason, and says so',
  'Cancelled', 'wrong amount')
await go(page, purchaseUrl)
await must(page, 'the cancelled purchase is kept as evidence, not deleted', '₦42,000', 'Cancelled')

// --- 3. the RECIPE-level missing-conversion blocker --------------------------
// Distinct from the ingredient page refusing an unknown purchase unit: here the
// ingredient IS priced, but the recipe asks for it in a unit that has no
// conversion for this item, so the engine cannot resolve the quantity. The
// recipe must name that, and must not fall back to a guess.
await go(page, '/ingredients')
await openDetails(page, 'Add your own item')
await page.fill('input[name=name]', `Garri ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'Weight — grams')
await submit(page, 'form button[type=submit]')
await page.locator(`a:has-text("Garri ${stamp}")`).first().click()
await page.waitForLoadState('domcontentloaded')
await rendered(page)
const garriBuy = page.locator('form:has(input[name=amount])')
await garriBuy.locator('input[name=qty]').fill('1000')
await pick(garriBuy, 'select[name=unit_id]', 'g — Gram')
await garriBuy.locator('input[name=amount]').fill('2000')
steps++
await garriBuy.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await settledForm(page)
await rendered(page)

await newDish(page, BASE, { name: 'Garri Test', batch: '1000', unit: 'g — Gram', portion: '250' })
const convRecipeUrl = page.url().split('?')[0]
await openDetails(page, 'Add an ingredient')
const addConv = page.locator('form:has([data-picker=ingredient_id])')
await pickItem(addConv, 'ingredient_id', `Garri ${stamp}`)
await addConv.locator('input[name=qty]').fill('2')
await pick(addConv, 'select[name=unit_id]', 'paint')
steps++
await addConv.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await settledForm(page)
await rendered(page)
await must(page, 'a recipe line in an unconvertible unit blocks and says what is needed',
  'Cost incomplete', `Garri ${stamp}`, 'paint')
await mustNot(page, 'no cost is guessed for the unconvertible line', ZERO_NAIRA, 'NaN')
await page.screenshot({ path: 'e2e/shots/rc-desktop-missing-conversion.png', fullPage: true })

await go(page, recipeUrl)

// --- 5. persistence after refresh -------------------------------------------
steps++
await page.reload({ waitUntil: 'domcontentloaded' })
await rendered(page)
await must(page, 'the recomputed cost survives a refresh', '₦4,500', '₦563')

// --- 7. direct URL ----------------------------------------------------------
await go(page, recipeUrl)
await must(page, 'the recipe opens from a direct URL', 'Ofada Special', '₦4,500')

// --- 8. validation ----------------------------------------------------------
await openDetails(page, 'Add an ingredient')
const addLine3 = page.locator('form:has([data-picker=ingredient_id])')
await pickItem(addLine3, 'ingredient_id', `Ofada Rice ${stamp}`)
// A unit too: the form now asks for one, and this step is about the amount.
await pick(addLine3, 'select[name=unit_id]', 'g — Gram')
await addLine3.locator('input[name=qty]').fill('0')
steps++
await addLine3.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await settledForm(page)
const afterZero = await text(page)
mark('a zero quantity is refused with a readable message',
  /greater than zero/i.test(afterZero), afterZero.match(/.{0,60}greater than zero.{0,20}/i)?.[0] ?? 'no message')

// --- 6. persistence across logout / login -----------------------------------
await go(page, '/account')
// The status reads as words now ("Free trial"), never the raw value "trialing".
await must(page, 'the account page reports the live trial from the database',
  'free trial', 'days left')
await mustNot(page, 'the account page shows no raw database status', 'trialing')
await ctx.clearCookies()
await go(page, recipeUrl)
mark('a logged-out visitor is sent to the login page', page.url().includes('/login'), page.url())

await logIn(page, A)
await go(page, recipeUrl)
await must(page, 'after logging back in the same authoritative figures return',
  'Ofada Special', '₦4,500', '₦563', '-13%')

// ===========================================================================
// TENANT ISOLATION — a second real account, through the browser
// ===========================================================================
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
ctxB.on('dialog', (d) => d.accept())
const pageB = await ctxB.newPage()
await signUp(pageB, B)
await onboard(pageB, 'Bola Foods', 'Bola Kitchen')

await go(pageB, recipeUrl)
await mustNot(pageB, 'account B cannot read account A\'s recipe',
  'Ofada Special', '₦4,500')
await go(pageB, ingUrl)
await mustNot(pageB, 'account B cannot read account A\'s ingredient or its prices',
  `Ofada Rice ${stamp}`, '₦1.13')
await go(pageB, '/recipes')
await mustNot(pageB, 'account B\'s recipe list contains none of account A\'s work', 'Ofada Special')
await ctxB.close()

// PHASE 5: with real data the dashboard answers the five questions.
// First give it a genuine task: an ingredient that a recipe uses but nobody
// has priced. Only ingredients actually IN a recipe should appear -- the
// starter catalogue must not fill the list with food never bought.
await go(page, '/ingredients')
await openDetails(page, 'Add your own item')
await page.fill('input[name=name]', `Unpriced Pepper ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'Weight — grams')
await submit(page, 'form button[type=submit]')
await go(page, fmtRecipeUrl)
await openDetails(page, 'Add an ingredient')
const upLine = page.locator('form:has([data-picker=ingredient_id])')
await pickItem(upLine, 'ingredient_id', `Unpriced Pepper ${stamp}`)
await upLine.locator('input[name=qty]').fill('50')
await pick(upLine, 'select[name=unit_id]', 'g — Gram')
steps++
await upLine.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await settledForm(page)

await go(page, '/dashboard')
// Home's "Needs you": Ofada Special sells at N500 against a N562.50 cost.
await must(page, 'the dashboard reports products that need attention',
  'Needs you', 'Ofada Special')
await must(page, 'and states them in plain business language',
  'Selling at a loss')
const lossRow = page.locator('section[aria-labelledby=home-needs] li', { hasText: 'Ofada Special' }).first()
mark('and offers the fix, a price worked out from her own cost and target',
  (await lossRow.locator('button:has-text("Use ₦")').count()) === 1,
  (await lossRow.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
await mustNot(page, 'and no naira zero stands in for a dish whose cost is not known', ZERO_NAIRA)
await mustNot(page, 'the dashboard still uses no database words',
  'allocation basis', 'snapshot', 'provenance', 'variant', 'NULL', 'is_complete')
await must(page, 'an ingredient a recipe uses but nobody priced is surfaced',
  'Prices to check', `Unpriced Pepper ${stamp}`, 'Price needed')
// The starter catalogue is ~180 items. None of them belongs in a task list
// until the business actually uses it.
await mustNot(page, 'and the starter catalogue does not fill the list with noise',
  'Semovita', 'Poundo yam flour', 'Rice (imported)')
await must(page, 'and quick actions are offered', 'Record a sale', 'Record a purchase')
{
  const lead = await homeLeads(page)
  mark('and they lead Home, above the week and the dishes', lead === 'ok', lead)
}
await page.screenshot({ path: 'e2e/shots/p5-dashboard-live.png', fullPage: true })

// ===========================================================================
// NEW DISH SUGGESTS WHAT GOES IN — names only, she types every amount
// ===========================================================================
{
  await go(page, '/recipes/new')
  const offer = page.locator('[data-suggest]')
  // Typed before the page has hydrated, the name may not reach the screen's state: type again.
  for (let i = 0; i < 10 && !(await offer.isVisible().catch(() => false)); i++) {
    await page.fill('input[name=name]', '')
    await page.fill('input[name=name]', 'efo riro')
    await page.waitForTimeout(400)
  }
  await must(page, 'typing a dish offers its usual ingredients', 'Usual ingredients for Efo Riro', 'Add these to the dish')
  await offer.locator('button:has-text("Add these to the dish")').click()
  await must(page, 'they become rows on the dish', 'Added the usual ingredients for Efo Riro')
  const chosen = await page.$$eval('[data-picker="line_ingredient_id"]', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  mark('the rows are her own items, by name', ['Tatashe', 'Palm oil', 'Locust bean', 'Efo tete'].every((n) => chosen.some((l) => l.includes(n))),
    JSON.stringify(chosen.slice(0, 6)))
  const amounts = await page.$$eval('input[name=line_qty]', (els) => els.map((e) => e.value))
  mark('and every amount is left for her to type', amounts.length > 4 && amounts.every((v) => v === ''), JSON.stringify(amounts))

  await page.fill('input[name=batch_yield_qty]', '20')
  await page.selectOption('select[name=yield_unit_id]', { label: 'Kilograms (kg)' })
  await page.locator('input[name=line_qty]').first().fill('2')
  await page.locator('select[name=line_unit_id]').first().selectOption({ label: 'grams' })
  await page.click('button:has-text("Save dish")')
  await must(page, 'a suggested row without a quantity is refused', 'enter the quantity that goes into one batch')
  const firstQty = await page.locator('input[name=line_qty]').first().inputValue()
  const batchKept = await page.inputValue('input[name=batch_yield_qty]')
  const nameKept = await page.inputValue('input[name=name]')
  mark('and nothing she typed is lost', firstQty === '2' && batchKept === '20' && nameKept === 'efo riro',
    `qty ${firstQty}, batch ${batchKept}, name ${nameKept}`)
  // React resets a form after each save attempt; a select would fall back to its first option.
  const shown = async (sel) => page.locator(sel).first().evaluate((s) => s.selectedOptions[0]?.textContent ?? '')
  const countedIn = await shown('select[name=yield_unit_id]')
  const unitKept = await shown('select[name=line_unit_id]')
  mark('nor what she chose: the batch unit and the ingredient unit', countedIn === 'Kilograms (kg)' && unitKept === 'grams',
    `counted in ${countedIn}, unit ${unitKept}`)

  // A dish that needs an item she does not have yet: add it in place.
  await page.fill('input[name=name]', 'abacha')
  await offer.waitFor({ state: 'visible', timeout: 10000 })
  await offer.locator('button:has-text("Add these to the dish")').click()
  await must(page, 'what she lacks is named, with a way to add it', 'Not on your list yet', 'Utazi leaf')
  await page.locator('[data-followup] li', { hasText: 'Utazi leaf' }).locator('button:has-text("Add it")').click()
  await page.locator('[data-picker="line_ingredient_id"][aria-label*="Utazi leaf"]').first()
    .waitFor({ state: 'attached', timeout: 20000 }).catch(() => {})
  const afterAdd = await page.$$eval('[data-picker="line_ingredient_id"]', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  mark('Add it puts Utazi leaf on her list and on the dish', afterAdd.some((l) => l.includes('Utazi leaf')), JSON.stringify(afterAdd.slice(-3)))
  await page.screenshot({ path: 'e2e/shots/p5-dish-suggest.png', fullPage: true })
}

// ===========================================================================
// WHAT SHE PAID, BESIDE AN INGREDIENT — and an item the search did not find
// ===========================================================================
{
  await go(page, '/recipes/new')
  const dishName = `Price test soup ${stamp}`
  for (let i = 0; i < 10; i++) {
    await page.fill('input[name=name]', dishName)
    await page.waitForTimeout(300)
    if ((await page.inputValue('input[name=name]')) === dishName) break
  }
  await page.fill('input[name=batch_yield_qty]', '5')
  const rowAt = (n) => page.locator('form ol > li').nth(n)
  await pickItem(rowAt(0), 'line_ingredient_id', 'Tatashe')
  await rowAt(0).locator('input[name=line_qty]').fill('200')
  await rowAt(0).locator('select[name=line_unit_id]').selectOption({ label: 'grams' })
  await must(page, 'an item with no price offers boxes for what she paid', 'What you paid for it (optional)')
  await rowAt(0).locator('input[aria-label^="You paid in naira"]').fill('2500')
  await rowAt(0).locator('input[aria-label^="Quantity bought for that price"]').fill('1')
  await rowAt(0).locator('select[aria-label^="Bought in"]').selectOption({ label: 'kg' })

  const leaf = `Ofe test leaf ${stamp}`
  await createItemInPicker(rowAt(1), 'line_ingredient_id', leaf, 'weight')
  const second = await rowAt(1).locator('[data-picker="line_ingredient_id"]').getAttribute('aria-label')
  mark('a search that finds nothing adds the item there and then', (second ?? '').includes(leaf), second ?? '')
  await rowAt(1).locator('input[name=line_qty]').fill('50')
  await rowAt(1).locator('select[name=line_unit_id]').selectOption({ label: 'grams' })

  await page.click('button:has-text("Save dish")')
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 60000 })
  await must(page, 'saving records what she paid, and the dish is costed from it at once',
    'what you paid for 1 item is recorded', 'Tatashe', '₦500', leaf)

  // The dish page: an ingredient added with what was paid for it.
  await openDetails(page, 'Add an ingredient')
  const add = page.locator('form:has([data-picker=ingredient_id])')
  await pickItem(add, 'ingredient_id', 'Onion')
  await add.locator('input[name=qty]').fill('100')
  await pick(add, 'select[name=unit_id]', 'g — Gram')
  await add.locator('input[name=paid]').fill('900')
  await add.locator('input[name=paid_qty]').fill('1')
  await add.locator('select[name=paid_unit_id]').selectOption({ label: 'kg' })
  await add.locator('button[type=submit]').click()
  await must(page, 'the dish page records what she paid with the ingredient', 'Ingredient added, and what you paid is recorded', '₦90')

  // An item with a price shows it, and offers a new one rather than retyping the old.
  await openDetails(page, 'Add an ingredient')
  await pickItem(page.locator('form:has([data-picker=ingredient_id])'), 'ingredient_id', 'Tatashe')
  await must(page, 'a priced item shows what was paid, with a way to give a new price', 'You paid', 'Paid a new price?')
  await page.screenshot({ path: 'e2e/shots/p5-dish-price.png', fullPage: true })

  // What she typed for one item never stays in the boxes for the next.
  const addForm = page.locator('form:has([data-picker=ingredient_id])')
  await pickItem(addForm, 'ingredient_id', leaf)
  await addForm.locator('input[name=paid]').fill('700')
  await addForm.locator('input[name=paid_qty]').fill('2')
  await pickItem(addForm, 'ingredient_id', 'Utazi leaf')
  const carried = [await addForm.locator('input[name=paid]').inputValue(), await addForm.locator('input[name=paid_qty]').inputValue()]
  mark('a price typed for one item is cleared when another is chosen', carried.join('') === '', JSON.stringify(carried))

  // Punctuation is not a name: nothing listed, nothing to add. A market name
  // of an item she has says so beside "+ Add".
  const sheet = page.locator('dialog[open]:has([role=listbox])').last()
  const trigger = addForm.locator('[data-picker=ingredient_id]').first()
  for (let i = 0; i < 25 && !(await sheet.isVisible().catch(() => false)); i++) { await trigger.click(); await page.waitForTimeout(300) }
  await sheet.locator('input[type=search]').fill('--')
  const junk = { options: await sheet.locator('[role=option]').count(), create: await sheet.locator('[data-create]').count(),
    says: (await sheet.innerText()).includes('Type the name in letters') }
  mark('a search of only punctuation lists nothing and offers nothing to add', junk.options === 0 && junk.create === 0 && junk.says, JSON.stringify(junk))
  await sheet.locator('input[type=search]').fill('maggi')
  const alias = await sheet.locator('[data-create]').innerText().catch(() => '')
  mark('"+ Add" for a market name says which item it already is', alias.includes('Seasoning cube'), alias)
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
}

// ===========================================================================
// MOBILE — the value moment on a phone
// ===========================================================================
for (const [w, h, tag] of [[360, 780, '360'], [390, 844, '390'], [820, 1180, 'tablet']]) {
  const ctxM = await browser.newContext({ viewport: { width: w, height: h } })
  ctxM.on('dialog', (d) => d.accept())
  const pageM = await ctxM.newPage()
  await logIn(pageM, A)
  await settled(pageM, '/dashboard', 'Record a sale')
  {
    const lead = await homeLeads(pageM)
    mark(`Record a sale and Record a purchase are in Home's first screen at ${tag}px`, lead === 'ok', lead)
  }
  // logIn already polls /dashboard, but the recipe page is a different route
  // and a second browser context racing the first has been seen to reach it
  // before its own cookie is live. Poll the page we are about to assert on,
  // rather than asserting on whatever rendered first.
  await settled(pageM, recipeUrl, 'Ofada Special')
  await must(pageM, `${tag}px shows the portion cost and the margin above the fold`,
    'Cost per portion', '₦563', '-13%')
  const overflow = await pageM.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  mark(`no horizontal overflow at ${tag}px`, overflow === 0, `${overflow}px`)

  // The bottom nav is position:fixed on phones. A fullPage screenshot renders
  // it mid-page, which LOOKS like it covers the ingredient rows. That is a
  // capture artifact -- but whether it covers real content at the true bottom
  // of the page is a real question, so measure it instead of trusting a class.
  // The bar is the fixed .mm-bottom-nav wrapper, and the "+" floats above it.
  // (This used to measure the first <nav> in the page: on a phone that is the
  // hidden sidebar, so the check passed without measuring anything.)
  const occluded = await pageM.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    const covers = [...document.querySelectorAll('.mm-bottom-nav, .mm-fab')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0)
    const hidden = []
    for (const el of document.querySelectorAll('main button, main input, main a, main select')) {
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      // Nothing to tap: a visually hidden input (sr-only, a picker's
      // "required" stand-in) is reached through its visible label or button,
      // and a folded section's form is not drawn at all -- though Chrome
      // still gives its fields the place they would have if it were open.
      const s = getComputedStyle(el)
      if (r.width <= 2 || r.height <= 2 || s.opacity === '0' || s.visibility === 'hidden') continue
      if (el.closest('details:not([open])') && !el.closest('summary')) continue
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      if (covers.some((c) => r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right)) {
        const what = el.textContent?.trim() ||
          `${el.tagName}${el.type ? `[type=${el.type}]` : ''}${el.name ? `[name=${el.name}]` : ''} ${Math.round(r.width)}x${Math.round(r.height)}`
        hidden.push(what)
      }
    }
    return hidden
  })
  mark(`the fixed nav covers no control at ${tag}px`, occluded.length === 0,
    occluded.length ? `covered: ${JSON.stringify(occluded.slice(0, 3))}` : 'scrolled to bottom')

  // Every navigation item must be REACHABLE without a horizontal gesture the
  // owner has no reason to expect. Ten items did not fit a 360px phone; the
  // bar scrolled and the last entries sat off-screen.
  const navCut = await pageM.evaluate(() => {
    // The primary nav on show at this width: the bottom bar on a phone, the
    // header from md. Not simply the first <nav>, which is the hidden sidebar.
    const nav = [...document.querySelectorAll('nav[aria-label="Primary"]')]
      .find((n) => n.getBoundingClientRect().height > 0)
    if (!nav) return ['no nav']
    const bar = nav.getBoundingClientRect()
    // The screen too: from md the header nav grows to fit its links, so
    // its own box alone could never show one running off the page.
    const right = Math.min(bar.right, document.documentElement.clientWidth)
    const left = Math.max(bar.left, 0)
    return [...nav.querySelectorAll('a')]
      .filter((a) => {
        const r = a.getBoundingClientRect()
        return r.right > right + 1 || r.left < left - 1
      })
      .map((a) => a.textContent?.trim() ?? '?')
  })
  mark(`every navigation item fits on screen at ${tag}px`, navCut.length === 0,
    navCut.length ? `off-screen: ${JSON.stringify(navCut)}` : 'all reachable')
  if (tag === '390') {
    await pageM.screenshot({ path: 'e2e/shots/rc-mobile-costed.png', fullPage: true })
    await go(pageM, recipeUrl + '?view=pro')
    await pageM.screenshot({ path: 'e2e/shots/rc-mobile-pro.png', fullPage: true })
    await go(pageM, '/ingredients')
    await must(pageM, 'mobile ingredient list renders', `Ofada Rice ${stamp}`)
    await go(pageM, '/dashboard')
    await must(pageM, 'the dashboard is usable on a phone', 'Needs you', 'Your dishes')
    await pageM.screenshot({ path: 'e2e/shots/p5-dashboard-mobile.png', fullPage: true })
  }
  await ctxM.close()
}

// ===========================================================================
// THE DISH'S OWN PHOTO -- added on the dish page, then shown wherever the dish is
// ===========================================================================
const SAMPLE = fileURLToPath(new URL('../../branding/06-imagery/samples/pexels-34772940.jpg', import.meta.url))
/** An <img> that has really loaded from the local storage gateway, not a broken one. */
const photoLoaded = (loc) => loc.evaluate(async (img) => {
  img.loading = 'eager'
  img.scrollIntoView({ block: 'center' })
  for (let i = 0; i < 40 && !(img.complete && img.naturalWidth > 0); i++) await new Promise((r) => setTimeout(r, 250))
  return { ok: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') ?? '' }
}).catch((e) => ({ ok: false, src: String(e) }))

await go(page, recipeUrl)
mark('a dish with no photo shows its tile, not a broken picture',
  (await page.locator('header img.mm-dish-photo').count()) === 0)
steps++
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('button:has-text("Add a photo")').first().click(),
])
await chooser.setFiles(SAMPLE)
await page.waitForURL(/notice=/, { timeout: 60000 }).catch(() => {})
await settledForm(page)
await rendered(page)
await must(page, 'a photo chosen on the dish page is shrunk, sent and saved', 'Photo saved.', 'Change photo', 'Remove photo')
const dishPhoto = await photoLoaded(page.locator('header img.mm-dish-photo').first())
mark('and the dish page shows it, from the dish bucket',
  dishPhoto.ok && /\/storage\/v1\/object\/public\/dish\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}\.(webp|jpg)$/.test(dishPhoto.src),
  dishPhoto.src)

await go(page, '/dashboard')
const homeCard = page.locator(`a[href="${new URL(recipeUrl).pathname}"]`, { has: page.locator('img.mm-dish-photo') }).first()
const homePhoto = await photoLoaded(homeCard.locator('img.mm-dish-photo').first())
mark('Home shows the photo on the dish, as a small thumbnail',
  homePhoto.ok && /-320\.(webp|jpg)$/.test(homePhoto.src), homePhoto.src)

await go(page, '/sales/new')
await page.waitForTimeout(600)
const sellPhoto = await photoLoaded(page.locator('li.mm-sell-card', { hasText: 'Ofada Special' }).locator('img.mm-dish-photo').first())
mark('and New sale shows it on the dish she taps', sellPhoto.ok && /-320\.(webp|jpg)$/.test(sellPhoto.src), sellPhoto.src)
await page.screenshot({ path: 'e2e/shots/p7-sale-photo.png', fullPage: true })

// ===========================================================================
// "USE ₦X" ON HOME -- the fix for a dish selling at a loss, in two taps
// ===========================================================================
await go(page, '/dashboard')
const fixRow = page.locator('section[aria-labelledby=home-needs] li', { hasText: 'Ofada Special' }).first()
const useBtn = fixRow.locator('button:has-text("Use ₦")').first()
const offered = (await useBtn.innerText().catch(() => '')).trim().replace(/^Use\s+/, '')
steps++
await useBtn.click()
const confirmSheet = page.locator('dialog[open]').first()
await confirmSheet.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
const sheetText = (await confirmSheet.innerText().catch(() => '')).replace(/\s+/g, ' ')
mark('"Use ₦X" asks first, in one sentence, before changing anything',
  /^₦[\d,]+$/.test(offered) && has(sheetText, `From now on, Ofada Special sells for ${offered}.`) && has(sheetText, 'Keep current price'),
  `${offered} / ${sheetText.slice(0, 160)}`)
await go(page, recipeUrl)
await must(page, 'nothing is saved until she confirms', 'You sell it for', '₦500', 'Loss')
await go(page, '/dashboard')
await page.locator('section[aria-labelledby=home-needs] li', { hasText: 'Ofada Special' }).first()
  .locator('button:has-text("Use ₦")').first().click()
await page.locator('dialog[open] button:has-text("Confirm")').first().click()
await page.waitForURL(/notice=/, { timeout: 30000 }).catch(() => {})
await settledForm(page)
await rendered(page)
await must(page, 'confirming sets the price and says so', 'Selling price saved.')
const stillLosing = await page.locator('section[aria-labelledby=home-needs] li', { hasText: 'Ofada Special' }).count()
mark('and the dish no longer needs her', stillLosing === 0, `${stillLosing} row(s) left`)
await go(page, recipeUrl)
await must(page, 'the dish now sells at the offered price and keeps her target',
  'You sell it for', offered, 'Healthy')
await mustNot(page, 'and the loss is gone', '-13%', 'less than it costs you to make')

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
const slow = waits.filter((w) => w >= 250).sort((a, b) => b - a)
console.log(`checks that had to wait for the page to update: ${slow.length}; longest ${slow[0] ?? 0} ms`)
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
