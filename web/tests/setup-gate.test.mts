/**
 * First-run setup rules. A wrong answer here either traps an owner outside
 * their own app or lets a new owner skip the one thing that makes it useful,
 * so each branch is pinned.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSetupExempt, needsFirstRunSetup, wizardStep, stepNumber,
  canOpen, resolveView, neighbours, isRevisit,
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

test('an owner who chose "Skip for now" is not sent back to setup', () => {
  assert.equal(needsFirstRunSetup({ ...owner, skipped: true }), false)
  assert.equal(needsFirstRunSetup({ ...owner, skipped: false }), true)
})

test('every step up to the current one can be opened again; later ones cannot', () => {
  assert.equal(canOpen('business', 'purchase'), true)
  assert.equal(canOpen('purchase', 'purchase'), true)
  assert.equal(canOpen('dish', 'purchase'), false)   // a dish needs a priced ingredient
  assert.equal(canOpen('price', 'dish'), false)      // a price needs a costed dish
  for (const v of ['business', 'purchase', 'dish', 'price', 'done'] as const) {
    assert.equal(canOpen(v, 'done'), true, v)
  }
})

test('/start?step= shows that step when it can be opened, otherwise where the owner is', () => {
  assert.equal(resolveView('purchase', 'price'), 'purchase')
  assert.equal(resolveView('business', 'dish'), 'business')
  assert.equal(resolveView('price', 'purchase'), 'purchase')   // not reachable yet
  assert.equal(resolveView('nonsense', 'dish'), 'dish')
  assert.equal(resolveView(null, 'price'), 'price')
})

test('Back and Next walk the steps; Next stops where the owner has not been', () => {
  assert.deepEqual(neighbours('purchase', 'done'), { back: 'business', next: 'dish' })
  assert.deepEqual(neighbours('business', 'dish'), { back: null, next: 'purchase' })
  assert.deepEqual(neighbours('dish', 'dish'), { back: 'purchase', next: null })
  assert.deepEqual(neighbours('done', 'done'), { back: 'price', next: null })
})

test('a step before the current one is a revisit (shows what was saved)', () => {
  assert.equal(isRevisit('purchase', 'price'), true)
  assert.equal(isRevisit('price', 'price'), false)
  assert.equal(isRevisit('price', 'done'), true)
  assert.equal(isRevisit('done', 'done'), false)
})
