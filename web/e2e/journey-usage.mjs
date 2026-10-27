/**
 * WHERE PEOPLE ARE, WHETHER THEY ARE STUCK, AND WHAT THEY TOLD US (0069),
 * IN A REAL BROWSER.
 *
 * Needs a database with 0068 and 0069, e.g. one built with
 * scripts/setup_db.ps1 -WithProposed. Proves:
 *
 *   each screen an owner opens is recorded as a pattern, on its device, and
 *   moving on closes the last one; setup records its step
 *   Help is on every screen: "Write to us" sends the request with the screen
 *   and gives a reference; opening Help is noted
 *   a refusal on screen is noted by its words, never the sentence
 *   after the first costed dish (and the first day) one short question comes;
 *   a low score asks what was hard, and the answer is kept
 *   turning recording off in Account removes what was recorded and stops it
 *   the admin sees who is in the app and where (Live now), how far each
 *   owner got and why they look stuck (Journeys), one owner's story, and the
 *   help requests and answers (Help & feedback), and marks a request replied
 *   an admin's own use is not recorded; the privacy policy says all of it
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { onboardBusiness, finishSetup } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const OWNER = { email: `usage-owner-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const ADMIN = { email: `usage-admin-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const BIZ = `Usage Journey Kitchen ${stamp}`
const HELP_TEXT = `How do I add a pack size? ${stamp}`

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const has = (body, needle) => body.toLowerCase().includes(needle.toLowerCase())
async function must(page, name, ...needles) {
  const start = Date.now()
  let missing = needles
  for (;;) {
    const body = await page.locator('body').innerText()
    missing = needles.filter((n) => !has(body, n))
    if (!missing.length || Date.now() - start > 8000) break
    await page.waitForTimeout(250)
  }
  mark(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)} at ${page.url()}` : '')
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
}
async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await settle(page)
}
async function waitText(page, needle, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (has(await page.locator('body').innerText(), needle)) return true
    await page.waitForTimeout(300)
  }
  return false
}
/** Polls the database until `test` holds for the rows `sql` returns, or 15 s pass. */
async function until(sql, args, test, ms = 15000) {
  const end = Date.now() + ms
  let rows = []
  while (Date.now() < end) {
    rows = (await db.query(sql, args)).rows
    if (test(rows)) return { ok: true, rows }
    await new Promise((r) => setTimeout(r, 400))
  }
  return { ok: false, rows }
}
async function signUp(page, who) {
  await go(page, '/signup')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/onboarding', { timeout: 60000 })
}
const VISITS = `select v.path, v.screen, v.device, v.state, v.session_id, v.active_seconds
                  from usage_views v join auth.users u on u.id = v.user_id where u.email = $1 order by v.started_at, v.last_seen_at`

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const browser = await chromium.launch()

try {
  // --- 1. an owner's screens --------------------------------------------------------
  const o = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await signUp(o, OWNER)
  // --- 0. told first --------------------------------------------------------------
  await must(o, 'the first screen says that screens are recorded, never what is typed, and where to turn it off',
    'Menu Master sees which screens you use', 'Never what you type', 'unless you turn this off in')
  await o.waitForTimeout(1500)
  mark('nothing is recorded before that has been seen', (await db.query(VISITS, [OWNER.email])).rows.length === 0)
  await onboardBusiness(o, BASE, { business: BIZ })
  await finishSetup(o, BASE)

  const STEPS = ['/start/purchase', '/start/dish', '/start/price']
  const setup = await until(VISITS, [OWNER.email], (r) => STEPS.every((p) => r.some((v) => v.path === p)))
  mark('setup is recorded, one visit per step', setup.ok, JSON.stringify([...new Set(setup.rows.map((v) => v.path))]))
  // A full page load cannot say it left (that visit goes quiet instead); moving
  // on inside the app does.
  mark('and a step moved on from is closed', STEPS.slice(0, 2).every((p) => setup.rows.some((v) => v.path === p && v.state === 'left')),
    JSON.stringify(setup.rows.map((v) => `${v.path}:${v.state}`)))

  await go(o, '/dashboard')
  const home = await until(VISITS, [OWNER.email], (r) => r.some((v) => v.path === '/dashboard' && v.state === 'active'))
  const h = home.rows.find((v) => v.path === '/dashboard')
  mark('opening Home records the screen, on a phone, active', home.ok && h?.device === 'phone', JSON.stringify(h ?? null))

  await o.locator('.mm-bottom-nav a:has-text("Dishes")').click()
  await o.waitForURL('**/recipes', { timeout: 30000 })
  const moved = await until(VISITS, [OWNER.email], (r) => r.some((v) => v.path === '/recipes')
    && r.filter((v) => v.path === '/dashboard').at(-1)?.state === 'left')
  const last = moved.rows.filter((v) => v.path === '/dashboard').at(-1)
  const rec = moved.rows.find((v) => v.path === '/recipes')
  mark('moving to Dishes closes Home and opens Dishes, in the same session', moved.ok && rec?.session_id === last?.session_id,
    JSON.stringify(moved.rows.slice(-2)))
  mark('only patterns are recorded: no ids, no query strings',
    moved.rows.every((v) => /^\/[a-z0-9/_:-]{0,99}$/.test(v.path) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(v.path)))

  // --- 2. Help, from the screen ------------------------------------------------------
  await o.locator('.mm-help-chip').click()
  await must(o, 'Help opens on every screen and says which screen it is', 'Need help?', 'You are on:')
  await o.fill('textarea[name=help_message]', HELP_TEXT)
  await o.locator('dialog[open] button:has-text("Send")').click()
  const sent = await waitText(o, 'Your reference is H')
  mark('"Write to us" sends it and gives a reference', sent)
  const req = (await db.query(`select h.id, h.path, h.channel, h.status, h.device from help_requests h join auth.users u on u.id = h.user_id
                                where u.email = $1`, [OWNER.email])).rows
  mark('the request is kept with the screen it came from', req.length === 1 && req[0].path === '/recipes' && req[0].channel === 'message'
    && req[0].status === 'open' && req[0].device === 'phone', JSON.stringify(req))
  const opened = await until(`select e.kind from usage_events e join auth.users u on u.id = e.user_id where u.email = $1`, [OWNER.email],
    (r) => r.some((e) => e.kind === 'help_open'))
  mark('opening Help is noted', opened.ok)
  await o.keyboard.press('Escape')

  // --- 3. a refusal is noted by its words -----------------------------------------
  await go(o, '/recipes?notice=' + encodeURIComponent(`Egusi ${stamp} already exists.`))
  const refused = await until(`select e.kind, e.code, e.path from usage_events e join auth.users u on u.id = e.user_id
                                where u.email = $1 and e.kind = 'refusal'`, [OWNER.email], (r) => r.length > 0)
  mark('a refusal on screen is noted with its words, never the sentence', refused.ok && refused.rows[0].code === 'already'
    && refused.rows[0].path === '/recipes', JSON.stringify(refused.rows))

  // --- 4. the short question ----------------------------------------------------------
  // her first day is judged from when she joined the business
  await db.query(`update memberships set created_at = now() - interval '2 days'
                   where user_id = (select id from auth.users where email = $1)`, [OWNER.email])
  await go(o, '/dashboard')
  const asked = await waitText(o, 'How easy was it to cost your first dish?', 20000)
  mark('a day after the first costed dish, one short question comes', asked)
  await o.getByRole('button', { name: '2, Hard', exact: true }).click()
  await must(o, 'a low score asks what made it hard', 'What made it hard?')
  await o.fill('textarea[name=feedback_comment]', 'The pack sizes confused me')
  await o.locator('dialog[open] button:has-text("Send")').click()
  await must(o, 'and thanks them', 'Thank you')
  const fb = (await db.query(`select f.prompt, f.score, f.comment from feedback f join auth.users u on u.id = f.user_id where u.email = $1`, [OWNER.email])).rows
  mark('the answer is kept: 2 of 5, with what was hard', fb.length === 1 && fb[0].prompt === 'first_dish' && fb[0].score === 2
    && fb[0].comment === 'The pack sizes confused me', JSON.stringify(fb))
  await o.waitForTimeout(2500)
  await go(o, '/dashboard')
  await o.waitForTimeout(7500)
  mark('and the question does not come back', (await o.locator('dialog[open]', { hasText: 'How easy' }).count()) === 0)

  await o.locator('.mm-notice button:has-text("OK")').click()
  await go(o, '/dashboard')
  mark('"OK" puts the notice away for good on this phone', !has(await o.locator('main').innerText(), 'sees which screens you use and for how long'))

  // --- 5. the admin -------------------------------------------------------------------
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await signUp(a, ADMIN)
  await db.query(`insert into platform_admins (user_id, reason) select id, 'journey-usage' from auth.users where email = $1`, [ADMIN.email])
  // what was recorded before they were made an admin
  const adminBefore = (await db.query(VISITS, [ADMIN.email])).rows.length
  // the owner is on Dishes while the admin looks
  await go(o, '/recipes')

  await go(a, '/admin/live')
  await must(a, 'Live now shows the owner on the screen they are on, using it now', 'Live now', BIZ, 'Using it now')
  const liveRow = a.locator('tr', { hasText: BIZ })
  mark('with the screen named and the time on it', has(await liveRow.innerText(), 'Dishes') || has(await liveRow.innerText(), 'Recipes'),
    (await liveRow.innerText()).replace(/\s+/g, ' ').slice(0, 120))
  mark('the sidebar counts the people in the app and the help waiting',
    (await a.locator('.ad-side a[href="/admin/live"] .ad-count').count()) === 1
    && (await a.locator('.ad-side a[href="/admin/feedback"] .ad-count').count()) === 1)

  await go(a, '/admin/journeys?show=all')
  await must(a, 'Journeys shows how far owners got, step by step', 'Where owners get to', 'First dish costed', 'Selling price set')
  const jrow = a.locator('tr', { hasText: BIZ })
  mark('the owner is there, flagged because they asked for help and rated it low', (await jrow.count()) === 1
    && has(await jrow.innerText(), 'Needs you') && has(await jrow.innerText(), 'Asked for help') && has(await jrow.innerText(), 'Unhappy'),
    (await jrow.innerText()).replace(/\s+/g, ' ').slice(0, 160))
  await go(a, '/admin/journeys')
  mark('and is on "Needs a look"', (await a.locator('tr', { hasText: BIZ }).count()) === 1)

  await a.locator('tr', { hasText: BIZ }).locator(`a:has-text("${BIZ}")`).click()
  await a.waitForURL('**/admin/journeys/*', { timeout: 30000 })
  await must(a, 'one owner\'s story: the steps, each use with its screens, the help and the rating',
    'What happened', 'Used the app for', 'First dish costed', 'Asked for help on', HELP_TEXT, 'Rated how easy costing the first dish was: 2 of 5',
    'The pack sizes confused me', 'Refused on')

  await go(a, '/admin/feedback')
  await must(a, 'Help & feedback lists the request with its reference and screen, and the answer',
    'Waiting for an answer', HELP_TEXT, 'Costing the first dish', '2 of 5')
  const hrow = a.locator('#requests tr', { hasText: HELP_TEXT })
  const mail = await hrow.locator('a:has-text("Email")').getAttribute('href').catch(() => null)
  mark('the reply is started for the admin, with the reference', (mail ?? '').startsWith(`mailto:${OWNER.email}`)
    && decodeURIComponent(mail ?? '').includes(`ref H${req[0]?.id}`), mail ?? 'none')
  await hrow.locator('summary:has-text("Mark done")').click()
  await hrow.locator('select[name=status]').selectOption('replied')
  await hrow.locator('input[name=note]').fill('Sent the pack size video')
  await hrow.locator('button:has-text("Save")').click()
  await waitText(a, 'Saved.')
  const after = (await db.query('select status, note, handled_at from help_requests where id = $1', [req[0]?.id ?? 0])).rows[0]
  mark('"Mark done" records it replied, with the note', after?.status === 'replied' && after?.note === 'Sent the pack size video'
    && after?.handled_at !== null, JSON.stringify(after))

  await go(a, '/admin')
  await must(a, 'the Overview shows who is in the app now', 'In the app now', 'In the app this minute')

  // an admin on an app screen (setup, for one with no business) is not recorded either
  await go(a, '/onboarding')
  await a.waitForTimeout(3000)
  const adminVisits = (await db.query(VISITS, [ADMIN.email])).rows
  mark('the admin\'s own use is not recorded', adminVisits.length === adminBefore, `${adminBefore} before, ${adminVisits.length} after`)

  // --- 6. turning it off ---------------------------------------------------------------
  await go(o, '/account')
  await must(o, 'Account offers the switch, and says what is recorded', 'Let Menu Master see which screens you use', 'Never what you type')
  const toggle = o.getByRole('switch', { name: 'Let Menu Master see which screens you use' })
  mark('it starts on', (await toggle.getAttribute('aria-checked')) === 'true', String(await toggle.getAttribute('aria-checked')))
  await toggle.click()
  await waitText(o, 'Off. We have deleted')
  const gone = await until(VISITS, [OWNER.email], (r) => r.length === 0)
  const prof = (await db.query('select p.usage_opt_out_at from profiles p join auth.users u on u.id = p.id where u.email = $1', [OWNER.email])).rows[0]
  mark('turning it off deletes the screens recorded', gone.ok && prof?.usage_opt_out_at !== null, `${gone.rows.length} left`)
  await go(o, '/recipes')
  await o.waitForTimeout(3000)
  mark('and records no more', (await db.query(VISITS, [OWNER.email])).rows.length === 0)
  const kept = (await db.query(`select (select count(*) from help_requests h where h.user_id = u.id)::int as help,
                                       (select count(*) from feedback f where f.user_id = u.id)::int as fb
                                  from auth.users u where u.email = $1`, [OWNER.email])).rows[0]
  mark('what they chose to send is kept: the request and the answer', kept?.help === 1 && kept?.fb === 1, JSON.stringify(kept))
  await go(o, '/account')
  await o.getByRole('switch', { name: 'Let Menu Master see which screens you use' }).click()
  await waitText(o, 'On. Thank you.')
  await go(o, '/recipes')
  const back = await until(VISITS, [OWNER.email], (r) => r.length > 0)
  mark('turning it on again records again', back.ok)

  // --- 7. the privacy policy --------------------------------------------------------------
  await go(o, '/privacy')
  await must(o, 'the privacy policy says which screens are recorded, how long, and how to stop it',
    'which screen you are on', 'never what you type', 'kept for 90 days', 'stop recording which screens you use')
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
