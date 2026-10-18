/**
 * Which billing buttons show, for each status, tier, role and switch state.
 *
 * The rules are the owner's (D5, D6) as the integrator settled them (X1-X4,
 * X8), and must match paystack-checkout's own refusals: a wrong answer here
 * either offers a second subscription for a plan already paid for, or hides
 * the only way to stop paying. The edge functions still refuse on the server
 * either way.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPaying, isLive, isEnding, knownTier, planAction, checkoutRefusal, checkoutGate,
  accountBilling, changeLabel, changeCaution, subscribeHeader, subscribeNote, SUBSCRIBE_BASE,
  lagosLongDate, cancelConfirmText, endingText, chooseAgainText, checkoutErrorText, billingErrorText,
  CHANGE_CAUTION, OWNER_ONLY_NOTE, FOUNDER_WARNING, PAY_NOW_TEXT, CANCELLED_NOW_TEXT, PLAN_UNREADABLE_TEXT,
  type BillingSub, type Tier,
} from '../src/app/(app)/subscribe/billing-choices.ts'
import { MESSAGE_US } from '../src/lib/site/billing-words.ts'

const now = new Date('2026-10-18T10:00:00Z')
const future = '2026-11-18T10:00:00Z'
const past = '2026-10-01T10:00:00Z'

const sub = (status: string, tier: string | null, end: string | null = future, cancelAtEnd = false): BillingSub =>
  ({ status, tier, current_period_end: end, cancel_at_period_end: cancelAtEnd })

const trial = sub('trialing', 'trial')
const endedTrial = sub('trialing', 'trial', past)
const costing = sub('active', 'costing')
const trading = sub('active', 'trading')
const overdueCosting = sub('past_due', 'costing', past)
// How 0067 records Paystack's not_renew (X8).
const cancelledInPeriod = sub('cancelled', 'costing', future, true)
const cancelledOver = sub('cancelled', 'costing', past, true)

const ROLES = ['owner', 'manager', 'accountant', 'kitchen', 'sales'] as const
const STAFF = ['manager', 'accountant', 'kitchen', 'sales', null, undefined] as const
const TIERS: Tier[] = ['costing', 'trading']
const BOTH = [true, false] as const

test('paying means active, past_due, or cancelled inside the paid month; live means active or past_due', () => {
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

  assert.equal(isLive(costing), true)
  assert.equal(isLive(overdueCosting), true)
  assert.equal(isLive(cancelledInPeriod), false)
  assert.equal(isLive(trial), false)
  assert.equal(isLive(null), false)
})

test('a tier is known only when it is costing or trading', () => {
  assert.equal(knownTier('costing'), true)
  assert.equal(knownTier('trading'), true)
  for (const t of ['trial', 'legacy', '', null, undefined, 3]) assert.equal(knownTier(t), false, String(t))
})

test('ending: renewal is off and the paid month still runs', () => {
  assert.equal(isEnding(cancelledInPeriod, now), true)
  assert.equal(isEnding(sub('active', 'costing', future, true), now), true)
  assert.equal(isEnding(cancelledOver, now), false)
  assert.equal(isEnding(costing, now), false)
  assert.equal(isEnding(overdueCosting, now), false)
  assert.equal(isEnding(trial, now), false)
  assert.equal(isEnding(null, now), false)
})

test('a trial, an ended trial and an ended plan: anyone may pay, either tier, whatever the switch', () => {
  for (const s of [trial, endedTrial, cancelledOver, null]) {
    for (const role of ROLES) {
      for (const tier of TIERS) {
        for (const on of BOTH) {
          assert.equal(planAction(s, tier, role, on, now), 'pay', `${s?.status} ${role} ${tier} ${on}`)
          assert.equal(checkoutRefusal(s, tier, role, on, now), null, `${s?.status} ${role} ${tier} ${on}`)
        }
      }
    }
  }
})

test('active: the tier paid for reads "Your plan" for everyone and is refused at checkout, either switch state', () => {
  for (const on of BOTH) {
    for (const role of ROLES) {
      assert.equal(planAction(costing, 'costing', role, on, now), 'your_plan')
      assert.deepEqual(checkoutRefusal(costing, 'costing', role, on, now), { error: 'already_on_plan', status: 409 })
      assert.equal(planAction(trading, 'trading', role, on, now), 'your_plan')
    }
  }
})

test('active, switch on: the other tier goes ahead for the owner, with the caution first', () => {
  assert.equal(planAction(costing, 'trading', 'owner', true, now), 'change')
  assert.equal(planAction(trading, 'costing', 'owner', true, now), 'change')
  assert.equal(checkoutRefusal(costing, 'trading', 'owner', true, now), null)
  assert.equal(checkoutRefusal(trading, 'costing', 'owner', true, now), null)
  assert.equal(changeCaution(costing, 'trading', '18 November 2026', now), CHANGE_CAUTION)
})

test('active, switch off: the owner is told to message us and checkout refuses switch_needs_support', () => {
  assert.equal(planAction(costing, 'trading', 'owner', false, now), 'message_us')
  assert.deepEqual(checkoutRefusal(costing, 'trading', 'owner', false, now), { error: 'switch_needs_support', status: 409 })
})

test('staff on a paying account cannot change the plan, in either switch state', () => {
  for (const on of BOTH) {
    for (const role of STAFF) {
      assert.equal(planAction(costing, 'trading', role, on, now), 'owner_only', String(role))
      assert.deepEqual(checkoutRefusal(costing, 'trading', role, on, now), { error: 'owner_only', status: 403 })
      for (const tier of TIERS) {
        assert.equal(planAction(cancelledInPeriod, tier, role, on, now), 'owner_only', `${role} ${tier}`)
        assert.deepEqual(checkoutRefusal(cancelledInPeriod, tier, role, on, now), { error: 'owner_only', status: 403 })
      }
    }
  }
})

test('past_due on the same tier, switch on: the owner may Pay now (a replacement), not refused as already_on_plan (X2)', () => {
  assert.equal(planAction(overdueCosting, 'costing', 'owner', true, now), 'pay_now')
  assert.equal(checkoutRefusal(overdueCosting, 'costing', 'owner', true, now), null)
  // Staff see their plan, and checkout refuses them as not the owner.
  for (const role of ['manager', 'kitchen', 'sales', 'accountant']) {
    assert.equal(planAction(overdueCosting, 'costing', role, true, now), 'your_plan', role)
    assert.deepEqual(checkoutRefusal(overdueCosting, 'costing', role, true, now), { error: 'owner_only', status: 403 })
  }
})

test('past_due, switch off: no Pay now and no switch; the owner messages us', () => {
  for (const tier of TIERS) {
    assert.equal(planAction(overdueCosting, tier, 'owner', false, now), 'message_us', tier)
    assert.deepEqual(checkoutRefusal(overdueCosting, tier, 'owner', false, now), { error: 'switch_needs_support', status: 409 })
  }
})

test('past_due, switch on: the other tier still goes ahead for the owner, and staff are refused', () => {
  assert.equal(planAction(overdueCosting, 'trading', 'owner', true, now), 'change')
  assert.equal(checkoutRefusal(overdueCosting, 'trading', 'owner', true, now), null)
  assert.equal(planAction(overdueCosting, 'trading', 'manager', true, now), 'owner_only')
  assert.deepEqual(checkoutRefusal(overdueCosting, 'trading', 'manager', true, now), { error: 'owner_only', status: 403 })
})

test('X8: a plan cancelled inside its paid month may be chosen again, starting a new paid month today', () => {
  for (const tier of TIERS) {
    assert.equal(planAction(cancelledInPeriod, tier, 'owner', true, now), 'change', tier)
    assert.equal(checkoutRefusal(cancelledInPeriod, tier, 'owner', true, now), null, tier)
  }
  assert.equal(changeLabel(cancelledInPeriod, 'costing'), 'Choose this plan again')
  assert.equal(changeCaution(cancelledInPeriod, 'costing', '18 November 2026', now),
    'Your plan is on until 18 November 2026. Choosing it again starts a new paid month today.')
  // The other tier is an ordinary switch, with the ordinary caution.
  assert.equal(changeLabel(cancelledInPeriod, 'trading'), 'Switch to this plan')
  assert.equal(changeCaution(cancelledInPeriod, 'trading', '18 November 2026', now), CHANGE_CAUTION)
})

test('X8: with the switch off, a cancelled plan still inside its month is not chosen again by itself', () => {
  for (const tier of TIERS) {
    assert.equal(planAction(cancelledInPeriod, tier, 'owner', false, now), 'message_us', tier)
    assert.deepEqual(checkoutRefusal(cancelledInPeriod, tier, 'owner', false, now), { error: 'switch_needs_support', status: 409 })
  }
})

test('X8: an "active" row with cancel_at_period_end is not how 0067 records a cancel; its tier stays "Your plan", as paystack-checkout refuses it', () => {
  const activeEnding = sub('active', 'costing', future, true)
  assert.equal(isEnding(activeEnding, now), true)
  assert.equal(planAction(activeEnding, 'costing', 'owner', true, now), 'your_plan')
  assert.deepEqual(checkoutRefusal(activeEnding, 'costing', 'owner', true, now), { error: 'already_on_plan', status: 409 })
  assert.equal(changeLabel(activeEnding, 'costing'), 'Switch to this plan')
  assert.equal(changeCaution(activeEnding, 'costing', null, now), CHANGE_CAUTION)
})

test('a cancelled plan’s own card says "again"; any other card says "switch"', () => {
  assert.equal(changeLabel(cancelledInPeriod, 'costing'), 'Choose this plan again')
  assert.equal(changeLabel(cancelledInPeriod, 'trading'), 'Switch to this plan')
  assert.equal(changeLabel(costing, 'trading'), 'Switch to this plan')
  assert.equal(changeLabel(null, 'costing'), 'Switch to this plan')
})

test('K4 order: already_on_plan is answered before owner_only, owner_only before the switch', () => {
  assert.equal(checkoutRefusal(costing, 'costing', 'kitchen', true, now)?.error, 'already_on_plan')
  assert.equal(checkoutRefusal(costing, 'trading', 'kitchen', false, now)?.error, 'owner_only')
})

test('a paying account whose tier is unknown fails closed: nothing to press for the owner, and checkout refuses', () => {
  for (const tier of [null, 'legacy', 'trial']) {
    for (const status of ['active', 'past_due', 'cancelled']) {
      const odd = sub(status, tier)
      for (const on of BOTH) {
        for (const t of TIERS) {
          assert.equal(planAction(odd, t, 'owner', on, now), 'reload', `${status} ${tier} ${t} ${on}`)
          assert.deepEqual(checkoutRefusal(odd, t, 'owner', on, now), { error: 'plan_unreadable', status: 503 })
          assert.equal(planAction(odd, t, 'sales', on, now), 'owner_only')
          assert.deepEqual(checkoutRefusal(odd, t, 'sales', on, now), { error: 'owner_only', status: 403 })
        }
      }
    }
  }
  // A trial row whose plan could not be read is still a first payment.
  assert.equal(planAction(sub('trialing', null), 'costing', 'owner', true, now), 'pay')
  assert.equal(checkoutRefusal(sub('trialing', null), 'costing', 'owner', false, now), null)
})

test('/api/checkout pre-check: what its reads returned decides, and an unknown answer fails closed', () => {
  const base = { contextStatus: 'ok', accountId: 'acc', role: 'owner', subError: false, planTier: 'costing', tier: 'trading' as Tier, selfServe: true, now }
  const row = { status: 'active', current_period_end: future, cancel_at_period_end: false }
  // The membership lookup failed: we cannot tell whether this account pays.
  assert.deepEqual(checkoutGate({ ...base, contextStatus: 'error', accountId: undefined, sub: null }), { error: 'plan_unreadable', status: 503 })
  // No account at all: the edge function answers no_account.
  assert.equal(checkoutGate({ ...base, contextStatus: 'no_membership', accountId: undefined, sub: null }), null)
  // The subscription read failed.
  assert.deepEqual(checkoutGate({ ...base, subError: true, sub: null }), { error: 'plan_unreadable', status: 503 })
  // No subscription row: nothing to refuse.
  assert.equal(checkoutGate({ ...base, sub: null }), null)
  // A row whose plan could not be read, on a paying account.
  assert.deepEqual(checkoutGate({ ...base, sub: row, planTier: null }), { error: 'plan_unreadable', status: 503 })
  // And the ordinary rules, through it.
  assert.equal(checkoutGate({ ...base, sub: row }), null)
  assert.deepEqual(checkoutGate({ ...base, sub: row, tier: 'costing' }), { error: 'already_on_plan', status: 409 })
  assert.deepEqual(checkoutGate({ ...base, sub: row, role: 'sales' }), { error: 'owner_only', status: 403 })
  assert.deepEqual(checkoutGate({ ...base, sub: row, selfServe: false }), { error: 'switch_needs_support', status: 409 })
  // A business lookup that failed after the account was found still decides.
  assert.deepEqual(checkoutGate({ ...base, contextStatus: 'error', sub: row, selfServe: false }), { error: 'switch_needs_support', status: 409 })
  // A trial's first payment is never refused by the switch.
  assert.equal(checkoutGate({ ...base, sub: { status: 'trialing', current_period_end: future }, planTier: 'trial', selfServe: false }), null)
})

const none = { cancel: false, overdue: false, updateCard: false, payNow: null, messageUs: false, ending: false }

test('Account page, switch on: the owner of a renewing plan may cancel', () => {
  assert.deepEqual(accountBilling(costing, 'owner', true, now), { ...none, cancel: true })
  for (const role of STAFF) {
    assert.deepEqual(accountBilling(costing, role, true, now), none, String(role))
  }
})

test('Account page, switch on: an overdue owner may Pay now, update the card, or cancel (X1, X2)', () => {
  assert.deepEqual(accountBilling(overdueCosting, 'owner', true, now),
    { ...none, cancel: true, overdue: true, updateCard: true, payNow: 'costing' })
  assert.deepEqual(accountBilling(overdueCosting, 'manager', true, now), { ...none, overdue: true })
  // An unknown tier: no Pay now, but the card and cancel still work.
  assert.deepEqual(accountBilling(sub('past_due', null, past), 'owner', true, now),
    { ...none, cancel: true, overdue: true, updateCard: true })
})

test('Account page, switch off: no self-serve button; the owner of a paying account is told to message us', () => {
  for (const s of [costing, overdueCosting, cancelledInPeriod]) {
    const b = accountBilling(s, 'owner', false, now)
    assert.equal(b.cancel, false, s.status!)
    assert.equal(b.updateCard, false, s.status!)
    assert.equal(b.payNow, null, s.status!)
    assert.equal(b.messageUs, true, s.status!)
    for (const role of STAFF) assert.equal(accountBilling(s, role, false, now).messageUs, false)
  }
  for (const s of [trial, endedTrial, cancelledOver, null]) {
    assert.equal(accountBilling(s, 'owner', false, now).messageUs, false, String(s?.status))
  }
})

test('Account page: once cancelled, no second cancel; the end date is said instead', () => {
  assert.deepEqual(accountBilling(cancelledInPeriod, 'owner', true, now), { ...none, ending: true })
  assert.deepEqual(accountBilling(sub('active', 'costing', future, true), 'owner', true, now), { ...none, ending: true })
  // Every member is told the plan is ending; only the buttons are the owner's.
  assert.equal(accountBilling(cancelledInPeriod, 'kitchen', true, now).ending, true)
})

test('Account page: trials and ended plans have nothing to cancel or update', () => {
  for (const s of [trial, endedTrial, cancelledOver, null]) {
    for (const on of BOTH) {
      assert.deepEqual(accountBilling(s, 'owner', on, now), none, `${s?.status} ${on}`)
    }
  }
})

test('the Plans & billing header promises only what this person can do', () => {
  const base = 'Monthly billing in naira.'
  // A trial, or nothing paid: nothing to change or cancel yet.
  for (const s of [trial, endedTrial, cancelledOver, null]) {
    for (const role of ROLES) {
      for (const on of BOTH) assert.equal(subscribeHeader(s, role, on, MESSAGE_US, now), base)
    }
  }
  // Staff on a paying account.
  for (const role of STAFF) {
    for (const on of BOTH) assert.equal(subscribeHeader(costing, role, on, MESSAGE_US, now), `${base} ${OWNER_ONLY_NOTE}`)
  }
  // The owner, switch on, renewing or overdue.
  for (const s of [costing, overdueCosting]) {
    assert.equal(subscribeHeader(s, 'owner', true, MESSAGE_US, now),
      `${base} Change plan here, and cancel from your Account page whenever you like.`)
  }
  // The owner, plan ending: nothing to cancel.
  assert.equal(subscribeHeader(cancelledInPeriod, 'owner', true, MESSAGE_US, now), base)
  // The owner, switch off.
  for (const s of [costing, overdueCosting, cancelledInPeriod]) {
    assert.equal(subscribeHeader(s, 'owner', false, MESSAGE_US, now), `${base} ${MESSAGE_US}`)
  }
})

test('the visible note under Plans & billing is the header without its base line', () => {
  assert.equal(SUBSCRIBE_BASE, 'Monthly billing in naira.')
  for (const s of [trial, endedTrial, cancelledOver, null, costing, overdueCosting, cancelledInPeriod]) {
    for (const role of ROLES) {
      for (const on of BOTH) {
        const note = subscribeNote(s, role, on, MESSAGE_US, now)
        assert.equal(subscribeHeader(s, role, on, MESSAGE_US, now), note ? `${SUBSCRIBE_BASE} ${note}` : SUBSCRIBE_BASE)
      }
    }
  }
  // A paying owner with the switch off is always told to message us, in visible text.
  for (const s of [costing, overdueCosting, cancelledInPeriod]) {
    assert.equal(subscribeNote(s, 'owner', false, MESSAGE_US, now), MESSAGE_US)
  }
  // A trial has nothing to say there.
  assert.equal(subscribeNote(trial, 'owner', true, MESSAGE_US, now), null)
})

test('dates are said on the Lagos calendar, in words', () => {
  assert.equal(lagosLongDate('2026-11-18T10:00:00Z'), '18 November 2026')
  // 23:30 UTC is already the next day in Lagos.
  assert.equal(lagosLongDate('2026-11-18T23:30:00Z'), '19 November 2026')
  // The trial boundary, 23:59:59 Lagos, stays on its own day.
  assert.equal(lagosLongDate('2026-10-31T22:59:59Z'), '31 October 2026')
  // ends_on comes as a bare date.
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
  // X1: an overdue plan has no paid month left.
  assert.equal(cancelConfirmText('1 October 2026', true),
    'Your last payment did not go through. If you cancel now, recording stops straight away and you will not be charged again.')
  assert.match(FOUNDER_WARNING, /founding price/)
  assert.match(FOUNDER_WARNING, /standard price/)
})

test('after cancelling, the end date and no further charge; an overdue plan is simply cancelled', () => {
  assert.equal(endingText('18 November 2026'), 'Your plan ends on 18 November 2026. You will not be charged again.')
  assert.match(endingText(null), /You will not be charged again\.$/)
  assert.doesNotMatch(endingText(null), /null|undefined/)
  assert.match(CANCELLED_NOW_TEXT, /You will not be charged again/)
  assert.doesNotMatch(CANCELLED_NOW_TEXT, /ends on/)
  assert.match(chooseAgainText(null), /until the end of the month you have paid for\. Choosing it again starts a new paid month today\.$/)
})

test('the agreed words: plan-change caution, Pay now, staff note, unreadable plan', () => {
  assert.equal(CHANGE_CAUTION,
    'Your new plan starts the day you pay and your old plan stops, so you are never charged for both. ' +
    'Unused days on the old plan are not refunded.')
  assert.equal(PAY_NOW_TEXT,
    'Your last payment did not go through. Pay now to carry on. The failed plan is switched off, so you are never charged twice.')
  assert.equal(OWNER_ONLY_NOTE, 'Plan changes are made by the account owner.')
  assert.match(PLAN_UNREADABLE_TEXT, /Reload the page/)
})

test('checkout refusals are said in plain words, and say nothing was charged or what to do', () => {
  assert.match(checkoutErrorText('already_on_plan'), /already paying for this plan/)
  assert.match(checkoutErrorText('already_on_plan'), /nothing has been charged/i)
  assert.match(checkoutErrorText('owner_only'), /account owner/)
  assert.match(checkoutErrorText('owner_only'), /Nothing has been charged/)
  assert.equal(checkoutErrorText('switch_needs_support'),
    'To change plan, message us. We switch it over for you so you are never charged twice.')
  assert.equal(checkoutErrorText('change_in_progress'), 'Your plan change is still finishing. Try again in a minute.')
  assert.match(checkoutErrorText('plan_unreadable'), /nothing has been charged/i)
  assert.match(checkoutErrorText('something new'), /Nothing has been charged/)
})

test('every /api/billing error code has its own plain sentence, none of them raw', () => {
  const codes = ['unauthorised', 'owner_only', 'nothing_to_cancel', 'no_subscription', 'not_configured',
    'switch_needs_support', 'change_in_progress', 'paystack_error', 'bad_request', 'bad_origin']
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
  assert.equal(billingErrorText('change_in_progress', 'cancel'), 'Your plan change is still finishing. Try again in a minute.')
  assert.match(billingErrorText('switch_needs_support', 'cancel'), /message us/)
})
