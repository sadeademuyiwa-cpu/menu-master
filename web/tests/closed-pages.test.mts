/**
 * After a trial ends, no screen offers a sale or a purchase it would only
 * refuse (D3). The decision is the database's (fn_my_entitlement_status, via
 * recordingOpen / closedLine in lib/data/context.ts); these check that each
 * screen asks it, so an order or a market run is never typed in only to be
 * refused at the last button. Only an explicit "closed" hides anything; a
 * lookup that fails keeps today's screen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(import.meta.dirname, '..', rel), 'utf8')

test('New sale sends a closed account back to Sales with the reason, as New purchase does', () => {
  for (const [rel, back, what] of [
    ['src/app/(app)/sales/new/page.tsx', '/sales', 'new sales can’t be recorded'],
    ['src/app/(app)/purchases/new/page.tsx', '/purchases', 'new purchases can’t be recorded'],
  ]) {
    const src = read(rel)
    assert.match(src, new RegExp(`closedLine\\(ctx\\.role, '${what}'\\)`), rel)
    assert.match(src, new RegExp(`if \\(paused\\) redirect\\(withNotice\\('${back}', paused\\)\\)`), rel)
  }
})

test('Sales and Purchases swap their New button for the reason', () => {
  const sales = read('src/app/(app)/sales/page.tsx')
  assert.match(sales, /const records = seller && open !== false/)
  assert.match(sales, /\{paused && !notice && <Notice tone="warn">\{paused\}<\/Notice>\}/)
  const buys = read('src/app/(app)/purchases/page.tsx')
  assert.match(buys, /const canRecord = canRecordPurchases\(ctx\.role\) && open !== false/)
})

test("an item's quick Record purchase gives way to the reason", () => {
  const src = read('src/app/(app)/ingredients/[id]/page.tsx')
  assert.match(src, /const buyPaused = canBuy \? await closedLine\(ctx\.role, 'new purchases can’t be recorded'\) : null/)
  assert.match(src, /\{buyPaused \? \(\s*<Notice tone="warn">\{buyPaused\}<\/Notice>\s*\) : \(\s*<>\s*<form action=\{addPrice\}/)
})

test('Home and the phone "+" offer no sale or purchase once closed', () => {
  const home = read('src/app/(app)/dashboard/page.tsx')
  assert.match(home, /const sellsNow = sells && open !== false/)
  assert.match(home, /const buysNow = buys && open !== false/)
  assert.match(home, /\{sellsNow && \(\s*<Link href="\/sales\/new"/)
  assert.match(home, /\{buysNow && \(\s*<Link href="\/purchases\/new"/)
  assert.match(read('src/components/quick-add.tsx'), /quickActions\(member\.role, salesPlan, open\)/)
})

test('a sale nobody can cancel does not tell sales staff to ask for it to be cancelled', () => {
  const src = read('src/app/(app)/sales/[id]/page.tsx')
  assert.match(src, /!removerRole && open !== false && salesPlan !== false && \(\s*<p[^>]*>If something is wrong with this sale, ask the owner or a manager to cancel it\./)
})
