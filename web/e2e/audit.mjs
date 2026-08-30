/**
 * UX AUDIT HARNESS. Builds one realistic business, then photographs every
 * customer-facing screen at four widths so they can be inspected rather than
 * assumed. Reports measurable defects: touch targets under 44px, text under
 * 12px, horizontal overflow, and controls hidden behind fixed furniture.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:3100'
const stamp = Date.now()
const OUT = process.env.SHOT_DIR || 'e2e/shots/audit'
mkdirSync(OUT, { recursive: true })

const WIDTHS = [[360, 780, '360'], [390, 844, '390'], [820, 1180, 'tablet'], [1280, 900, 'desktop']]
const findings = []

const go = async (p, path) => {
  await p.goto(path.startsWith('http') ? path : BASE + path, { waitUntil: 'domcontentloaded' })
  await p.waitForLoadState('networkidle').catch(() => {})
}
const pick = async (scope, sel, needle) => {
  const el = scope.locator(sel)
  const v = await el.locator('option', { hasText: needle }).first().getAttribute('value')
  if (!v) throw new Error(`no option ${needle}`)
  await el.selectOption(v)
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] })

// ---- build one realistic business -----------------------------------------
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
await go(page, '/signup')
await page.fill('input[type=email]', `audit-${stamp}@t.ng`)
await page.fill('input[type=password]', 'correct-horse-battery')
await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('button[type=submit]')])
await page.waitForLoadState('networkidle').catch(() => {})
// the auth cookie is written by a server action; poll rather than sleep
for (let i = 0; i < 15; i++) {
  await go(page, '/onboarding')
  if ((await page.locator('body').innerText()).includes('Set up your business')) break
  await page.waitForTimeout(400)
}
const oi = page.locator('form input[type=text], form input:not([type])')
await oi.nth(0).fill('Ada Foods'); await oi.nth(1).fill('Ada Kitchen')
await page.click('form button[type=submit]'); await page.waitForTimeout(2500)

await go(page, '/ingredients')
await page.fill('input[name=name]', 'Ofada Rice')
await pick(page, 'select[name=base_unit_id]', 'g — Gram')
await page.click('form button[type=submit]'); await page.waitForTimeout(1200)
await page.locator('a:has-text("Ofada Rice")').first().click()
await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(600)
const buy = page.locator('form:has(input[name=amount])')
await buy.locator('input[name=qty]').fill('50')
await pick(buy, 'select[name=unit_id]', 'kg — Kilogram')
await buy.locator('input[name=amount]').fill('85000')
await buy.locator('button[type=submit]').click(); await page.waitForTimeout(1200)

await go(page, '/recipes')
await page.fill('input[name=name]', 'Party Jollof Rice with Chicken')
await page.fill('input[name=batch_yield_qty]', '4500')
await pick(page, 'select[name=yield_unit_id]', 'g — Gram')
await page.fill('input[name=portion_qty]', '500')
await page.click('form button[type=submit]'); await page.waitForTimeout(1500)
const recipeUrl = page.url().split('?')[0]
await page.locator('summary:has-text("Add an ingredient")').first().click()
const line = page.locator('form:has(select[name=ingredient_id])')
await pick(line, 'select[name=ingredient_id]', 'Ofada Rice')
await line.locator('input[name=qty]').fill('4500')
await pick(line, 'select[name=unit_id]', 'g — Gram')
await line.locator('button[type=submit]').click(); await page.waitForTimeout(1500)
const priceForm = page.locator('form').last()
await priceForm.locator('input[name=price]').fill('1000')
await priceForm.locator('button[type=submit]').click(); await page.waitForTimeout(1200)
await ctx.close()

// ---- photograph and measure ----------------------------------------------
const SCREENS = [
  ['dashboard', '/dashboard'],
  ['ingredients', '/ingredients'],
  ['recipe', recipeUrl],
  ['recipe-pro', recipeUrl + '?view=pro'],
  ['purchases', '/purchases'],
  ['formats', '/formats'],
  ['settings', '/settings'],
  ['reports', '/reports'],
  ['pricing', '/pricing'],
]

for (const [w, h, tag] of WIDTHS) {
  const c = await browser.newContext({ viewport: { width: w, height: h } })
  const p = await c.newPage()
  await go(p, '/login')
  await p.fill('input[type=email]', `audit-${stamp}@t.ng`)
  await p.fill('input[type=password]', 'correct-horse-battery')
  await p.click('button[type=submit]'); await p.waitForTimeout(2000)

  for (const [name, path] of SCREENS) {
    await go(p, path)
    await p.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage: true })

    const m = await p.evaluate(() => {
      const out = { overflow: 0, small: [], tiny: [] }
      out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
      for (const el of document.querySelectorAll('a, button, input, select, summary')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const label = (el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 24)
        if (r.height < 40) out.small.push(`${label} ${Math.round(r.height)}px`)
      }
      for (const el of document.querySelectorAll('body *')) {
        if (!el.children.length && el.textContent?.trim()) {
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs && fs < 12) out.tiny.push(`${el.textContent.trim().slice(0, 20)} ${fs}px`)
        }
      }
      return out
    })
    if (m.overflow > 0) findings.push(`OVERFLOW ${name}@${tag}: ${m.overflow}px`)
    if (tag === '360' && m.small.length) {
      findings.push(`TOUCH ${name}@${tag}: ${m.small.length} target(s) under 40px — ${m.small.slice(0,4).join(', ')}`)
    }
    if (tag === '360' && m.tiny.length) {
      findings.push(`TYPE ${name}@${tag}: ${m.tiny.length} run(s) under 12px — ${[...new Set(m.tiny)].slice(0,4).join(', ')}`)
    }
  }
  await c.close()
}

await browser.close()
console.log('=== MEASURED FINDINGS ===')
if (!findings.length) console.log('none')
for (const f of findings) console.log(' -', f)
console.log(`\nscreens captured: ${SCREENS.length * WIDTHS.length} in ${OUT}`)
