/**
 * "CONTINUE WITH GOOGLE", SWITCHED FROM THE ADMIN PANEL.
 *
 * Run with the local gateway reporting Google as enabled in "Supabase":
 *
 *   $env:LOCAL_GOOGLE = 'on'
 *   pwsh -File scripts/dev_local.ps1 -Database mmp ... -Run web/e2e/check-google.mjs
 *
 * Needs a database with 0057. Proves the admin's switch shows and hides the
 * button, and that the button starts Supabase's Google sign-in with this
 * site's /auth/callback as the way back. Google itself is never contacted.
 */
import { chromium } from 'playwright'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const BASE = 'http://127.0.0.1:3100'
const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const browser = await chromium.launch()

async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
}
async function waitText(page, needle, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await page.locator('body').innerText()).includes(needle)) return true
    await page.waitForTimeout(300)
  }
  return false
}
const googleButtons = async (path) => {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await go(p, path)
  const n = await p.locator('button:has-text("with Google")').count()
  await ctx.close()
  return n
}

try {
  mark('(setup) the gateway reports Google on', process.env.LOCAL_GOOGLE === 'on')

  // A platform admin with a business, made directly: this checks the switch, not signup.
  const uid = randomUUID()
  const email = `google-admin-${Date.now()}@test.ng`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [uid, email])
  await db.query(`select fn_create_account_and_business('G Foods', 'G Kitchen', 'other', $1::uuid, p_idempotency_key => $2)`, [uid, `g-${uid}`])
  await db.query(`insert into platform_admins (user_id, reason) values ($1, 'check-google')`, [uid])

  const ctx = await browser.newContext()
  const a = await ctx.newPage()
  await go(a, '/login')
  await a.fill('input[type=email]', email)
  await a.fill('input[type=password]', 'any-password')
  await a.click('button:has-text("Log in")')
  await a.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })

  await go(a, '/admin/site')
  await waitText(a, 'Sign in with Google')
  mark('the admin page sees Google on in Supabase', await waitText(a, 'On in Supabase', 5000))

  // Off here: hidden, even though Supabase has it on.
  if (await a.isChecked('input[name=google]')) {
    await a.uncheck('input[name=google]')
    await a.click('button:has-text("Save sign-in")')
    await waitText(a, 'Sign-in saved')
  }
  mark('switched off here, the login page does not offer Google', (await googleButtons('/login')) === 0)

  await a.check('input[name=google]')
  await a.click('button:has-text("Save sign-in")')
  await waitText(a, 'Sign-in saved')
  mark('the admin page says the button is showing', await waitText(a, 'The button is showing', 5000))
  mark('switched on here, login offers "Continue with Google"', (await googleButtons('/login')) === 1)
  mark('and signup offers "Sign up with Google"', (await googleButtons('/signup')) === 1)

  // Pressing it hands over to Supabase's Google sign-in, coming back to /auth/callback.
  const v = await browser.newContext()
  const p = await v.newPage()
  let authorize = null
  await v.route(/\/auth\/v1\/authorize/, (route) => {
    authorize = route.request().url()
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' })
  })
  await go(p, '/login')
  await p.click('button:has-text("Continue with Google")')
  for (let i = 0; i < 40 && !authorize; i++) await p.waitForTimeout(250)
  const u = authorize ? new URL(authorize) : null
  mark('the button starts Supabase\'s Google sign-in',
    u?.searchParams.get('provider') === 'google', authorize ?? 'no request')
  mark('with this site\'s /auth/callback as the way back',
    (u?.searchParams.get('redirect_to') ?? '').endsWith('/auth/callback'), u?.searchParams.get('redirect_to') ?? '')
  await v.close()

  // Leave it off for whoever runs next.
  await a.uncheck('input[name=google]')
  await a.click('button:has-text("Save sign-in")')
  await waitText(a, 'Sign-in saved')
  mark('switched off again, the button is gone', (await googleButtons('/login')) === 0)
  await ctx.close()
} catch (e) {
  mark('the check ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
  await db.end()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
