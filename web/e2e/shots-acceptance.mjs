/**
 * ACCEPTANCE SCREENSHOTS.
 *
 * Drives one owner's whole selling journey and photographs every screen at
 * 1280px and at 360px, so the owner can review the product as a product rather
 * than reading a description of it.
 *
 * It also measures, at each 360px screen, the things that are easy to claim and
 * hard to keep true: no sideways scroll, no clipped money, no tap target under
 * 44px, no overlapping navigation.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const A = { email: `accept-${stamp}@test.ng`, pass: 'correct-horse-battery' }
const DIR = 'e2e/shots/acceptance'
mkdirSync(DIR, { recursive: true })

const findings = []
const note = (where, ok, what) => {
  findings.push({ where, ok, what })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${where} — ${what}`)
}

const go = (p, path) =>
  p.goto(path.startsWith('http') ? path : BASE + path, { waitUntil: 'domcontentloaded' })
const submit = async (p, sel) => {
  await Promise.all([p.waitForLoadState('domcontentloaded'), p.click(sel)])
  await p.waitForLoadState('networkidle').catch(() => {})
  await p.waitForTimeout(500)
}
const press = async (scope, p, sel) => {
  await scope.locator(sel).click()
  await p.waitForLoadState('networkidle').catch(() => {})
  await p.waitForTimeout(700)
}
async function pick(scope, selector, needle) {
  const el = scope.locator(selector)
  const v = await el.evaluate((n, s) =>
    Array.from(n.options).find((o) => o.textContent.includes(s))?.value, needle)
  if (!v) throw new Error(`no option ${needle} in ${selector}`)
  await el.selectOption(v)
}
async function settled(p, path, needle, tries = 25) {
  for (let i = 0; i < tries; i++) {
    await go(p, path)
    if ((await p.locator('body').innerText()).includes(needle)) return
    await p.waitForTimeout(400)
  }
  throw new Error(`never settled: ${path}`)
}

/** Everything that is easy to claim and hard to keep true, measured. */
async function inspect(p, label) {
  const r = await p.evaluate(() => {
    const doc = document.documentElement
    const overflow = doc.scrollWidth - doc.clientWidth

    // Any element whose text is a naira amount and whose box cuts it off.
    const money = Array.from(document.querySelectorAll('*')).filter((el) =>
      el.children.length === 0 && /₦[\d,]+\.\d{2}/.test(el.textContent || ''))
    const clipped = money.filter((el) => {
      const s = getComputedStyle(el)
      if (s.overflow === 'visible' && s.textOverflow !== 'ellipsis') {
        return el.scrollWidth > el.clientWidth + 1 && s.whiteSpace === 'nowrap'
      }
      return el.scrollWidth > el.clientWidth + 1
    }).map((el) => el.textContent.trim())

    const smallestMoney = money.length
      ? Math.min(...money.map((el) => parseFloat(getComputedStyle(el).fontSize))) : null

    // Interactive things smaller than a fingertip.
    const targets = Array.from(document.querySelectorAll(
      'a, button, select, input:not([type=hidden]), summary'))
      .filter((el) => el.offsetParent !== null)
    const small = targets.filter((el) => {
      const b = el.getBoundingClientRect()
      return b.height > 0 && b.height < 44
    }).map((el) => `${el.tagName.toLowerCase()}"${(el.textContent||'').trim().slice(0,24)}"@${Math.round(el.getBoundingClientRect().height)}px`)

    // Navigation must not sit on top of content or run off the edge.
    const nav = document.querySelector('nav')
    const navCut = nav ? Array.from(nav.querySelectorAll('a'))
      .filter((a) => a.getBoundingClientRect().right > window.innerWidth + 1)
      .map((a) => a.textContent.trim()) : []

    // Words the owner should never have to read.
    const body = document.body.innerText
    const jargon = ['cost_snapshot_id','costed_revenue','allocation residual','provenance',
      'finalised_at','unit_cost_at_sale','order_discount','discount_amount','NULL',
      'COGS','snapshot','security_invoker','account_id','business_id','variant_id']
      .filter((w) => body.includes(w))

    const zeroNaira = body.includes('₦0.00')
    return { overflow, clipped, smallestMoney, small, navCut, jargon, zeroNaira }
  })

  note(label, r.overflow <= 0, `horizontal overflow ${r.overflow}px`)
  note(label, r.clipped.length === 0,
    r.clipped.length ? `clipped money: ${JSON.stringify(r.clipped)}` : 'no clipped naira amounts')
  if (r.smallestMoney !== null) {
    note(label, r.smallestMoney >= 13,
      `smallest naira amount renders at ${r.smallestMoney}px`)
  }
  note(label, r.small.length === 0,
    r.small.length ? `tap targets under 44px: ${JSON.stringify(r.small.slice(0, 6))}` : 'every tap target is at least 44px')
  note(label, r.navCut.length === 0,
    r.navCut.length ? `off-screen nav: ${JSON.stringify(r.navCut)}` : 'all nav destinations on screen')
  note(label, r.jargon.length === 0,
    r.jargon.length ? `internal terms on screen: ${JSON.stringify(r.jargon)}` : 'no internal terminology on screen')
  return r
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })

// ---------------------------------------------------------------- build data
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

await go(page, '/signup')
await page.fill('input[type=email]', A.email)
await page.fill('input[type=password]', A.pass)
await submit(page, 'button[type=submit]')
await settled(page, '/onboarding', 'Set up your business')
await go(page, '/onboarding')
const ins = page.locator('form input[type=text], form input:not([type])')
await ins.nth(0).fill('Adaeze Catering')
await ins.nth(1).fill('Adaeze Kitchen')
await submit(page, 'button[type=submit]')
await page.waitForTimeout(1800)

await go(page, '/ingredients')
await page.fill('input[name=name]', `Rice ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await submit(page, 'form button[type=submit]')
await page.locator(`a:has-text("Rice ${stamp}")`).first().click()
await page.waitForTimeout(700)
const buy = page.locator('form:has(input[name=amount])')
await buy.locator('input[name=qty]').fill('50')
await pick(buy, 'select[name=unit_id]', 'kg')
await buy.locator('input[name=amount]').fill('85000')
await press(buy, page, 'button[type=submit]')

await go(page, '/recipes')
await page.fill('input[name=name]', 'Party Jollof')
await page.fill('input[name=batch_yield_qty]', '4500')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '500')
await submit(page, 'form button[type=submit]')
await page.locator('summary:has-text("Add an ingredient")').first().click()
const al = page.locator('form:has(select[name=ingredient_id])')
await pick(al, 'select[name=ingredient_id]', `Rice ${stamp}`)
await al.locator('input[name=qty]').fill('4500')
await pick(al, 'select[name=unit_id]', 'g — Gram')
await press(al, page, 'button[type=submit]')

// a dish nobody has costed
await go(page, '/ingredients')
await page.fill('input[name=name]', `Unpriced spice ${stamp}`)
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await submit(page, 'form button[type=submit]')
await go(page, '/recipes')
await page.fill('input[name=name]', 'Mystery Stew')
await page.fill('input[name=batch_yield_qty]', '4000')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '400')
await submit(page, 'form button[type=submit]')
await page.locator('summary:has-text("Add an ingredient")').first().click()
const al2 = page.locator('form:has(select[name=ingredient_id])')
await pick(al2, 'select[name=ingredient_id]', `Unpriced spice ${stamp}`)
await al2.locator('input[name=qty]').fill('4000')
await pick(al2, 'select[name=unit_id]', 'g — Gram')
await press(al2, page, 'button[type=submit]')

// a customer
await go(page, '/customers')
await page.fill('input[name=name]', 'Mrs Adeyemi')
await page.fill('input[name=company]', 'Adeyemi Events')
await page.fill('input[name=notes]', 'No pepper for the children')
await submit(page, 'form button[type=submit]')

// a draft sale with a discount and an uncosted line
await go(page, '/sales')
const start = page.locator('form:has(select[name=customer_id])')
await pick(start, 'select[name=customer_id]', 'Mrs Adeyemi')
await start.locator('input[name=order_no]').fill('Saturday party')
await press(start, page, 'button[type=submit]')
const saleUrl = page.url().split('?')[0]
const add = page.locator('form:has(select[name=product])')
await pick(add, 'select[name=product]', 'Party Jollof')
await add.locator('input[name=qty]').fill('20')
await add.locator('input[name=unit_price]').fill('1500')
await add.locator('input[name=discount_amount]').fill('2000')
await press(add, page, 'button[type=submit]')
const add2 = page.locator('form:has(select[name=product])')
await pick(add2, 'select[name=product]', 'Mystery Stew')
await add2.locator('input[name=qty]').fill('5')
await add2.locator('input[name=unit_price]').fill('2000')
await press(add2, page, 'button[type=submit]')
const dsc = page.locator('form:has(input[name=order_discount])')
await dsc.locator('input[name=order_discount]').fill('5000')
await press(dsc, page, 'button[type=submit]')

// ------------------------------------------------------------------ capture
const SHOTS = [
  ['01-sales-empty-and-form', '/sales'],
  ['02-customers', '/customers'],
  ['03-order-draft', saleUrl],
]

async function shoot(p, tag, list) {
  for (const [name, path] of list) {
    await go(p, path)
    await p.waitForTimeout(400)
    await p.screenshot({ path: `${DIR}/${tag}-${name}.png`, fullPage: true })
    await inspect(p, `${tag} ${name}`)
  }
}

await shoot(page, 'desktop', SHOTS)

// confirm, then photograph the confirmed states
await go(page, saleUrl)
await press(page.locator('form:has(button:has-text("Confirm sale"))'), page, 'button[type=submit]')
await page.screenshot({ path: `${DIR}/desktop-04-order-confirmed.png`, fullPage: true })
await inspect(page, 'desktop 04-order-confirmed')

await shoot(page, 'desktop', [
  ['05-sales-list', '/sales'],
  ['06-reports', '/reports'],
  ['07-customer-detail-incomplete-cost', '/customers'],
])
await go(page, '/customers')
await page.locator('a:has-text("Mrs Adeyemi")').first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${DIR}/desktop-07-customer-detail.png`, fullPage: true })
await inspect(page, 'desktop 07-customer-detail')

// void and reissue
await go(page, saleUrl)
await page.locator('summary:has-text("Something is wrong")').first().click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${DIR}/desktop-08-void-form.png`, fullPage: true })
const vf = page.locator('form:has(input[name=reason])')
await vf.locator('input[name=reason]').fill('customer moved the event')
await press(vf, page, 'button[type=submit]')
await page.screenshot({ path: `${DIR}/desktop-09-voided.png`, fullPage: true })
await inspect(page, 'desktop 09-voided')
await press(page.locator('form:has(button:has-text("Start the replacement"))'), page, 'button[type=submit]')
await page.screenshot({ path: `${DIR}/desktop-10-reissued.png`, fullPage: true })
await inspect(page, 'desktop 10-reissued')
const reissueUrl = page.url().split('?')[0]

await go(page, '/dashboard')
await page.screenshot({ path: `${DIR}/desktop-11-dashboard.png`, fullPage: true })
await inspect(page, 'desktop 11-dashboard')

// ------------------------------------------------------------------- 360 px
const ctxM = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true })
const pageM = await ctxM.newPage()
await go(pageM, '/login')
await pageM.fill('input[type=email]', A.email)
await pageM.fill('input[type=password]', A.pass)
await submit(pageM, 'button[type=submit]')
await settled(pageM, '/sales', 'Record a sale')

await shoot(pageM, 'mobile360', [
  ['01-sales-list', '/sales'],
  ['02-customers', '/customers'],
  ['03-order-voided', saleUrl],
  ['04-order-reissued-draft', reissueUrl],
  ['05-reports', '/reports'],
  ['06-dashboard', '/dashboard'],
])
await go(pageM, '/customers')
await pageM.locator('a:has-text("Mrs Adeyemi")').first().click()
await pageM.waitForTimeout(700)
await pageM.screenshot({ path: `${DIR}/mobile360-07-customer-detail.png`, fullPage: true })
await inspect(pageM, 'mobile360 07-customer-detail')

await browser.close()

const bad = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - bad.length}/${findings.length} checks clean`)
if (bad.length) {
  console.log('\nFINDINGS:')
  for (const f of bad) console.log(`  ${f.where}: ${f.what}`)
}
process.exit(0)
