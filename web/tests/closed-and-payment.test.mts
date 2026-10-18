/**
 * The two decisions the trial gate's app side makes on its own
 * (src/lib/data/write-notice.ts), tested without a server:
 *
 *   closedText      before recording, cancelling or correcting a purchase, or
 *                   confirming, cancelling or re-issuing a sale: refuse only
 *                   on an explicit "closed" (or, for a Sales record, an
 *                   explicit "no Sales"); not known goes ahead.
 *   paymentAnswer   what Save payment says when fn_record_order_payment
 *                   (0066) answers: its own MMPAY sentence as written, the
 *                   role sentence for 42501 -- never the subscription one,
 *                   because the subscription never stops a payment (D2) --
 *                   and the old direct write before 0066 exists.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asksAboutSales, closedText, describeWriteError, paymentAnswer, paymentProblem,
  PAYMENT_NOT_SAVED, PAYMENT_ROLE_REFUSED, PAYMENT_STATUSES,
  type AccessVerdict,
} from '../src/lib/data/write-notice.ts'

// 23:59:59 Lagos time on 17 October 2026 (Lagos is UTC+1, no daylight saving).
const END = '2026-10-17T22:59:59Z'
const ended = (reason: string): AccessVerdict => ({ entitled: false, status: 'trialing', boundary: END, reason })
const LIVE: AccessVerdict = { entitled: true, status: 'active', boundary: '2026-11-01T22:59:59Z', reason: 'active' }

// ---------------------------------------------------------------------------
// closedText
// ---------------------------------------------------------------------------

test('a closed account refuses, with the reason and for the role', () => {
  assert.match(closedText(ended('trial_ended'), true, 'owner') ?? '',
    /^Nothing was changed\. Your free trial ended on 17 October 2026\. Choose a plan on Plans & billing/)
  assert.match(closedText(ended('trial_ended'), null, 'sales', { sales: true }) ?? '', /Ask the owner to choose a plan\./)
  assert.match(closedText(ended('payment_failed'), true, 'owner', { sales: true }) ?? '', /Update your card on Plans & billing/)
  // Closed is the reason even on a plan without Sales.
  assert.match(closedText(ended('trial_ended'), false, 'owner', { sales: true }) ?? '', /free trial ended/)
})

test('a live account without Sales refuses a Sales record only', () => {
  assert.match(closedText(LIVE, false, 'owner', { sales: true }) ?? '', /does not include Sales\. Choose Costing \+ Sales/)
  assert.match(closedText(LIVE, false, 'sales', { sales: true }) ?? '', /Ask the owner about Costing \+ Sales/)
  assert.equal(closedText(LIVE, false, 'owner'), null, 'a purchase is not a Sales record')
})

test('not known goes ahead: only an explicit false refuses', () => {
  assert.equal(closedText(LIVE, true, 'owner', { sales: true }), null)
  assert.equal(closedText(LIVE, null, 'owner', { sales: true }), null)
  assert.equal(closedText(null, null, 'owner', { sales: true }), null)
  assert.equal(closedText(undefined, undefined, 'owner'), null)
  // The verdict not known but the plan known to lack Sales still says so.
  assert.match(closedText(null, false, 'owner', { sales: true }) ?? '', /does not include Sales/)
})

test('Sales is asked about only when it could be the reason', () => {
  assert.equal(asksAboutSales(LIVE, { sales: true }), true)
  assert.equal(asksAboutSales(null, { sales: true }), true)
  assert.equal(asksAboutSales(ended('trial_ended'), { sales: true }), false)
  assert.equal(asksAboutSales(LIVE, {}), false)
  assert.equal(asksAboutSales(LIVE), false)
})

// ---------------------------------------------------------------------------
// paymentProblem: markPaid's own check, before the database is asked
// ---------------------------------------------------------------------------

test('zero or more, and one of the three states', () => {
  assert.equal(paymentProblem(0, 'unpaid'), null)
  assert.equal(paymentProblem(1500, 'part_paid'), null)
  assert.equal(paymentProblem(2000, 'paid'), null)
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.match(paymentProblem(bad, 'paid') ?? '', /cannot be negative/, String(bad))
  }
  for (const bad of ['refunded', '', 'PAID']) {
    assert.match(paymentProblem(10, bad) ?? '', /not paid, part paid or paid in full/, bad)
  }
  assert.deepEqual([...PAYMENT_STATUSES], ['unpaid', 'part_paid', 'paid'])
})

// ---------------------------------------------------------------------------
// paymentAnswer
// ---------------------------------------------------------------------------

test('a payment that went through is saved', () => {
  assert.deepEqual(paymentAnswer(null), { kind: 'saved' })
})

test('before 0066 the function is not there, and the payment is written the old way', () => {
  assert.deepEqual(paymentAnswer({ code: 'PGRST202', message: 'Could not find the function public.fn_record_order_payment' }),
    { kind: 'not_there' })
  assert.deepEqual(paymentAnswer({ code: '42883', message: 'function fn_record_order_payment(uuid, numeric, text) does not exist' }),
    { kind: 'not_there' })
})

test("the function's own refusals (MMPAY) are shown exactly as written", () => {
  // fn_record_order_payment's sentences in 0066 (mm-wt/db-gate), raised with
  // SQLSTATE MMPAY under integration decision X5.
  for (const said of [
    'This sale was cancelled, so no payment can be recorded on it.',
    'This sale is still a draft. A payment can be recorded once it is confirmed.',
    'The amount paid must be zero or more.',
    'That amount is too large to record. Check the figure and try again.',
    'Say whether the sale is not paid, part paid or paid in full.',
    'This sale could not be found. It may have been removed.',
  ]) {
    assert.deepEqual(paymentAnswer({ code: 'MMPAY', message: said }), { kind: 'refused', notice: said })
    // ...and anywhere else describeWriteError meets one, it passes it through too.
    assert.equal(describeWriteError({ code: 'MMPAY', message: said }), said)
  }
  assert.deepEqual(paymentAnswer({ code: 'MMPAY', message: '  ' }), { kind: 'refused', notice: PAYMENT_NOT_SAVED })
  assert.equal(describeWriteError({ code: 'MMPAY' }), PAYMENT_NOT_SAVED)
})

test('a role that takes no money is told so, never that the subscription stopped it (D2)', () => {
  assert.equal(PAYMENT_ROLE_REFUSED, 'Your role can’t record payments. Ask the owner or a manager.')
  assert.deepEqual(paymentAnswer({ code: '42501', message: 'Your role does not permit recording payments' }),
    { kind: 'refused', notice: PAYMENT_ROLE_REFUSED })
  // Someone who is not on the account at all gets the same, and no SQL.
  assert.deepEqual(paymentAnswer({ code: '42501', message: 'Not authorized for this account' }),
    { kind: 'refused', notice: PAYMENT_ROLE_REFUSED })
  // What describeWriteError says for a 42501 elsewhere is not what a payment says.
  assert.match(describeWriteError({ code: '42501' }) ?? '', /subscription/)
  assert.doesNotMatch(PAYMENT_ROLE_REFUSED, /subscription|plan|trial/i)
})

test('anything else: English passes, the database talking to itself does not', () => {
  // The first 0066 draft raised check_violation. Its sentences still read as
  // English and are shown -- never "Quantities and amounts must be greater
  // than zero", which is wrong for a payment, where zero is allowed.
  const said = 'This sale was cancelled, so no payment can be recorded on it.'
  assert.deepEqual(paymentAnswer({ code: '23514', message: said }), { kind: 'refused', notice: said })
  assert.match(describeWriteError({ code: '23514', message: said }) ?? '', /greater than zero/, 'why paymentAnswer exists')
  for (const raw of [
    'new row for relation "orders" violates check constraint "orders_amount_paid_check"',
    'new row violates row-level security policy for table "orders"',
    'permission denied for function fn_record_order_payment',
    'TypeError: fetch failed',
    'JWT expired',
  ]) {
    assert.deepEqual(paymentAnswer({ code: '23514', message: raw }), { kind: 'refused', notice: PAYMENT_NOT_SAVED }, raw)
  }
  assert.deepEqual(paymentAnswer({}), { kind: 'refused', notice: PAYMENT_NOT_SAVED })
  // The trial gate's own words, should a gate ever be put on payments.
  const gate = 'Your free trial has ended, so nothing new can be saved. Choose a plan on Plans & billing to carry on.'
  assert.deepEqual(paymentAnswer({ code: 'MMENT', message: gate }), { kind: 'refused', notice: gate })
})

test('no payment refusal names an amount of money', () => {
  for (const notice of [PAYMENT_ROLE_REFUSED, PAYMENT_NOT_SAVED, paymentProblem(-5, 'paid'), paymentProblem(5, 'x')]) {
    assert.doesNotMatch(notice ?? '', /₦|\bNGN\b|\d/)
  }
})

test('Save payment is wired to these: its own check, the function, its answer, and the old write before 0066', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const src = readFileSync(join(import.meta.dirname, '..', 'src/app/(app)/sales/[id]/page.tsx'), 'utf8')
  const body = src.slice(src.indexOf('async function markPaid('), src.indexOf('async function voidSale('))
  assert.match(body, /paymentProblem\(paid, status\)/)
  assert.match(body, /rpc\('fn_record_order_payment', \{\s*p_order_id: id, p_amount_paid: paid, p_payment_status: status,\s*\}\)/)
  assert.match(body, /const answer = paymentAnswer\(error\)/)
  assert.match(body, /answer\.kind === 'not_there'[\s\S]*\.update\(\{ amount_paid: paid, payment_status: status \}\)/)
  assert.match(body, /answer\.kind === 'refused' \? answer\.notice : 'Payment updated\.'/)
  // Never behind the trial gate (D2).
  assert.doesNotMatch(body, /closedRefusal|recordingOpen|hasSalesEntitlement/)
  assert.doesNotMatch(body, /describeWriteError\(error\)/, 'the function’s refusal is never put through the generic translator')
})
