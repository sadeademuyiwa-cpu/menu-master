/**
 * What the public pages promise must be something the product really does.
 *
 * The terms, the refunds page and the plans FAQ once promised cancelling and
 * exporting "from your account page" and plan changes that "take effect
 * straight away", and the app had none of these. Now:
 *   - how to cancel, change plan and put a failed payment right follows the
 *     web's billing safety switch (BILLING_SELF_SERVE, X4). "on": Cancel plan
 *     on the Account page, plan changes and Pay now on Plans & billing.
 *     Anything else: "message us". The sentences for both states live in one
 *     file, src/lib/site/billing-words.ts, and the pages render them; this
 *     checks each state's words against the buttons that state shows;
 *   - there is NO download, so a copy of your records is sent on request,
 *     within one working day.
 *
 * Each source is read as words (comments, imports and code-level `export`
 * removed) and fails if a promise appears without its feature. When an
 * export route is built (src/app/api/export), the export test lets the word
 * back in by itself.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { billingWords, planFaq, selfServeOn, MESSAGE_US } from '../src/lib/site/billing-words.ts'
import { accountBilling, checkoutRefusal, planAction, type BillingSub, type Tier } from '../src/app/(app)/subscribe/billing-choices.ts'
import { billingRequest } from '../src/app/(app)/subscribe/billing-api.ts'
import { LEGAL } from '../src/lib/legal.ts'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(join(web, rel), 'utf8')
const exists = (rel: string) => existsSync(join(web, rel))

/** What a source file says to a reader, not how it is coded. */
function words(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')            // block and JSX comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1')           // line comments, never https://
    .replace(/^\s*import\s.*$/gm, ' ')
    .replace(/<\/?[A-Za-z][^<>]*>/g, ' ')          // JSX tags, so sentences read as text
    .replace(/\bexport\s+(default\s+)?(async\s+)?(function|const|let|type|interface|class)\b/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\{' '\}/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Every place an owner or a visitor reads a promise about billing or records,
 * including every in-app upsell that sends people to Plans & billing.
 */
const PUBLIC = [
  'src/app/terms/page.tsx',
  'src/app/refunds/page.tsx',
  'src/app/privacy/page.tsx',
  'src/lib/site/privacy-draft.ts',
  'src/lib/site/plan-features.ts',
  'src/lib/site/billing-words.ts',
  'src/app/(marketing)/page.tsx',
  'src/app/(app)/subscribe/page.tsx',
  'src/app/(app)/subscribe/billing-choices.ts',
  'src/app/(app)/account/page.tsx',
  'src/app/(app)/more/page.tsx',
  'src/app/(setup)/start/page.tsx',
  'src/components/plan-chooser.tsx',
  'src/components/cancel-plan.tsx',
  'src/components/entitlement-banner.tsx',
  'src/components/sales-locked.tsx',
  '../supabase/functions/trial-reminder-mailer/lib.ts',
]
const page = (rel: string) => words(read(rel))

/** The sentences of a text that contain a phrase. */
const sentencesWith = (text: string, re: RegExp) =>
  text.split(/(?<=[.?!])\s+/).filter((s) => re.test(s))

const EXPORT = /[^.]*\b(export(s|ed|ing)?|download(s|ed|ing)?)\b[^.]*/i
const RETIRED = [
  /Choose your plan below to pay again/i,      // invited a second subscription
  /takes? effect (straight away|immediately)/i, // the new plan starts the day you pay
  /open and export/i,
]

/** Both states of the switch, with every word each one publishes. */
const STATES = [true, false].map((on) => {
  const w = billingWords(on)
  const faq = planFaq(on)
  const answer = (re: RegExp) => faq.find(([q]) => re.test(q))?.[1] ?? ''
  return {
    on,
    name: on ? 'switch on' : 'switch off',
    w,
    faq,
    faqCancel: answer(/cancel/i),
    faqChange: answer(/change plan/i),
    all: [...Object.values(w), ...faq.flat()].join(' '),
  }
})

const now = new Date('2026-10-18T10:00:00Z')
const s = (status: string, tier: string, end = '2026-11-18T10:00:00Z', cancelAtEnd = false): BillingSub =>
  ({ status, tier, current_period_end: end, cancel_at_period_end: cancelAtEnd })
/** Every paying state a customer can reach (0067 records not_renew as cancelled, X8). */
const PAYING = {
  active: s('active', 'costing'),
  past_due: s('past_due', 'costing', '2026-10-01T10:00:00Z'),
  cancelled_in_period: s('cancelled', 'costing', '2026-11-18T10:00:00Z', true),
}
const TIERS: Tier[] = ['costing', 'trading']

test('the reader sees promises in page text, and not in code or comments', () => {
  const promise = /\b(export(s|ed|ing)?|download(s|ed|ing)?)\b/i
  assert.match(words('<p>You can export every recipe.</p>'), promise)
  assert.match(words("['Can I?', 'Yes, download your records any time.']"), promise)
  assert.doesNotMatch(words('export default async function TermsPage() {}'), promise)
  assert.doesNotMatch(words('export const revalidate = 60\nexport type X = 1'), promise)
  assert.doesNotMatch(words('/* no download yet */ {/* exported later */} // export soon'), promise)
  assert.match(words('<a href="https://x.ng/export">Export</a>'), promise)
})

test('every page listed here still exists (a rename must not silence this test)', () => {
  for (const rel of PUBLIC) assert.ok(exists(rel), rel)
})

test('the switch is on only for the exact word "on"', () => {
  assert.equal(selfServeOn('on'), true)
  for (const v of ['off', 'On', 'ON', ' on', 'on ', 'true', '1', 'yes', '', null, undefined]) {
    assert.equal(selfServeOn(v), false, JSON.stringify(v))
  }
})

test('no page promises an export or a download while there is none', () => {
  if (exists('src/app/api/export')) return // the feature exists: the word may come back
  for (const rel of PUBLIC) {
    const found = page(rel).match(EXPORT)
    assert.equal(found, null, `${rel} promises: "${found?.[0]?.trim()}"`)
  }
  for (const st of STATES) {
    const found = st.all.match(EXPORT)
    assert.equal(found, null, `${st.name} promises: "${found?.[0]?.trim()}"`)
  }
})

test('a copy of your records is promised as a request, answered within one working day', () => {
  for (const rel of ['src/app/terms/page.tsx', 'src/app/refunds/page.tsx', 'src/app/(app)/account/page.tsx']) {
    const text = page(rel)
    const promise = sentencesWith(text, /copy of your records/i)
      .filter((x) => /message us/i.test(x) && /spreadsheet/i.test(x) && /within one working day/i.test(x))
    assert.ok(promise.length > 0,
      `${rel} does not say: message us and we send a copy of your records as a spreadsheet, within one working day`)
  }
  for (const st of STATES) {
    const faq = st.faq.find(([q]) => /copy of my records/i.test(q))
    assert.ok(faq, `${st.name}: the plans FAQ answers "Can I get a copy of my records?"`)
    assert.match(faq[1], /Message us and we send you a copy of your records as a spreadsheet, within one working day/)
  }
})

test('the terms, refunds page and FAQ render their billing words from the one source, for the switch as the server sees it', () => {
  const terms = read('src/app/terms/page.tsx')
  const refunds = read('src/app/refunds/page.tsx')
  for (const src of [terms, refunds]) assert.match(src, /billingWords\(billingSelfServe\(\)\)/)
  for (const field of ['termsChange', 'termsCancel']) assert.match(terms, new RegExp(`\\{W\\.${field}\\}`), field)
  for (const field of ['refundsCancel', 'refundsChange', 'refundsFailed']) assert.match(refunds, new RegExp(`\\{W\\.${field}\\}`), field)
  assert.match(read('src/lib/site/plan-features.ts'), /PLAN_FAQ[^=]*=\s*planFaq\(billingSelfServe\(\)\)/)
  // No billing promise is left written into a page by hand, where it would
  // stay the same whichever way the switch is set.
  for (const rel of ['src/app/terms/page.tsx', 'src/app/refunds/page.tsx']) {
    const text = page(rel)
    for (const re of [/from the Account page/i, /Plans & billing page/i, /Update your card/i, /Pay now/i, /message us and we cancel/i]) {
      assert.doesNotMatch(text, re, `${rel} writes ${re} by hand`)
    }
  }
  // The screens read the same switch.
  for (const rel of ['src/app/(app)/subscribe/page.tsx', 'src/app/(app)/account/page.tsx',
    'src/app/api/checkout/route.ts', 'src/app/api/billing/route.ts']) {
    assert.match(read(rel), /billingSelfServe\(\)/, rel)
  }
})

test('switch on: cancelling is promised on the Account page, and every renewing state has the button there', () => {
  const on = STATES[0]
  assert.match(on.w.termsCancel, /cancel[^.]*from the Account page/i)
  assert.match(on.w.refundsCancel, /cancel[^.]*from the Account page/i)
  assert.match(on.w.refundsCancel, /press Cancel plan/)
  assert.match(on.faqCancel, /cancels from the Account page/)
  // The promise says what an overdue cancel does (X1).
  assert.match(on.w.refundsCancel, /did not go through[^.]*recording stops straight away/i)
  assert.match(on.faqCancel, /did not go through, recording stops straight away/)

  // The feature behind the words, in every state a paying owner can reach.
  // "At any time" holds: a renewing plan (active) or an overdue one has the
  // button; a cancelled one is already stopping.
  assert.equal(accountBilling(PAYING.active, 'owner', true, now).cancel, true)
  assert.equal(accountBilling(PAYING.past_due, 'owner', true, now).cancel, true)
  assert.equal(accountBilling(PAYING.cancelled_in_period, 'owner', true, now).ending, true)
  const account = read('src/app/(app)/account/page.tsx')
  assert.match(account, /<CancelPlan\b/, 'the Account page renders Cancel plan')
  assert.match(account, /billing\.cancel &&/)
  const cancel = read('src/components/cancel-plan.tsx')
  assert.match(cancel, /\/api\/billing/)
  assert.match(cancel, /action: 'cancel'/)
  assert.match(cancel, />\s*Cancel plan\s*</)
  assert.ok(exists('src/app/api/billing/route.ts'), '/api/billing exists')
  assert.match(read('src/app/api/billing/route.ts'), /functions\/v1\/paystack-manage/)
})

test('switch on: plan changes and Pay now are promised on Plans & billing, and that page offers them with the caution', () => {
  const on = STATES[0]
  for (const text of [on.w.termsChange, on.w.refundsChange]) {
    assert.match(text, /changes plan on the Plans & billing page/i)
    assert.match(text, /never charged for both/i)
    assert.match(text, /Unused days on the old plan are not refunded/i)
  }
  assert.match(on.faqChange, /changes plan on Plans & billing/)
  assert.match(on.faqChange, /never charged for both/)
  assert.match(on.faqChange, /Unused days on the old plan are not refunded/)
  assert.match(on.w.refundsFailed, /Pay now or Update your card on Plans & billing/)
  assert.match(on.w.refundsFailed, /never charged twice/)

  // The feature behind the words, in every paying state.
  for (const st of Object.values(PAYING)) {
    assert.equal(planAction(st, 'trading', 'owner', true, now), 'change', st.status!)
    assert.equal(checkoutRefusal(st, 'trading', 'owner', true, now), null, st.status!)
  }
  assert.equal(planAction(PAYING.past_due, 'costing', 'owner', true, now), 'pay_now')
  assert.equal(checkoutRefusal(PAYING.past_due, 'costing', 'owner', true, now), null)
  assert.equal(accountBilling(PAYING.past_due, 'owner', true, now).updateCard, true)
  assert.match(read('src/app/(app)/subscribe/page.tsx'), /planAction\(/)
  const chooser = read('src/components/plan-chooser.tsx')
  assert.match(chooser, /Switch to this plan/)
  assert.match(chooser, /CHANGE_CAUTION/)
  assert.match(chooser, />\s*Pay now\s*</)
  assert.match(chooser, /Update your card/)
})

test('switch off: every promise is "message us", and no paying state shows a self-serve button', () => {
  const off = STATES[1]
  for (const [field, text] of Object.entries(off.w)) {
    assert.match(text, /messag(e|es|ing) us/i, field)
    for (const re of [/Cancel plan/, /Update your card/, /Pay now/, /Account page/, /on (the )?Plans & billing/]) {
      assert.doesNotMatch(text, re, `${field}: ${re}`)
    }
  }
  assert.ok(off.faqCancel.includes(MESSAGE_US), 'the FAQ cancel answer')
  assert.ok(off.faqChange.includes(MESSAGE_US), 'the FAQ change answer')
  for (const text of [off.faqCancel, off.faqChange]) {
    assert.doesNotMatch(text, /Account page|on Plans & billing|Cancel plan|Update your card|Pay now/)
  }
  assert.match(off.w.termsCancel, /within one working day/)
  assert.match(off.w.refundsCancel, /within one working day/)
  assert.match(off.w.refundsCancel, /did not go through[^.]*recording stops straight away/i)
  for (const text of [off.w.termsChange, off.w.refundsChange]) {
    assert.match(text, /never charged for both/i)
    assert.match(text, /Unused days on the old plan are not refunded/i)
  }

  // The feature behind the words: nothing self-serve for a paying account.
  for (const st of Object.values(PAYING)) {
    const b = accountBilling(st, 'owner', false, now)
    assert.equal(b.cancel, false, st.status!)
    assert.equal(b.updateCard, false, st.status!)
    assert.equal(b.payNow, null, st.status!)
    assert.equal(b.messageUs, true, st.status!)
    for (const tier of TIERS) {
      assert.ok(['your_plan', 'message_us'].includes(planAction(st, tier, 'owner', false, now)), `${st.status} ${tier}`)
      const refused = checkoutRefusal(st, tier, 'owner', false, now)
      assert.ok(refused && ['already_on_plan', 'switch_needs_support'].includes(refused.error), `${st.status} ${tier}`)
    }
  }
  for (const action of ['cancel', 'card_link']) {
    assert.deepEqual(billingRequest({
      origin: null, ownHosts: ['x'], fetchSite: null, contentType: 'application/json',
      rawBody: JSON.stringify({ action }), selfServe: false,
    }), { refuse: { status: 500, body: { error: 'not_configured' } } })
  }
  // And the screens say it.
  assert.match(read('src/app/(app)/account/page.tsx'), /billing\.messageUs &&[\s\S]*MESSAGE_US/)
  assert.match(read('src/app/(app)/subscribe/page.tsx'), /subscribeNote\([^)]*MESSAGE_US\)/)
  // and as visible text, not inside the title's (i)
  assert.match(read('src/app/(app)/subscribe/page.tsx'), /\{billingNote && <p/)
})

test('retired promises stay retired', () => {
  for (const rel of PUBLIC) {
    const text = page(rel)
    for (const re of RETIRED) assert.doesNotMatch(text, re, `${rel} ${re}`)
  }
  for (const st of STATES) {
    for (const re of RETIRED) assert.doesNotMatch(st.all, re, `${st.name} ${re}`)
  }
})

test('the agreed upsell sentence (sales-locked.tsx) passes every check here', () => {
  // The owner of components/sales-locked.tsx is rewording it to this (K6).
  const agreed = words('<p>The account owner can switch plan on Plans &amp; billing. The new plan starts the day you pay.</p>')
  assert.equal(agreed.match(EXPORT), null)
  for (const re of RETIRED) assert.doesNotMatch(agreed, re)
})

test('the terms show the date they last changed, no earlier than this change', () => {
  assert.match(LEGAL.lastUpdated, /^\d{1,2} [A-Z][a-z]+ \d{4}$/)
  const when = new Date(`${LEGAL.lastUpdated} 12:00 UTC`)
  assert.ok(!Number.isNaN(when.getTime()), LEGAL.lastUpdated)
  assert.ok(when >= new Date('2026-10-18T00:00:00Z'), `terms dated ${LEGAL.lastUpdated}`)
})
