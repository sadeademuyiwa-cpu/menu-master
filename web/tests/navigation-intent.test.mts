import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInternalNavigation, type ClickFacts } from '../src/lib/ui/navigation-intent.ts'

const base: ClickFacts = {
  href: '/recipes', target: null, download: false, button: 0, modifier: false,
  origin: 'https://menumasterng.com', current: '/dashboard',
}

test('a plain click on an internal link starts the bar', () => {
  assert.equal(isInternalNavigation(base), true)
  assert.equal(isInternalNavigation({ ...base, href: 'https://menumasterng.com/sales?x=1' }), true)
})

test('clicks that do not load a new page here do not', () => {
  assert.equal(isInternalNavigation({ ...base, href: null }), false, 'no href')
  assert.equal(isInternalNavigation({ ...base, target: '_blank' }), false, 'new tab')
  assert.equal(isInternalNavigation({ ...base, download: true }), false, 'download')
  assert.equal(isInternalNavigation({ ...base, button: 1 }), false, 'middle click')
  assert.equal(isInternalNavigation({ ...base, modifier: true }), false, 'ctrl/cmd click')
  assert.equal(isInternalNavigation({ ...base, href: 'https://paystack.com/pay/x' }), false, 'off site')
  assert.equal(isInternalNavigation({ ...base, href: 'mailto:help@menumasterng.com' }), false, 'mailto')
  assert.equal(isInternalNavigation({ ...base, href: '/dashboard#top' }), false, 'same page, hash only')
})

test('a hash on a different page is still a navigation', () => {
  assert.equal(isInternalNavigation({ ...base, href: '/recipes#lines' }), true)
})
