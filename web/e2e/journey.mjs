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
/**
 * innerText returns text AFTER CSS text-transform, so a heading styled
 * `uppercase` reads back as "COST PER PORTION" and a literal match fails on
 * copy that is in fact present. Case is presentational here; the words are the
 * assertion. Everything else stays exact -- amounts and percentages are
 * compared character for character.
 */
const has = (body, needle) => body.toLowerCase().includes(needle.toLowerCase())
async function must(page, name, ...needles) {
  const body = await text(page)
  const missing = needles.filter((n) => !has(body, n))
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '')
  return missing.length === 0
}
async function mustNot(page, name, ...needles) {
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
  await page.waitForLoadState('networkidle').catch(() => {})
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
  await settled(page, '/onboarding', 'Set up your business')
}
/** Navigate until the page proves the session is live, or fail loudly. */
async function settled(page, path, needle, tries = 15) {
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
  await settled(page, '/dashboard', 'Menu Master NG')
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
mark('signup completes and lands inside the app', (await text(page)).includes('Set up your business'), page.url())

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
await page.screenshot({ path: 'e2e/shots/rc-ingredient-unknown-unit.png', fullPage: true })
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
await must(page, 'the recipe is created and opens', 'Ofada Special', 'Ingredients')
const recipeUrl = page.url().split('?')[0]
const tFirstRecipe = Date.now() - t0
const stepsFirstRecipe = steps

// --- 1. a complete, costed recipe -------------------------------------------
await page.locator('summary:has-text("Add an ingredient")').first().click()
const addLine = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine, 'select[name=ingredient_id]', `Ofada Rice ${stamp}`)
await addLine.locator('input[name=qty]').fill('2000')
await pick(addLine, 'select[name=unit_id]', 'g — Gram')
steps++
await addLine.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await must(page, 'THE FIRST VALUE MOMENT: cost per portion, above the fold',
  'Cost per portion', '₦281.25')
await page.screenshot({ path: 'e2e/shots/rc-desktop-costed.png', fullPage: true })
const tFirstCost = Date.now() - t0
const stepsFirstCost = steps

// --- 5/6. selling price and margin ------------------------------------------
const priceForm = page.locator('form').last()
await priceForm.locator('input[name=price]').fill('500')
steps++
await priceForm.locator('button[type=submit]').click()
await page.waitForTimeout(900)
await must(page, 'profit, margin and a plain-language verdict appear',
  '₦218.75', '43.75%', 'Healthy')
const tFirstMargin = Date.now() - t0
const stepsFirstMargin = steps

// --- 2. a missing price blocks, and NAMES the item ---------------------------
await go(page, '/ingredients')
await page.fill('input[name=name]', `Palm Oil ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'ml — Millilitre')
await submit(page, 'form button[type=submit]')
await go(page, recipeUrl)
await page.locator('summary:has-text("Add an ingredient")').first().click()
const addLine2 = page.locator('form:has(select[name=ingredient_id])')
await pick(addLine2, 'select[name=ingredient_id]', `Palm Oil ${stamp}`)
await addLine2.locator('input[name=qty]').fill('100')
await pick(addLine2, 'select[name=unit_id]', 'ml — Millilitre')
steps++
await addLine2.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
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
await mustNot(page, 'no recipe cost, profit or margin is shown while incomplete',
  '₦281.25', '₦218.75', '43.75%', 'Cost per portion', 'Profit per portion')
await must(page, 'the priced line still shows its own true cost while incomplete',
  '₦2,250.00', '₦1.13 per g')
await mustNot(page, 'and no ₦0.00 stands in for the unknown cost', '₦0.00')

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
  '-12.50%', 'Loss', 'less than it costs you to make')
await page.screenshot({ path: 'e2e/shots/rc-desktop-below-cost.png', fullPage: true })
await mustNot(page, 'the stale margin is gone', '43.75%')

// --- full costing view -------------------------------------------------------
await go(page, recipeUrl + '?view=pro')
await must(page, 'the full costing view shows the batch breakdown',
  'Full costing', 'Batch cost', 'Where the batch cost goes', 'Portions per batch')
// Owner rule: a customer must be able to reproduce a purchase-derived cost
// from their own records, and an estimate must never look like a purchase.
await must(page, 'the page states where the unit cost came from',
  'You bought 8000 g for ₦9,000.00')
// Phase 3: the worksheet's profitability panel, every figure from PostgreSQL.
// Margin and markup are different numbers for the same dish and must both
// appear, correctly labelled, so neither can be mistaken for the other.
await must(page, 'the worksheet shows margin AND markup, distinctly labelled',
  'Profitability, per portion', 'Margin (share of the price)',
  'Markup (added to your cost)', 'Price to hit that target')
await mustNot(page, 'a real purchase is never labelled an estimate',
  'Estimated price')
await page.screenshot({ path: 'e2e/shots/rc-desktop-pro.png', fullPage: true })

// --- PHASE 4: business-defined formats, packaging, labour, overhead ---------
// Nothing here is a Menu Master constant: the business names its own format
// and states its own size, and the engine blocks rather than guesses.
await go(page, '/settings')
await page.fill('input[name=name]', 'Cooking')
await page.locator('form:has(input[name=rate_per_hour]) input[name=rate_per_hour]').fill('500')
await page.locator('form:has(input[name=rate_per_hour]) button[type=submit]').click()
await page.waitForTimeout(900)
await must(page, 'a business can define what it pays per hour', 'Cooking', '₦500.00 an hour')

await go(page, '/formats')
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
await must(page, 'the format explains that packaging is counted once per serving',
  'Packaging', 'once per serving')
await page.screenshot({ path: 'e2e/shots/p4-format-detail.png', fullPage: true })

await go(page, '/settings')
await must(page, 'overhead is spread over what the business produces, not a fixed assumption',
  'How much do you produce in a month?')

// A non-accountant must be able to split bills across two kinds of output
// without meeting the words "dimension", "basis" or "allocation".
await must(page, 'running costs are explained in plain business language',
  'Spread across how much?', 'rent for the soup pots over 600')
await mustNot(page, 'no dimensional-analysis jargon reaches the owner',
  'dimension', 'allocation basis', 'basis unit')

const ohForm = page.locator('form:has(input[name=basis_qty])')
await ohForm.locator('input[name=name]').fill('Soup pot rent')
await ohForm.locator('input[name=monthly_cost]').fill('300000')
await ohForm.locator('input[name=basis_qty]').fill('600')
await pick(ohForm, 'select[name=basis_unit_id]', 'l — Litre')
steps++
await ohForm.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await must(page, 'a running cost states what it is spread across, in the owner\'s words',
  'Soup pot rent', 'spread across 600 l you make')

const ohForm2 = page.locator('form:has(input[name=basis_qty])')
await ohForm2.locator('input[name=name]').fill('Bakery rent')
await ohForm2.locator('input[name=monthly_cost]').fill('200000')
await ohForm2.locator('input[name=basis_qty]').fill('400')
await pick(ohForm2, 'select[name=basis_unit_id]', 'kg — Kilogram')
steps++
await ohForm2.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await must(page, 'a second cost can be spread across a different kind of output',
  'Bakery rent', 'spread across 400 kg you make')
await page.screenshot({ path: 'e2e/shots/p4-overhead-split.png', fullPage: true })
await mustNot(page, 'the superseded servings-per-month field is gone',
  'Servings you sell in a typical month')
await page.screenshot({ path: 'e2e/shots/p4-settings.png', fullPage: true })

await go(page, recipeUrl + '?view=pro')
await must(page, 'the recipe worksheet offers labour from the business rates', 'Work', 'Add work')

// MODEL 1 vs MODEL 2, on SEPARATE recipes so each is exercised in its own
// right. Attaching a format to the main recipe would switch it to the
// format-based model and its per-portion assertions would stop applying --
// correctly, but it would no longer test the portion model.
await go(page, recipeUrl)
await must(page, 'a recipe with no format is sold by the portion',
  'How you sell this', 'Sold by the portion')

await go(page, '/recipes')
await page.fill('input[name=name]', `Format Soup ${stamp}`)
await page.fill('input[name=batch_yield_qty]', '10000')
await pick(page, 'select[name=yield_unit_id]', 'ml — Millilitre')
await submit(page, 'form button[type=submit]')
const fmtRecipeUrl = page.url().split('?')[0]

await page.locator('summary:has-text("Add an ingredient")').first().click()
const fLine = page.locator('form:has(select[name=ingredient_id])')
await pick(fLine, 'select[name=ingredient_id]', `Ofada Rice ${stamp}`)
await fLine.locator('input[name=qty]').fill('10000')
await pick(fLine, 'select[name=unit_id]', 'g — Gram')
steps++
await fLine.locator('button[type=submit]').click()
await page.waitForTimeout(1200)

// With no format yet this recipe is still MODEL 1, so the engine correctly
// asks for a portion size. That is the point of the two models: the demand
// appears only while the portion is the commercial unit.
await must(page, 'MODEL 1 still applies until a format exists', 'Cost incomplete')

await page.locator('summary:has-text("Sell this in a size")').first().click()
const vForm = page.locator('form:has(select[name=format_id])')
await pick(vForm, 'select[name=format_id]', `Family Bowl ${stamp}`)
steps++
await vForm.locator('button[type=submit]').click()
await page.waitForTimeout(1500)
await must(page, 'attaching a format switches the recipe to selling by size',
  `Family Bowl ${stamp}`, 'You sell this in your own sizes')
await must(page, 'each size shows what it costs, from the same batch',
  'What each size costs you', 'Price to hit your target')
// MODEL 2 now applies: the format is the commercial unit and no portion size
// was ever supplied, yet nothing is blocked and nothing was invented.
await mustNot(page, 'MODEL 2: no synthetic portion size is demanded',
  'Cost incomplete', 'set how much one portion is')
await page.screenshot({ path: 'e2e/shots/p4-recipe-formats.png', fullPage: true })

// price the size and read back profit, margin and markup for THAT size
const fpForm = page.locator('form:has(input[name=variant_id])').first()
await fpForm.locator('input[name=price]').fill('7500')
steps++
await fpForm.locator('button[type=submit]').click()
await page.waitForTimeout(1500)
await must(page, 'a size can be priced and reports its own profit and margin',
  '₦7,500.00', 'You keep')
await go(page, fmtRecipeUrl)

// --- PHASE 2: the purchase ledger, end to end -------------------------------
// The single-line form on the ingredient page now goes through fn_post_purchase,
// so a real purchase must appear in the ledger and be reversible.
await go(page, '/purchases')
await must(page, 'the purchase the ingredient page recorded appears in the ledger',
  'Purchase history', 'Recorded')

// A full multi-line purchase, entered the way a market run actually happens.
await go(page, '/suppliers')
await page.fill('input[name=name]', `Mile 12 ${stamp}`)
await submit(page, 'form button[type=submit]')
await must(page, 'a market can be added as a supplier', `Mile 12 ${stamp}`)

await go(page, '/purchases')
await pick(page, 'select[name=supplier_id]', `Mile 12 ${stamp}`)
await submit(page, 'form button[type=submit]')
await must(page, 'starting a purchase opens it for items', 'Add an item', 'Not recorded')
const purchaseUrl = page.url().split('?')[0]

const lineForm = page.locator('form:has(select[name=ingredient_id])')
await pick(lineForm, 'select[name=ingredient_id]', `Ofada Rice ${stamp}`)
await lineForm.locator('input[name=qty]').fill('25')
await pick(lineForm, 'select[name=unit_id]', 'kg — Kilogram')
await lineForm.locator('input[name=amount]').fill('42000')
steps++
await lineForm.locator('button[type=submit]').click()
await page.waitForTimeout(1000)
await must(page, 'the item is added with what was actually paid', '₦42,000.00', '25 kg')

await page.locator('form:has-text("Record this purchase") button[type=submit]').first().click()
await page.waitForTimeout(1200)
await must(page, 'recording the purchase reports the prices it updated',
  'Recorded', 'ingredient price')
await mustNot(page, 'a recorded purchase is never left as a draft', 'Not recorded yet')

// Reversal: the cost is undone, the record is kept.
const revForm = page.locator('form:has(input[name=reason])')
await revForm.locator('input[name=reason]').fill('wrong amount')
steps++
await revForm.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await must(page, 'a purchase can be cancelled with a reason, and says so',
  'Cancelled', 'wrong amount')
await go(page, purchaseUrl)
await must(page, 'the cancelled purchase is kept as evidence, not deleted', '₦42,000.00')

// --- 3. the RECIPE-level missing-conversion blocker --------------------------
// Distinct from the ingredient page refusing an unknown purchase unit: here the
// ingredient IS priced, but the recipe asks for it in a unit that has no
// conversion for this item, so the engine cannot resolve the quantity. The
// recipe must name that, and must not fall back to a guess.
await go(page, '/ingredients')
await page.fill('input[name=name]', `Garri ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await submit(page, 'form button[type=submit]')
await page.locator(`a:has-text("Garri ${stamp}")`).first().click()
await page.waitForLoadState('domcontentloaded')
const garriBuy = page.locator('form:has(input[name=amount])')
await garriBuy.locator('input[name=qty]').fill('1000')
await pick(garriBuy, 'select[name=unit_id]', 'g — Gram')
await garriBuy.locator('input[name=amount]').fill('2000')
steps++
await garriBuy.locator('button[type=submit]').click()
await page.waitForTimeout(900)

await go(page, '/recipes')
await page.fill('input[name=name]', 'Garri Test')
await page.fill('input[name=batch_yield_qty]', '1000')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '250')
await submit(page, 'form button[type=submit]')
const convRecipeUrl = page.url().split('?')[0]
await page.locator('summary:has-text("Add an ingredient")').first().click()
const addConv = page.locator('form:has(select[name=ingredient_id])')
await pick(addConv, 'select[name=ingredient_id]', `Garri ${stamp}`)
await addConv.locator('input[name=qty]').fill('2')
await pick(addConv, 'select[name=unit_id]', 'paint')
steps++
await addConv.locator('button[type=submit]').click()
await page.waitForTimeout(1200)
await must(page, 'a recipe line in an unconvertible unit blocks and says what is needed',
  'Cost incomplete', `Garri ${stamp}`, 'paint')
await mustNot(page, 'no cost is guessed for the unconvertible line', '₦0.00', 'NaN')
await page.screenshot({ path: 'e2e/shots/rc-desktop-missing-conversion.png', fullPage: true })

await go(page, recipeUrl)

// --- 5. persistence after refresh -------------------------------------------
steps++
await page.reload({ waitUntil: 'domcontentloaded' })
await must(page, 'the recomputed cost survives a refresh', '₦4,500.00', '₦562.50')

// --- 7. direct URL ----------------------------------------------------------
await go(page, recipeUrl)
await must(page, 'the recipe opens from a direct URL', 'Ofada Special', '₦4,500.00')

// --- 8. validation ----------------------------------------------------------
await page.locator('summary:has-text("Add an ingredient")').first().click()
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
for (const [w, h, tag] of [[360, 780, '360'], [390, 844, '390'], [820, 1180, 'tablet']]) {
  const ctxM = await browser.newContext({ viewport: { width: w, height: h } })
  const pageM = await ctxM.newPage()
  await logIn(pageM, A)
  await go(pageM, recipeUrl)
  await must(pageM, `${tag}px shows the portion cost and the margin above the fold`,
    'Cost per portion', '₦562.50', '-12.50%')
  const overflow = await pageM.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  mark(`no horizontal overflow at ${tag}px`, overflow === 0, `${overflow}px`)

  // The bottom nav is position:fixed on phones. A fullPage screenshot renders
  // it mid-page, which LOOKS like it covers the ingredient rows. That is a
  // capture artifact -- but whether it covers real content at the true bottom
  // of the page is a real question, so measure it instead of trusting a class.
  const occluded = await pageM.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    const nav = document.querySelector('nav')
    if (!nav || getComputedStyle(nav).position !== 'fixed') return []
    const bar = nav.getBoundingClientRect()
    const hidden = []
    for (const el of document.querySelectorAll('main button, main input, main a, main select')) {
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      if (r.bottom > bar.top && r.top < bar.bottom) hidden.push(el.textContent?.trim() || el.tagName)
    }
    return hidden
  })
  mark(`the fixed nav covers no control at ${tag}px`, occluded.length === 0,
    occluded.length ? `covered: ${JSON.stringify(occluded.slice(0, 3))}` : 'scrolled to bottom')
  if (tag === '390') {
    await pageM.screenshot({ path: 'e2e/shots/rc-mobile-costed.png', fullPage: true })
    await go(pageM, recipeUrl + '?view=pro')
    await pageM.screenshot({ path: 'e2e/shots/rc-mobile-pro.png', fullPage: true })
    await go(pageM, '/ingredients')
    await must(pageM, 'mobile ingredient list renders', `Ofada Rice ${stamp}`)
  }
  await ctxM.close()
}

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
