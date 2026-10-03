/**
 * Email links carry a "next" in the URL, which anyone can edit. It must only
 * ever send people somewhere on this site.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeNext } from '../src/lib/safe-next.ts'

test('a path on this site is kept', () => {
  assert.equal(safeNext('/reset-password', '/x'), '/reset-password')
  assert.equal(safeNext('/onboarding?step=2', '/x'), '/onboarding?step=2')
})

test('anything that could leave the site falls back', () => {
  for (const bad of ['//evil.example', 'https://evil.example', 'evil.example', '/\\evil.example', 'javascript:alert(1)',
                     // browsers drop tabs and newlines, leaving "//evil.example"
                     '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ /evil.example']) {
    assert.equal(safeNext(bad, '/onboarding'), '/onboarding', bad)
  }
})

test('nothing given falls back', () => {
  assert.equal(safeNext(null, '/onboarding'), '/onboarding')
  assert.equal(safeNext('', '/onboarding'), '/onboarding')
})
