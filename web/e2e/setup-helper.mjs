/**
 * First-run setup, driven through the real screens.
 *
 * Setup is compulsory for a new owner (src/lib/setup-gate.ts): until one dish
 * is costed from their own purchase and has a price, every app page returns
 * them to /start. Each journey therefore finishes setup first, through the
 * same four screens a customer uses, before testing anything else.
 *
 * Buttons are found by their words, never by `button[type=submit]`: the setup
 * header carries a Sign out button that comes first in the page.
 */

const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(600)
}

async function waitFor(page, needle, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const body = (await page.locator('body').innerText()).toLowerCase()
    if (body.includes(needle.toLowerCase())) return
    await page.waitForTimeout(400)
  }
  throw new Error(`setup never showed ${JSON.stringify(needle)} (at ${page.url()})`)
}

/**
 * Step 1: the business. Waits until /onboarding renders for this session,
 * because the auth cookie can land a moment after the signup request.
 */
export async function onboardBusiness(page, base, { business, type = 'Catering and events' }) {
  for (let i = 0; i < 25; i++) {
    await page.goto(`${base}/onboarding`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    if (new URL(page.url()).pathname === '/start') return            // already has one
    if ((await page.locator('body').innerText()).includes('Tell us about your business')) break
    await page.waitForTimeout(400)
  }
  await page.fill('input[autocomplete=organization]', business)
  await page.click(`text=${type}`)
  await page.click('button:has-text("Continue")')
  await page.waitForURL('**/start', { timeout: 60000 })
  await settle(page)
}

/**
 * Steps 2-4 with deliberately small, separate data, so the journey's own
 * ingredients and recipes are untouched: one purchase of salt, one dish made
 * from it, and a price for that dish.
 */
export async function finishSetup(page, base, { dish = 'Setup pepper soup', price = '500' } = {}) {
  await page.goto(`${base}/start`, { waitUntil: 'domcontentloaded' })
  await settle(page)

  await waitFor(page, 'What did you pay for your ingredients?')
  await pickItem(page, 'ingredient_id', 'Salt')
  await page.locator('input[name=qty]').first().fill('1')
  await page.locator('select[name=unit_id]').first().selectOption({ label: 'kg' })
  await page.locator('input[name=amount]').first().fill('600')
  await page.click('button:has-text("Save and continue")')

  await waitFor(page, 'Now, one dish you sell')
  await page.fill('input[name=name]', dish)
  await page.fill('input[name=plates]', '10')
  await page.locator('li.mm-card', { hasText: 'Salt' }).locator('input[name=qty]').fill('100')
  await page.locator('li.mm-card', { hasText: 'Salt' }).locator('select[name=unit_id]').selectOption({ label: 'grams' })
  await page.click('button:has-text("Work out the cost")')

  await waitFor(page, 'costs you')
  await page.fill('input[name=price]', price)
  await page.click('button:has-text("Save my price")')

  await waitFor(page, 'all set')
}

const YIELD_LABEL = { 'g — Gram': 'Grams (g)', 'ml — Millilitre': 'Millilitres (ml)', 'kg — Kilogram': 'Kilograms (kg)' }

/**
 * A new dish through its own screen (/recipes/new): name, how much one batch
 * makes, what it is counted in and, for weights and volumes, how much one
 * portion is. Lands on the dish's page. `unit` accepts the old option text
 * ('g — Gram') or the new label ('Grams (g)').
 */
export async function newDish(page, base, { name, batch, unit, portion }) {
  await page.goto(`${base}/recipes/new`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  await page.fill('input[name=name]', name)
  await page.fill('input[name=batch_yield_qty]', String(batch))
  const label = YIELD_LABEL[unit] ?? unit
  // The portion field appears once the screen has reacted to the unit; a
  // change made before the page has hydrated is not seen, so try again.
  for (let i = 0; i < 4; i++) {
    await page.selectOption('select[name=yield_unit_id]', { label })
    if (portion === undefined || portion === null) break
    if (await page.locator('input[name=portion_qty]').isVisible()) break
    await page.waitForTimeout(700)
  }
  if (portion !== undefined && portion !== null) await page.fill('input[name=portion_qty]', String(portion))
  await page.click('button:has-text("Save dish")')
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 60000 })
  await settle(page)
}

/**
 * Choose an item in an item picker (src/components/item-picker.tsx): open
 * it by its field name or label (`which`, its data-picker), type, and tap the
 * item. The exact name wins; otherwise the first item containing `needle`.
 * Works with a page or a locator as `scope`; the sheet itself is on the body.
 */
export async function pickItem(scope, which, needle) {
  const page = typeof scope.page === 'function' ? scope.page() : scope
  const trigger = scope.locator(`[data-picker="${which}"]`).first()
  const sheet = page.locator('dialog[open]:has([role=listbox])').last()
  // Before the page has hydrated the button does nothing: tap until it opens.
  for (let i = 0; i < 25; i++) {
    await trigger.click()
    if (await sheet.isVisible().catch(() => false)) break
    await page.waitForTimeout(300)
  }
  await sheet.locator('input[type=search]').fill(needle)
  const q = needle.replace(/["\\]/g, '\\$&')
  const exact = sheet.locator(`[role=option][data-name="${q}"]`)
  const option = (await exact.count()) > 0 ? exact.first() : sheet.locator(`[role=option][data-name*="${q}"]`).first()
  await option.click()
  await sheet.waitFor({ state: 'hidden', timeout: 10000 })
}

/** Open a folded section by its title, without closing one that is already open. */
export async function openDetails(page, title) {
  const d = page.locator(`details:has(> summary:has-text("${title}"))`).first()
  await d.waitFor({ state: 'attached', timeout: 15000 })
  if (!(await d.evaluate((e) => e.open))) await d.locator('summary').first().click()
  await page.waitForTimeout(150)
}
