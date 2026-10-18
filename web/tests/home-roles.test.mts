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

test('money received on a confirmed sale: the sale roles, whatever the plan or the trial', () => {
  // D2 / fn_record_order_payment (0066): canRecordPayments takes no plan and
  // no trial state at all, so a Costing plan or an ended trial cannot hide
  // the payment form from the people who take the money.
  for (const role of ['owner', 'manager', 'sales']) assert.equal(r.canRecordPayments(role), true, role)
  for (const role of ['kitchen', 'accountant', '', null, undefined]) {
    assert.equal(r.canRecordPayments(role), false, String(role))
  }
  assert.equal(r.canRecordPayments.length, 1)
  // ...while recording a new sale still follows the plan.
  assert.equal(r.canRecordSales('sales', false), false)
})
