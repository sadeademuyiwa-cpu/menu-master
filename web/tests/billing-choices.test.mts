/**
 * Which billing buttons show, for each status, tier and role.
 *
 * The rules are the owner's (D5, D6) and must match paystack-checkout's own
 * refusals (contract K4): a wrong answer here either offers a second
 * subscription for a plan already paid for, or hides the only way to stop
 * paying. The edge functions still refuse on the server either way.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPaying, isEnding, planAction, checkoutRefusal, accountBilling, changeLabel,
  lagosLongDate, cancelConfirmText, endingText, checkoutErrorText, billingErrorText,
  CHANGE_CAUTION, OWNER_ONLY_NOTE, FOUNDER_WARNING,
  type BillingSub, type Tier,
} from '../src/app/(app)/subscribe/billing-choices.ts'

const now = new Date('2026-10-18T10:00:00Z')
const future = '2026-11-18T10:00:00Z'
const past = '2026-10-01T10:00:00Z'

const sub = (status: string, tier: string, end: string | null = future, cancelAtEnd = false): BillingSub =>
  ({ status, tier, current_period_end: end, cancel_at_period_end: cancelAtEnd })

const trial = sub('trialing', 'trial')
const endedTrial = sub('trialing', 'trial', past)
const costing = sub('active', 'costing')
const trading = sub('active', 'trading')
const overdueCosting = sub('past_due', 'costing', past)
const cancelledInPeriod = sub('cancelled', 'costing', future, true)
const cancelledOver = sub('cancelled', 'costing', past, true)

const ROLES = ['owner', 'manager', 'accountant', 'kitchen', 'sales'] as const
const TIERS: Tier[] = ['costing', 'trading']

test('paying means active, past_due, or cancelled inside the paid month', () => {
  assert.equal(isPaying(costing, now), true)
  assert.equal(isPaying(overdueCosting, now), true)
  assert.equal(isPaying(cancelledInPeriod, now), true)
  assert.equal(isPaying(cancelledOver, now), false)
  assert.equal(isPaying(trial, now), false)
  assert.equal(isPaying(endedTrial, now), false)
  assert.equal(isPaying(null, now), false)
  // A cancelled row with no date, or a date that is not one, is over.
  assert.equal(isPaying(sub('cancelled', 'costing', null), now), false)
  assert.equal(isPaying(sub('cancelled', 'costing', 'not a date'), now), false)
})

test('ending: renewal is off and the paid month still runs', () => {
  assert.equal(isEnding(cancelledInPeriod, now), true)
  // Either way Paystack's not_renew may be recorded: status cancelled, or
  // active with cancel_at_period_end.
  assert.equal(isEnding(sub('active', 'costing', future, true), now), true)
  assert.equal(isEnding(cancelledOver, now), false)
  assert.equal(isEnding(costing, now), false)
  assert.equal(isEnding(overdueCosting, now), false)
  assert.equal(isEnding(trial, now), false)
})

test('a trial, an ended trial and an ended plan: anyone on the account may pay, either tier', () => {
  for (const s of [trial, endedTrial, cancelledOver, null]) {
    for (const role of ROLES) {
      for (const tier of TIERS) {
        assert.equal(planAction(s, tier, role, now), 'pay', `${s?.status} ${role} ${tier}`)
        assert.equal(checkoutRefusal(s, tier, role, now), null, `${s?.status} ${role} ${tier}`)
      }
    }
  }
})

test('active: the tier paid for reads "Your plan" for everyone and is refused at checkout', () => {
  for (const role of ROLES) {
    assert.equal(planAction(costing, 'costing', role, now), 'your_plan')
    assert.deepEqual(checkoutRefusal(costing, 'costing', role, now), { error: 'already_on_plan', status: 409 })
    assert.equal(planAction(trading, 'trading', role, now), 'your_plan')
  }
})

test('active: the other tier goes ahead for the owner, with the caution first', () => {
  assert.equal(planAction(costing, 'trading', 'owner', now), 'change')
  assert.equal(planAction(trading, 'costing', 'owner', now), 'change')
  assert.equal(checkoutRefusal(costing, 'trading', 'owner', now), null)
  assert.equal(checkoutRefusal(trading, 'costing', 'owner', now), null)
})

test('active: staff cannot change the plan; they are told the owner does it', () => {
  for (const role of ['manager', 'accountant', 'kitchen', 'sales', null, undefined]) {
    assert.equal(planAction(costing, 'trading', role, now), 'owner_only', String(role))
    assert.deepEqual(checkoutRefusal(costing, 'trading', role, now), { error: 'owner_only', status: 403 })
  }
})

test('past_due on the same tier: the owner gets "Update your card", never a second subscription', () => {
  assert.equal(planAction(overdueCosting, 'costing', 'owner', now), 'update_card')
  assert.deepEqual(checkoutRefusal(overdueCosting, 'costing', 'owner', now), { error: 'already_on_plan', status: 409 })
  for (const role of ['manager', 'kitchen', 'sales', 'accountant']) {
    assert.equal(planAction(overdueCosting, 'costing', role, now), 'your_plan', role)
  }
})

test('past_due: the other tier still goes ahead for the owner, and staff are refused', () => {
  assert.equal(planAction(overdueCosting, 'trading', 'owner', now), 'change')
  assert.equal(checkoutRefusal(overdueCosting, 'trading', 'owner', now), null)
  assert.equal(planAction(overdueCosting, 'trading', 'manager', now), 'owner_only')
  assert.deepEqual(checkoutRefusal(overdueCosting, 'trading', 'manager', now), { error: 'owner_only', status: 403 })
})

test('cancelled inside the paid month: choosing a plan again is the owner’s, any tier', () => {
  for (const tier of TIERS) {
    assert.equal(planAction(cancelledInPeriod, tier, 'owner', now), 'change', tier)
    assert.equal(checkoutRefusal(cancelledInPeriod, tier, 'owner', now), null, tier)
    assert.equal(planAction(cancelledInPeriod, tier, 'sales', now), 'owner_only', tier)
    assert.deepEqual(checkoutRefusal(cancelledInPeriod, tier, 'sales', now), { error: 'owner_only', status: 403 })
  }
})

test('a cancelled plan’s own card says "again"; any other card says "switch"', () => {
  assert.equal(changeLabel(cancelledInPeriod, 'costing'), 'Choose this plan again')
  assert.equal(changeLabel(cancelledInPeriod, 'trading'), 'Switch to this plan')
  assert.equal(changeLabel(costing, 'trading'), 'Switch to this plan')
  assert.equal(changeLabel(null, 'costing'), 'Switch to this plan')
})

test('K4 order: already_on_plan is answered before owner_only', () => {
  assert.equal(checkoutRefusal(costing, 'costing', 'kitchen', now)?.error, 'already_on_plan')
})

test('an unknown plan tier on an active row: no tier is "Your plan", both are a change', () => {
  const odd = sub('active', 'legacy')
  assert.equal(planAction(odd, 'costing', 'owner', now), 'change')
  assert.equal(planAction(odd, 'trading', 'owner', now), 'change')
  assert.equal(checkoutRefusal(odd, 'costing', 'owner', now), null)
})

test('Account page: only the owner of a renewing plan may cancel', () => {
  assert.deepEqual(accountBilling(costing, 'owner', now), { cancel: true, updateCard: false, ending: false })
  for (const role of ['manager', 'accountant', 'kitchen', 'sales', null]) {
    assert.deepEqual(accountBilling(costing, role, now), { cancel: false, updateCard: false, ending: false }, String(role))
  }
})

test('Account page: past_due offers the owner the card page, and staff nothing', () => {
  assert.deepEqual(accountBilling(overdueCosting, 'owner', now), { cancel: false, updateCard: true, ending: false })
  assert.deepEqual(accountBilling(overdueCosting, 'manager', now), { cancel: false, updateCard: false, ending: false })
})

test('Account page: once cancelled, no second cancel; the end date is said instead', () => {
  assert.deepEqual(accountBilling(cancelledInPeriod, 'owner', now), { cancel: false, updateCard: false, ending: true })
  assert.deepEqual(accountBilling(sub('active', 'costing', future, true), 'owner', now),
    { cancel: false, updateCard: false, ending: true })
  // Every member is told the plan is ending; only the buttons are the owner's.
  assert.equal(accountBilling(cancelledInPeriod, 'kitchen', now).ending, true)
})

test('Account page: trials and ended plans have nothing to cancel or update', () => {
  for (const s of [trial, endedTrial, cancelledOver, null]) {
    assert.deepEqual(accountBilling(s, 'owner', now), { cancel: false, updateCard: false, ending: false }, String(s?.status))
  }
})

test('dates are said on the Lagos calendar, in words', () => {
  assert.equal(lagosLongDate('2026-11-18T10:00:00Z'), '18 November 2026')
  // 23:30 UTC is already the next day in Lagos.
  assert.equal(lagosLongDate('2026-11-18T23:30:00Z'), '19 November 2026')
  // The trial boundary, 23:59:59 Lagos, stays on its own day.
  assert.equal(lagosLongDate('2026-10-31T22:59:59Z'), '31 October 2026')
  // ends_on may come as a bare date.
  assert.equal(lagosLongDate('2026-11-18'), '18 November 2026')
  assert.equal(lagosLongDate(null), null)
  assert.equal(lagosLongDate(''), null)
  assert.equal(lagosLongDate('not a date'), null)
})

test('the confirm step says what happens, and that nothing more is charged', () => {
  assert.equal(cancelConfirmText('18 November 2026'),
    'Your plan stays on until 18 November 2026. After that you can still open and read everything, ' +
    'but you cannot record new work. You will not be charged again.')
  assert.match(cancelConfirmText(null), /until the end of the month you have paid for/)
  assert.match(FOUNDER_WARNING, /founding price/)
  assert.match(FOUNDER_WARNING, /standard price/)
})

test('after cancelling, the end date and no further charge', () => {
  assert.equal(endingText('18 November 2026'), 'Your plan ends on 18 November 2026. You will not be charged again.')
  assert.match(endingText(null), /You will not be charged again\.$/)
  assert.doesNotMatch(endingText(null), /null|undefined/)
})

test('the plan-change caution and the staff note are the agreed words', () => {
  assert.equal(CHANGE_CAUTION,
    'Your new plan starts the day you pay and your old plan stops, so you are never charged for both. ' +
    'Unused days on the old plan are not refunded.')
  assert.equal(OWNER_ONLY_NOTE, 'Plan changes are made by the account owner.')
})

test('checkout refusals are said in plain words, and say nothing was charged', () => {
  assert.match(checkoutErrorText('already_on_plan'), /already paying for this plan/)
  assert.match(checkoutErrorText('already_on_plan'), /nothing has been charged/i)
  assert.match(checkoutErrorText('owner_only'), /account owner/)
  assert.match(checkoutErrorText('owner_only'), /Nothing has been charged/)
  assert.match(checkoutErrorText('something new'), /Nothing has been charged/)
})

test('every K3 error code has its own plain sentence, none of them raw', () => {
  const codes = ['unauthorised', 'owner_only', 'nothing_to_cancel', 'no_subscription', 'not_configured', 'paystack_error', 'bad_request']
  for (const action of ['cancel', 'card_link'] as const) {
    for (const code of codes) {
      const text = billingErrorText(code, action)
      assert.ok(text.length > 20, code)
      assert.doesNotMatch(text, /_/, `${code} leaks a code`)
    }
  }
  assert.match(billingErrorText('owner_only', 'cancel'), /owner can cancel/)
  assert.match(billingErrorText('owner_only', 'card_link'), /owner can update the card/)
  assert.match(billingErrorText('no_subscription', 'cancel'), /within one working day/)
  assert.match(billingErrorText('paystack_error', 'cancel'), /Nothing has changed/)
})
