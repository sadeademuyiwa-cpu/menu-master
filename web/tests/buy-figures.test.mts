import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sumMoney, weekStart, lastWeeks, monthStart, spendByWeek, groupByDay,
  priceTrend, sinceWords, trendWords, perBuyingUnit, nameList,
} from '../src/app/(app)/purchases/buy-figures.ts'

test('money adds in kobo and nothing is not zero', () => {
  assert.equal(sumMoney(['0.10', '0.20']), 0.3)
  assert.equal(sumMoney(['85000.00', 600]), 85600)
  assert.equal(sumMoney([]), null)
  assert.equal(sumMoney([null, undefined, '']), null)
  assert.equal(sumMoney(['0']), 0)
})

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-10-17'), '2026-10-12') // Saturday
  assert.equal(weekStart('2026-10-12'), '2026-10-12') // Monday
  assert.equal(weekStart('2026-10-18'), '2026-10-12') // Sunday
  assert.deepEqual(lastWeeks('2026-10-17', 3), ['2026-09-28', '2026-10-05', '2026-10-12'])
  assert.equal(monthStart('2026-10-17'), '2026-10-01')
})

test('a week with nothing recorded is a gap', () => {
  const s = spendByWeek([
    { date: '2026-10-13', amount: '100.50' },
    { date: '2026-10-14', amount: '200' },
    { date: '2026-09-29', amount: '50' },
    { date: '2026-08-01', amount: '999' },
  ], '2026-10-17', 3)
  assert.deepEqual(s, [50, null, 300.5])
})

test('days group in order', () => {
  const g = groupByDay([{ purchase_date: 'b' }, { purchase_date: 'b' }, { purchase_date: 'a' }])
  assert.deepEqual(g.map((x) => [x.day, x.rows.length]), [['b', 2], ['a', 1]])
})

test('a trend needs three known prices', () => {
  assert.equal(priceTrend([{ day: 'a', price: 1 }, { day: 'b', price: 2 }]), null)
  assert.equal(priceTrend([{ day: 'a', price: 1 }, { day: 'b', price: null }, { day: 'c', price: 2 }]), null)
  const t = priceTrend([{ day: '2026-09-02', price: 1.7 }, { day: 'b', price: 1.8 }, { day: 'c', price: 1.836 }])
  assert.equal(t?.since, '2026-09-02')
  assert.ok(Math.abs((t?.change ?? 0) - 8) < 1e-9)
  assert.equal(priceTrend([{ day: 'a', price: 0 }, { day: 'b', price: 1 }, { day: 'c', price: 2 }]), null)
})

test('since words', () => {
  assert.equal(sinceWords('2026-10-04', '2026-10-17'), '4 Oct')
  assert.equal(sinceWords('2026-09-02', '2026-10-17'), 'September')
  assert.equal(sinceWords('2025-09-02', '2026-10-17'), 'September 2025')
})

test('trend words', () => {
  const p = (n: number) => `${n.toFixed(0)}%`
  assert.equal(trendWords(8, p), 'up 8%')
  assert.equal(trendWords(-5.2, p), 'down 5%')
  assert.equal(trendWords(0.3, p), 'steady')
})

test('per buying unit', () => {
  assert.deepEqual(perBuyingUnit(1.7, 'g'), { value: 1700, per: 'per kg' })
  assert.deepEqual(perBuyingUnit(2.4, 'ml'), { value: 2400, per: 'per litre' })
  assert.deepEqual(perBuyingUnit(80, 'unit'), { value: 80, per: 'each' })
})

test('name lists', () => {
  assert.equal(nameList(['Rice']), 'Rice')
  assert.equal(nameList(['Rice', 'Tomato']), 'Rice and Tomato')
  assert.equal(nameList(['Rice', 'Tomato', 'Pepper']), 'Rice, Tomato and Pepper')
  assert.equal(nameList(['Rice', 'Tomato', 'Pepper', 'Onion', 'Oil', 'Rice']), 'Rice, Tomato, Pepper and 2 more')
  assert.equal(nameList([]), '')
})
