import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
// supabase-js decodes the access token locally before it will call the auth
// server, so a placeholder string is silently rejected and the page redirects
// to /login. A well-formed (unsigned) JWT is required for the client to get as
// far as asking the server who the user is.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 3600
const jwt = [
  b64u({ alg: 'HS256', typ: 'JWT' }),
  b64u({
    sub: '00000000-0000-0000-0000-000000000099', aud: 'authenticated',
    role: 'authenticated', email: 'ada@adakitchen.ng', exp,
    iat: Math.floor(Date.now() / 1000), iss: 'http://127.0.0.1:54321/auth/v1',
  }),
  'signature',
].join('.')

const shots = [
  ['recipes', '/recipes', ['Recipes', 'New recipe', 'Jollof Rice']],
  ['recipe-detail', '/recipes/00000000-0000-0000-0000-000000000020',
    ['Jollof Rice', 'Ingredients used', 'Selling price', 'Rice', 'Salt']],
  ['ingredient-detail', '/ingredients/00000000-0000-0000-0000-000000000010',
    ['Rice', 'Record a purchase', 'Local measurements', '1 paint =']],
  ['account', '/account', ['Account', 'Plan', 'Free Trial']],
]

const label = process.argv[2] ?? 'complete'
// In the blocked fixture the page must NAME what is missing, not merely count it.
if (label === 'blocked') {
  shots[1][2] = ['Jollof Rice', 'cannot be costed yet', 'Salt', 'no purchase price recorded',
                 'No margin is shown']
}
const browser = await chromium.launch({ args: ['--no-proxy-server'] })  // the container's HTTPS proxy 400s on 127.0.0.1
const failures = []

for (const [device, viewport] of [
  ['mobile', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 900 }],
]) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()

  // Sign in through the application's own form. The session cookie is then
  // written by the real Supabase client, not forged by the harness -- which
  // also makes the login screen part of the evidence.
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.fill('input[type=email]', 'ada@adakitchen.ng')
  await page.fill('input[type=password]', 'correct-horse')
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }),
    page.click('button[type=submit]'),
  ])
  await page.screenshot({ path: `e2e/shots/${label}-${device}-after-login.png`, fullPage: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  for (const [name, path, must] of shots) {
    const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    const status = resp?.status() ?? 0
    const bodyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    const text = await page.locator('body').innerText()
    await page.screenshot({ path: `e2e/shots/${label}-${device}-${name}.png`, fullPage: true })
    const line = `${label}/${device}/${name} status=${status} h-overflow=${bodyOverflow}px`
    if (status !== 200) failures.push(line + ' NON-200')
    if (bodyOverflow > 0) failures.push(line + ' HORIZONTAL OVERFLOW')
    if (/₦0\.00|NaN|undefined/.test(text)) failures.push(line + ' SUSPECT ZERO/NaN IN OUTPUT')
    if (/Log in/.test(text)) failures.push(line + ' REDIRECTED TO LOGIN')
    for (const m of must) {
      if (!text.includes(m)) failures.push(`${line} MISSING EXPECTED TEXT: ${JSON.stringify(m)}`)
    }
    console.log(line)
  }
  if (errors.length) failures.push(`${device}: page errors ${errors.join('; ')}`)
  await ctx.close()
}

await browser.close()
if (failures.length) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exit(1) }
console.log('\nall shots ok')
