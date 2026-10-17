import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../src/app/(app)/dashboard/roles.ts'

test('roles follow the 0015 write matrix', () => {
  assert.equal(r.canRecordSales('sales', true), true)
  assert.equal(r.canRecordSales('sales', null), true)
  assert.equal(r.canRecordSales('owner', false), false)
  assert.equal(r.canRecordSales('kitchen', true), false)
  assert.equal(r.canRecordSales('accountant', true), false)
  assert.equal(r.canRecordPurchases('kitchen'), false)
  assert.equal(r.canRecordPurchases('accountant'), true)
  assert.equal(r.canRecordPurchases('sales'), false)
  assert.deepEqual(r.quickActions('kitchen', true).map((a) => a.label), ['New dish', 'Add an item'])
  assert.deepEqual(r.quickActions('sales', true).map((a) => a.label), ['Record a sale'])
  assert.deepEqual(r.quickActions('sales', false), [])
  assert.deepEqual(r.quickActions('accountant', true).map((a) => a.label), ['Record a purchase'])
  assert.equal(r.quickActions('owner', true).length, 4)
  assert.deepEqual(r.quickActions(undefined, true), [])
})
