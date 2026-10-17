/**
 * FIXING A MISTAKE WITHOUT STARTING OVER, in a real browser.
 *
 * Phase 1 of docs/PLAN_NATURAL_UX.md. Every edit path the app gained is
 * driven through its own screen against the local stack (0001-0060):
 * a dish renamed and re-portioned, a recipe line's unit changed, an
 * ingredient's yield and measure edited, a wage edited (and every dish
 * re-costed), the target margin changed, a recorded purchase corrected in
 * one step, a supplier and a size edited and hidden, a customer and a dish
 * put away and brought back.
 *
 * Runs with: scripts/dev_local.ps1 -Database <db-with-0060> -Run web/e2e/journey-edit.mjs
 */
import { chromium } from 'playwright'
import { onboardBusiness, finishSetup, newDish, openDetails } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const owner = { email: `fix-${stamp}@test.ng`, pass: 'correct-horse-battery' }

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const text = (p) => p.locator('body').innerText()
const has = (body, n) => body.toLowerCase().includes(n.toLowerCase())
const rendered = (p) => p.locator('[aria-label="Loading"]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
async function readUntil(p, needles, ms = 8000) {
  const start = Date.now()
  let body = await text(p)
  let missing = needles.filter((n) => !has(body, n))
  while (missing.length && Date.now() - start < ms) {
    await p.waitForTimeout(250)
    body = await text(p)
    missing = needles.filter((n) => !has(body, n))
  }
  return { body, missing }
}
async function must(p, name, ...needles) {
  await rendered(p)
  const { body, missing } = await readUntil(p, needles)
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '')
  if (missing.length) console.log('      page said: ' + body.replace(/\s+/g, ' ').slice(0, 500))
}
async function mustNot(p, name, ...needles) {
  await rendered(p)
  const body = await text(p)
  const present = needles.filter((n) => has(body, n))
  mark(name, present.length === 0, present.length ? `present ${JSON.stringify(present)}` : '')
}
async function go(p, path) {
  await p.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await p.waitForLoadState('networkidle').catch(() => {})
  await rendered(p)
}
const settledForm = (p) => p.locator('button[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
async function submit(p, locator) {
  await Promise.all([p.waitForLoadState('domcontentloaded'), locator.click()])
  await p.waitForLoadState('networkidle').catch(() => {})
  await settledForm(p); await rendered(p); await p.waitForTimeout(400)
}
/** A folded section, opened, as a scope for the fields inside it. */
async function section(p, title) {
  await openDetails(p, title)
  return p.locator(`details:has(> summary:has-text("${title}"))`).first()
}
async function signUp(p, who) {
  await go(p, '/signup')
  await p.fill('input[type=email]', who.email)
  await p.fill('input[type=password]', who.pass)
  await submit(p, p.locator('button[type=submit]'))
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
ctx.on('dialog', (d) => d.accept())
const page = await ctx.newPage()

// ---- a fresh owner, through setup -------------------------------------------
await signUp(page, owner)
await onboardBusiness(page, BASE, { business: 'Fix-it Kitchen' })
await finishSetup(page, BASE, { dish: 'Setup pepper soup', price: '500' })

// ---- 1. the dish itself -----------------------------------------------------
await go(page, '/recipes')
await page.locator('a[href^="/recipes/"]:has-text("Setup pepper soup")').first().click()
await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 30000 })
await rendered(page)
const dishUrl = new URL(page.url()).pathname

let s = await section(page, 'Edit this dish')
await s.locator('input[name=name]').fill('Setup pepper soup deluxe')
await s.locator('input[name=category]').fill('Soups')
await submit(page, s.locator('button:has-text("Save changes")'))
await must(page, 'a dish can be renamed in place', 'Dish updated.', 'Setup pepper soup deluxe')
s = await section(page, 'Edit this dish')
mark('and the edit form reopens with the saved group',
  (await s.locator('input[name=category]').inputValue()) === 'Soups')

// the unit of a line, not only its quantity. A row opens its sheet, which
// holds the quantity and unit together (recipes/[id]/lines.tsx).
await page.locator('li', { hasText: 'Salt' }).locator('button[aria-haspopup=dialog]').first().click()
const saltLine = page.locator('dialog[open]').first()
await saltLine.waitFor({ state: 'visible', timeout: 10000 })
await saltLine.locator('input[name=qty]').fill('0.2')
await saltLine.locator('select[name=unit_id]').selectOption({ label: 'kg — Kilogram' })
await submit(page, saltLine.locator('button:has-text("Save")'))
await must(page, 'a recipe line changes unit and quantity together', 'Ingredient updated.', '0.2 kg')

// ---- 2. the ingredient ------------------------------------------------------
await go(page, '/ingredients')
await page.locator('a[href^="/ingredients/"]:has-text("Salt")').first().click()
await page.waitForURL(/\/ingredients\/[0-9a-f-]{36}/, { timeout: 30000 })
await rendered(page)
s = await section(page, 'Edit this item')
await s.locator('input[name=purchase_yield_pct]').fill('90')
await submit(page, s.locator('button:has-text("Save changes")'))
await must(page, 'an ingredient edits in place', 'Item updated.')
s = await section(page, 'Edit this item')
mark('and the yield is saved', (await s.locator('input[name=purchase_yield_pct]').inputValue()) === '90')
await must(page, 'its measure is locked once purchases are recorded in it', 'cannot change now')

// a local measure, then corrected
await openDetails(page, 'Add a local measure')
await page.locator('form:has(input[name=qty_in_base]) select[name=unit_id]').first().selectOption({ label: 'paint — Paint (rubber)' }).catch(async () => {
  await page.locator('form:has(input[name=qty_in_base]) select[name=unit_id]').first().selectOption({ index: 1 })
})
await page.locator('form:has(input[name=qty_in_base]) input[name=qty_in_base]').first().fill('400')
await submit(page, page.locator('button:has-text("Save conversion")'))
await must(page, 'a local measure is saved', 'Conversion saved.')
const measure = page.locator('li:has(input[name=conversion_id])').first()
await measure.locator('summary:has-text("Edit")').click()
await measure.locator('input[name=qty_in_base]').fill('4000')
await submit(page, measure.locator('button:has-text("Update")'))
await must(page, 'a wrong measure is corrected in place', 'Measure updated', '4000')

// ---- 3. settings: a wage, the target margin, the business name ----------------
await go(page, '/settings')
await openDetails(page, 'Add a kind of work')
const addWork = page.locator('details:has(> summary:has-text("Add a kind of work"))').first()
await addWork.locator('input[name=name]').fill('Cooking')
await addWork.locator('input[name=rate_per_hour]').fill('1500')
await submit(page, addWork.locator('button:has-text("Add")'))
await must(page, 'a kind of work is added', 'Kind of work added.', 'Cooking')
const workRow = page.locator('li:has-text("Cooking")').first()
await workRow.locator('summary:has-text("Edit")').click()
await workRow.locator('input[name=rate_per_hour]').fill('2000')
await submit(page, workRow.locator('button:has-text("Save")'))
await must(page, 'a wage is edited and every dish re-costed', 'Kind of work updated.', 're-costed', '₦2,000')
await submit(page, page.locator('li:has-text("Cooking") button:has-text("Hide")').first())
await must(page, 'a kind of work can be hidden', 'Hidden', 'hidden')
await submit(page, page.locator('li:has-text("Cooking") button:has-text("Show again")').first())
await must(page, 'and shown again', 'Shown again.')

await page.locator('input[name=default_target_margin]').fill('45')
await submit(page, page.locator('button:has-text("Save pricing")'))
await must(page, 'the target margin is now editable', 'Pricing saved.')
await go(page, dishUrl + '?view=pro')
await must(page, 'and the dish reads the new target', 'Your target margin', '45%')

await go(page, '/settings')
await page.locator('form:has(select[name=type]) input[name=name]').fill('Fix-it Kitchen Ltd')
await submit(page, page.locator('form:has(select[name=type]) button:has-text("Save")'))
await must(page, 'the business name is edited from Settings and shows in the header', 'Business details saved.', 'Fix-it Kitchen Ltd')

// ---- 4. correcting a recorded purchase ----------------------------------------
await go(page, '/purchases')
await mustNot(page, 'no "0 items" cancellation records are listed', '0 items')
// A recorded purchase no longer says "Recorded" on the list (only the
// exceptions carry a word); open the first row that is not cancelled.
await page.locator('a.mm-buy-row').filter({ hasNotText: /Cancelled|Reversal|Not recorded yet/ }).first().click()
await page.waitForURL(/\/purchases\/[0-9a-f-]{36}$/, { timeout: 30000 })
await rendered(page)
const originalUrl = new URL(page.url()).pathname
await must(page, 'a recorded purchase offers a one-step correction', 'Correct this purchase')
await page.locator('a:has-text("Correct this purchase")').first().click()
await page.waitForURL(/\/correct$/, { timeout: 30000 })
await rendered(page)
await must(page, 'the correction opens pre-filled', 'was 1 kg for ₦600')
await page.locator('input[name=amount]').first().fill('700')
await submit(page, page.locator('button:has-text("Save the corrected purchase")'))
await page.waitForURL(/\/purchases\/[0-9a-f-]{36}(\?.*)?$/, { timeout: 30000 }).catch(() => {})
await must(page, 'the corrected purchase is recorded with the new amount', 'Corrected.', '₦700', 'Recorded')
mark('and it is a new record, not the old one edited', new URL(page.url()).pathname !== originalUrl)
await go(page, originalUrl)
await must(page, 'the original is cancelled and linked to its correction', 'This purchase was corrected', 'See the corrected purchase', 'Cancelled')
await go(page, '/purchases')
await mustNot(page, 'the bookkeeping twin of the cancellation stays out of the list', '0 items')
await go(page, dishUrl)
// The line's sheet says where its cost came from, per buying unit.
await page.locator('li', { hasText: 'Salt' }).locator('button[aria-haspopup=dialog]').first().click()
await page.locator('dialog[open]').first().waitFor({ state: 'visible', timeout: 10000 })
// Salt is 90% usable (set above), so the line costs ₦778 a usable kg; the sheet
// names the purchase it came from: the corrected ₦700, not the cancelled ₦600.
await must(page, 'the dish now costs from the corrected price', '1 kg for ₦700')
await mustNot(page, 'and not from the cancelled one', '1 kg for ₦600')
await page.keyboard.press('Escape')

// ---- 5. suppliers -----------------------------------------------------------
await go(page, '/suppliers')
await openDetails(page, 'Add a supplier or market')
await page.locator('form:has(input[name=location]) input[name=name]').first().fill('Mile 12')
await submit(page, page.locator('form:has(input[name=location]) button:has-text("Add")').first())
await must(page, 'a supplier is added', 'Supplier added.', 'Mile 12')
const supplierRow = page.locator('li:has-text("Mile 12")').first()
await supplierRow.locator('summary:has-text("Edit")').click()
await supplierRow.locator('input[name=phone]').fill('08031234567')
await submit(page, supplierRow.locator('button:has-text("Save")'))
await must(page, 'a supplier is edited', 'Supplier updated.', '08031234567')
await submit(page, page.locator('li:has-text("Mile 12") button:has-text("Hide")').first())
await must(page, 'a supplier is hidden', 'hidden')
await submit(page, page.locator('li:has-text("Mile 12") button:has-text("Show again")').first())
await must(page, 'and shown again', 'Supplier shown again.')

// ---- 6. sizes -----------------------------------------------------------------
await go(page, '/formats')
await openDetails(page, 'Add a size')
await page.fill('input[name=name]', 'Bowl')
await page.fill('input[name=capacity_qty]', '1')
await page.selectOption('select[name=capacity_unit_id]', { label: 'l — Litre' }).catch(() => page.selectOption('select[name=capacity_unit_id]', { index: 1 }))
await submit(page, page.locator('button:has-text("Add size")'))
await must(page, 'a size is added', 'Size added.', 'Bowl')
await page.locator('a[href^="/formats/"]:has-text("Bowl")').first().click()
await page.waitForURL(/\/formats\/[0-9a-f-]{36}/, { timeout: 30000 })
await rendered(page)
s = await section(page, 'Edit this size')
await s.locator('input[name=name]').fill('Big bowl')
await submit(page, s.locator('button:has-text("Save changes")'))
await must(page, 'a size is renamed', 'Size updated.', 'Big bowl')
await openDetails(page, 'Edit this size')
await submit(page, page.locator('button:has-text("Hide this size")'))
await must(page, 'a size is hidden, never deleted', 'Size hidden', 'hidden')
await openDetails(page, 'Edit this size')
await submit(page, page.locator('button:has-text("Show this size again")'))
await must(page, 'and shown again', 'Size shown again.')

// ---- 7. customers: put away and brought back ------------------------------------
await go(page, '/customers')
await openDetails(page, 'Add a customer')
await page.locator('form:has(input[name=company]) input[name=name]').first().fill('Mrs Ade')
await submit(page, page.locator('button:has-text("Add customer")'))
await must(page, 'a customer is added', 'Mrs Ade added.')
await page.locator('a[href^="/customers/"]:has-text("Mrs Ade")').first().click()
await page.waitForURL(/\/customers\/[0-9a-f-]{36}/, { timeout: 30000 })
await rendered(page)
await openDetails(page, 'Put this customer away')
await submit(page, page.locator('button:has-text("Put this customer away")'))
await must(page, 'a customer is put away, not deleted', 'Customer put away', '1 customer put away')
mark('and leaves the list', (await page.locator('a[href^="/customers/"]:has-text("Mrs Ade")').count()) === 0)
await page.locator('a:has-text("put away →")').first().click()
await rendered(page)
await submit(page, page.locator('li:has-text("Mrs Ade") button:has-text("Bring back")').first())
await must(page, 'and is brought back', 'Customer is back.', 'Mrs Ade')

// ---- 8. a dish put away and brought back --------------------------------------
await newDish(page, BASE, { name: 'Test soup', batch: 1000, unit: 'g — Gram', portion: 100 })
await openDetails(page, 'Put this dish away')
await submit(page, page.locator('button:has-text("Put this dish away")'))
await must(page, 'a dish is put away and leaves the list', 'has been put away', '1 dish put away')
await mustNot(page, 'it is no longer among the dishes', 'Test soup\n')
await page.locator('a:has-text("put away →")').first().click()
await rendered(page)
await submit(page, page.locator('li:has-text("Test soup") button:has-text("Bring back")').first())
await must(page, 'and is brought back', 'Test soup is back.', 'Test soup')
s = await section(page, 'Edit this dish')
mark('exactly as it was', (await s.locator('input[name=batch_yield_qty]').inputValue()) === '1000'
  && (await s.locator('input[name=portion_qty]').inputValue()) === '100')

// ---- 9. made from another dish, and scaled -----------------------------------
await openDetails(page, 'Add a dish you make')
const subForm = page.locator('form:has(select[name=sub_recipe_id])')
// The only other dish on this account is the setup dish.
await subForm.locator('select[name=sub_recipe_id]').selectOption({ index: 0 })
await subForm.locator('input[name=qty]').fill('2')
await subForm.locator('select[name=unit_id]').selectOption({ label: 'portion — Portion' }).catch(() =>
  subForm.locator('select[name=unit_id]').selectOption({ index: 0 }))
await submit(page, subForm.locator('button:has-text("Add dish")'))
await must(page, 'a dish can be made from another dish', 'Dish added as an ingredient.', 'Made from another dish')

s = await section(page, 'Edit this dish')
await s.locator('input[name=new_batch]').fill('2000')
await submit(page, s.locator('button:has-text("Scale everything")'))
await must(page, 'a batch scales in one step', 'Scaled ×2')
s = await section(page, 'Edit this dish')
mark('and the batch size follows', (await s.locator('input[name=batch_yield_qty]').inputValue()) === '2000')

// ---- 10. an extra with a cost, a quote, then the sale -----------------------
await go(page, '/sales/new')
await page.locator('button[aria-label^="Add Setup pepper soup"]').first().click()
await page.locator('button:has-text("Something not on the menu")').click()
const other = page.locator('dialog[open]').first()
await other.locator('input').nth(0).fill('Delivery')
await other.locator('input').nth(2).fill('1000')
await other.locator('input').nth(3).fill('400')
await other.locator('button:has-text("Add to sale")').click()
await page.locator('button:has-text("Next")').click()
await must(page, 'an extra sits on the sale with its price', 'Delivery', '₦1,000')
await submit(page, page.locator('button:has-text("Save for later")'))
await page.waitForURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 30000 })
await must(page, 'a saved draft offers itself as a quote', 'Send as a quote', 'prices hold for 7 days')
await openDetails(page, 'See the quote')
await must(page, 'the quote carries the items and the total', 'Quote ·', '1 × Delivery', 'Prices hold for 7 days')
await submit(page, page.locator('button:has-text("Confirm sale")'))
await must(page, 'after confirming, the extra has a known cost', 'Confirmed', 'Cost known', 'cost ₦400')
// The receipt card also lists "Delivery × 1"; the line with its cost status is
// the one that names the cost.
const deliveryRow = page.locator('li', { hasText: 'Delivery' }).filter({ hasText: 'Cost known' }).first()
mark('the delivery line reads "Cost known", not "Not a dish"',
  /Cost known/.test(await deliveryRow.innerText()) && !/Not a dish/.test(await page.locator('main').innerText()),
  (await deliveryRow.innerText()).replace(/\s+/g, ' ').slice(0, 120))

// ---- 11. price per head ------------------------------------------------------
await go(page, '/quote')
await must(page, 'the per-head calculator lists the dishes', 'Price per head', 'How many guests?', 'Setup pepper soup deluxe')
await page.fill('input[aria-label="How many guests?"], input[inputmode=numeric]', '50')
await page.locator('input[aria-label="Setup pepper soup deluxe per guest"]').fill('1')
await must(page, 'and works out cost and price per guest and for the event',
  'Food costs you, per guest', 'At your prices, per guest', 'for 50 guests', 'Send the quote on WhatsApp')

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
