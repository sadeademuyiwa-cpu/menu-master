/**
 * The receipt a customer receives and the date a sale is filed under. Either
 * one wrong is visible to someone outside the business, so both are pinned.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReceipt, buildQuote, whatsappNumber, whatsappLink, receiptMoney, receiptDate,
} from '../src/lib/receipt.ts'
import { money } from '../src/lib/format/index.ts'

test('a quote says it is a quote, how long it holds, and never a receipt', () => {
  const q = buildQuote({
    businessName: 'Adaeze Kitchen', date: '30 Aug 2026', customerName: 'Mrs Adeyemi',
    lines: [{ name: 'Party Jollof', qty: 20, unitPrice: 1500, gross: 30000 }],
    discount: 0, total: 30000, validDays: 7,
  })
  assert.match(q, /^\*Adaeze Kitchen\*\nQuote · 30 Aug 2026\nFor: Mrs Adeyemi/)
  assert.match(q, /20 × Party Jollof/)
  assert.match(q, /\*Total: ₦30,000\*/)
  assert.match(q, /Prices hold for 7 days\. Reply to confirm\./)
  assert.doesNotMatch(q, /Receipt|Thank you for your order/)
})
import { localToday, paidDay } from '../src/lib/dates.ts'

test('a day paid is a real day, not after today; empty is today', () => {
  const now = new Date('2026-10-18T12:00:00Z')
  assert.equal(paidDay('', now), '2026-10-18')
  assert.equal(paidDay(null, now), '2026-10-18')
  assert.equal(paidDay(' 2026-10-17 ', now), '2026-10-17')
  assert.equal(paidDay('2026-10-18', now), '2026-10-18')
  assert.equal(paidDay('2026-10-19', now), null, 'tomorrow has not happened')
  assert.equal(paidDay('2026-02-30', now), null, 'no such day')
  assert.equal(paidDay('0099-01-01', now), null, 'not a four-figure year')
  assert.equal(paidDay('18/10/2026', now), null)
  // Just after midnight in Lagos it is already the 19th there.
  assert.equal(paidDay('2026-10-19', new Date('2026-10-18T23:30:00Z')), '2026-10-19')
})

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
    businessName: 'Mama Put Kitchen', date: '2 Oct 2026', reference: 'Sat party',
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
  assert.match(text, /₦1,500 each = ₦3,000/)
  assert.match(text, /Discount: −₦200/)
  assert.match(text, /\*Total: ₦3,300\*/)
  // The brand's voice: no exclamation marks, even in thanks.
  assert.match(text, /Thank you for your order\.$/)
  assert.doesNotMatch(text, /!/)
})

test('no discount line when nothing was taken off', () => {
  const text = buildReceipt({
    businessName: 'B', date: '2 Oct 2026', reference: null, customerName: null,
    lines: [{ name: 'Puff-puff', qty: 10, unitPrice: 50, gross: 500 }], discount: 0, total: 500,
  })
  assert.doesNotMatch(text, /Discount/)
  assert.doesNotMatch(text, /Ref:|For:/)
})

test('receipts drop the .00 like the app (decision 4) but keep every kobo', () => {
  // Whole naira read as the app reads them: no .00, and -0 is never printed.
  for (const n of [0, 50, 850, 1500, 184500, 1.7, 0.1 + 0.2, 849.999, -0.004]) {
    assert.equal(receiptMoney(n), money(n), `for ${n}`)
  }
  // The app rounds ₦100 and up to whole naira on its screens; a receipt is a
  // record of what was paid, so it keeps the kobo.
  assert.equal(receiptMoney(218.75), '₦218.75')
  assert.equal(money(218.75), '₦219')
  assert.equal(receiptMoney(1234567.5), '₦1,234,567.50')
  assert.equal(receiptMoney(30000), '₦30,000')
})

test('kobo on a receipt are kept, not rounded away', () => {
  const text = buildReceipt({
    businessName: 'B', date: '2 Oct 2026', reference: null, customerName: null,
    lines: [{ name: 'Zobo', qty: 3, unitPrice: 333.33, gross: 999.99 }], discount: 0, total: 999.99,
  })
  assert.match(text, /₦333\.33 each = ₦999\.99/)
  assert.match(text, /\*Total: ₦999\.99\*/)
})

test('a part-paid sale tells the customer what they paid and what is left', () => {
  const base = {
    businessName: 'Kemi Cakes', date: '2 Oct 2026', reference: null, customerName: 'Tolu',
    lines: [{ name: '8-inch cake', qty: 1, unitPrice: 25000, gross: 25000 }], discount: 0, total: 25000,
  }
  const deposit = buildReceipt({ ...base, paid: 10000 })
  assert.match(deposit, /Paid so far: ₦10,000\n\*Still to pay: ₦15,000\*/)
  // Paid in full, not paid, or not said: no balance line at all.
  for (const paid of [25000, 0, null, undefined]) {
    assert.doesNotMatch(buildReceipt({ ...base, paid }), /Paid so far|Still to pay/, `for ${paid}`)
  }
})

test('a receipt is dated the way it is written on paper, never "Today"', () => {
  assert.equal(receiptDate('2026-10-02'), '2 Oct 2026')
  assert.equal(receiptDate('2026-01-31'), '31 Jan 2026')
  // Not a database date: passed through, not guessed at.
  assert.equal(receiptDate('Saturday'), 'Saturday')
})

import { orderLink, readCarried } from '../src/app/(app)/sales/new/carry.ts'

const JOLLOF = '11111111-1111-4111-8111-111111111111:'
const CAKE = '22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333'

test('Price per head carries its dishes into New sale without retyping', () => {
  const link = orderLink([{ key: JOLLOF, qty: 100 }, { key: CAKE, qty: 0.5 * 3 }, { key: JOLLOF, qty: 0 }])
  assert.equal(link, `/sales/new?add=${encodeURIComponent(`${JOLLOF}*100`)}&add=${encodeURIComponent(`${CAKE}*1.5`)}`)
  const back = readCarried(new URLSearchParams(link.split('?')[1]).getAll('add'), new Set([JOLLOF, CAKE]))
  assert.deepEqual(back, [{ key: JOLLOF, qty: 100 }, { key: CAKE, qty: 1.5 }])
  assert.equal(orderLink([]), '/sales/new')
})

test('a carried order only names dishes on the menu, never a price', () => {
  const known = new Set([JOLLOF])
  assert.deepEqual(readCarried(undefined, known), [])
  assert.deepEqual(readCarried(`${CAKE}*2`, known), [], 'not on this menu')
  assert.deepEqual(readCarried(`${JOLLOF}*`, known), [], 'a blank is not a quantity')
  assert.deepEqual(readCarried(`${JOLLOF}*0`, known), [])
  assert.deepEqual(readCarried(`${JOLLOF}*-3`, known), [])
  assert.deepEqual(readCarried(`${JOLLOF}*1e3`, known), [])
  assert.deepEqual(readCarried(`${JOLLOF}*2000000`, known), [])
  assert.deepEqual(readCarried(`${JOLLOF}*2*1500`, known), [], 'a price cannot ride along')
  // The same dish twice is added up; floats are kept to a thousandth.
  assert.deepEqual(readCarried([`${JOLLOF}*0.1`, `${JOLLOF}*0.2`], known), [{ key: JOLLOF, qty: 0.3 }])
})
