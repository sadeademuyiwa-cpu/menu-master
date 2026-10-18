/**
 * What a save says when it did not save (src/lib/data/write-notice.ts).
 *
 * The bug these exist for: after a free trial ends, row-level security
 * refuses every edit and remove quietly -- no error, zero rows -- and about
 * twenty actions still said "Ingredient updated." or "Business details
 * saved.", some after re-costing every dish. The shared helper must:
 *   - let the database's own error win,
 *   - say the action's own success only when a row really changed,
 *   - otherwise say "Nothing was changed." with the real reason for this
 *     person, and look that reason up only then,
 *   - and pass 0066's trial-gate messages (SQLSTATE MMENT / MMSAL) through
 *     as the plain words they already are.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeWriteError, changedRows, wrote, lagosDay, knownVerdict, pauseReason, pauseRemedy,
  refusalText, pausedLine, refusalAfterWrite, NOT_CHANGED, NOT_CHANGED_LIVE,
  type AccessVerdict,
} from '../src/lib/data/write-notice.ts'

// 23:59:59 Lagos time on 17 October 2026 (Lagos is UTC+1, no daylight saving).
const END = '2026-10-17T22:59:59Z'
const ended = (reason: string, boundary: string | null = END): AccessVerdict =>
  ({ entitled: false, status: 'trialing', boundary, reason })
const LIVE: AccessVerdict = { entitled: true, status: 'trialing', boundary: '2026-11-01T22:59:59Z', reason: 'trial_active' }

// ---------------------------------------------------------------------------
// describeWriteError
// ---------------------------------------------------------------------------

test('no error, no words', () => {
  assert.equal(describeWriteError(null), null)
})

test("0066's trial gate is shown as it is, in its own words", () => {
  const said = 'Your free trial ended on 17 October 2026. Choose a plan to record new work again.'
  assert.equal(describeWriteError({ code: 'MMENT', message: said }), said)
  const sales = 'Your plan does not include Sales. Choose Costing + Sales to record sales.'
  assert.equal(describeWriteError({ code: 'MMSAL', message: sales }), sales)
})

test('a trial-gate code with no message still reads as English, never as SQL', () => {
  for (const code of ['MMENT', 'MMSAL']) {
    const text = describeWriteError({ code, message: '' }) ?? ''
    assert.match(text, /^Nothing was changed\./, code)
    assert.doesNotMatch(text, /MMENT|MMSAL|SQLSTATE|exception/i, code)
  }
  assert.match(describeWriteError({ code: 'MMSAL' }) ?? '', /does not include Sales/)
})

test('the trial gate is not mistaken for a row-level-security refusal', () => {
  // The generic 42501 sentence talks about "your subscription or your role";
  // MMENT's own sentence is more exact and must not be replaced by it.
  const said = 'This account has no plan at the moment. Ask the owner to choose a plan.'
  assert.equal(describeWriteError({ code: 'MMENT', message: said }), said)
})

test('the refusals it always translated still translate', () => {
  assert.match(describeWriteError({ code: '42501', message: 'new row violates row-level security policy' }) ?? '',
    /does not allow recording new work/)
  assert.match(describeWriteError({ message: 'new row violates row-level security policy for table "x"' }) ?? '',
    /does not allow recording new work/)
  assert.equal(describeWriteError({ code: '23505', message: 'duplicate key' }), 'That already exists. Give it a different name.')
  assert.match(describeWriteError({ code: '23503' }) ?? '', /no longer exists/)
  assert.match(describeWriteError({ code: '23514' }) ?? '', /greater than zero/)
  assert.equal(describeWriteError({ code: 'P0001', message: 'That sale is already confirmed.' }), 'That sale is already confirmed.')
  assert.equal(describeWriteError({}), 'Menu Master could not save that. Nothing was changed.')
})

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

test('changed rows are counted from what .select() handed back', () => {
  assert.equal(changedRows([]), 0)
  assert.equal(changedRows([{ id: 'a' }, { id: 'b' }]), 2)
  assert.equal(changedRows(null), 0)
  assert.equal(changedRows(undefined), 0)
  // .maybeSingle(): one object, or null when nothing matched.
  assert.equal(changedRows({ name: 'Jollof Rice' }), 1)
})

test('a write wrote only with no error AND a row back', () => {
  assert.equal(wrote(null, [{ id: 'a' }]), true)
  assert.equal(wrote(null, []), false)
  assert.equal(wrote(null, null), false)
  assert.equal(wrote({ code: '42501' }, [{ id: 'a' }]), false)
})

// ---------------------------------------------------------------------------
// the date, in Lagos
// ---------------------------------------------------------------------------

test('the end of a trial is named by its day in Lagos, whatever the server runs in', () => {
  assert.equal(lagosDay(END), '17 October 2026')
  // 23:30 UTC is already the next morning in Lagos.
  assert.equal(lagosDay('2026-10-17T23:30:00Z'), '18 October 2026')
  assert.equal(lagosDay('2026-10-17T22:59:59+00:00'), '17 October 2026')
  for (const bad of [null, undefined, '', 'soon']) assert.equal(lagosDay(bad as never), null, String(bad))
})

// ---------------------------------------------------------------------------
// the verdict
// ---------------------------------------------------------------------------

test('only a real verdict counts; anything else is "not known"', () => {
  for (const bad of [null, undefined, 8000, 'yes', {}, { entitled: 'false' }, { entitled: null }]) {
    assert.equal(knownVerdict(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(knownVerdict({ entitled: false, status: 'trialing', boundary: END, reason: 'trial_ended' }),
    { entitled: false, status: 'trialing', boundary: END, reason: 'trial_ended' })
  assert.deepEqual(knownVerdict({ entitled: true }), { entitled: true, status: null, boundary: null, reason: '' })
})

test('the reason recording is paused, for each way it can be', () => {
  assert.equal(pauseReason(ended('trial_ended')), 'Your free trial ended on 17 October 2026')
  assert.equal(pauseReason(ended('trial_ended', null)), 'Your free trial has ended')
  assert.equal(pauseReason(ended('payment_failed')), 'We could not take your last payment')
  assert.equal(pauseReason(ended('subscription_ended')), 'Your subscription has ended')
  assert.equal(pauseReason(ended('not_entitled')), 'This account has no plan at the moment')
  // Live, or not known: nothing is paused, and nothing is claimed.
  assert.equal(pauseReason(LIVE), null)
  assert.equal(pauseReason(null), null)
  assert.equal(pauseReason(undefined), null)
})

test('the owner acts on the plan; everyone else asks the owner', () => {
  assert.equal(pauseRemedy(ended('trial_ended'), 'owner'), 'Choose a plan on Plans & billing to carry on.')
  assert.equal(pauseRemedy(ended('payment_failed'), 'owner'), 'Update your card on Plans & billing to carry on.')
  for (const role of ['manager', 'kitchen', 'sales', 'accountant']) {
    assert.equal(pauseRemedy(ended('trial_ended'), role), 'Ask the owner to choose a plan.', role)
    assert.equal(pauseRemedy(ended('payment_failed'), role), 'Ask the owner to update the card on Plans & billing.', role)
  }
  // A role that is not known is never told to "ask the owner": it may be her.
  assert.doesNotMatch(pauseRemedy(ended('trial_ended'), undefined), /ask the owner/i)
  assert.doesNotMatch(pauseRemedy(ended('trial_ended'), null), /ask the owner/i)
})

// ---------------------------------------------------------------------------
// refusalText: what an edit that changed nothing says
// ---------------------------------------------------------------------------

test('after the trial, the owner is told what happened, when, and what to do', () => {
  const text = refusalText(ended('trial_ended'), 'owner')
  assert.equal(text, 'Nothing was changed. Your free trial ended on 17 October 2026. ' +
    'Choose a plan on Plans & billing to carry on. Everything you entered is still here.')
  assert.doesNotMatch(text, /ask the owner/i)
})

test('after the trial, staff are told the same and to ask the owner', () => {
  for (const role of ['manager', 'kitchen', 'sales', 'accountant']) {
    const text = refusalText(ended('trial_ended'), role)
    assert.match(text, /^Nothing was changed\. Your free trial ended on 17 October 2026\. Ask the owner to choose a plan\./, role)
    assert.match(text, /Everything you entered is still here\.$/, role)
  }
})

test('a failed payment and an ended subscription have their own words', () => {
  assert.match(refusalText(ended('payment_failed'), 'owner'), /We could not take your last payment\. Update your card/)
  assert.match(refusalText(ended('subscription_ended'), 'owner'), /Your subscription has ended\. Choose a plan/)
  assert.doesNotMatch(refusalText(ended('payment_failed'), 'owner'), /free trial/i)
  assert.doesNotMatch(refusalText(ended('subscription_ended'), 'owner'), /free trial/i)
})

test('a live account: not the plan, so the row or the role, and never the trial', () => {
  for (const role of ['owner', 'sales', undefined]) {
    const text = refusalText(LIVE, role)
    assert.equal(text, NOT_CHANGED_LIVE)
    assert.doesNotMatch(text, /trial|subscription|plan/i)
  }
})

test('a live account without Sales says so, for a Sales record only', () => {
  assert.equal(refusalText(LIVE, 'owner', { noSales: true }),
    'Nothing was changed. Your plan does not include Sales. Choose Costing + Sales on Plans & billing to record sales again.')
  assert.equal(refusalText(LIVE, 'sales', { noSales: true }),
    'Nothing was changed. Your plan does not include Sales. Ask the owner about Costing + Sales.')
  // A paused account names the pause first: that is what must be fixed.
  assert.match(refusalText(ended('trial_ended'), 'owner', { noSales: true }), /free trial ended/)
})

test('not known keeps the old, careful sentence', () => {
  assert.equal(refusalText(null, 'owner'), NOT_CHANGED)
  assert.equal(refusalText(undefined), NOT_CHANGED)
  assert.match(NOT_CHANGED, /^Nothing was changed\./)
})

test('no refusal ever shows a money figure, least of all ₦0', () => {
  for (const v of [ended('trial_ended'), ended('payment_failed'), ended('subscription_ended'), LIVE, null]) {
    for (const role of ['owner', 'kitchen']) {
      assert.doesNotMatch(refusalText(v, role, { noSales: true }), /₦|\bNGN\b|\d+\.\d\d/, `${JSON.stringify(v)} ${role}`)
    }
  }
})

// ---------------------------------------------------------------------------
// pausedLine: the line where buttons were taken away
// ---------------------------------------------------------------------------

test('the line where Record, Cancel and Correct were', () => {
  assert.equal(pausedLine(ended('trial_ended'), 'owner', 'this purchase can’t be cancelled or corrected'),
    'Your free trial ended on 17 October 2026, so this purchase can’t be cancelled or corrected. ' +
    'Choose a plan on Plans & billing to carry on.')
  assert.equal(pausedLine(ended('trial_ended'), 'accountant', 'new purchases can’t be recorded'),
    'Your free trial ended on 17 October 2026, so new purchases can’t be recorded. Ask the owner to choose a plan.')
  assert.equal(pausedLine(ended('payment_failed'), 'owner', 'this draft can’t be changed or confirmed'),
    'We could not take your last payment, so this draft can’t be changed or confirmed. ' +
    'Update your card on Plans & billing to carry on.')
})

test('no line while recording is open, or when nobody knows', () => {
  assert.equal(pausedLine(LIVE, 'owner', 'x'), null)
  assert.equal(pausedLine(null, 'owner', 'x'), null)
  assert.equal(pausedLine(undefined, 'owner', 'x'), null)
})

// ---------------------------------------------------------------------------
// refusalAfterWrite: the order of the three outcomes
// ---------------------------------------------------------------------------

function counting(text = 'REFUSED') {
  const calls = { n: 0 }
  return { calls, refusal: () => { calls.n += 1; return text } }
}

test('the database error wins, and the reason is not even looked up', async () => {
  const { calls, refusal } = counting()
  assert.equal(await refusalAfterWrite({ code: '23505', message: 'dup' }, [], refusal),
    'That already exists. Give it a different name.')
  assert.equal(await refusalAfterWrite({ code: 'MMENT', message: 'Trial over.' }, [{ id: 'a' }], refusal), 'Trial over.')
  assert.equal(calls.n, 0)
})

test('rows back: no notice (the action says its own success), and no lookup', async () => {
  const { calls, refusal } = counting()
  assert.equal(await refusalAfterWrite(null, [{ id: 'a' }], refusal), null)
  assert.equal(await refusalAfterWrite(null, { name: 'Jollof Rice' }, refusal), null)
  assert.equal(calls.n, 0)
})

test('no rows back: the refusal, looked up once', async () => {
  const { calls, refusal } = counting('Nothing was changed. Your free trial ended on 17 October 2026.')
  assert.equal(await refusalAfterWrite(null, [], refusal), 'Nothing was changed. Your free trial ended on 17 October 2026.')
  assert.equal(calls.n, 1)
  assert.equal(await refusalAfterWrite(null, null, refusal), 'Nothing was changed. Your free trial ended on 17 October 2026.')
  assert.equal(calls.n, 2)
})

test('an asynchronous refusal (the real one reads the database) is awaited', async () => {
  const text = await refusalAfterWrite(null, [], async () => refusalText(ended('trial_ended'), 'kitchen'))
  assert.match(text ?? '', /^Nothing was changed\. Your free trial ended on 17 October 2026\. Ask the owner/)
})
