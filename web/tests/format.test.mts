/**
 * Money and percentages, the way an owner says them: ₦850 and 15%, not
 * ₦850.00 and 15.00%. From ₦100 up money is whole naira; below it kobo still
 * show when there are kobo. A missing figure still says so -- it never reads
 * ₦0 or 0%.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  money, moneyExact, percent, targetPercent, marginPercent, NOT_ENTERED, NOT_AVAILABLE,
} from '../src/lib/format/index.ts'

test('whole naira show no decimals', () => {
  assert.equal(money(850), '₦850')
  assert.equal(money(184500), '₦184,500')
  assert.equal(money(1000000), '₦1,000,000')
  assert.equal(money('1450.00'), '₦1,450')   // a numeric as PostgREST sends it
  assert.equal(money(0), '₦0')               // a real zero is a real figure
})

test('from ₦100 up, whole naira: the kobo are noise on a plate', () => {
  assert.equal(money(212.93), '₦213')
  assert.equal(money(218.5), '₦219')         // a half rounds away from zero
  assert.equal(money('1450.50'), '₦1,451')
  assert.equal(money(77830.4), '₦77,830')
  assert.equal(money(849.994), '₦850')
  assert.equal(money(99.995), '₦100')        // the edge rounds up into whole naira
})

test('below ₦100, kobo show as two digits when there are kobo', () => {
  assert.equal(money(1.7), '₦1.70')          // a price per gram
  assert.equal(money(8.4), '₦8.40')
  assert.equal(money(99.99), '₦99.99')
  assert.equal(money(0.1 + 0.2), '₦0.30')
  assert.equal(money(40), '₦40')
})

test('a small amount is judged to the kobo before deciding', () => {
  assert.equal(money(-0.004), '₦0')          // never "-₦0"
  assert.equal(money(0.004), '₦0')
})

test('a loss keeps its sign and rounds like a gain', () => {
  assert.equal(money(-200), '-₦200')
  assert.equal(money(-1450.5), '-₦1,451')
  assert.equal(money(-212.93), '-₦213')
  assert.equal(money(-1.5), '-₦1.50')
})

test('a missing amount says so, never ₦0', () => {
  for (const absent of [null, undefined, '', 'abc', NaN, Infinity]) {
    assert.equal(money(absent as never), NOT_ENTERED, String(absent))
  }
  assert.equal(money(null, 'not known yet'), 'not known yet')
})

test('moneyExact always shows kobo, for tables that must line up', () => {
  assert.equal(moneyExact(850), '₦850.00')
  assert.equal(moneyExact(218.75), '₦218.75')
  assert.equal(moneyExact('1450'), '₦1,450.00')
  assert.equal(moneyExact(-0.004), '₦0.00')
  assert.equal(moneyExact(null), NOT_ENTERED)
  assert.equal(moneyExact(undefined, 'not known yet'), 'not known yet')
})

test('percentages are whole numbers', () => {
  assert.equal(percent(15), '15%')
  assert.equal(percent(-13), '-13%')
  assert.equal(percent('39.99'), '40%')
  assert.equal(percent(100), '100%')
  assert.equal(percent(0), '0%')
  assert.equal(percent(1), '1%')
})

test('a half rounds away from zero, as PostgreSQL rounds', () => {
  assert.equal(percent(12.5), '13%')
  assert.equal(percent(-12.5), '-13%')
  assert.equal(percent(2.5), '3%')
})

test('below 1%, one decimal, so a small margin is not called zero', () => {
  assert.equal(percent(0.4), '0.4%')
  assert.equal(percent(-0.4), '-0.4%')
  assert.equal(percent(0.45), '0.5%')
  assert.equal(percent(0.04), '0%')          // rounds to nothing: no "0.0%", no "-0%"
  assert.equal(percent(-0.04), '0%')
  assert.equal(percent(0.96), '1%')          // rounds to a whole number: no "1.0%"
  assert.equal(percent(-0.96), '-1%')
})

test('a missing percentage says so, never 0%', () => {
  for (const absent of [null, undefined, '', 'abc', NaN, -Infinity]) {
    assert.equal(percent(absent as never), NOT_AVAILABLE, String(absent))
  }
})

test('her own target prints as she set it, never rounded', () => {
  assert.equal(targetPercent(40), '40%')
  assert.equal(targetPercent(37.5), '37.5%')
  assert.equal(targetPercent('37.50'), '37.5%')   // numeric(5,2) as PostgREST sends it
  assert.equal(targetPercent('40.00'), '40%')
  assert.equal(targetPercent(12.25), '12.25%')
  assert.equal(targetPercent(null), NOT_AVAILABLE)
})

test('a margin just under the target never reads as the target', () => {
  assert.equal(marginPercent(39.6, 40), '39.6%')
  assert.equal(marginPercent(39.96, 40), '39.9%')   // cut down, never "40.0%"
  assert.equal(marginPercent(39.5, 40), '39.5%')
  assert.equal(marginPercent(37.6, 38), '37.6%')
  assert.equal(marginPercent(37.6, '37.70'), '37.6%') // would round past a 37.7 target
  assert.equal(marginPercent('39.70', '40.00'), '39.7%') // numerics as PostgREST sends them
  assert.equal(marginPercent((2500 - 1500.0001) / 2500 * 100, 40), '39.9%') // a margin worked out on the phone
  assert.equal(marginPercent(0.96, 1), '0.9%')
})

test('a margin just over the target never reads as the target', () => {
  assert.equal(marginPercent(40.04, 40), '40.1%')
  assert.equal(marginPercent(37.6, 37.5), '38%')    // already reads as over
})

test('away from the target a margin is a whole number, as percent()', () => {
  assert.equal(marginPercent(45.2, 40), '45%')
  assert.equal(marginPercent(35.4, 40), '35%')
  assert.equal(marginPercent(-12.5, 40), '-13%')
  assert.equal(marginPercent(40, 40), '40%')
  assert.equal(marginPercent(37.5, 37.5), '37.5%')  // exactly the target prints as the target
  assert.equal(marginPercent(39.6, null), '40%')    // no target: nothing to be confused with
})

test('a missing margin says so, target or not', () => {
  assert.equal(marginPercent(null, 40), NOT_AVAILABLE)
  assert.equal(marginPercent(undefined, 40, 'not known yet'), 'not known yet')
})
