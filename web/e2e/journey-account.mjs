/**
 * THE ACCOUNT JOURNEY, IN A REAL BROWSER.
 *
 * Owners did not know they were on a free trial, could not find the plans,
 * and had no way back in after forgetting a password. This proves, on the
 * screens they use:
 *
 *   the trial and its days left are on every page, with a way to the plans
 *   the plans page says where the account stands and what each plan costs
 *   an ended trial says so, and that nothing entered is lost
 *   after the trial an edit says "Nothing was changed" and why, and costs
 *     nothing again; a purchase cannot be recorded, cancelled or corrected;
 *     and a balance owed on a confirmed sale can still be recorded (0066)
 *   sign out is reachable, and so is "Forgot password?"
 *   a reset link signs you in to choose a new password, once
 *   an expired or edited link never leaves the site
 *
 * Email links come from the local gateway's stand-in mailbox
 * (/__local/last-mail), which exists only in e2e/supabase-local.mjs.
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { onboardBusiness, finishSetup, openDetails } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const GATEWAY = 'http://127.0.0.1:54321'
const stamp = Date.now()
const A = { email: `acct-${stamp}@test.ng`, pass: 'correct-horse-battery' }

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const has = (body, needle) => body.toLowerCase().includes(needle.toLowerCase())
async function must(page, name, ...needles) {
  const body = await page.locator('body').innerText()
  const missing = needles.filter((n) => !has(body, n))
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)} at ${page.url()}` : '')
}
async function mustNot(page, name, ...needles) {
  const body = await page.locator('body').innerText()
  const present = needles.filter((n) => has(body, n))
  mark(name, present.length === 0, present.length ? `unexpectedly present ${JSON.stringify(present)}` : '')
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
}
async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await settle(page)
}
async function waitText(page, needle, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (has(await page.locator('body').innerText(), needle)) return true
    await page.waitForTimeout(300)
  }
  return false
}
const path = (page) => new URL(page.url()).pathname
/** Press a form's button and wait for the page it lands on. */
async function submit(page, locator) {
  await Promise.all([page.waitForLoadState('domcontentloaded'), locator.click()])
  await settle(page)
  await page.locator('button[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
}
/** This owner's own rows, read straight from the database. */
const OWN = `join memberships m on m.account_id = t.account_id
             join auth.users u on u.id = m.user_id and u.email = $1`

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })

try {
  // --- a new owner -----------------------------------------------------------
  await go(page, '/signup')
  await must(page, 'signup says the trial is free and needs no card', 'Start your free trial', '14 days free', 'No card needed')
  await page.fill('input[type=email]', A.email)
  await page.fill('input[type=password]', A.pass)
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/onboarding', { timeout: 60000 })
  await onboardBusiness(page, BASE, { business: 'Trial Kitchen' })

  // Setup's last screen names the trial and the cheapest plan.
  await finishSetup(page, BASE)
  await go(page, '/start')
  await must(page, 'the end of setup says a free trial is running and what plans cost', 'free trial', 'days left', 'Plans start at ₦', 'See plans')

  // --- the trial on every page ----------------------------------------------
  for (const p of ['/dashboard', '/recipes', '/purchases', '/more']) {
    await go(page, p)
    const bar = page.locator('.mm-access-bar')
    const ok = (await bar.count()) === 1 && /Free trial · \d+ days left/.test(await bar.innerText())
    mark(`the trial and its days left show on ${p}`, ok, ok ? '' : await bar.allInnerTexts().then((t) => t.join(' | ')))
  }
  await go(page, '/dashboard')
  await page.click('.mm-access-bar >> text=Choose a plan')
  await page.waitForURL('**/subscribe', { timeout: 30000 })
  await settle(page)
  await must(page, 'the plans page says where the account stands',
    'Free trial', 'days left', 'Costing', 'Costing + Sales', '/month', 'What happens when my free trial ends?')

  // --- a sale with a balance still owed, while the trial runs ----------------
  // The same order screen as journey-sales.mjs: two plates at N500, confirmed,
  // then a N300 deposit recorded on the sale's own page.
  await go(page, '/sales/new')
  await page.waitForTimeout(600)
  await page.click('button[aria-label="Add Setup pepper soup"]')
  if (!(await page.locator('dialog[open]').count())) {
    await page.click('button[aria-label^="How many Setup pepper soup"]')
  }
  await page.fill('dialog[open] input[name=item_qty]', '2')
  await page.fill('dialog[open] input[name=item_price]', '500')
  await page.click('dialog[open] button:has-text("Done")')
  await page.click('button:has-text("Next")')
  await page.click('button:has-text("Confirm sale")')
  await page.waitForURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 60000 })
  await settle(page)
  const saleId = path(page).split('/').pop()
  await page.fill('input[name=amount_paid]', '300')
  await page.locator('select[name=payment_status]').selectOption('part_paid')
  await submit(page, page.locator('button:has-text("Save payment")'))
  await must(page, 'during the trial a deposit is recorded and the balance shown', 'Payment updated.', 'still to pay')

  // --- More, Account, sign out ----------------------------------------------
  await go(page, '/more')
  await must(page, 'More leads to plans and billing, and can sign out', 'Plans & billing', 'Sign out')
  await go(page, '/account')
  await must(page, 'Account shows the plan in words, and can change password or sign out', 'Free trial', 'Change password', 'Sign out')
  await mustNot(page, 'Account shows no raw database status', 'trialing')

  await go(page, '/more')
  await page.click('button:has-text("Sign out")')
  await page.waitForURL('**/login', { timeout: 30000 })
  await go(page, '/dashboard')
  mark('after signing out, the app asks you to log in', path(page) === '/login', page.url())

  // --- forgot password ------------------------------------------------------
  await go(page, '/login')
  await must(page, 'login offers "Forgot password?"', 'Forgot password?', 'Start your free trial')
  await page.click('text=Forgot password?')
  await page.waitForURL('**/forgot-password', { timeout: 30000 })
  await settle(page)
  await page.fill('input[type=email]', 'nobody-' + stamp + '@test.ng')
  await page.click('button:has-text("Send reset link")')
  await waitText(page, 'Check your email')
  await must(page, 'an unknown address gets the same answer (no account lookup)', 'If nobody-', 'has a Menu Master account')

  await page.click('text=Try another address')
  await page.fill('input[type=email]', A.email)
  await page.click('button:has-text("Send reset link")')
  await waitText(page, 'Check your email')
  await must(page, 'a known address is told to check email, and Spam', 'Check your email', 'Spam')

  const mail = await (await fetch(`${GATEWAY}/__local/last-mail`)).json()
  mark('a reset email was "sent" to the owner', mail.to === A.email && /\/auth\/confirm\?token_hash=/.test(mail.link ?? ''), JSON.stringify(mail))

  // An edited link that tries to leave the site stays here.
  const evil = mail.link.replace(/next=[^&]*/, 'next=' + encodeURIComponent('//evil.example/steal'))
  await page.goto(evil, { waitUntil: 'domcontentloaded' })
  await settle(page)
  mark('a link edited to point elsewhere never leaves the site', new URL(page.url()).host === new URL(BASE).host, page.url())

  // The real link: signed in, on the new-password screen.
  await page.goto(mail.link, { waitUntil: 'domcontentloaded' })
  await settle(page)
  mark('the reset link opens "Choose a new password"', path(page) === '/reset-password', page.url())
  await must(page, 'the new-password screen explains itself', 'Choose a new password', 'At least 8 characters')

  const pw = page.locator('input[type=password]')
  await pw.nth(0).fill('new-password-1')
  await pw.nth(1).fill('new-password-2')
  await page.click('button:has-text("Save new password")')
  await waitText(page, 'two passwords are different', 5000)
  await must(page, 'two different passwords are caught before saving', 'The two passwords are different')

  await pw.nth(1).fill('new-password-1')
  await page.click('button:has-text("Save new password")')
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
  const toasted = await waitText(page, 'Password changed', 10000)
  mark('saving the password says so, on the dashboard', toasted, page.url())

  // --- a dead link ----------------------------------------------------------
  await go(page, '/auth/confirm?token_hash=not-a-real-token&type=recovery')
  mark('an expired reset link leads back to ask for a new one', path(page) === '/forgot-password', page.url())
  await must(page, 'and says why', 'expired or was already used')

  // --- the trial ends -------------------------------------------------------
  const { rowCount } = await db.query(
    `update subscriptions s set current_period_end = now() - interval '1 day'
       from memberships m join auth.users u on u.id = m.user_id
      where m.account_id = s.account_id and u.email = $1`, [A.email])
  mark('(test) the trial was moved into the past', rowCount === 1, `rows ${rowCount}`)
  await go(page, '/dashboard')
  const ended = page.locator('.mm-access-bar[data-tone=ended]')
  mark('an ended trial says so on the dashboard', (await ended.count()) === 1)
  await must(page, 'and says nothing entered is lost, with the way back', 'Your free trial ended', 'Everything you entered is still here to read', 'Choose a plan')
  await go(page, '/subscribe')
  await must(page, 'the plans page says the trial has ended', 'ended')

  // --- after the trial: an edit changes nothing, and says why (APP1) ----------
  const { rows: [own] } = await db.query(
    `select (select t.id from recipes t ${OWN} where t.name = 'Setup pepper soup' and t.deleted_at is null limit 1) as recipe_id,
            (select t.id from purchases t ${OWN} where t.status = 'posted' and t.reverses is null
              order by t.created_at limit 1) as purchase_id,
            (select count(*)::int from cost_snapshots t ${OWN}) as snapshots,
            (select count(*)::int from ingredient_prices t ${OWN}) as prices`, [A.email])
  mark('(test) the setup dish and purchase were found', !!own?.recipe_id && !!own?.purchase_id, JSON.stringify(own))

  await go(page, '/settings')
  await page.locator('form:has(select[name=type]) input[name=name]').fill('Renamed after the trial')
  await submit(page, page.locator('form:has(select[name=type]) button:has-text("Save")'))
  await must(page, 'after the trial, saving Business details says nothing was changed, and why',
    'Nothing was changed', 'Your free trial ended on', 'Choose a plan', 'Everything you entered is still here')
  await mustNot(page, 'and never claims it was saved', 'Business details saved.')

  await go(page, `/recipes/${own.recipe_id}`)
  await openDetails(page, 'Edit this dish')
  const editDish = page.locator('details:has(> summary:has-text("Edit this dish"))').first()
  await editDish.locator('input[name=name]').fill('Setup pepper soup renamed')
  await submit(page, editDish.locator('button:has-text("Save changes")'))
  await must(page, 'after the trial, renaming a dish says nothing was changed, and why', 'Nothing was changed', 'Your free trial ended on')
  await mustNot(page, 'and does not claim the dish was updated', 'Dish updated.')

  // --- a recorded purchase can be neither cancelled nor corrected (APP2) ------
  await go(page, `/purchases/${own.purchase_id}`)
  await must(page, 'after the trial a recorded purchase says why it cannot be changed',
    'can’t be cancelled or corrected', 'Choose a plan')
  await mustNot(page, 'and offers no correction and no cancellation', 'Correct this purchase', 'Cancel it without a replacement')
  await go(page, `/purchases/${own.purchase_id}/correct`)
  mark('the correction page sends an ended trial back to the purchase', path(page) === `/purchases/${own.purchase_id}`, page.url())
  await must(page, 'and says why', 'free trial ended', 'can’t be cancelled or corrected')
  await go(page, '/purchases/new')
  mark('a new purchase sends an ended trial back to Purchases', path(page) === '/purchases', page.url())
  await must(page, 'and says why', 'new purchases can’t be recorded')
  mark('Purchases has no New purchase button after the trial',
    (await page.locator('a.mm-btn[href="/purchases/new"]').count()) === 0)
  // --- and a new sale is not typed in only to be refused at Confirm ----------
  await go(page, '/sales/new')
  mark('a new sale sends an ended trial back to Sales', path(page) === '/sales', page.url())
  await must(page, 'and says why', 'new sales can’t be recorded')
  mark('Sales has no New sale button after the trial',
    (await page.locator('a.mm-btn[href="/sales/new"]').count()) === 0)
  await go(page, '/dashboard')
  mark('Home offers neither Record a sale nor Record a purchase after the trial',
    (await page.locator('a.mm-btn[href="/sales/new"], a.mm-btn[href="/purchases/new"]').count()) === 0)

  const { rows: [after] } = await db.query(
    `select (select count(*)::int from cost_snapshots t ${OWN}) as snapshots,
            (select count(*)::int from ingredient_prices t ${OWN}) as prices`, [A.email])
  mark('none of that re-costed a dish or wrote a price', after.snapshots === own.snapshots && after.prices === own.prices,
    `snapshots ${own.snapshots} -> ${after.snapshots}, prices ${own.prices} -> ${after.prices}`)

  // --- money owed on a confirmed sale can still come in (D2, 0066) ------------
  await go(page, `/sales/${saleId}`)
  await must(page, 'after the trial the sale still says what is owed, and that it can be recorded',
    'still to pay', 'can still be recorded')
  await mustNot(page, 'but it can no longer be cancelled', 'Something is wrong with this sale')
  await page.fill('input[name=amount_paid]', '1000')
  await page.locator('select[name=payment_status]').selectOption('paid')
  await submit(page, page.locator('button:has-text("Save payment")'))
  await must(page, 'after the trial the balance is recorded and the sale reads paid', 'Payment updated.', 'Paid in full')
  const { rows: [paidRow] } = await db.query('select amount_paid::text as paid, payment_status::text as status from orders where id = $1', [saleId])
  mark('and the database holds the payment', paidRow?.status === 'paid' && Number(paidRow?.paid) === 1000, JSON.stringify(paidRow))
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
