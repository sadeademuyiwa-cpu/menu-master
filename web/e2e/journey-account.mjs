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
 *   sign out is reachable, and so is "Forgot password?"
 *   a reset link signs you in to choose a new password, once
 *   an expired or edited link never leaves the site
 *
 * Email links come from the local gateway's stand-in mailbox
 * (/__local/last-mail), which exists only in e2e/supabase-local.mjs.
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { onboardBusiness, finishSetup } from './setup-helper.mjs'

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
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
