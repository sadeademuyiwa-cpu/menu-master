/**
 * Which primary destination the current URL belongs to.
 *
 * The rule matters more than it looks: a navigation where nothing is lit is
 * the failure a user notices, so every reachable path must resolve to exactly
 * one of the five. And the lit tab must be the one the owner came from, or
 * she looks for Customers under More when she reached it from Sales.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV, activeHref, parentTab } from '../src/lib/nav.ts'

test('the five destinations keep their places; the fourth is called Dishes', () => {
  assert.deepEqual(NAV.map((i) => i.href),
    ['/dashboard', '/sales', '/purchases', '/recipes', '/more'])
  assert.deepEqual(NAV.map((i) => i.label),
    ['Home', 'Sales', 'Purchases', 'Dishes', 'More'])
})

test('Dishes keeps the /recipes address, so no link or bookmark breaks', () => {
  const dishes = NAV.find((i) => i.label === 'Dishes')
  assert.equal(dishes?.href, '/recipes')
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
  assert.equal(activeHref('/sales/new'), '/sales')
  assert.equal(activeHref('/recipes/1f164655-cff3-48ad-87a9-0a38c7cd48a3'), '/recipes')
  assert.equal(activeHref('/purchases/abc'), '/purchases')
  assert.equal(activeHref('/recipes/abc/anything/deeper'), '/recipes')
})

test('each tool lights the tab it belongs to', () => {
  // Selling
  assert.equal(activeHref('/customers'), '/sales')
  assert.equal(activeHref('/quote'), '/sales')
  // Buying
  assert.equal(activeHref('/ingredients'), '/purchases')
  assert.equal(activeHref('/suppliers'), '/purchases')
  // Making a dish
  assert.equal(activeHref('/formats'), '/recipes')
  assert.equal(activeHref('/pricing'), '/recipes')
})

test("a tool's own pages light the same tab", () => {
  assert.equal(activeHref('/customers/abc'), '/sales')
  assert.equal(activeHref('/ingredients/067db41d-930d-4f06-bbc3-d4df715cbb02'), '/purchases')
  assert.equal(activeHref('/suppliers/abc/edit'), '/purchases')
  assert.equal(activeHref('/formats/abc'), '/recipes')
})

test('everything else lights More', () => {
  for (const p of ['/settings', '/settings/people', '/reports', '/reports/dishes',
                   '/subscribe', '/account', '/start', '/admin', '/admin/site', '/more']) {
    assert.equal(activeHref(p), '/more', p)
  }
})

test('no reachable path leaves the navigation unlit', () => {
  for (const p of ['/', '/units', '/costing', '/onboarding', '/anything-new-we-add']) {
    const a = activeHref(p)
    assert.ok(NAV.some((i) => i.href === a), `${p} resolved to ${a}, which is not a nav item`)
  }
})

test('the prefix test respects a path boundary', () => {
  // A future /salesforce must not light Sales, nor /pricing-history Dishes.
  assert.equal(activeHref('/salesforce'), '/more')
  assert.equal(activeHref('/recipes-archive'), '/more')
  assert.equal(activeHref('/pricing-history'), '/more')
  assert.equal(activeHref('/customersupport'), '/more')
  assert.equal(activeHref('/ingredientsx'), '/more')
})

test('exactly one destination is ever active', () => {
  for (const p of ['/dashboard', '/sales', '/sales/x', '/purchases', '/recipes/x',
                   '/more', '/customers', '/quote', '/ingredients', '/suppliers',
                   '/formats', '/pricing', '/reports', '/']) {
    const a = activeHref(p)
    assert.equal(NAV.filter((i) => i.href === a).length, 1, p)
  }
})

test('a tool page goes back to the tab it lights', () => {
  assert.deepEqual(parentTab('/customers'), { href: '/sales', label: 'Sales' })
  assert.deepEqual(parentTab('/quote'), { href: '/sales', label: 'Sales' })
  assert.deepEqual(parentTab('/ingredients/abc'), { href: '/purchases', label: 'Purchases' })
  assert.deepEqual(parentTab('/suppliers'), { href: '/purchases', label: 'Purchases' })
  assert.deepEqual(parentTab('/pricing'), { href: '/recipes', label: 'Dishes' })
  assert.deepEqual(parentTab('/formats'), { href: '/recipes', label: 'Dishes' })
  assert.deepEqual(parentTab('/settings/people'), { href: '/more', label: 'More' })
  // Every tool's back link and lit tab agree.
  for (const p of ['/customers', '/quote', '/ingredients', '/suppliers', '/formats',
                   '/pricing', '/settings', '/reports', '/account']) {
    assert.equal(parentTab(p)?.href, activeHref(p), p)
  }
})

test("a tab's own pages and unplaced pages have no parent tab", () => {
  assert.equal(parentTab('/sales'), null)
  assert.equal(parentTab('/sales/new'), null)
  assert.equal(parentTab('/recipes/abc'), null)
  assert.equal(parentTab('/dashboard'), null)
  assert.equal(parentTab('/anything-new-we-add'), null)
  assert.equal(parentTab('/salesforce'), null)
})
