/**
 * What the app itself says about changing plan and fixing a payment.
 *
 *   sales-locked.tsx       a Costing plan's Sales screen. It once said
 *                          "Upgrading takes effect immediately"; the new plan
 *                          starts the day you pay, and only the owner switches.
 *   entitlement-banner.tsx the bar on every page. While a failed payment is
 *                          in its grace days its link says "Update your card",
 *                          the same words as the button it leads to -- a
 *                          button that exists only while the web's billing
 *                          switch is on (X4).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const web = join(import.meta.dirname, '..')
/** The words a reader sees: JSX tags, comments and line breaks removed. */
const words = (rel: string) => readFileSync(join(web, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/<\/?[A-Za-z][^<>]*>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')

test('the Sales screen on a Costing plan says who switches and when the new plan starts', () => {
  const text = words('src/components/sales-locked.tsx')
  assert.doesNotMatch(text, /takes? effect (straight away|immediately)/i)
  assert.doesNotMatch(text, /Upgrading/)
  // The billing switch on (X4): the owner switches on Plans & billing.
  assert.match(text, /The account owner can switch plan on Plans & billing\. The new plan starts the day you pay\./)
  // Off: message us (X3's words), so nobody is charged twice.
  assert.match(text, /To change plan, message us\. We switch it over for you so you are never charged twice\./)
})

test('the switch decides which, off unless exactly "on", read on the server', () => {
  const locked = readFileSync(join(web, 'src/components/sales-locked.tsx'), 'utf8')
  assert.match(locked, /selfServe = false/, 'off when not said')
  assert.match(locked, /\{selfServe \? SWITCH_SELF : SWITCH_MESSAGE_US\}/)
  const page = readFileSync(join(web, 'src/app/(app)/sales/page.tsx'), 'utf8')
  assert.match(page, /process\.env\.BILLING_SELF_SERVE === 'on'/)
  assert.match(page, /selfServe=\{selfServe\}/)
})

test('the grace-days bar links to Update your card while the switch is on, else to Plans & billing', () => {
  const src = readFileSync(join(web, 'src/components/entitlement-banner.tsx'), 'utf8')
  const grace = src.slice(src.indexOf("'payment_failed_in_grace'"), src.indexOf('<ActivationReporter'))
  assert.match(grace, /process\.env\.BILLING_SELF_SERVE === 'on' \? 'Update your card' : 'Plans & billing'/)
  assert.match(grace, /href="\/subscribe"/)
  assert.doesNotMatch(src, /Update payment/)
})
