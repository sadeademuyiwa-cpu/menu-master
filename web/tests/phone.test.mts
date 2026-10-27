import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseNgMobile, formatNgMobile, localNgMobile, waLink } from '../src/lib/phone.ts'
import { normaliseWhatsapp } from '../src/lib/site/settings.ts'
import { whatsappNumber } from '../src/lib/receipt.ts'

test('every way an owner types a Nigerian mobile becomes one form', () => {
  for (const typed of ['0803 123 4567', '08031234567', '803 123 4567', '2348031234567', '+234 803 123 4567',
    '+234 (0) 803-123-4567', '+234 0803 123 4567', '002348031234567']) {
    assert.equal(normaliseNgMobile(typed), '2348031234567', typed)
  }
  assert.equal(normaliseNgMobile('0901 234 5678'), '2349012345678')
  assert.equal(normaliseNgMobile('0701 234 5678'), '2347012345678')
})

test('anything that is not a Nigerian mobile is no number at all', () => {
  for (const typed of ['', 'call me', '12345', '0713 123 4567', '+44 7700 900123', '0803 123 456', '0803 123 45678']) {
    assert.equal(normaliseNgMobile(typed), null, typed)
  }
  assert.equal(normaliseNgMobile(null), null)
  assert.equal(normaliseNgMobile(8031234567), null)
})

test('numbers read the way people read them, and fill a form box the way they typed them', () => {
  assert.equal(formatNgMobile('2348031234567'), '+234 803 123 4567')
  assert.equal(localNgMobile('2348031234567'), '0803 123 4567')
  assert.equal(localNgMobile(null), '')
  assert.equal(waLink('2348031234567', 'Hello Ada'), 'https://wa.me/2348031234567?text=Hello%20Ada')
})

test('"+234 0803…" no longer makes a 14-digit WhatsApp number anywhere', () => {
  assert.equal(normaliseWhatsapp('+234 0803 123 4567'), '2348031234567')
  assert.equal(normaliseWhatsapp('002348031234567'), '2348031234567')
  assert.equal(whatsappNumber('+234 0803 123 4567'), '2348031234567')
  assert.equal(whatsappNumber('+234 (0) 803 123 4567'), '2348031234567')
  // a customer abroad is still reachable on a receipt
  assert.equal(whatsappNumber('+44 7700 900123'), '447700900123')
})
