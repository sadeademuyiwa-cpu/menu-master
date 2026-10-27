import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkinMessage, outcomeWords, CHECKIN_REASONS } from '../src/lib/admin/checkins.ts'
import { attentionItems } from '../src/lib/admin/overview.ts'

test('each check-in has its message written, naming the business', () => {
  assert.match(checkinMessage('welcome', { business: 'Iya Basira Foods' }), /Did setting up Iya Basira Foods go okay\?/)
  assert.match(checkinMessage('day3', { business: 'Iya Basira Foods' }), /first dish/)
  assert.match(checkinMessage('trial_end', { business: 'X', endsOn: '28 Oct 2026' }), /ends on 28 Oct 2026/)
  assert.match(checkinMessage('payment_failed', { business: 'X' }), /did not go through/)
})

test('a failed payment points to Plans & billing only when owners can pay there themselves', () => {
  assert.match(checkinMessage('payment_failed', { business: 'X', selfServe: true }), /More, then Plans & billing/)
  const off = checkinMessage('payment_failed', { business: 'X', selfServe: false })
  assert.match(off, /Reply here and I will help you pay again/)
  assert.doesNotMatch(off, /Plans & billing/)
})

test('check-in messages are service contact, never offers', () => {
  for (const reason of Object.keys(CHECKIN_REASONS) as (keyof typeof CHECKIN_REASONS)[]) {
    const text = checkinMessage(reason, { business: 'X', endsOn: '28 Oct 2026' })
    assert.doesNotMatch(text, /discount|offer|founding|% off|promo/i, reason)
  }
})

test('outcomes read as words', () => {
  assert.equal(outcomeWords('reached'), 'Talked to them')
  assert.equal(outcomeWords('opted_out'), 'Asked not to be contacted')
  assert.equal(outcomeWords(null), 'not yet')
})

test('owners due a check-in make one queue row with the reasons counted', () => {
  const items = attentionItems({
    alerts: [], subs: [], trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false },
    checkinsDue: [{ reason: 'welcome', account_id: 'a' }, { reason: 'welcome', account_id: 'b' }, { reason: 'trial_end', account_id: 'c' }],
    say: { alert: (k) => k, money: (n) => String(n), ago: () => '' },
    now: new Date('2026-10-26T12:00:00Z'),
  })
  assert.deepEqual(items.map((i) => [i.key, i.tone, i.title]), [['checkins', 'info', '3 owners to check in with']])
  assert.match(items[0].detail, /^1 trial ending · 2 new/)
  assert.equal(items[0].href, '/admin/signups#checkins')
})

test('one owner due for two reasons is one owner to message', () => {
  const items = attentionItems({
    alerts: [], subs: [], trialsEndingSoon: [], stalled: [], website: { missing: [], unreachable: false },
    checkinsDue: [{ reason: 'payment_failed', account_id: 'a' }, { reason: 'day3', account_id: 'a' }],
    say: { alert: (k) => k, money: (n) => String(n), ago: () => '' },
  })
  assert.equal(items[0].title, '1 owner to check in with')
})
