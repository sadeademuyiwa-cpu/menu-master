import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSalesLocked } from '../src/lib/sales-gate.ts'

test('a Costing-only account is locked out of the Sales product', () => {
  assert.equal(isSalesLocked(false), true)
})

test('a Costing + Sales account sees Sales', () => {
  assert.equal(isSalesLocked(true), false)
})

test('NOT KNOWING must not lock a paying customer out', () => {
  // null is "we could not find out" -- the function is absent, or the lookup
  // failed. Locking here would tell a Costing + Sales subscriber they cannot
  // sell. RLS still refuses any write that should be refused.
  assert.equal(isSalesLocked(null), false)
  assert.equal(isSalesLocked(undefined), false)
})

test('only an explicit false locks -- no truthiness games', () => {
  for (const v of [0, '', 'false', NaN] as unknown as (boolean | null)[]) {
    assert.equal(isSalesLocked(v), false,
      `${String(v)} is not an explicit false and must not lock`)
  }
})
