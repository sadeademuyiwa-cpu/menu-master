/**
 * A NEW OWNER'S WHATSAPP NUMBER, IN A REAL BROWSER (0068).
 *
 * Needs a database with 0068 (signup contact), e.g. one built with
 * scripts/setup_db.ps1 -WithProposed. Proves:
 *
 *   onboarding asks for a WhatsApp number, optionally, says what it is for,
 *   and refuses a mistyped one before the business is created
 *   the number is stored in one form, with the choice on record
 *   the owner sees, changes and removes it in More -> Account
 *   the platform admin sees the new owner under "Check-ins due", with a
 *   WhatsApp link that has the message written, and can mark it done
 *   the privacy policy says what the number is for
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { onboardBusiness, finishSetup } from './setup-helper.mjs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const OWNER = { email: `contact-owner-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const QUIET = { email: `contact-quiet-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const ADMIN = { email: `contact-admin-${stamp}@test.ng`, pass: 'correct-horse-battery' }
// Names carry the stamp, so a rerun on the same database finds only its own rows.
const BIZ = `Contact Journey Kitchen ${stamp}`
const QUIET_BIZ = `Quiet Journey Kitchen ${stamp}`

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
    if (!missing.length || Date.now() - start > 5000) break
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
async function signUp(page, who) {
  await go(page, '/signup')
  await page.fill('input[type=email]', who.email)
  await page.fill('input[type=password]', who.pass)
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/onboarding', { timeout: 60000 })
}
/** Onboarding up to the business, with what the person types in the WhatsApp box. */
async function openOnboarding(page) {
  for (let i = 0; i < 25; i++) {
    await go(page, '/onboarding')
    if ((await page.locator('body').innerText()).includes('Tell us about your business')) return
    await page.waitForTimeout(400)
  }
}
const profile = async (email) => (await db.query(
  `select p.phone, p.marketing_ok_at, p.phone_confirmed_at from profiles p join auth.users u on u.id = p.id where u.email = $1`, [email])).rows[0]
const consents = async (email) => (await db.query(
  `select c.purpose, c.granted, c.source from contact_consents c join auth.users u on u.id = c.user_id
    where u.email = $1 order by c.id`, [email])).rows.map((r) => `${r.purpose}:${r.granted}:${r.source}`)

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const browser = await chromium.launch()

try {
  // --- 1. onboarding asks, optionally, and checks the number ----------------------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const o = await ctx.newPage()
  await signUp(o, OWNER)
  await openOnboarding(o)
  await must(o, 'onboarding asks for a WhatsApp number, marked optional, and says what it is for',
    'WhatsApp number', '(optional)', 'help you get set up', 'Not for adverts')
  mark('the offers box only appears once a number is typed', (await o.locator('input[name=offers]').count()) === 0)

  await o.fill('input[autocomplete=organization]', BIZ)
  await o.click('text=Catering and events')
  await o.fill('input[name=phone]', '12345')
  await o.click('button:has-text("Continue")')
  await must(o, 'a mistyped number is refused before the business is made', 'Use a Nigerian mobile number')
  mark('and nothing was created', new URL(o.url()).pathname === '/onboarding', o.url())

  await o.fill('input[name=phone]', '+234 (0) 803 555 0101')
  mark('typing a number shows the unticked offers box',
    (await o.locator('input[name=offers]').count()) === 1 && !(await o.locator('input[name=offers]').isChecked()))
  await o.click('button:has-text("Continue")')
  await o.waitForURL('**/start', { timeout: 60000 })
  await finishSetup(o, BASE)

  const p1 = await profile(OWNER.email)
  mark('the number is kept in one form, with offers off', p1?.phone === '2348035550101' && p1?.marketing_ok_at === null, JSON.stringify(p1))
  mark('and the choice is on record', JSON.stringify(await consents(OWNER.email)) === JSON.stringify(['service_contact:true:onboarding']),
    JSON.stringify(await consents(OWNER.email)))

  // --- 2. More -> Account: see it, change it, remove it ----------------------------
  await go(o, '/account')
  await must(o, 'Account shows "Your WhatsApp number"', 'Your WhatsApp number')
  mark('with the number in the box, the way it was typed', (await o.locator('input[name=phone]').inputValue()) === '0803 555 0101',
    await o.locator('input[name=phone]').inputValue())
  await o.fill('input[name=phone]', '0909 555 0202')
  await o.check('input[name=offers]')
  await o.click('button:has-text("Save number")')
  await waitText(o, 'Saved.')
  const p2 = await profile(OWNER.email)
  mark('a new number and the offers box are saved', p2?.phone === '2349095550202' && p2?.marketing_ok_at !== null, JSON.stringify(p2))

  // a second owner who gives no number
  const q = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await signUp(q, QUIET)
  await onboardBusiness(q, BASE, { business: QUIET_BIZ })
  mark('an owner can leave the number out and carry on', new URL(q.url()).pathname === '/start', q.url())

  // --- 3. the platform admin's check-ins --------------------------------------------
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await signUp(a, ADMIN)
  await onboardBusiness(a, BASE, { business: `Contact Admin Kitchen ${stamp}` })
  await finishSetup(a, BASE)
  await db.query(`insert into platform_admins (user_id, reason) select id, 'journey-contact' from auth.users where email = $1`, [ADMIN.email])

  await go(a, '/admin/signups')
  await must(a, 'Signups shows "Check-ins due" and how many new owners gave a number', 'Check-ins due', 'Gave a WhatsApp number')
  const row = a.locator('#checkins tr', { hasText: BIZ })
  mark('the new owner is due a hello, with their number', (await row.count()) === 1 && has(await row.innerText(), 'New: say hello')
    && has(await row.innerText(), '+234 909 555 0202'))
  const wa = await row.locator('a:has-text("WhatsApp")').getAttribute('href').catch(() => null)
  mark('the WhatsApp button opens a chat with the message written', (wa ?? '').startsWith('https://wa.me/2349095550202?text=')
    && decodeURIComponent(wa ?? '').includes(BIZ), wa ?? 'none')
  const quiet = a.locator('#checkins tr', { hasText: QUIET_BIZ })
  mark('an owner with no number is listed too, offering email instead',
    has(await quiet.innerText(), 'No number') && (await quiet.locator('a:has-text("Email")').count()) === 1)

  await row.locator('summary:has-text("Mark done")').click()
  await row.locator('select[name=outcome]').selectOption('reached')
  await row.locator('input[name=note]').fill('Set up fine')
  await row.locator('button:has-text("Save check-in")').click()
  await waitText(a, 'Check-in recorded')
  const p3 = await profile(OWNER.email)
  mark('"Talked to them" confirms the number', p3?.phone_confirmed_at !== null, JSON.stringify(p3))
  mark('and the hello is no longer due',
    (await a.locator('#checkins tr', { hasText: BIZ }).filter({ hasText: 'New: say hello' }).count()) === 0)

  // --- 4. removing it is one press ---------------------------------------------------
  await go(o, '/account')
  await o.click('button:has-text("Remove my number")')
  await waitText(o, 'Removed.')
  const p4 = await profile(OWNER.email)
  mark('"Remove my number" clears the number and the offers choice', p4?.phone === null && p4?.marketing_ok_at === null, JSON.stringify(p4))
  mark('and the withdrawal is on record', (await consents(OWNER.email)).slice(-2).sort().join(',') ===
    'marketing_whatsapp:false:account,service_contact:false:account', JSON.stringify(await consents(OWNER.email)))

  // --- 5. the privacy policy says it ---------------------------------------------------
  await go(o, '/privacy')
  await must(o, 'the privacy policy names the WhatsApp number, why, and who receives it',
    'Your WhatsApp number', 'WhatsApp (Meta)', 'remove your number in More')
} catch (e) {
  mark('the journey ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
