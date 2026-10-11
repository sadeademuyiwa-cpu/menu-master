/**
 * Dates and record numbers the way the owner says them. A raw `2026-10-11`
 * or `S-0012-R2` on a list is a code; these helpers are the only path a page
 * has to the screen, so their words are pinned here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDay, formatMoment } from '../src/lib/dates.ts'
import { saleLabel, purchaseReference } from '../src/lib/format/index.ts'

const noon = new Date('2026-10-11T12:00:00Z') // 13:00 in Lagos

test('a calendar day is said in words, never as ISO', () => {
  assert.equal(formatDay('2026-08-30', noon), '30 Aug 2026')
  assert.equal(formatDay('2026-01-05', noon), '5 Jan 2026')
})

test('today and yesterday are named, judged in Lagos', () => {
  assert.equal(formatDay('2026-10-11', noon), 'Today')
  assert.equal(formatDay('2026-10-10', noon), 'Yesterday')
  // 23:30 UTC on the 10th is already 00:30 on the 11th in Lagos.
  assert.equal(formatDay('2026-10-11', new Date('2026-10-10T23:30:00Z')), 'Today')
})

test('a timestamp is placed on its Lagos day', () => {
  // 23:30 UTC on the 9th is 00:30 on the 10th in Lagos: yesterday, not two days ago.
  assert.equal(formatDay('2026-10-09T23:30:00Z', noon), 'Yesterday')
})

test('nothing in, nothing out', () => {
  assert.equal(formatDay(null, noon), '')
  assert.equal(formatDay('', noon), '')
  assert.equal(formatDay('not a date', noon), '')
  assert.equal(formatMoment(null), '')
})

test('a moment carries its Lagos time and is never "Today"', () => {
  assert.equal(formatMoment('2026-10-11T12:05:00Z'), '11 Oct 2026, 13:05')
})

test('a replacement sale is described, not suffixed', () => {
  assert.equal(saleLabel('S-0012'), 'S-0012')
  assert.equal(saleLabel('S-0012-R'), 'S-0012 (replacement)')
  assert.equal(saleLabel('S-0012-R2'), 'S-0012 (replacement 2)')
  assert.equal(saleLabel(null), null)
})

test('the reversal marker never reaches the screen', () => {
  assert.equal(purchaseReference('INV-44 (reversal)'), 'INV-44')
  assert.equal(purchaseReference('(reversal)'), null)
  assert.equal(purchaseReference('INV-44'), 'INV-44')
  assert.equal(purchaseReference(null), null)
})
