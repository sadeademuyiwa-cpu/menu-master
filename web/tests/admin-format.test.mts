import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alertWords, severityTone, summariseAlerts, alertFacts, slotWords, daysUntil, kobo, sumLastDays,
  type AlertRow,
} from '../src/lib/admin/format.ts'

const row = (o: Partial<AlertRow>): AlertRow => ({
  id: 'x', kind: 'billing_stuck', severity: 'warn', subject: 's', summary: 'sum', detail: {},
  first_seen: '2026-09-10T10:00:00Z', last_seen: '2026-09-10T10:00:00Z',
  resolved_at: null, resolved_by: null, resolution: null, notified_at: null, ...o,
})

test('alert kinds read as words, unknown ones too', () => {
  assert.equal(alertWords('billing_failed_permanent'), 'Billing event failed permanently')
  assert.equal(alertWords('something_else'), 'something else')
})

test('severity maps to the badge tones the app already uses', () => {
  assert.equal(severityTone('critical'), 'bad')
  assert.equal(severityTone('warn'), 'warn')
  assert.equal(severityTone('info'), 'muted')
})

test('the summary counts only open rows', () => {
  const s = summariseAlerts([
    row({ severity: 'critical' }), row({ severity: 'warn' }),
    row({ severity: 'critical', resolved_at: '2026-09-10T11:00:00Z' }),
  ])
  assert.deepEqual(s, { open: 2, critical: 1, warn: 1, info: 0 })
})

test('facts are the flat detail values only', () => {
  assert.deepEqual(alertFacts({ event_id: 'e', attempts: 3, nested: { a: 1 }, gone: null }), [
    { label: 'event id', value: 'e' }, { label: 'attempts', value: '3' },
  ])
})

test('slot words say what is free, claimed, reserved and forfeited', () => {
  assert.equal(slotWords({ total: 100, claimed: 2, forfeited: 0, reserved: 1, free: 98 }),
    '98 of 100 free · 2 claimed · 1 reserved · 0 forfeited')
  assert.equal(slotWords(null), 'not entered')
})

test('days until is signed and null when absent', () => {
  const now = new Date('2026-09-10T12:00:00Z')
  assert.equal(daysUntil('2026-09-13T12:00:00Z', now), 3)
  assert.equal(daysUntil('2026-09-08T12:00:00Z', now), -2)
  assert.equal(daysUntil(null, now), null)
  assert.equal(daysUntil('not a date', now), null)
})

test('kobo becomes naira and null stays null -- never zero', () => {
  assert.equal(kobo(350000), 3500)
  assert.equal(kobo(null), null)
})

test('the last-n-days sum counts today and ignores older points', () => {
  const now = new Date('2026-09-10T15:00:00Z')
  const series = [
    { day: '2026-09-01', accounts: 5 }, { day: '2026-09-09', accounts: 2 }, { day: '2026-09-10', accounts: 3 },
  ]
  assert.equal(sumLastDays(series, 1, now), 3)
  assert.equal(sumLastDays(series, 7, now), 5)
  assert.equal(sumLastDays(series, 30, now), 10)
})
