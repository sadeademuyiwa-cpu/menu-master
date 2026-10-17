/**
 * PART B, IN A REAL BROWSER: an owner invites someone by email; that person
 * signs up and is simply in the right business; the owner changes their role
 * and removes them; the removed person is back to having no account.
 *
 * Runs against the local stack (scripts/dev_local.ps1 -Run web/e2e/people.mjs).
 * Every verdict here is the database's: the page only shows what the
 * functions of 0056 returned.
 */
import { chromium } from 'playwright'
import { onboardBusiness, finishSetup } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const owner = { email: `owner-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const cook  = { email: `cook-${stamp}@test.ng`,  pass: 'correct-horse-battery' }

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const text = (p) => p.locator('body').innerText()
const has = (body, n) => body.toLowerCase().includes(n.toLowerCase())
async function must(p, name, ...needles) {
  const body = await text(p)
  const missing = needles.filter((n) => !has(body, n))
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '')
  if (missing.length) console.log(`      page said: ${body.replace(/\s+/g, ' ').slice(0, 700)}`)
}
async function mustNot(p, name, ...needles) {
  const body = await text(p)
  const present = needles.filter((n) => has(body, n))
  mark(name, present.length === 0, present.length ? `present ${JSON.stringify(present)}` : '')
}
const rendered = (p) => p.locator('[aria-label="Loading"]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
async function go(p, path) { await p.goto(BASE + path, { waitUntil: 'domcontentloaded' }); await rendered(p) }
// over when the button stops being busy (the transition committed), then rendered
const settledForm = (p) => p.locator('button[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
async function submit(p, sel) {
  await Promise.all([p.waitForLoadState('domcontentloaded'), p.click(sel)])
  await p.waitForLoadState('networkidle').catch(() => {})
  await settledForm(p); await rendered(p); await p.waitForTimeout(400)
}
async function settled(p, path, needle, tries = 25) {
  for (let i = 0; i < tries; i++) {
    await go(p, path)
    if ((await text(p)).includes(needle)) return true
    await p.waitForTimeout(400)
  }
  throw new Error(`never settled: ${path} never showed ${JSON.stringify(needle)}`)
}
async function signUp(p, who, path = '/signup') {
  await go(p, path)
  await p.fill('input[type=email]', who.email)
  await p.fill('input[type=password]', who.pass)
  await submit(p, 'button[type=submit]')
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })

// ---- the owner ------------------------------------------------------------
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const A = await ctxA.newPage()
await signUp(A, owner)
// Onboarding, then the compulsory guided setup (one purchase, one dish, its
// price), through the real screens: the staff checks below need a dish with a
// cost and a selling price to prove who sees which.
await onboardBusiness(A, BASE, { business: 'Invite Kitchen' })
await finishSetup(A, BASE, { dish: 'Invite soup', price: '500' })
await settled(A, '/dashboard', 'Invite Kitchen')
await go(A, '/recipes')
const dishPath = await A.locator('a[href^="/recipes/"]:not([href="/recipes/new"])', { hasText: 'Invite soup' }).first().getAttribute('href')
mark('the owner has a costed, priced dish to share', !!dishPath, String(dishPath))

await go(A, '/settings/people')
await must(A, 'the owner sees themselves on the account as Owner', owner.email, 'Owner', 'Invite someone')
await A.fill('input[name=email]', cook.email)
await A.selectOption('select[name=role]', 'sales')
await submit(A, 'form:has(input[name=email]) button[type=submit]')
await must(A, 'the invitation is recorded and the message to send is shown',
  `${cook.email} invited`, 'Waiting for them to sign up', 'Sign up with', `/signup?email=${encodeURIComponent(cook.email)}`)

// the same address again is renewed, not duplicated
await A.fill('input[name=email]', cook.email)
await submit(A, 'form:has(input[name=email]) button[type=submit]')
const dupes = (await text(A)).split(cook.email).length - 1
mark('re-inviting the same address does not duplicate the row', dupes <= 4, `${dupes} mentions`)

// ---- the invited cook ------------------------------------------------------
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } })
const B = await ctxB.newPage()
await go(B, `/signup?email=${encodeURIComponent(cook.email)}`)
await B.waitForFunction(() => document.querySelector('input[type=email]')?.value !== '', null, { timeout: 10000 }).catch(() => {})
const prefilled = await B.locator('input[type=email]').inputValue()
mark('the invite link opens signup with the address filled in', prefilled === cook.email, prefilled)
await B.fill('input[type=password]', cook.pass)
await submit(B, 'button[type=submit]')
await settled(B, '/dashboard', 'Invite Kitchen')
await must(B, 'the invited person lands in the business with no onboarding step', 'Invite Kitchen')
await go(B, '/settings/people')
await must(B, 'they see the people list, marked as themselves, and cannot invite', cook.email, 'you', 'Only an owner can invite')
await mustNot(B, 'no invite form is offered to a sales member', 'Invite someone')
await go(B, '/recipes')
await mustNot(B, 'a sales member sees no cost figures on Dishes', 'per portion', 'you keep', 'you lose')
// 0064: sales staff read selling prices (fn_menu_prices), never costs.
await must(B, 'and sees what each dish sells for', 'Invite soup', '₦500')
await go(B, '/sales/new')
await must(B, 'New sale offers the dish at its selling price to a sales member', 'Invite soup', '₦500')
await mustNot(B, 'with nothing cost-like on it', 'you keep', 'kept')
await go(B, '/dashboard')
await mustNot(B, 'Home shows a sales member no cost, keep, margin or suggested price', 'you keep', 'you kept', 'margin', 'Use ₦')
await go(B, dishPath)
await mustNot(B, 'the dish page shows a sales member no cost', 'Cost per portion', 'you keep', 'What one portion is made of')
await go(B, '/reports')
await mustNot(B, 'Reports show a sales member no kept figure', 'kept', 'margin')

// ---- the owner manages them ------------------------------------------------
await go(A, '/settings/people')
await must(A, 'the owner now sees the cook on the account as Sales, and the invitation as joined', cook.email, 'Sales', 'Joined')
const row = A.locator(`li:has-text("${cook.email}")`).first()

// Kitchen sees no money at all: no costs, no selling prices, no takings.
await row.locator('select[name=role]').selectOption('kitchen')
await submit(A, `li:has-text("${cook.email}") form:has(select[name=role]) button[type=submit]`)
await must(A, 'the role changes to Kitchen', 'Role changed', 'Kitchen')
for (const [path, where] of [['/dashboard', 'Home'], ['/sales', 'Sales'], [dishPath, 'the dish page'], ['/recipes', 'Dishes'], ['/reports', 'Reports']]) {
  await go(B, path)
  await mustNot(B, `a kitchen member sees no money on ${where}`, '₦')
}

await go(A, '/settings/people')
await row.locator('select[name=role]').selectOption('manager')
await submit(A, `li:has-text("${cook.email}") form:has(select[name=role]) button[type=submit]`)
await must(A, 'the role changes to Manager', 'Role changed', 'Manager')
await submit(A, `li:has-text("${cook.email}") form:not(:has(select)) button[type=submit]`)
await must(A, 'the cook is removed', 'Removed from the account')
// the address now appears only in the invitation history, not in the members list
const mentions = (await text(A)).split(cook.email).length - 1
mark('and no longer listed on the account', mentions === 1, `${mentions} mention(s)`)

// the removed cook is back to having no account
await go(B, '/dashboard')
await B.waitForURL(/\/onboarding/, { timeout: 10000 }).catch(() => {})
mark('a removed person is sent to onboarding, not shown someone else\'s business',
  B.url().includes('/onboarding'), B.url())

// the last owner is never offered Remove on their own row; the database
// would refuse it anyway (0012 guard)
await go(A, '/settings/people')
await mustNot(A, 'the owner is offered no Remove for their own row', 'Remove')

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
