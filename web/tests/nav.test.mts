/**
 * Which primary destination the current URL belongs to.
 *
 * The rule matters more than it looks: a navigation where nothing is lit is
 * the failure a user notices, so every reachable path must resolve to exactly
 * one of the five.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV, activeHref } from '../src/lib/nav.ts'

test('the five destinations are unchanged', () => {
  assert.deepEqual(NAV.map((i) => i.href),
    ['/dashboard', '/sales', '/purchases', '/recipes', '/more'])
  assert.deepEqual(NAV.map((i) => i.label),
    ['Home', 'Sales', 'Purchases', 'Recipes', 'More'])
})

test('a section page lights its own item', () => {
  assert.equal(activeHref('/dashboard'), '/dashboard')
  assert.equal(activeHref('/sales'), '/sales')
  assert.equal(activeHref('/purchases'), '/purchases')
  assert.equal(activeHref('/recipes'), '/recipes')
  assert.equal(activeHref('/more'), '/more')
})

test('a child page lights its parent', () => {
  assert.equal(activeHref('/sales/1385f353-a3b0-43ec-ad12-f6917bf27404'), '/sales')
  assert.equal(activeHref('/recipes/1f164655-cff3-48ad-87a9-0a38c7cd48a3'), '/recipes')
  assert.equal(activeHref('/purchases/abc'), '/purchases')
  assert.equal(activeHref('/recipes/abc/anything/deeper'), '/recipes')
})

test('everything reached from More lights More', () => {
  // Exactly the destinations /more lists.
  for (const p of ['/customers', '/formats', '/pricing', '/ingredients',
                   '/suppliers', '/settings', '/reports', '/account']) {
    assert.equal(activeHref(p), '/more', p)
  }
  // and their child pages
  assert.equal(activeHref('/customers/abc'), '/more')
  assert.equal(activeHref('/ingredients/067db41d-930d-4f06-bbc3-d4df715cbb02'), '/more')
})

test('no reachable path leaves the navigation unlit', () => {
  for (const p of ['/', '/units', '/costing', '/onboarding', '/anything-new-we-add']) {
    const a = activeHref(p)
    assert.ok(NAV.some((i) => i.href === a), `${p} resolved to ${a}, which is not a nav item`)
  }
})

test('the prefix test respects a path boundary', () => {
  // A future /salesforce must not light Sales.
  assert.equal(activeHref('/salesforce'), '/more')
  assert.equal(activeHref('/recipes-archive'), '/more')
})

test('exactly one destination is ever active', () => {
  for (const p of ['/dashboard', '/sales', '/sales/x', '/purchases', '/recipes/x',
                   '/more', '/customers', '/reports', '/']) {
    const a = activeHref(p)
    assert.equal(NAV.filter((i) => i.href === a).length, 1, p)
  }
})
