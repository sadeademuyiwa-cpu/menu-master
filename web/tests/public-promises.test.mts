/**
 * What the public pages promise must be something the product really does.
 *
 * The terms, the refunds page and the plans FAQ once promised cancelling and
 * exporting "from your account page" and plan changes that "take effect
 * straight away", and the app had none of these. Now:
 *   - cancelling IS on the Account page (Cancel plan, components/cancel-plan.tsx);
 *   - changing plan IS on Plans & billing, for the owner, with the caution;
 *   - there is NO download, so a copy of your records is sent on request,
 *     within one working day.
 *
 * Each test reads the page sources as words (comments, imports and code-level
 * `export` removed) and fails if a promise appears without its feature.
 * When an export route is built (src/app/api/export), the export test lets
 * the word back in by itself.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAN_FAQ } from '../src/lib/site/plan-features.ts'
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

/** Every place an owner or a visitor reads a promise about billing or records. */
const PUBLIC = [
  'src/app/terms/page.tsx',
  'src/app/refunds/page.tsx',
  'src/app/privacy/page.tsx',
  'src/lib/site/privacy-draft.ts',
  'src/lib/site/plan-features.ts',
  'src/app/(marketing)/page.tsx',
  'src/app/(app)/subscribe/page.tsx',
  'src/app/(app)/subscribe/billing-choices.ts',
  'src/app/(app)/account/page.tsx',
  'src/components/plan-chooser.tsx',
  'src/components/cancel-plan.tsx',
  'src/components/entitlement-banner.tsx',
  '../supabase/functions/trial-reminder-mailer/lib.ts',
]
const page = (rel: string) => words(read(rel))

/** The sentences of a text that contain a phrase. */
const sentencesWith = (text: string, re: RegExp) =>
  text.split(/(?<=[.?!])\s+/).filter((s) => re.test(s))

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

test('no page promises an export or a download while there is none', () => {
  if (exists('src/app/api/export')) return // the feature exists: the word may come back
  for (const rel of PUBLIC) {
    const text = page(rel)
    const found = text.match(/[^.]*\b(export(s|ed|ing)?|download(s|ed|ing)?)\b[^.]*/i)
    assert.equal(found, null, `${rel} promises: "${found?.[0]?.trim()}"`)
  }
})

test('a copy of your records is promised as a request, answered within one working day', () => {
  for (const rel of ['src/app/terms/page.tsx', 'src/app/refunds/page.tsx', 'src/app/(app)/account/page.tsx']) {
    const text = page(rel)
    const promise = sentencesWith(text, /copy of your records/i)
      .filter((s) => /message us/i.test(s) && /spreadsheet/i.test(s) && /within one working day/i.test(s))
    assert.ok(promise.length > 0,
      `${rel} does not say: message us and we send a copy of your records as a spreadsheet, within one working day`)
  }
  const faq = PLAN_FAQ.find(([q]) => /copy of my records/i.test(q))
  assert.ok(faq, 'the plans FAQ answers "Can I get a copy of my records?"')
  assert.match(faq[1], /Message us and we send you a copy of your records as a spreadsheet, within one working day/)
})

test('cancelling is promised on the Account page, and the Account page has the button', () => {
  for (const rel of ['src/app/terms/page.tsx', 'src/app/refunds/page.tsx']) {
    assert.match(page(rel), /cancel[^.]*from the Account page/i, rel)
  }
  const faq = PLAN_FAQ.find(([q]) => /cancel/i.test(q))
  assert.ok(faq)
  assert.match(faq[1], /cancels from the Account page/)

  // The feature behind the words.
  const account = read('src/app/(app)/account/page.tsx')
  assert.match(account, /<CancelPlan\b/, 'the Account page renders Cancel plan')
  const cancel = read('src/components/cancel-plan.tsx')
  assert.match(cancel, /\/api\/billing/)
  assert.match(cancel, /action: 'cancel'/)
  assert.match(cancel, />\s*Cancel plan\s*</)
  assert.ok(exists('src/app/api/billing/route.ts'), '/api/billing exists')
  assert.match(read('src/app/api/billing/route.ts'), /functions\/v1\/paystack-manage/)
})

test('plan changes are promised on Plans & billing, and that page offers them with the caution', () => {
  for (const rel of ['src/app/terms/page.tsx', 'src/app/refunds/page.tsx']) {
    const text = page(rel)
    assert.match(text, /changes plan on the Plans & billing page/i, rel)
    assert.match(text, /never charged for both/i, rel)
    assert.match(text, /Unused days on the old plan are not refunded/i, rel)
  }
  const faq = PLAN_FAQ.find(([q]) => /change plan/i.test(q))
  assert.ok(faq)
  assert.match(faq[1], /changes plan on Plans & billing/)
  assert.match(faq[1], /never charged for both/)
  assert.match(faq[1], /Unused days on the old plan are not refunded/)

  // The feature behind the words.
  assert.match(read('src/app/(app)/subscribe/page.tsx'), /planAction\(/)
  const chooser = read('src/components/plan-chooser.tsx')
  assert.match(chooser, /Switch to this plan/)
  assert.match(chooser, /CHANGE_CAUTION/)
  assert.match(chooser, /Update your card/)
})

test('retired promises stay retired', () => {
  const retired = [
    /Choose your plan below to pay again/i,      // invited a second subscription
    /takes? effect (straight away|immediately)/i, // the new plan starts the day you pay
    /open and export/i,
  ]
  for (const rel of PUBLIC) {
    const text = page(rel)
    for (const re of retired) assert.doesNotMatch(text, re, `${rel} ${re}`)
  }
  for (const [q, a] of PLAN_FAQ) {
    for (const re of retired) assert.doesNotMatch(`${q} ${a}`, re)
  }
})

test('the terms show the date they last changed, no earlier than this change', () => {
  assert.match(LEGAL.lastUpdated, /^\d{1,2} [A-Z][a-z]+ \d{4}$/)
  const when = new Date(`${LEGAL.lastUpdated} 12:00 UTC`)
  assert.ok(!Number.isNaN(when.getTime()), LEGAL.lastUpdated)
  assert.ok(when >= new Date('2026-10-18T00:00:00Z'), `terms dated ${LEGAL.lastUpdated}`)
})
