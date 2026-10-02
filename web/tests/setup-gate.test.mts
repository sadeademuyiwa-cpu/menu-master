/**
 * First-run setup rules. A wrong answer here either traps an owner outside
 * their own app or lets a new owner skip the one thing that makes it useful,
 * so each branch is pinned.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSetupExempt, needsFirstRunSetup, wizardStep, stepNumber,
} from '../src/lib/setup-gate.ts'

const owner = { hasBusiness: true, role: 'owner', completeCostings: 0, pricesSet: 0 }

test('the setup screens, account and payment routes stay open', () => {
  for (const p of ['/start', '/onboarding', '/account', '/subscribe', '/checkout/callback',
                   '/reset-password', '/admin', '/admin/billing', '/api/checkout', '/auth/callback',
                   '/auth/confirm']) {
    assert.equal(isSetupExempt(p), true, p)
  }
})

test('the rest of the app is held until setup is finished', () => {
  for (const p of ['/dashboard', '/sales', '/sales/123', '/purchases', '/recipes', '/ingredients',
                   '/more', '/settings', '/reports', '/customers']) {
    assert.equal(isSetupExempt(p), false, p)
  }
})

test('a prefix only counts on a path boundary', () => {
  assert.equal(isSetupExempt('/starter'), false)
  assert.equal(isSetupExempt('/accounts'), false)
})

test('a new owner must finish setup', () => {
  assert.equal(needsFirstRunSetup(owner), true)
  assert.equal(needsFirstRunSetup({ ...owner, role: 'manager' }), true)
})

test('a costed dish without a selling price is not finished', () => {
  assert.equal(needsFirstRunSetup({ ...owner, completeCostings: 1, pricesSet: 0 }), true)
})

test('a priced dish without a complete costing is not finished', () => {
  assert.equal(needsFirstRunSetup({ ...owner, completeCostings: 0, pricesSet: 2 }), true)
})

test('one costed dish with a price finishes setup', () => {
  assert.equal(needsFirstRunSetup({ ...owner, completeCostings: 1, pricesSet: 1 }), false)
})

test('staff are never trapped in a wizard they cannot complete', () => {
  for (const role of ['kitchen', 'sales', 'viewer', null]) {
    assert.equal(needsFirstRunSetup({ ...owner, role }), false, String(role))
  }
})

test('no business is onboarding, not setup', () => {
  assert.equal(needsFirstRunSetup({ ...owner, hasBusiness: false }), false)
})

test('the step follows what the database holds', () => {
  assert.equal(wizardStep({ pricesEntered: 0, completeCostings: 0, pricesSet: 0 }), 'purchase')
  assert.equal(wizardStep({ pricesEntered: 3, completeCostings: 0, pricesSet: 0 }), 'dish')
  assert.equal(wizardStep({ pricesEntered: 3, completeCostings: 1, pricesSet: 0 }), 'price')
  assert.equal(wizardStep({ pricesEntered: 3, completeCostings: 1, pricesSet: 1 }), 'done')
})

test('business details are step 1, so the wizard counts on from 2', () => {
  assert.equal(stepNumber('purchase'), 2)
  assert.equal(stepNumber('dish'), 3)
  assert.equal(stepNumber('price'), 4)
})
