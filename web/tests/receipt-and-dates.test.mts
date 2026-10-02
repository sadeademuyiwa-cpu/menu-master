/**
 * The receipt a customer receives and the date a sale is filed under. Either
 * one wrong is visible to someone outside the business, so both are pinned.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReceipt, whatsappNumber, whatsappLink } from '../src/lib/receipt.ts'
import { localToday } from '../src/lib/dates.ts'

test('just after midnight in Lagos it is already the new day', () => {
  // 00:30 in Lagos on 2 October is 23:30 UTC on 1 October.
  assert.equal(localToday(new Date('2026-10-01T23:30:00Z')), '2026-10-02')
})

test('during the day Lagos and UTC agree on the date', () => {
  assert.equal(localToday(new Date('2026-10-02T12:00:00Z')), '2026-10-02')
})

test('local numbers become international ones', () => {
  assert.equal(whatsappNumber('08031234567'), '2348031234567')
  assert.equal(whatsappNumber('0803 123 4567'), '2348031234567')
  assert.equal(whatsappNumber('+234 803 123 4567'), '2348031234567')
  assert.equal(whatsappNumber('002348031234567'), '2348031234567')
  assert.equal(whatsappNumber('8031234567'), '2348031234567')
})

test('something that is not a phone number gets no recipient', () => {
  assert.equal(whatsappNumber(''), null)
  assert.equal(whatsappNumber(null), null)
  assert.equal(whatsappNumber('12345'), null)
  assert.equal(whatsappNumber('call me'), null)
})

test('the link carries the whole receipt, encoded', () => {
  assert.equal(whatsappLink('08031234567', 'Total: ₦1,500'),
    'https://wa.me/2348031234567?text=Total%3A%20%E2%82%A61%2C500')
  assert.equal(whatsappLink(null, 'hi'), 'https://wa.me/?text=hi')
})

test('a receipt lists every item and ends with what the customer pays', () => {
  const text = buildReceipt({
    businessName: 'Mama Put Kitchen', date: '2026-10-02', reference: 'Sat party',
    customerName: 'Ngozi',
    lines: [
      { name: 'Jollof rice', qty: 2, unitPrice: 1500, gross: 3000 },
      { name: 'Delivery', qty: 1, unitPrice: 500, gross: 500 },
    ],
    discount: 200, total: 3300,
  })
  assert.match(text, /\*Mama Put Kitchen\*/)
  assert.match(text, /Ref: Sat party/)
  assert.match(text, /For: Ngozi/)
  assert.match(text, /2 × Jollof rice/)
  assert.match(text, /₦1,500\.00 each = ₦3,000\.00/)
  assert.match(text, /Discount: −₦200\.00/)
  assert.match(text, /\*Total: ₦3,300\.00\*/)
})

test('no discount line when nothing was taken off', () => {
  const text = buildReceipt({
    businessName: 'B', date: '2026-10-02', reference: null, customerName: null,
    lines: [{ name: 'Puff-puff', qty: 10, unitPrice: 50, gross: 500 }], discount: 0, total: 500,
  })
  assert.doesNotMatch(text, /Discount/)
  assert.doesNotMatch(text, /Ref:|For:/)
})
