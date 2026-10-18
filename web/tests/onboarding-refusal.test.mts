/**
 * What setting up a business says when the database refuses it
 * (src/app/(setup)/onboarding/onboarding-refusal.ts).
 *
 * 0066 refuses two new cases with sentences written for the person:
 *   MMLGN  a login that is already staff on a business starts none of its own (D4)
 *   MMENT  an owner whose account has no access adds no business
 * Both used to come out as "Check your connection and press Continue again",
 * which sent people round in a loop.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { onboardingRefusal, LOGIN_TAKEN, NO_ACCESS } from '../src/app/(setup)/onboarding/onboarding-refusal.ts'

test("a login that is already staff somewhere is told so, in the database's words", () => {
  const said = 'This login already belongs to a business on Menu Master. To run a business of your own, ' +
    'sign up with a different email address.'
  assert.equal(onboardingRefusal({ code: 'MMLGN', message: said }), said)
  assert.equal(onboardingRefusal({ code: 'MMLGN', message: '' }), LOGIN_TAKEN)
  assert.equal(LOGIN_TAKEN, said)
})

test('an owner whose account has no access is told why, and what to do', () => {
  const said = 'Your free trial has ended, so nothing new can be saved. Choose a plan on Plans & billing to carry on. ' +
    'Everything already entered is still here.'
  assert.equal(onboardingRefusal({ code: 'MMENT', message: said }), said)
  assert.equal(onboardingRefusal({ code: 'MMENT' }), NO_ACCESS)
  assert.match(NO_ACCESS, /Choose a plan on Plans & billing/)
})

test('the refusals it always translated still translate, and nothing raw is shown', () => {
  assert.match(onboardingRefusal({ code: 'P0001', message: 'idempotency key reused with different arguments' }),
    /already being set up/)
  assert.match(onboardingRefusal({ code: '23505', message: 'duplicate key value violates unique constraint' }), /different name/)
  assert.match(onboardingRefusal({ code: '42501', message: 'new row violates row-level security policy' }), /Sign out, sign back in/)
  for (const e of [{ code: 'XX000', message: 'internal error at line 3' }, {}, null, undefined]) {
    assert.match(onboardingRefusal(e), /Check your connection/)
  }
})

test('the form shows these words, not a copy of its own', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src/app/(setup)/onboarding/onboarding-form.tsx'), 'utf8')
  assert.match(src, /setError\(onboardingRefusal\(error\)\)/)
  assert.doesNotMatch(src, /function friendly\(/)
})
