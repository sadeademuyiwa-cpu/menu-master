/**
 * Supabase's raw sign-in errors told owners nothing about what to do next.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { friendlyAuthError } from '../src/lib/auth-errors.ts'

test('an unconfirmed email offers to resend, and mentions the spam folder', () => {
  for (const e of [{ code: 'email_not_confirmed' }, { message: 'Email not confirmed' }]) {
    const p = friendlyAuthError(e)
    assert.equal(p.canResend, true)
    assert.match(p.text, /Spam/)
  }
})

test('a wrong password points at reset, without saying which half was wrong', () => {
  const p = friendlyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })
  assert.match(p.text, /reset your password/)
  assert.equal(p.canResend, undefined)
})

test('rate limits say to wait', () => {
  assert.match(friendlyAuthError({ code: 'over_email_send_rate_limit' }).text, /Wait a minute/)
  assert.match(friendlyAuthError({ status: 429 }).text, /Wait a minute/)
  assert.match(friendlyAuthError({ message: 'For security purposes, you can only request this after 42 seconds.' }).text, /Wait a minute/)
})

test('password problems are explained', () => {
  assert.match(friendlyAuthError({ code: 'same_password' }).text, /current password/)
  assert.match(friendlyAuthError({ code: 'weak_password' }).text, /8 characters/)
})

test('anything unknown is still a sentence, never the raw server text', () => {
  const p = friendlyAuthError({ message: 'AuthApiError: unexpected_failure 500' })
  assert.equal(p.text, 'Something went wrong. Please try again.')
})
