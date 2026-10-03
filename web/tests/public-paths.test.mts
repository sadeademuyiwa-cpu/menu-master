import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLIC_PATHS, isPublicPath } from '../src/lib/public-paths.ts'

test('the legal pages are readable without an account', () => {
  // A terms page that redirects to /login cannot be read before signing up,
  // which is the one moment it matters.
  assert.equal(isPublicPath('/terms'), true)
  assert.equal(isPublicPath('/refunds'), true)
  assert.equal(isPublicPath('/privacy'), true)
})

test('the landing page is public, and opens nothing else', () => {
  // Ads send people to "/". Listing it must not make every path public.
  assert.equal(isPublicPath('/'), true)
  assert.equal(isPublicPath('//dashboard'), false)
})

test('the auth flow stays public', () => {
  for (const p of ['/login', '/signup', '/verify-email', '/forgot-password', '/auth/callback', '/auth/confirm']) {
    assert.equal(isPublicPath(p), true, p)
  }
})

test('the product is not', () => {
  // /reset-password needs the session the reset link signs in with.
  for (const p of ['/dashboard', '/sales', '/subscribe', '/account', '/reset-password', '/checkout/callback', '/api/checkout']) {
    assert.equal(isPublicPath(p), false, p)
  }
})

test('a prefix does not leak: /termsandconditions is not /terms', () => {
  assert.equal(isPublicPath('/termsandconditions'), false)
  assert.equal(isPublicPath('/refundsx'), false)
  // but a genuine child path is fine
  assert.equal(isPublicPath('/auth/callback/'), true)
})

test('the list is exactly what the product decided', () => {
  assert.deepEqual([...PUBLIC_PATHS],
    ['/', '/login', '/signup', '/verify-email', '/forgot-password', '/auth/callback', '/auth/confirm',
     '/terms', '/refunds', '/privacy'])
})
