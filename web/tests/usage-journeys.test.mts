import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routePattern, withSetupStep, deviceFor, presence, durationWords, pathWords, agoWords, stateWords } from '../src/lib/usage.ts'
import { buildTimeline, easeAverage, funnel, helpReply, isLowScore, journeyStatus, lastSeen, lowScoreOpen, npsScore, recordingOff, stoppedAt, stuckReasons, uses, type ActivationRow } from '../src/lib/admin/journeys.ts'

test('a screen is recorded as a pattern: no ids, no query, nothing typed', () => {
  assert.equal(routePattern('/recipes/3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '/recipes/:id')
  assert.equal(routePattern('/purchases/3F2504E0-4F89-11D3-9A0C-0305E82C3301/correct?x=1#y'), '/purchases/:id/correct')
  assert.equal(routePattern('/sales/123'), '/sales/:id')
  assert.equal(routePattern('/'), '/')
  assert.equal(routePattern(null), '/')
  assert.equal(routePattern('/Recipes/New'), '/recipes/new')
  assert.equal(routePattern('/odd/<script>'), '/odd/script')
  assert.ok(routePattern('/' + 'a'.repeat(300)).length <= 100)
  // every pattern fits the database's check
  for (const p of ['/', '/recipes/:id', '/start/purchase', '/settings/people']) assert.match(routePattern(p), /^\/[a-z0-9/_:-]{0,99}$/)
})

test('the setup step is added only on /start, and only as a plain word', () => {
  assert.equal(withSetupStep('/start', 'purchase'), '/start/purchase')
  assert.equal(withSetupStep('/start', null), '/start')
  assert.equal(withSetupStep('/start', 'x"y'), '/start')
  assert.equal(withSetupStep('/recipes', 'purchase'), '/recipes')
})

test('devices, presence and durations', () => {
  assert.equal(deviceFor(390, 844, true), 'phone')
  assert.equal(deviceFor(844, 390, true), 'phone')        // a phone held sideways
  assert.equal(deviceFor(820, 1180, true), 'tablet')
  assert.equal(deviceFor(1180, 820, true), 'tablet')
  assert.equal(deviceFor(500, 900, false), 'desktop')     // a narrow window on a computer
  assert.equal(deviceFor(1440, 900, false), 'desktop')
  const now = new Date('2026-10-26T12:00:00Z')
  assert.equal(presence('2026-10-26T11:59:00Z', 'active', now), 'live')
  assert.equal(presence('2026-10-26T11:59:00Z', 'hidden', now), 'recent')
  assert.equal(presence('2026-10-26T11:40:00Z', 'active', now), 'recent')
  assert.equal(presence('2026-10-26T10:00:00Z', 'active', now), 'away')
  assert.equal(durationWords(35), '35 s')
  assert.equal(durationWords(240), '4 min')
  assert.equal(durationWords(3900), '1 h 5 min')
  assert.equal(pathWords('/recipes/:id'), 'Recipes › one item')
  assert.equal(pathWords('/'), 'Home page')
})

const NOW = new Date('2026-10-26T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const row = (o: Partial<ActivationRow>): ActivationRow => ({
  id: 'a', name: 'Kitchen', created_at: day(10), email: 'o@k.ng', phone: null, usage_opt_out_at: null,
  status: 'trialing', trial_ends_at: day(-4), price_tier: 'trial', tier: 'trading', entitled: true,
  business_at: day(10), purchase_at: day(9), costed_at: day(9), priced_at: day(9), sale_at: day(8), paid_at: null,
  seen_at: day(0), signed_in_at: day(1), active_days_14: 6, refusals_24h: 0, open_help: 0, low_score: null, low_prompt: null,
  low_score_at: null, last_checkin_at: null, ...o,
})

test('where an owner stopped is the first step not reached', () => {
  assert.deepEqual(stoppedAt(row({ costed_at: null, priced_at: null, sale_at: null })), { reached: 3, next: 'costed' })
  assert.deepEqual(stoppedAt(row({ business_at: null })), { reached: 1, next: 'business' })
  assert.deepEqual(stoppedAt(row({ paid_at: day(1) })), { reached: 7, next: null })
})

test('the funnel counts each step, of all signups', () => {
  const f = funnel([row({}), row({ id: 'b', costed_at: null, priced_at: null, sale_at: null }), row({ id: 'c', business_at: null, purchase_at: null, costed_at: null, priced_at: null, sale_at: null })])
  assert.deepEqual(f.map((s) => [s.key, s.n]), [['signed_up', 3], ['business', 2], ['purchase', 2], ['costed', 1], ['priced', 1], ['sale', 1], ['paid', 0]])
  assert.equal(f[1].pct, 2 / 3)
  assert.equal(funnel([])[0].pct, null)
})

test('stuck: setup stopped too long at one step, the earliest gap only', () => {
  assert.deepEqual(stuckReasons(row({ business_at: null, purchase_at: null, costed_at: null, priced_at: null, sale_at: null, created_at: day(2) }), NOW),
    ['No business set up after a day'])
  assert.deepEqual(stuckReasons(row({ costed_at: null, priced_at: null, sale_at: null, purchase_at: day(3) }), NOW), ['No dish costed yet'])
  assert.deepEqual(stuckReasons(row({ sale_at: null, priced_at: day(4) }), NOW), ['No sale recorded yet'])
  // a paying Costing-only plan has no Sales, so no sale is expected
  assert.deepEqual(stuckReasons(row({ sale_at: null, priced_at: day(4), status: 'active', price_tier: 'standard', tier: 'costing' }), NOW), [])
})

test('stuck: help asked, unhappy, refusals, gone quiet', () => {
  assert.deepEqual(stuckReasons(row({ open_help: 1 }), NOW), ['Asked for help'])
  assert.deepEqual(stuckReasons(row({ low_score: 2, low_prompt: 'first_dish' }), NOW), ['Unhappy: rated 2 of 5'])
  assert.deepEqual(stuckReasons(row({ low_score: 6, low_prompt: 'nps' }), NOW), ['Unhappy: rated 6 of 10'])
  assert.deepEqual(stuckReasons(row({ low_score: 4, low_prompt: 'first_dish' }), NOW), [])
  assert.deepEqual(stuckReasons(row({ refusals_24h: 3 }), NOW), ['Hit 3 refusals today'])
  assert.deepEqual(stuckReasons(row({ seen_at: day(6), signed_in_at: day(6) }), NOW), ['Not seen for 6 days'])
  assert.deepEqual(stuckReasons(row({ seen_at: day(6), signed_in_at: day(6), status: 'active', price_tier: 'standard' }), NOW), [])
})

test('an ended trial or a cancelled plan is not "stuck"; status words', () => {
  assert.deepEqual(stuckReasons(row({ entitled: false, open_help: 2 }), NOW), ['Asked for help 2 times'])   // help waiting always counts
  assert.deepEqual(stuckReasons(row({ entitled: false, low_score: 1, low_prompt: 'first_dish' }), NOW), [])
  assert.equal(journeyStatus(row({ entitled: false }), NOW).word, 'Trial ended')
  assert.equal(journeyStatus(row({ open_help: 1 }), NOW).word, 'Needs you')
  assert.equal(journeyStatus(row({ refusals_24h: 4 }), NOW).word, 'Stuck')
  assert.equal(journeyStatus(row({}), NOW).word, 'On track')
  assert.equal(journeyStatus(row({ created_at: day(0.5), business_at: null, purchase_at: null, costed_at: null, priced_at: null, sale_at: null }), NOW).word, 'New')
  assert.equal(lastSeen(row({ seen_at: null, signed_in_at: day(2) })), day(2))
})

test('ratings: the recommend score and the ease average', () => {
  assert.deepEqual(npsScore([10, 9, 8, 6, null, 3]), { score: 0, n: 5, promoters: 2, passives: 1, detractors: 2 })
  assert.equal(npsScore([null]).score, null)
  assert.deepEqual(easeAverage([5, 4, 2, null]), { avg: 3.7, n: 3, hard: 1 })
  assert.equal(isLowScore('nps', 6), true)
  assert.equal(isLowScore('first_dish', 3), false)
  assert.equal(isLowScore('first_sale', null), false)
  assert.match(helpReply({ ref: 'H12', screen: 'Recipes', asked: 'x'.repeat(200) }), /^Hello, this is Menu Master\. You asked for help on Recipes about "x{77}…" \(ref H12\)\. $/)
})

test('live: how long ago and what the state means', () => {
  const now = new Date('2026-10-26T12:00:00Z')
  assert.equal(agoWords('2026-10-26T11:59:30Z', now), 'just now')
  assert.equal(agoWords('2026-10-26T11:50:00Z', now), '10 min ago')
  assert.equal(agoWords('2026-10-25T10:00:00Z', now), 'yesterday')
  assert.equal(agoWords(null, now), 'never')
  assert.equal(stateWords('2026-10-26T11:59:30Z', 'active', now).word, 'Using it now')
  assert.equal(stateWords('2026-10-26T11:59:30Z', 'idle', now).tone, 'neutral')
  assert.equal(stateWords('2026-10-26T11:59:30Z', 'hidden', now).word, 'Switched away')
  assert.equal(stateWords('2026-10-26T11:40:00Z', 'active', now).word, 'Went quiet')
})

test('one owner\'s story: steps, sessions as one line each, newest first', () => {
  const visit = (id: string, session: string, path: string, at: string, secs: number) => ({
    id, session_id: session, user_id: 'u1', screen: null, path, device: 'phone', started_at: at, last_seen_at: at, active_seconds: secs, state: 'left',
  })
  const j = {
    account: { id: 'a', name: 'Kitchen', created_at: day(3) },
    members: [{ user_id: 'u1', email: 'o@k.ng', role: 'owner', phone: null, opted_out_usage: false }],
    visits: [visit('1', 's1', '/dashboard', day(1), 30), visit('2', 's1', '/recipes', '2026-10-25T12:01:00Z', 90), visit('3', 's1', '/recipes', '2026-10-25T12:03:00Z', 60)],
    events: [{ kind: 'refusal' as const, screen: null, path: '/recipes', code: 'already', at: '2026-10-25T12:02:00Z', user_id: 'u1' }],
    help: [{ id: 7, screen: null, path: '/recipes', channel: 'message' as const, message: 'How do I price?', status: 'open' as const, note: null, created_at: '2026-10-25T12:04:00Z', handled_at: null, user_id: 'u1' }],
    feedback: [{ prompt: 'first_dish' as const, score: 2, comment: 'Too many steps', screen: null, created_at: '2026-10-25T12:05:00Z' }],
    checkins: [],
  }
  const t = buildTimeline(j, row({ created_at: day(3), business_at: day(3), purchase_at: null, costed_at: null, priced_at: null, sale_at: null }),
    { nameOf: (_s, p) => pathWords(p), duration: durationWords })
  assert.deepEqual(t.map((e) => e.kind), ['feedback', 'help', 'refusal', 'session', 'step', 'step'])
  const session = t.find((e) => e.kind === 'session')!
  assert.equal(session.title, 'Used the app for 3 min on a phone')
  assert.equal(session.detail, 'Dashboard → Recipes')
  assert.equal(t[0].tone, 'warn')
  assert.equal(t[1].tone, 'critical')
  assert.match(t[1].title, /H7, open/)
})

test('a low rating asks for a word for 30 days, or until the admin has checked in since', () => {
  const low = { low_score: 2, low_prompt: 'first_dish', low_score_at: day(3) }
  assert.equal(lowScoreOpen(row(low), NOW), true)
  assert.equal(lowScoreOpen(row({ ...low, low_score_at: day(31) }), NOW), false)
  assert.equal(lowScoreOpen(row({ ...low, last_checkin_at: day(1) }), NOW), false)
  assert.equal(lowScoreOpen(row({ ...low, last_checkin_at: day(5) }), NOW), true)    // the check-in was before the rating
  assert.equal(journeyStatus(row({ ...low, low_score_at: day(40) }), NOW).word, 'On track')
})

test('an owner who turned recording off is not "gone quiet"', () => {
  const off = row({ usage_opt_out_at: day(20), seen_at: null, signed_in_at: day(19) })
  assert.equal(recordingOff(off), true)
  assert.deepEqual(stuckReasons(off, NOW), [])
  // staff still recorded: the account is seen, so the usual rule applies
  // a staff member's old visit is not hers: still no 'gone quiet'
  assert.deepEqual(stuckReasons(row({ usage_opt_out_at: day(20), seen_at: day(20), signed_in_at: day(19) }), NOW), [])
  // setup gaps still count
  assert.deepEqual(stuckReasons(row({ usage_opt_out_at: day(20), seen_at: null, costed_at: null, priced_at: null, sale_at: null, purchase_at: day(3) }), NOW),
    ['No dish costed yet'])
})

test('a paying Costing customer is not expected to record a sale', () => {
  const costing = { status: 'active', price_tier: 'standard', tier: 'costing', sale_at: null, paid_at: day(2) }
  assert.deepEqual(stoppedAt(row(costing)), { reached: 7, next: null })
  assert.deepEqual(stoppedAt(row({ ...costing, paid_at: null })), { reached: 5, next: 'paid' })   // got to: Selling price set
  assert.deepEqual(stoppedAt(row({ ...costing, tier: 'trading', paid_at: null })), { reached: 5, next: 'sale' })
})

test('renewal off but still paid up is "Not renewing", not "Left"; an ended trial with help waiting needs you', () => {
  const cancelling = { status: 'cancelled', entitled: true, price_tier: 'standard' }
  assert.equal(journeyStatus(row(cancelling), NOW).word, 'Not renewing')
  assert.equal(journeyStatus(row({ ...cancelling, open_help: 1 }), NOW).word, 'Needs you')
  assert.equal(journeyStatus(row({ ...cancelling, low_score: 2, low_prompt: 'first_sale', low_score_at: day(2) }), NOW).word, 'Needs you')
  assert.equal(journeyStatus(row({ status: 'cancelled', entitled: false }), NOW).word, 'Left')
  assert.equal(journeyStatus(row({ entitled: false, open_help: 1 }), NOW).word, 'Needs you')
  assert.equal(journeyStatus(row({ entitled: false }), NOW).word, 'Trial ended')
})

test('one page load left open for days is split into separate uses', () => {
  const v = (id: string, start: string, end: string) => ({
    id, session_id: 's', user_id: 'u1', screen: null, path: '/sales', device: 'desktop', started_at: start, last_seen_at: end, active_seconds: 60, state: 'left',
  })
  const one = [v('1', '2026-10-24T08:00:00Z', '2026-10-24T08:20:00Z'), v('2', '2026-10-24T08:25:00Z', '2026-10-24T09:00:00Z'),
    v('3', '2026-10-24T15:00:00Z', '2026-10-24T15:10:00Z'), v('4', '2026-10-25T07:00:00Z', '2026-10-25T07:05:00Z')]
  assert.deepEqual(uses(one).map((u) => u.map((x) => x.id)), [['1', '2'], ['3'], ['4']])
  const j = { account: { id: 'a', name: 'K', created_at: day(5) }, members: [], visits: one, events: [], help: [], feedback: [], checkins: [] }
  assert.equal(buildTimeline(j, null, { nameOf: (_s, p) => pathWords(p), duration: durationWords }).filter((e) => e.kind === 'session').length, 3)
})
