/**
 * "Try a price" and "Use ₦1,450" do their sums on the phone. If they ever
 * disagreed with the database, the owner would be told one price on the
 * screen and see another on the dish page. So every case below was computed
 * by PostgreSQL 17 with v_price_check's own expressions
 * (migrations/0037_deterministic_snapshot.sql):
 *
 *   profit            round(p.price - x.cost_per_portion, 2)
 *   margin_pct        round(100.0 * (p.price - x.cost_per_portion) / p.price, 2)
 *                     when p.price > 0
 *   recommended_price ceil(x.cost_per_portion
 *                          / (1::numeric - target_margin / 100.0)
 *                          / price_rounding_to) * price_rounding_to
 *                     when the cost is known and target_margin < 100
 *
 * and the expected value is what that query returned, not what we think it
 * should be.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  keepAt, marginAt, suggestedPrice, canSeeCosts, canSetPrices, PRICE_ROLES,
  canSeeSellingPrices, MENU_PRICE_ROLES, recipeIdOrNull, priceReturnPath,
} from '../src/lib/pricing.ts'

test('the suggested price matches recommended_price, case by case', () => {
  // [cost, target %, rounding, what PostgreSQL returned]
  const cases: [number | string, number | string, number | string, number][] = [
    [600, 40, 50, 1000],             // exactly on a step
    [700, 30, 50, 1000],             // exactly on a step, where binary lands above it
    [175, 30, 50, 250],
    [1400, 30, 50, 2000],
    [870.125, 40, 50, 1500],
    [812.5, 40, 50, 1400],
    [0, 40, 50, 0],                  // a real zero cost suggests zero, as the view does
    [1, 0, 50, 50],
    [333.3333, 35.5, 1, 517],
    [450, -10, 50, 450],             // a negative target is legal in the column
    [1234.5678, 99.99, 0.01, 12345678],
    [999.9999, 65, 100, 2900],
    [480, 37.5, 25, 775],
  ]
  for (const [cost, target, r, sql] of cases) {
    assert.equal(suggestedPrice(cost, target, r), sql, `${cost} at ${target}% to ${r}`)
  }
})

test('the database sends numerics as strings, and they give the same answer', () => {
  assert.equal(suggestedPrice('600.0000', '40.00', '50.00'), 1000)
  assert.equal(suggestedPrice('870.1250', '40.00', '50.00'), 1500)
  assert.equal(keepAt('1450.00', '870.1250'), 579.88)
  assert.equal(marginAt('800.00', '701.2400'), 12.35)
})

test('binary arithmetic would get the boundary wrong; this does not', () => {
  // 700 / (1 - 0.3) is 1000 exactly, and PostgreSQL says ₦1,000. In binary it
  // is 1000.0000000000001, so the naive sum ceil()s a whole step up.
  const naive = Math.ceil(700 / (1 - 30 / 100) / 50) * 50
  assert.equal(naive, 1050, 'if this starts failing, the guard below is no longer proving anything')
  assert.equal(suggestedPrice(700, 30, 50), 1000)
})

test('what a price keeps matches profit, rounded as PostgreSQL rounds', () => {
  // [price, cost, profit from PostgreSQL]
  const cases: [number, number, number][] = [
    [1450, 870.125, 579.88],         // half a kobo rounds away from zero
    [800, 701.24, 98.76],
    [500, 565.005, -65.01],          // a loss rounds away from zero too
    [1000, 600, 400],
    [0, 120, -120],                  // the view computes profit at a price of 0
    [1200, 1200, 0],
    [1450, 870.115, 579.89],
    [2.5, 0.0001, 2.5],
  ]
  for (const [price, cost, sql] of cases) {
    assert.equal(keepAt(price, cost), sql, `${price} - ${cost}`)
  }
})

test('the margin matches margin_pct, and a free item has none', () => {
  // [price, cost, margin_pct from PostgreSQL]
  const cases: [number, number, number][] = [
    [1450, 870.125, 39.99],
    [800, 701.24, 12.35],            // 12.345 exactly: rounds up, not to 12.34
    [500, 565.005, -13],
    [1000, 600, 40],
    [1200, 1200, 0],
    [1450, 870.115, 39.99],
    [2.5, 0.0001, 100],
  ]
  for (const [price, cost, sql] of cases) {
    assert.equal(marginAt(price, cost), sql, `${price} over ${cost}`)
  }
  assert.equal(marginAt(0, 120), null)   // the view: only when p.price > 0
  assert.equal(marginAt(-5, 120), null)
})

test('a missing figure stays missing, never 0', () => {
  for (const absent of [null, undefined, '', '   ', 'abc', NaN, Infinity, -Infinity]) {
    assert.equal(keepAt(absent as never, 100), null, `price ${String(absent)}`)
    assert.equal(keepAt(1000, absent as never), null, `cost ${String(absent)}`)
    assert.equal(marginAt(absent as never, 100), null)
    assert.equal(marginAt(1000, absent as never), null)
    assert.equal(suggestedPrice(absent as never, 40, 50), null)
    assert.equal(suggestedPrice(600, absent as never, 50), null)
    assert.equal(suggestedPrice(600, 40, absent as never), null)
  }
})

test('no suggested price where the view gives none, or would fail', () => {
  assert.equal(suggestedPrice(600, 100, 50), null)   // target_margin < 100 is required
  assert.equal(suggestedPrice(600, 120, 50), null)
  assert.equal(suggestedPrice(600, 40, 0), null)     // the view would divide by zero
  assert.equal(suggestedPrice(600, 40, -50), null)
})

test('only the roles that may see costs are offered prices', () => {
  assert.deepEqual([...PRICE_ROLES], ['owner', 'manager', 'accountant'])
  for (const role of ['owner', 'manager', 'accountant']) {
    assert.equal(canSeeCosts(role), true, role)
    assert.equal(canSetPrices(role), true, role)
  }
  for (const role of ['sales', 'kitchen', '', null, undefined, 'Owner']) {
    assert.equal(canSeeCosts(role), false, String(role))
    assert.equal(canSetPrices(role), false, String(role))
  }
})

test('after 0064, sales sees what a dish sells for; kitchen still does not', () => {
  // fn_menu_prices: array['owner','manager','sales','accountant'] (0064).
  assert.deepEqual([...MENU_PRICE_ROLES], ['owner', 'manager', 'sales', 'accountant'])
  for (const role of ['owner', 'manager', 'sales', 'accountant']) {
    assert.equal(canSeeSellingPrices(role), true, role)
  }
  for (const role of ['kitchen', '', null, undefined, 'Sales']) {
    assert.equal(canSeeSellingPrices(role), false, String(role))
  }
  // Seeing a price is not seeing a cost, nor setting a price.
  assert.equal(canSeeCosts('sales'), false)
  assert.equal(canSetPrices('sales'), false)
})

const DISH = '1f164655-cff3-48ad-87a9-0a38c7cd48a3'

test('a dish id is read as the database prints it, or not at all', () => {
  assert.equal(recipeIdOrNull(DISH), DISH)
  assert.equal(recipeIdOrNull(` ${DISH.toUpperCase()} `), DISH)
  for (const bad of ['', 'abc', `${DISH}x`, `../${DISH}`, null, undefined, 42]) {
    assert.equal(recipeIdOrNull(bad), null, String(bad))
  }
})

test('after a new price, the owner lands back where she pressed the button', () => {
  assert.equal(priceReturnPath('/dashboard', DISH), '/dashboard')
  assert.equal(priceReturnPath('/recipes', DISH), '/recipes')
  assert.equal(priceReturnPath('/pricing', DISH), '/pricing')
  assert.equal(priceReturnPath('/sales/new', DISH), '/sales/new')
  assert.equal(priceReturnPath(`/recipes/${DISH}`, DISH), `/recipes/${DISH}`)
  // The dish page's own query survives; an old notice does not, the action adds the new one.
  assert.equal(priceReturnPath(`/recipes/${DISH}?view=pro&notice=Old`, DISH), `/recipes/${DISH}?view=pro`)
  assert.equal(priceReturnPath('/dashboard?notice=Selling%20price%20saved.', DISH), '/dashboard')
  assert.equal(priceReturnPath('/dashboard#top', DISH), '/dashboard')
})

test('a return address from a form never leaves the pages that show prices', () => {
  for (const bad of ['//evil.example', 'https://evil.example/dashboard', '/dashboard.evil',
                     '/dashboardx', '/\\evil.example', '/settings', '/recipes/new', '/recipes/abc',
                     `/recipes/${DISH}/edit`, 'dashboard', '', '   ', null, undefined, 7]) {
    assert.equal(priceReturnPath(bad, DISH), `/recipes/${DISH}`, String(bad))
  }
  // Whatever rides in the query is re-encoded, so nothing raw reaches the Location header.
  const sneaky = priceReturnPath('/dashboard?x=\n//evil.example&y=<b>', DISH)
  assert.ok(sneaky.startsWith('/dashboard?'), sneaky)
  assert.doesNotMatch(sneaky, /[\s<>]/)
})
