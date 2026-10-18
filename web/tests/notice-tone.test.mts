import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noticeTone, noticeDuration } from '../src/lib/ui/notice-tone.ts'

test('a confirmation is info', () => {
  assert.equal(noticeTone('Ofada Rice added.'), 'info')
  assert.equal(noticeTone('Purchase recorded — 3 prices updated.'), 'info')
  assert.equal(noticeTone('Saved.'), 'info')
})

test('the refusals every page used to match on their own are warn', () => {
  for (const n of [
    'Menu Master could not save that. Your subscription or your role on this account does not allow recording new work at the moment.',
    'You already have an item called “Salt”. Open it to record a purchase, or use a different name.',
    'A batch has to produce something. Enter a yield greater than zero.',
    'Give this kind of work a name.',
    'Say how many this makes.',
    'Menu Master does not know how a bag converts to grams for this item.',
    'Your session expired — sign in again.',
    'We couldn’t complete that request. Please try again.',
    'How much this is spread across must be more than zero.',
    // An edit that changed nothing (lib/data/write-notice.ts), in every form it takes.
    'Nothing was changed. Your free trial ended on 17 October 2026. Choose a plan on Plans & billing to carry on. Everything you entered is still here.',
    'Nothing was changed. It may have been changed or removed already, or your role on this account does not allow it. Reload the page to see the latest.',
    'Your free trial ended on 17 October 2026, so this purchase can’t be cancelled or corrected. Choose a plan on Plans & billing to carry on.',
  ]) assert.equal(noticeTone(n), 'warn', n)
})

test('a refusal stays on screen longer than a confirmation', () => {
  assert.ok(noticeDuration('warn') > noticeDuration('info'))
})
