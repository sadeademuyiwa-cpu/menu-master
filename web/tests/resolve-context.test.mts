/**
 * Context resolution.
 *
 * The bug these exist for: on 2026-09-01 a live smoke test was told
 * "No business found for your login." while starting a sale, on a login that
 * had created that business minutes earlier. An unauthenticated PostgREST
 * request does not raise -- RLS returns zero rows -- and the old lookup
 * discarded its error, so a lapsed session and a genuinely missing business
 * were indistinguishable.
 *
 * Run: node --test --experimental-strip-types src/lib/data/__tests__/*.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveContext, contextRedirect, GENERIC_FAILURE, type ContextPort } from '../src/lib/data/resolve-context.ts'

const USER = { userId: 'user-1', error: null }
const MEMBER = { data: { account_id: 'acct-1', role: 'owner' }, error: null }
const BIZ = { data: { id: 'biz-1', name: 'TEST BUSINESS' }, error: null }

const port = (o: Partial<ContextPort> = {}): ContextPort => ({
  getUserId: async () => USER,
  getMembership: async () => MEMBER,
  getBusiness: async () => BIZ,
  ...o,
})

// A. the happy path still resolves exactly as before
test('A. valid session with a business resolves to ok, with both ids', async () => {
  const ctx = await resolveContext(port())
  assert.equal(ctx.status, 'ok')
  assert.equal(ctx.accountId, 'acct-1')
  assert.equal(ctx.businessId, 'biz-1')
  assert.equal(ctx.businessName, 'TEST BUSINESS')
  assert.equal(ctx.role, 'owner')
  assert.equal(contextRedirect(ctx, '/sales'), '/sales')
})

// B. THE REGRESSION. An expired session must be named as one.
test('B. expired session is unauthenticated, and never blamed on the business', async () => {
  // The shape a lapsed session actually produces: getUser fails, and the two
  // lookups would have returned zero rows WITHOUT an error.
  const ctx = await resolveContext(port({
    getUserId: async () => ({ userId: null, error: { message: 'invalid JWT' } }),
    getMembership: async () => ({ data: null, error: null }),
    getBusiness: async () => ({ data: null, error: null }),
  }))
  assert.equal(ctx.status, 'unauthenticated')
  const to = contextRedirect(ctx, '/sales')
  assert.match(to, /^\/login\?notice=/)
  assert.match(decodeURIComponent(to), /session expired/i)
  assert.doesNotMatch(decodeURIComponent(to), /No business found/i)
  assert.doesNotMatch(decodeURIComponent(to), /No account found/i)
})

test('B2. a null user with no error is also unauthenticated, not "no account"', async () => {
  const ctx = await resolveContext(port({ getUserId: async () => ({ userId: null, error: null }) }))
  assert.equal(ctx.status, 'unauthenticated')
})

// C. a real new user is NOT a session problem
test('C. signed in with no membership is no_membership, and goes to onboarding', async () => {
  const ctx = await resolveContext(port({ getMembership: async () => ({ data: null, error: null }) }))
  assert.equal(ctx.status, 'no_membership')
  assert.equal(ctx.userId, 'user-1')
  assert.equal(contextRedirect(ctx, '/sales'), '/onboarding')
})

// D. an account without a business is its own case
test('D. signed in, has an account, no business -> no_business, keeps the account id', async () => {
  const ctx = await resolveContext(port({ getBusiness: async () => ({ data: null, error: null }) }))
  assert.equal(ctx.status, 'no_business')
  assert.equal(ctx.accountId, 'acct-1')
  assert.equal(ctx.businessId, undefined)
  const to = contextRedirect(ctx, '/sales')
  assert.match(to, /^\/onboarding\?notice=/)
  assert.match(decodeURIComponent(to), /setting up your business/i)
})

// E. errors must not be swallowed and re-reported as absence
test('E1. a membership query error is an error, and keeps the real message server-side', async () => {
  const ctx = await resolveContext(port({
    getMembership: async () => ({ data: null, error: { message: 'statement timeout' } }),
  }))
  assert.equal(ctx.status, 'error')
  // Available to the server for logging...
  assert.equal(ctx.failure, 'statement timeout')
  // ...and absent from anything the browser sees.
  const to = decodeURIComponent(contextRedirect(ctx, '/sales'))
  assert.doesNotMatch(to, /statement timeout/)
  assert.ok(to.includes(GENERIC_FAILURE))
})

test('E2. a business query error stays on the page and leaks nothing', async () => {
  const ctx = await resolveContext(port({
    getBusiness: async () => ({ data: null, error: { message: 'connection reset' } }),
  }))
  assert.equal(ctx.status, 'error')
  assert.equal(ctx.accountId, 'acct-1')
  assert.equal(ctx.failure, 'connection reset')
  const to = contextRedirect(ctx, '/sales')
  assert.match(to, /^\/sales\?notice=/)
  assert.doesNotMatch(decodeURIComponent(to), /connection reset/)
})

test('E4. no database, network or SQL detail can reach a URL, whatever the error says', () => {
  // Messages shaped like the ones PostgREST, Postgres and undici actually emit.
  const leaky = [
    'permission denied for table memberships',
    'new row violates row-level security policy for relation "orders"',
    'relation "public.businesses" does not exist',
    'duplicate key value violates unique constraint "businesses_slug_key"',
    'connect ECONNREFUSED 10.0.0.7:5432',
    'FATAL: password authentication failed for user "postgres"',
    'JWSError JWSInvalidSignature',
  ]
  const forbidden = /table|relation|constraint|policy|row-level|schema|public\.|postgres|password|ECONN|\d+\.\d+\.\d+\.\d+|:\d{4}|JWS|SQL|select |insert |update /i
  for (const message of leaky) {
    const to = contextRedirect({ status: 'error', failure: message }, '/sales')
    const shown = decodeURIComponent(to)
    assert.doesNotMatch(shown, forbidden, `leaked from: ${message}`)
    assert.ok(shown.includes(GENERIC_FAILURE))
  }
})

test('E5. the generic sentence is fixed text with nothing interpolated', () => {
  const a = decodeURIComponent(contextRedirect({ status: 'error', failure: 'AAA' }, '/sales'))
  const b = decodeURIComponent(contextRedirect({ status: 'error', failure: 'BBB' }, '/sales'))
  assert.equal(a, b, 'the notice must not vary with the underlying error')
  assert.doesNotMatch(a, /AAA|BBB/)
})

test('E3. authentication is awaited BEFORE the lookups run', async () => {
  // The old code fired both lookups through Promise.all while the session might
  // be mid-refresh. Nothing may be read until the user is known.
  const order: string[] = []
  await resolveContext({
    getUserId: async () => { order.push('auth'); return { userId: null, error: null } },
    getMembership: async () => { order.push('membership'); return MEMBER },
    getBusiness: async () => { order.push('business'); return BIZ },
  })
  assert.deepEqual(order, ['auth'], 'no lookup may run for an unauthenticated caller')

  const order2: string[] = []
  await resolveContext({
    getUserId: async () => { order2.push('auth'); return USER },
    getMembership: async () => { order2.push('membership'); return MEMBER },
    getBusiness: async () => { order2.push('business'); return BIZ },
  })
  assert.deepEqual(order2, ['auth', 'membership', 'business'], 'reads are serial, after auth')
})

// F. the guard that failed in production
test('F. no app guard can still blame the business for a session failure', () => {
  // contextRedirect is what every guard now calls; an unauthenticated context
  // can only produce the login route.
  for (const here of ['/sales', '/customers', '/purchases', '/recipes', '/ingredients']) {
    const to = decodeURIComponent(contextRedirect({ status: 'unauthenticated' }, here))
    assert.doesNotMatch(to, /No business found|No account found/)
    assert.match(to, /session expired/i)
  }
})

test('F2. the false messages are gone from the application source', () => {
  const files = [
    'src/app/(app)/sales/page.tsx',
    'src/app/(app)/sales/[id]/page.tsx',
    'src/app/(app)/customers/page.tsx',
    'src/app/(app)/purchases/page.tsx',
    'src/app/(app)/recipes/page.tsx',
    'src/app/(app)/ingredients/page.tsx',
  ]
  for (const f of files) {
    const src = readFileSync(join(import.meta.dirname, '..', f), 'utf8')
    assert.doesNotMatch(src, /No business found for your login/, f)
    assert.doesNotMatch(src, /No account found for your login/, f)
    assert.match(src, /contextRedirect\(/, `${f} must consult the context status`)
  }
})

// ---------------------------------------------------------------------------
// The /sales list is fed by v_orders_attention, which ends
//   where o.voided_at is null and o.status <> 'cancelled'
// so a cancelled sale is deliberately absent from it. It keeps its record, its
// frozen cost and its reason, and is reachable under Reports -> Voided sales.
// The heading must not claim otherwise. Certified Phase 6 behaviour; this
// guards the WORDING, not the query.
// ---------------------------------------------------------------------------
test('G. the sales list does not claim to show every sale', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src/app/(app)/sales/page.tsx'), 'utf8')

  // It still reads the attention view -- the fix must not have changed the query.
  assert.match(src, /from\('v_orders_attention'\)/,
    'the list must still come from v_orders_attention')

  // And it must not label that view "All sales".
  assert.doesNotMatch(src, />All sales</,
    'v_orders_attention excludes cancelled sales, so it cannot be headed "All sales"')

  // It must say where the cancelled ones went.
  assert.match(src, /Cancelled sales are kept under/,
    'the heading must point at Reports -> Voided sales')
  assert.match(src, /Voided sales/, 'it must name the destination')
})
