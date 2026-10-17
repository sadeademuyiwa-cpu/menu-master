import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as h from '../src/app/(app)/dashboard/home-data.ts'
import * as r from '../src/app/(app)/dashboard/roles.ts'

test('days and weekdays', () => {
  assert.equal(h.daysBefore('2026-10-17', 6), '2026-10-11')
  assert.equal(h.daysBefore('2026-03-01', 1), '2026-02-28')
  assert.equal(h.weekday('2026-10-17'), 'Sat')
})

test('a week with no sales has no total, not zero', () => {
  const w = h.sumDays([], '2026-10-11', '2026-10-17')
  assert.deepEqual(w, { sales: 0, sold: null, kept: null, partly: false })
})

test('sums, partial cost and unknown kept', () => {
  const days = [
    { sale_date: '2026-10-17', sale_count: 2, revenue: '1000.10', gross_profit: '400.20', revenue_without_cost: '0' },
    { sale_date: '2026-10-16', sale_count: 1, revenue: '500.20', gross_profit: null, revenue_without_cost: '500.20' },
    { sale_date: '2026-10-09', sale_count: 1, revenue: '900', gross_profit: '300' },
  ]
  const w = h.sumDays(days, '2026-10-11', '2026-10-17')
  assert.deepEqual(w, { sales: 3, sold: 1500.3, kept: 400.2, partly: true })
  const l = h.sumDays(days, '2026-10-04', '2026-10-10')
  assert.deepEqual(l, { sales: 1, sold: 900, kept: 300, partly: false })
  // sales role: no kept columns at all
  const s = h.sumDays([{ sale_date: '2026-10-17', sale_count: 1, revenue: '10' }], '2026-10-11', '2026-10-17')
  assert.equal(s.kept, null)
})

test('seven chart days, kept withheld for sales', () => {
  const days = [{ sale_date: '2026-10-17', sale_count: 2, revenue: '1000', gross_profit: '400' },
                { sale_date: '2026-10-15', sale_count: 1, revenue: '500', gross_profit: null }]
  const c = h.lastSevenDays(days, '2026-10-17', true)
  assert.equal(c.length, 7)
  assert.deepEqual(c[6], { label: 'Sat', sold: 1000, kept: 400 })
  assert.deepEqual(c[4], { label: 'Thu', sold: 500, kept: null })
  assert.deepEqual(c[0], { label: 'Sun', sold: null, kept: null })
  const s = h.lastSevenDays(days, '2026-10-17', false)
  assert.equal(s[6].kept, null)
})

test('trend', () => {
  assert.deepEqual(h.trend(112, 100), { dir: 'up', pct: 12 })
  assert.deepEqual(h.trend(92, 100), { dir: 'down', pct: 8 })
  assert.deepEqual(h.trend(100.3, 100), { dir: 'same', pct: 0 })
  assert.equal(h.trend(100, 0), null)
  assert.equal(h.trend(100, -50), null)
  assert.equal(h.trend(null, 100), null)
  assert.equal(h.trend(100, null), null)
})

const row = (o: Record<string, unknown> = {}): h.ProductRow => ({ recipe_id: 'a', variant_id: null, product_name: 'Jollof', format_name: null, profit: '100',
  recommended_price: '1450', target_margin: '40', state: 'healthy', attention_rank: 5, ...o })

test('needs: grouped per dish, worst first, channels deduped', () => {
  const rows = [
    row({ recipe_id: 'b', product_name: 'Egusi', variant_id: 'v1', format_name: 'Big', state: 'losing_money', attention_rank: 1 }),
    row({ recipe_id: 'b', product_name: 'Egusi', variant_id: 'v1', format_name: 'Big', state: 'losing_money', attention_rank: 1 }),
    row({ recipe_id: 'a', state: 'below_target', attention_rank: 2 }),
    row({ recipe_id: 'b', product_name: 'Egusi', variant_id: 'v2', format_name: 'Small', state: 'no_price_yet', attention_rank: 3 }),
    row({ recipe_id: 'c', product_name: 'Moi', state: 'costing_incomplete', attention_rank: 4 }),
    row({ recipe_id: 'd', product_name: 'Puff', state: 'healthy', attention_rank: 5 }),
  ]
  const g = h.needGroups(rows)
  assert.deepEqual(g.map((x) => [x.recipeId, x.rows.length]), [['b', 2], ['a', 1]])
})

test('grid order and figures', () => {
  const rows = h.byDish(h.uniqueRows([
    row({ recipe_id: 'a', state: 'below_target', attention_rank: 2, profit: '150' }),
    row({ recipe_id: 'b', state: 'losing_money', attention_rank: 1, profit: '-200' }),
  ]))
  const dishes = [{ id: 'z', name: 'Zobo', photo_path: null }, { id: 'a', name: 'Amala', photo_path: null }, { id: 'b', name: 'Beans', photo_path: null }]
  assert.deepEqual(h.orderDishes(dishes, rows).map((d) => d.id), ['b', 'a', 'z'])
  assert.deepEqual(h.keepFigure(rows.get('a') ?? []), { kind: 'keep', amount: 150 })
  assert.deepEqual(h.keepFigure(rows.get('b') ?? []), { kind: 'lose', amount: 200 })
  assert.deepEqual(h.keepFigure([]), { kind: 'no_cost' })
  assert.deepEqual(h.keepFigure([row({ state: 'no_price_yet', profit: null })]), { kind: 'no_price' })
  assert.deepEqual(h.keepFigure([row({ state: 'costing_incomplete', profit: null })]), { kind: 'no_cost' })
  assert.deepEqual(h.keepFigure([row({ variant_id: 'x' }), row({ variant_id: 'y' })]), { kind: 'sizes', count: 2 })
  assert.deepEqual(h.keepFigure([row({ profit: '0' })]), { kind: 'keep', amount: 0 })
  assert.equal(h.worstState([row({ attention_rank: 5 }), row({ state: 'below_target', attention_rank: 2 })]), 'below_target')
})

test('sales prices', () => {
  assert.deepEqual(h.priceFigure([]), { kind: 'none' })
  assert.deepEqual(h.priceFigure([{ recipe_id: 'a', variant_id: null, selling_price: null }]), { kind: 'none' })
  assert.deepEqual(h.priceFigure([{ recipe_id: 'a', variant_id: null, selling_price: '1450.00' }]), { kind: 'one', price: 1450 })
  assert.deepEqual(h.priceFigure([
    { recipe_id: 'a', variant_id: 'x', selling_price: '1800' },
    { recipe_id: 'a', variant_id: 'y', selling_price: '1200' },
    { recipe_id: 'a', variant_id: 'z', selling_price: null },
  ]), { kind: 'from', price: 1200 })
})

test('best sellers by units, all sizes together', () => {
  assert.deepEqual(h.bestSellers([
    { recipe_id: 'a', units_sold: '10' }, { recipe_id: 'b', units_sold: '8' }, { recipe_id: 'a', units_sold: '1' },
    { recipe_id: 'b', units_sold: '5' }, { recipe_id: null, units_sold: '99' }, { recipe_id: 'c', units_sold: '2' },
    { recipe_id: 'd', units_sold: '1' },
  ]), ['b', 'a', 'c'])
})
