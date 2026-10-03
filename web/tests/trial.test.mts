/**
 * The trial countdown an owner sees on every page. Off by one here means
 * telling someone they have a day they do not have.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysLeft, trialTone, daysLeftText, planStatusLabel } from '../src/lib/trial.ts'

const now = new Date('2026-10-02T10:00:00Z')

test('a part-day counts as a day left', () => {
  assert.equal(daysLeft('2026-10-02T18:00:00Z', now), 1)
  assert.equal(daysLeft('2026-10-03T09:00:00Z', now), 1)
  assert.equal(daysLeft('2026-10-03T11:00:00Z', now), 2)
  assert.equal(daysLeft('2026-10-16T10:00:00Z', now), 14)
})

test('a boundary already passed is zero, never negative', () => {
  assert.equal(daysLeft('2026-09-30T10:00:00Z', now), 0)
})

test('no boundary or a bad date is unknown, not zero', () => {
  assert.equal(daysLeft(null, now), null)
  assert.equal(daysLeft('not a date', now), null)
})

test('the bar is calm until the last three days', () => {
  assert.equal(trialTone(14), 'calm')
  assert.equal(trialTone(4), 'calm')
  assert.equal(trialTone(3), 'soon')
  assert.equal(trialTone(2), 'soon')
  assert.equal(trialTone(1), 'last')
  assert.equal(trialTone(0), 'last')
  assert.equal(trialTone(null), 'calm')
})

test('the words match the days', () => {
  assert.equal(daysLeftText(9), 'Free trial · 9 days left')
  assert.equal(daysLeftText(1), 'Free trial · last day')
  assert.equal(daysLeftText(0), 'Free trial ends today')
})

test('statuses read as words, not database values', () => {
  assert.equal(planStatusLabel('trialing'), 'Free trial')
  assert.equal(planStatusLabel('active'), 'Active')
  assert.equal(planStatusLabel('past_due'), 'Payment overdue')
  assert.equal(planStatusLabel('cancelled'), 'Cancelled')
  assert.equal(planStatusLabel(null), 'No plan')
})
