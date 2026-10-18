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
 *   /api/billing takes only our own pages' JSON requests
 *   a paying owner sees "Your plan" and is refused a second payment for it
 *   with the web's billing switch ON (BILLING_SELF_SERVE=on on the server):
 *     the other plan is a switch, past a caution; Cancel plan asks first,
 *     names the end date and warns a founder; a cancelled plan says when it
 *     ends and can be chosen again ("a new paid month today"); a failed
 *     payment offers Pay now, Update your card and Cancel plan ("recording
 *     stops straight away"); the refunds page and terms promise those buttons
 *   with the switch OFF (anything but "on"): no self-serve button for a
 *     paying account, "message us" instead, checkout answers
 *     switch_needs_support, /api/billing answers not_configured, and the
 *     refunds page and terms say "message us"
 *   staff see no cancel, card, switch or Pay now button, and the routes
 *     refuse them
 *
 * Plans & billing tells the journey which state the server is in
 * (data-self-serve), so run it twice: once with BILLING_SELF_SERVE=on in the
 * app's environment, once without.
 *
 * This stack serves no edge functions (the gateway answers 404 for
 * /functions/v1/*), so a real cancel or card request is expected to be
 * refused in plain words, and the subscription row to stay as it was: only
 * the webhook ever writes it.
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
const S = { email: `acct-sales-${stamp}@test.ng`, pass: 'correct-horse-battery' }

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
  mark('an ended trial may pay for either plan', (await page.locator('[data-plan-action=pay]').count()) === 2)

  // --- a paying account ---------------------------------------------------------
  // (test) Paystack is not reachable from this stack, so the row is set the
  // way the webhook leaves it after a Costing payment.
  const setSub = (sql, label) => db.query(
    `update subscriptions s set ${sql}
       from memberships m join auth.users u on u.id = m.user_id
      where m.account_id = s.account_id and u.email = $1`, [A.email])
    .then(({ rowCount }) => mark(`(test) ${label}`, rowCount === 1, `rows ${rowCount}`))
  const subRow = async () => (await db.query(
    `select s.status, s.cancel_at_period_end from subscriptions s
       join memberships m on m.account_id = s.account_id join auth.users u on u.id = m.user_id
      where u.email = $1`, [A.email])).rows[0]
  const postAs = (p, url, body, type = 'application/json') => p.evaluate(async ([u, b, t]) => {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': t }, body: JSON.stringify(b) })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }, [url, body, type])
  const post = (url, body, type) => postAs(page, url, body, type)
  const actionOf = (p, blurb) => p.locator(`.mm-card:has-text("${blurb}") [data-plan-action]`).first().getAttribute('data-plan-action')
  const buttons = async (p, label) => p.locator(`button:has-text("${label}")`).count()
  const COSTING = 'Know what your food costs'
  const TRADING = 'everything you sell'
  const MESSAGE_US = 'To change or cancel your plan, message us. We do it for you, so you are never charged twice.'
  // The web's own refusals; anything else came from the (absent) edge function.
  const WEB_REFUSALS = ['already_on_plan', 'owner_only', 'switch_needs_support', 'plan_unreadable']

  await setSub(`plan_id = 'costing', status = 'active', cancel_at_period_end = false,
                founding_price_active = false, current_period_end = now() + interval '20 days'`,
    'the account now pays for Costing')
  await go(page, '/subscribe')
  // The web's billing safety switch (BILLING_SELF_SERVE, exactly "on") on
  // this server decides which half below applies. Run the journey once with
  // it on and once without.
  const selfServe = (await page.locator('[data-self-serve]').first().getAttribute('data-self-serve')) === 'on'
  console.log(`      (this server's BILLING_SELF_SERVE is ${selfServe ? 'on' : 'not on'})`)
  await must(page, 'Plans & billing says which plan is paid for and when it renews', 'You are on Costing', 'renewing on')
  await mustNot(page, 'and never invites a second payment', 'Choose your plan below to pay again')
  mark('the plan paid for reads "Your plan" and cannot be pressed',
    (await actionOf(page, COSTING)) === 'your_plan'
      && await page.locator('[data-plan-action=your_plan] button:has-text("Your plan")').isDisabled())
  const again = await post('/api/checkout', { tier: 'costing' })
  mark('paying again for the plan already paid for is refused', again.status === 409 && again.body.error === 'already_on_plan', JSON.stringify(again))

  // The billing route takes only our own pages' JSON requests.
  const foreign = await fetch(`${BASE}/api/billing`, {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel' }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  mark('another site cannot ask /api/billing to cancel', foreign.status === 403 && foreign.body.error === 'bad_origin', JSON.stringify(foreign))
  const notJson = await post('/api/billing', { action: 'cancel' }, 'text/plain')
  mark('and a body not sent as JSON is refused', notJson.status === 415 && notJson.body.error === 'bad_request', JSON.stringify(notJson))

  if (selfServe) {
    // --- switch on: switching plan -----------------------------------------------
    await must(page, 'the owner is told plans change here and cancel on Account', 'Change plan here', 'cancel from your Account page')
    mark('the other plan is offered as a switch', (await actionOf(page, TRADING)) === 'change')
    await page.click('button:has-text("Switch to this plan")')
    await must(page, 'switching shows the caution before any payment',
      'Your new plan starts the day you pay and your old plan stops', 'never charged for both',
      'Unused days on the old plan are not refunded', 'Pay for Costing + Sales')
    await page.click('button:has-text("Not now")')
    mark('"Not now" closes it, and nothing is paid', (await buttons(page, 'Pay for Costing + Sales')) === 0)

    // --- switch on: cancelling ---------------------------------------------------
    await go(page, '/account')
    await must(page, 'the owner sees when the plan renews, can change it or cancel, and how to get a copy',
      'Renews on', 'Change your plan', 'Cancel plan', 'copy of your records', 'within one working day')
    await mustNot(page, 'the Account page promises no export', 'export')
    await page.click('button:has-text("Cancel plan")')
    await must(page, 'cancelling asks first, and says what happens',
      'Your plan stays on until', 'you can still open and read everything', 'cannot record new work',
      'You will not be charged again', 'There is no undo', 'Keep my plan', 'Yes, cancel my plan')
    await mustNot(page, 'a plan on the standard price is not warned about the founding price', 'You are on the founding price')
    await page.click('button:has-text("Keep my plan")')
    mark('"Keep my plan" changes nothing', (await buttons(page, 'Yes, cancel my plan')) === 0)

    await page.click('button:has-text("Cancel plan")')
    await page.click('button:has-text("Yes, cancel my plan")')
    await waitText(page, 'Nothing has changed', 15000)
    await must(page, 'with no billing service here, the cancel is refused in plain words', 'Nothing has changed', 'within one working day')
    const kept = await subRow()
    mark('and the plan is left as it was: only the webhook writes it',
      kept?.status === 'active' && kept?.cancel_at_period_end === false, JSON.stringify(kept))

    await setSub(`founding_price_active = true`, 'the account is on the founding price')
    await go(page, '/account')
    await page.click('button:has-text("Cancel plan")')
    await must(page, 'a founder is warned that cancelling loses the founding price', 'You are on the founding price', 'standard price')

    // Paystack's not_renew, as 0067's webhook records it (X8).
    await setSub(`status = 'cancelled', cancel_at_period_end = true`, 'the plan is cancelled, paid month still running')
    await go(page, '/account')
    await must(page, 'after cancelling, the end date is said, with no further charge', 'Your plan ends on', 'You will not be charged again', 'Ends on')
    mark('and there is no second Cancel plan', (await buttons(page, 'Cancel plan')) === 0)
    await go(page, '/subscribe')
    await must(page, 'Plans & billing says the same', 'Your plan ends on', 'Not renewing')
    mark('the cancelled plan can be chosen again', (await actionOf(page, COSTING)) === 'change'
      && (await buttons(page, 'Choose this plan again')) === 1)
    await page.click('button:has-text("Choose this plan again")')
    await must(page, 'choosing it again says a new paid month starts today',
      'Your plan is on until', 'Choosing it again starts a new paid month today')
    await page.click('button:has-text("Not now")')
    const back = await post('/api/checkout', { tier: 'costing' })
    mark('and checkout lets it through to the edge function', !WEB_REFUSALS.includes(back.body.error), JSON.stringify(back))

    // --- switch on: a failed payment ---------------------------------------------
    await setSub(`status = 'past_due', cancel_at_period_end = false, current_period_end = now() - interval '1 day'`,
      'the last renewal failed, inside the grace period')
    await go(page, '/subscribe')
    await must(page, 'a failed payment offers Pay now and Update your card, and says nothing is charged twice',
      'We could not take your last payment', 'Pay now', 'Update your card',
      'The failed plan is switched off, so you are never charged twice')
    mark('the plan paid for offers "Pay now"', (await actionOf(page, COSTING)) === 'pay_now')
    mark('the other plan can still be switched to', (await actionOf(page, TRADING)) === 'change')
    const payAgain = await post('/api/checkout', { tier: 'costing' })
    mark('paying again for the overdue plan is not refused by the web (it replaces the failed one)',
      !WEB_REFUSALS.includes(payAgain.body.error), JSON.stringify(payAgain))
    await go(page, '/account')
    await must(page, 'Account offers the owner Pay now, Update your card and Cancel plan', 'Pay now', 'Update your card', 'Cancel plan')
    await page.click('button:has-text("Cancel plan")')
    await must(page, 'an overdue cancel says recording stops straight away',
      'Your last payment did not go through', 'recording stops straight away', 'You will not be charged again')
    await page.click('button:has-text("Keep my plan")')
    await page.click('button:has-text("Update your card")')
    await waitText(page, 'Nothing has changed', 15000)
    await must(page, 'with no billing service here, the card link is refused in plain words', 'Nothing has changed')

    await go(page, '/refunds')
    await must(page, 'the refunds page promises the buttons the owner has', 'press Cancel plan', 'Pay now or Update your card')
    await go(page, '/terms')
    await must(page, 'and so do the terms', 'from the Account page', 'Plans & billing page')
  } else {
    // --- switch off: nothing self-serve for a paying account ---------------------
    await must(page, 'the owner is told to message us to change or cancel', MESSAGE_US)
    mark('the other plan offers no switch, only "message us"', (await actionOf(page, TRADING)) === 'message_us'
      && (await buttons(page, 'Switch to this plan')) === 0)
    const sw = await post('/api/checkout', { tier: 'trading' })
    mark('checkout refuses a paying account\'s switch while the switch is off',
      sw.status === 409 && sw.body.error === 'switch_needs_support', JSON.stringify(sw))

    await go(page, '/account')
    await must(page, 'Account tells the owner to message us, and how to get a copy', MESSAGE_US, 'copy of your records', 'within one working day')
    await mustNot(page, 'the Account page promises no export', 'export')
    for (const b of ['Cancel plan', 'Update your card', 'Pay now']) {
      mark(`no "${b}" on Account while the switch is off`, (await buttons(page, b)) === 0)
    }
    const c = await post('/api/billing', { action: 'cancel' })
    mark('the billing route answers not_configured', c.status === 500 && c.body.error === 'not_configured', JSON.stringify(c))
    const kept = await subRow()
    mark('and the plan is left as it was', kept?.status === 'active' && kept?.cancel_at_period_end === false, JSON.stringify(kept))

    await setSub(`status = 'cancelled', cancel_at_period_end = true`, 'the plan is cancelled, paid month still running')
    await go(page, '/subscribe')
    await must(page, 'a cancelled plan says when it ends', 'Your plan ends on', 'Not renewing')
    mark('and is not chosen again by itself while the switch is off',
      (await actionOf(page, COSTING)) === 'message_us' && (await actionOf(page, TRADING)) === 'message_us')
    const re = await post('/api/checkout', { tier: 'costing' })
    mark('checkout refuses it too', re.status === 409 && re.body.error === 'switch_needs_support', JSON.stringify(re))

    await setSub(`status = 'past_due', cancel_at_period_end = false, current_period_end = now() - interval '1 day'`,
      'the last renewal failed, inside the grace period')
    await go(page, '/subscribe')
    await must(page, 'a failed payment tells the owner to message us', 'We could not take your last payment', 'Message us')
    for (const b of ['Pay now', 'Update your card']) {
      mark(`no "${b}" on Plans & billing while the switch is off`, (await buttons(page, b)) === 0)
    }
    const owed = await post('/api/checkout', { tier: 'costing' })
    mark('and checkout refuses paying again by itself', owed.status === 409 && owed.body.error === 'switch_needs_support', JSON.stringify(owed))
    await go(page, '/account')
    for (const b of ['Pay now', 'Update your card', 'Cancel plan']) {
      mark(`no "${b}" on Account for an overdue plan while the switch is off`, (await buttons(page, b)) === 0)
    }

    await go(page, '/refunds')
    await must(page, 'the refunds page says to message us', 'message us and we cancel it for you within one working day')
    await mustNot(page, 'and promises no button the owner cannot see', 'press Cancel plan', 'Pay now', 'Update your card')
    await go(page, '/terms')
    await must(page, 'and so do the terms', 'by messaging us')
    await mustNot(page, 'with no button promised', 'from the Account page')
  }

  // --- staff on a paying account (the row is past_due here) ----------------------
  await go(page, '/settings/people')
  await page.fill('input[name=email]', S.email)
  await page.selectOption('select[name=role]', 'sales')
  await page.click('form:has(input[name=email]) button[type=submit]')
  await waitText(page, `${S.email} invited`)
  const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const staff = await staffCtx.newPage()
  await go(staff, `/signup?email=${encodeURIComponent(S.email)}`)
  await staff.fill('input[type=email]', S.email)
  await staff.fill('input[type=password]', S.pass)
  await staff.click('button[type=submit]')
  await staff.waitForURL('**/dashboard**', { timeout: 60000 })
  await go(staff, '/subscribe')
  await must(staff, 'staff are told plan changes are the owner\'s', 'Plan changes are made by the account owner.')
  await mustNot(staff, 'and are not told to change or cancel it themselves', 'Change plan here', 'cancel from your Account page')
  for (const b of ['Switch to this plan', 'Update your card', 'Choose plan', 'Pay now']) {
    mark(`staff see no "${b}" button`, (await buttons(staff, b)) === 0)
  }
  await go(staff, '/account')
  await must(staff, 'Account tells staff the owner handles billing', 'Plan changes are made by the account owner.')
  for (const b of ['Cancel plan', 'Update your card', 'Pay now']) {
    mark(`staff see no "${b}" on Account`, (await buttons(staff, b)) === 0)
  }
  // With the switch off the billing route answers not_configured to everyone.
  const staffBilling = selfServe ? { status: 403, error: 'owner_only' } : { status: 500, error: 'not_configured' }
  const sCancel = await postAs(staff, '/api/billing', { action: 'cancel' })
  mark('the billing route refuses a staff cancel', sCancel.status === staffBilling.status && sCancel.body.error === staffBilling.error, JSON.stringify(sCancel))
  const sCard = await postAs(staff, '/api/billing', { action: 'card_link' })
  mark('and a staff card change', sCard.status === staffBilling.status && sCard.body.error === staffBilling.error, JSON.stringify(sCard))
  const sSwitch = await postAs(staff, '/api/checkout', { tier: 'trading' })
  mark('the checkout route refuses a staff plan change', sSwitch.status === 403 && sSwitch.body.error === 'owner_only', JSON.stringify(sSwitch))
  const sPay = await postAs(staff, '/api/checkout', { tier: 'costing' })
  mark('and a staff Pay now', sPay.status === 403 && sPay.body.error === 'owner_only', JSON.stringify(sPay))
  await staffCtx.close()
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
