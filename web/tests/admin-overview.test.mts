import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attentionItems, billingSuccessRate, fillDays, groupAlerts, monthlyValue, payState, setUpCount, signupsToday,
  subscriptionBuckets, trialCounts, valueAtRisk, weekOverWeek, type SubRow,
} from '../src/lib/admin/overview.ts'
import type { AlertRow } from '../src/lib/admin/format.ts'

const NOW = new Date('2026-10-25T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString()

const sub = (o: Partial<SubRow>): SubRow => ({
  account_id: 'a', account_name: 'Kitchen', price_tier: 'standard', status: 'active',
  trial_ends_at: null, current_period_end: day(10), price_kobo: 750000, cancel_at_period_end: false,
  created_at: day(-40), entitled: true, ...o,
})
const alert = (o: Partial<AlertRow>): AlertRow => ({
  id: 'x', kind: 'billing_stuck', severity: 'warn', subject: 's', summary: 'sum', detail: {},
  first_seen: day(-3), last_seen: day(-1), resolved_at: null, resolved_by: null, resolution: null, notified_at: null, ...o,
})
const say = { alert: (k: string) => `words:${k}`, money: (n: number) => `N${n}`, ago: () => '3 days ago' }

test('a paid subscription past its paid-until date is overdue while it keeps access, locked once it loses it', () => {
  assert.equal(payState(sub({}), NOW), 'ok')
  assert.equal(payState(sub({ current_period_end: day(-3) }), NOW), 'overdue')
  assert.equal(payState(sub({ current_period_end: day(-9), entitled: false }), NOW), 'locked')
  assert.equal(payState(sub({ status: 'past_due' }), NOW), 'past_due')
  assert.equal(payState(sub({ cancel_at_period_end: true }), NOW), 'cancelling')
  // What Paystack's subscription.not_renew really leaves behind (0050/0051).
  assert.equal(payState(sub({ status: 'cancelled', cancel_at_period_end: true, entitled: true }), NOW), 'cancelling')
})

test('an ended trial keeps status trialing: only the entitlement says it is over', () => {
  const rows = [
    sub({ account_id: 't1', price_tier: 'trial', status: 'trialing', trial_ends_at: day(3), price_kobo: null }),
    sub({ account_id: 't2', price_tier: 'trial', status: 'trialing', trial_ends_at: day(-5), entitled: false, price_kobo: null }),
    sub({ account_id: 't3', price_tier: 'trial', status: 'trialing', trial_ends_at: day(12), price_kobo: null }),
  ]
  assert.deepEqual(trialCounts(rows, 7, NOW), { running: 2, endingSoon: 1, endedUnpaid: 1 })
  const b = subscriptionBuckets(rows, NOW)
  assert.deepEqual(b.trials.map((r) => r.account_id), ['t1', 't3'])
  assert.deepEqual(b.trialEnded.map((r) => r.account_id), ['t2'])
})

test('paying rows read worst first: no access, failed payment, renewal not recorded, then fine', () => {
  const rows = [
    sub({ account_id: 'ok' }),
    sub({ account_id: 'overdue', current_period_end: day(-2) }),
    sub({ account_id: 'locked', current_period_end: day(-9), entitled: false }),
    sub({ account_id: 'pd', status: 'past_due' }),
    sub({ account_id: 'gone', status: 'cancelled', entitled: false }),
    sub({ account_id: 'leaving', status: 'cancelled', cancel_at_period_end: true, current_period_end: day(12) }),
  ]
  const b = subscriptionBuckets(rows, NOW)
  assert.deepEqual(b.paying.map((r) => r.account_id), ['locked', 'pd', 'overdue', 'leaving', 'ok'])
  assert.deepEqual(b.ended.map((r) => r.account_id), ['gone'])
})

test('plan value counts active paid plans, and a missing price apart, never as zero', () => {
  const v = monthlyValue([
    sub({}), sub({ account_id: 'b', price_kobo: null }), sub({ account_id: 'c', current_period_end: day(-1) }),
    sub({ account_id: 't', price_tier: 'trial', status: 'trialing' }),
  ], NOW)
  assert.deepEqual(v, { kobo: 1500000, accounts: 3, unpriced: 1, notRenewed: 1 })
  assert.equal(monthlyValue([sub({ price_kobo: null })], NOW).kobo, null)
  assert.equal(monthlyValue([], NOW).kobo, 0)
  assert.deepEqual(valueAtRisk([sub({ status: 'past_due' }), sub({ status: 'cancelled', cancel_at_period_end: true }), sub({})], NOW),
    { kobo: 1500000, unpriced: 0, accounts: 2 })
  assert.deepEqual(valueAtRisk([sub({ status: 'past_due', price_kobo: null })], NOW), { kobo: null, unpriced: 1, accounts: 1 })
})

test('the empty days come back, in UTC, oldest first, ending today', () => {
  const s = fillDays([{ day: '2026-10-25', accounts: 2 }, { day: '2026-10-23', accounts: 1 }], 3, NOW)
  assert.deepEqual(s, [{ day: '2026-10-23', n: 1 }, { day: '2026-10-24', n: 0 }, { day: '2026-10-25', n: 2 }])
  assert.equal(signupsToday([{ day: '2026-10-25', accounts: 2 }], NOW), 2)
  assert.deepEqual(weekOverWeek([{ day: '2026-10-25', accounts: 2 }, { day: '2026-10-15', accounts: 4 }], NOW), { thisWeek: 2, lastWeek: 4 })
})

test('set-up and billing shares say nothing rather than divide by zero', () => {
  assert.deepEqual(setUpCount(9, 4), { done: 5, total: 9 })
  assert.equal(billingSuccessRate({}), null)
  assert.equal(billingSuccessRate({ applied: 3, failed_permanent: 1 }), 0.75)
})

test('alerts group by kind, critical first, then the bigger group', () => {
  const g = groupAlerts([
    alert({ id: '1', kind: 'billing_stuck' }),
    alert({ id: '2', kind: 'billing_failed_permanent', severity: 'critical', first_seen: day(-7) }),
    alert({ id: '3', kind: 'billing_failed_permanent', severity: 'critical', first_seen: day(-2) }),
  ])
  assert.deepEqual(g.map((x) => [x.kind, x.rows.length]), [['billing_failed_permanent', 2], ['billing_stuck', 1]])
  assert.equal(g[0].oldest, day(-7))
})

test('the queue: critical before needs-action before info, and one row per kind', () => {
  const items = attentionItems({
    alerts: [alert({ id: '1' }), alert({ id: '2', kind: 'billing_failed_permanent', severity: 'critical' }), alert({ id: '3', kind: 'billing_failed_permanent', severity: 'critical' })],
    subs: [sub({ account_id: 'x', price_tier: 'trial', status: 'trialing', entitled: false, account_name: 'Ended Kitchen' })],
    trialsEndingSoon: [{ name: 'Soon Kitchen' }],
    stalled: [{ name: 'New', created_at: day(-2) }, { name: 'Old', created_at: day(-90) }],
    website: { missing: ['Support email', 'WhatsApp number'], unreachable: true },
    say, now: NOW,
  })
  assert.deepEqual(items.map((i) => [i.tone, i.key]), [
    ['critical', 'alert-billing_failed_permanent'],
    ['warn', 'alert-billing_stuck'],
    ['warn', 'website'],
    ['info', 'trial-ended'],
    ['info', 'trials'],
    ['info', 'stalled'],
  ])
  assert.equal(items[0].title, '2 × words:billing_failed_permanent')
  assert.equal(items[2].title, 'Customers cannot reach you from the website')
  assert.match(items[5].title, /^1 new account has/)
})

test('a locked-out payer is critical, and the scan alert about the same account is not listed again', () => {
  const items = attentionItems({
    alerts: [alert({ kind: 'past_due_beyond_grace' })],
    subs: [sub({ current_period_end: day(-9), entitled: false, account_name: 'Mama Put' })],
    trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false }, say, now: NOW,
  })
  assert.deepEqual(items.map((i) => i.key), ['locked'])
  assert.match(items[0].detail, /Mama Put/)
})

test('renewals not recorded are their own row; nothing open means an empty queue', () => {
  const overdue = attentionItems({
    alerts: [], subs: [sub({ current_period_end: day(-3) })], trialsEndingSoon: [], stalled: [],
    website: { missing: [], unreachable: false }, say, now: NOW,
  })
  assert.deepEqual(overdue.map((i) => [i.tone, i.key]), [['warn', 'overdue']])
  const none = attentionItems({ alerts: [], subs: [sub({})], trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false }, say, now: NOW })
  assert.deepEqual(none, [])
})

test('a failed payment with no price says the amount is unknown, never ₦0', () => {
  const items = attentionItems({
    alerts: [], subs: [sub({ status: 'past_due', price_kobo: null, account_name: 'No Price Kitchen' })],
    trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false }, say, now: NOW,
  })
  assert.equal(items[0].key, 'past-due')
  assert.match(items[0].detail, /^An unknown amount a month at risk/)
  assert.doesNotMatch(items[0].detail, /N0/)
})

test('settings that cannot be read at all are critical', () => {
  const items = attentionItems({ alerts: [], subs: [], trialsEndingSoon: [], stalled: [], website: null, say, now: NOW })
  assert.deepEqual(items.map((i) => [i.tone, i.key]), [['critical', 'website-down']])
})

test('help waiting is a needs-action row; low ratings and stuck owners are info (0069)', () => {
  const items = attentionItems({
    alerts: [], subs: [], trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false },
    helpOpen: [{ business: 'Iya Basira', created_at: day(-2) }, { business: null, created_at: day(-1) }],
    lowRatings: [{ business: 'Iya Basira' }],
    stuck: [{ name: 'Quiet Kitchen' }],
    say, now: NOW,
  })
  assert.deepEqual(items.map((i) => [i.tone, i.key]), [['warn', 'help'], ['info', 'low-ratings'], ['info', 'stuck']])
  assert.equal(items[0].title, '2 help requests are waiting for an answer')
  assert.match(items[0].detail, /^The oldest 3 days ago · /)
  assert.match(items[0].detail, /Iya Basira, no business yet$/)
  assert.equal(items[2].href, '/admin/journeys')
  // before 0069 none of them is there
  assert.deepEqual(attentionItems({ alerts: [], subs: [], trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false }, say, now: NOW }), [])
})
