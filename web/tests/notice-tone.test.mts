import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { noticeTone, noticeDuration, refusalCode } from '../src/lib/ui/notice-tone.ts'

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

test("0066's own sentences are refusals too: the trial gate (MMENT) and a refused payment (MMPAY)", () => {
  for (const n of [
    'Your free trial has ended, so nothing new can be saved. Choose a plan on Plans & billing to carry on.',
    'The last payment for this business did not go through, so nothing new can be saved. Ask the owner to update the card.',
    'This sale was cancelled, so no payment can be recorded on it.',
    'This sale is still a draft. A payment can be recorded once it is confirmed.',
    'The amount paid must be zero or more.',
    'That amount is too large to record. Check the figure and try again.',
    'This sale could not be found. It may have been removed.',
    'Say whether the sale is not paid, part paid or paid in full.',
    'Your role can’t record payments. Ask the owner or a manager.',
  ]) assert.equal(noticeTone(n), 'warn', n)
  // ...and a payment that went in is not.
  assert.equal(noticeTone('Payment updated.'), 'info')
})

test("a page's own refusal words add to the shared ones, never replace them", () => {
  assert.equal(noticeTone('Tell us why you are cancelling this purchase.'), 'info')
  assert.equal(noticeTone('Tell us why you are cancelling this purchase.', /cancelling/i), 'warn')
  assert.equal(noticeTone('Nothing was changed.', /cancelling/i), 'warn')
  assert.equal(noticeTone('Purchase recorded.', /cancelling/i), 'info')
})

test('the sale and purchase pages use the shared tone, not a regex of their own', () => {
  const web = join(import.meta.dirname, '..')
  for (const rel of [
    'src/app/(app)/sales/[id]/page.tsx', 'src/app/(app)/sales/page.tsx',
    'src/app/(app)/purchases/page.tsx', 'src/app/(app)/purchases/[id]/page.tsx',
    'src/app/(app)/purchases/[id]/correct/page.tsx',
  ]) {
    const src = readFileSync(join(web, rel), 'utf8')
    assert.match(src, /<Notice tone=\{noticeTone\(notice/, rel)
    assert.doesNotMatch(src, /\.test\(notice\) \? 'warn' : 'info'/, rel)
  }
})

test('a refusal stays on screen longer than a confirmation', () => {
  assert.ok(noticeDuration('warn') > noticeDuration('info'))
})

test('a refusal is noted by its words, never by the sentence (0069)', () => {
  assert.equal(refusalCode('Egusi soup already exists.'), 'already')
  assert.equal(refusalCode('Your free trial has ended, so nothing new can be saved.'), 'nothing_new_can_be_saved')
  assert.equal(refusalCode('We couldn’t save that.'), 'couldn_t')
  assert.equal(refusalCode('Saved.'), null)
  for (const s of ['Price must be more than zero.', 'Give a name.', 'That did not go through.']) {
    assert.match(refusalCode(s) ?? '', /^[A-Za-z0-9_]{1,24}$/)
  }
})

test('saving a sale for later is a confirmation, not a refusal (0069 counts refusals)', () => {
  assert.equal(noticeTone('Saved for later. It counts as a sale once you confirm it. You can send it as a quote from here.'), 'info')
  assert.equal(noticeTone('Saved for later. It counts as a sale once you confirm it. You can send it as a quote from here. Record what they paid when you confirm it.'), 'info')
})
