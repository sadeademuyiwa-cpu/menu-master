/**
 * A minimal PostgREST/GoTrue stand-in, ONLY for rendering evidence.
 *
 * It serves fixtures shaped exactly like the real responses so the pages can be
 * rendered and photographed. It is NOT a substitute for the database tests --
 * every rule about costing, blockers and isolation is proved in
 * tests/021_costing_mvp_journey.sql against real PostgreSQL with real RLS.
 */
import { createServer } from 'node:http'

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

const units = [
  { id: U(1), code: 'g', name: 'Gram', kind: 'mass', factor_to_base: 1 },
  { id: U(2), code: 'kg', name: 'Kilogram', kind: 'mass', factor_to_base: 1000 },
  { id: U(3), code: 'paint', name: 'Paint (rubber)', kind: 'container', factor_to_base: null },
]
const ingredients = [
  { id: U(10), name: 'Rice', kind: 'ingredient', base_unit_id: U(1), purchase_yield_pct: 100, is_active: true },
  { id: U(11), name: 'Salt', kind: 'ingredient', base_unit_id: U(1), purchase_yield_pct: 100, is_active: true },
]
const COMPLETE = process.env.MOCK_STATE !== 'blocked'

const recipes = [{
  id: U(20), name: 'Jollof Rice', batch_yield_qty: '4000', yield_unit_id: U(1),
  portion_qty: '500', cooking_yield_pct: '100', status: 'active',
}]
const recipeLines = [
  { id: U(30), recipe_id: U(20), ingredient_id: U(10), sub_recipe_id: null, qty: '2000', unit_id: U(1), is_cost_bearing: true },
  { id: U(31), recipe_id: U(20), ingredient_id: U(11), sub_recipe_id: null, qty: '50', unit_id: U(1), is_cost_bearing: true },
]
const costCurrent = [{
  recipe_id: U(20), is_complete: COMPLETE,
  batch_cost: COMPLETE ? '2275.0000' : null,
  cost_per_yield_unit: COMPLETE ? '0.568750' : null,
  cost_per_portion: COMPLETE ? '284.3750' : null,
  required_inputs: 2, priced_inputs: COMPLETE ? 2 : 1,
}]
const priceCheck = [{
  recipe_id: U(20), name: 'Jollof Rice', is_complete: COMPLETE,
  required_inputs: 2, priced_inputs: COMPLETE ? 2 : 1, excluded_inputs: 0,
  unpriced_items: COMPLETE ? [] : [{ name: 'Salt', problem: 'missing_price' }],
  cost_per_portion: COMPLETE ? '284.3750' : null,
  cost_floor_per_portion: COMPLETE ? '284.3750' : null,
  selling_price: '500.00',
  profit: COMPLETE ? '215.6250' : null,
  margin_pct: COMPLETE ? '43.13' : null,
  recommended_price: COMPLETE ? '500.00' : null,
  target_margin: '40.00',
}]
const blockers = COMPLETE ? [] : [
  { recipe_id: U(20), problem: 'missing_price', ingredient_name: 'Salt', unit_code: null, item: 'Salt' },
  { recipe_id: U(20), problem: 'missing_conversion', ingredient_name: 'Rice', unit_code: 'paint', item: 'Rice' },
]

const table = (name) => ({
  units, ingredients, recipes,
  recipe_lines: recipeLines,
  ingredient_prices: [{
    id: U(40), ingredient_id: U(10), qty_base: '8000.000000', amount: '9000.00', unit_cost: '1.125000',
    effective_date: '2026-08-20', source: 'manual', supplier_id: null,
  }],
  ingredient_unit_conversions: [{ id: U(50), ingredient_id: U(10), unit_id: U(3), qty_in_base: '4000.000000' }],
  v_missing_unit_conversions: COMPLETE ? [] : [{ ingredient_id: U(10), unit_code: 'paint', reason: 'blocking_recipe' }],
  v_recipe_cost_current: costCurrent,
  v_price_check: priceCheck,
  v_costing_blockers: blockers,
  memberships: [{ account_id: U(90), role: 'owner' }],
  businesses: [{ id: U(91), name: 'Ada Kitchen' }],
  subscriptions: [{
    plan_id: 'trial', status: 'trialing',
    trial_ends_at: COMPLETE ? '2026-09-20T00:00:00Z' : '2026-08-01T00:00:00Z',
    current_period_end: COMPLETE ? '2026-09-20T00:00:00Z' : '2026-08-01T00:00:00Z',
  }],
  plans: [{ id: 'trial', name: 'Free Trial' }],
  v_onboarding_status: [], v_dashboard_waterfall: [],
  v_profit_by_period: [], v_profit_by_product: [], v_voided_sales: [],

  // An empty draft sale, so the "Add an item" form renders and its price
  // prefill can be exercised. Jollof Rice already sells for N2,000, which is
  // what v_product_attention reports and what the form must offer.
  orders: [{
    id: U(60), order_no: 'TEST-1', order_date: '2026-09-02', status: 'draft',
    payment_status: 'unpaid', amount_paid: '0.00', order_discount: '0.00',
    customer_id: null, finalised_at: null, voided_at: null, void_reason: null, replaces: null,
  }],
  v_sale_lines: [],
  recipe_variants: [],
  customers: [],
  v_product_attention: [{
    recipe_id: U(20), variant_id: null, product_name: 'Jollof Rice', format_name: null,
    is_complete: true, true_cost: '1000.00', selling_price: '2000.00', profit: '1000.00',
    margin_pct: '50.00', recommended_price: '2000.00', state: 'ok', attention_rank: 1,
  }],
}[name] ?? [])

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (process.env.MOCK_LOG) console.log(req.method, url.pathname)
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range',
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const send = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', ...cors })
    res.end(JSON.stringify(body))
  }
  const jwt = (() => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const exp = Math.floor(Date.now() / 1000) + 3600
    return [b({ alg: 'HS256', typ: 'JWT' }),
            b({ sub: U(99), aud: 'authenticated', role: 'authenticated',
                email: 'ada@adakitchen.ng', exp, iat: exp - 3600 }), 'sig'].join('.')
  })()
  const mockUser = {
    id: U(99), email: 'ada@adakitchen.ng', aud: 'authenticated', role: 'authenticated',
    email_confirmed_at: '2026-08-01T00:00:00Z', confirmed_at: '2026-08-01T00:00:00Z',
    app_metadata: {}, user_metadata: {}, created_at: '2026-08-01T00:00:00Z',
  }
  // The harness signs in through the application's own login form, so the
  // session cookie is written by the real client rather than hand-forged.
  if (url.pathname === '/auth/v1/token') {
    return send({
      access_token: jwt, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'mock-refresh', user: mockUser,
    })
  }
  if (url.pathname === '/auth/v1/user') {
    return send(mockUser)
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return send(8000)
  if (url.pathname.startsWith('/rest/v1/')) {
    const name = url.pathname.replace('/rest/v1/', '')
    let rows = table(name)
    // crude eq filter support: ?id=eq.<uuid>
    for (const [k, v] of url.searchParams) {
      if (k === 'select' || k === 'order' || k === 'limit') continue
      if (typeof v === 'string' && v.startsWith('eq.')) {
        const want = v.slice(3)
        rows = rows.filter((r) => String(r[k]) === want)
      }
    }
    const accept = req.headers.accept ?? ''
    if (accept.includes('vnd.pgrst.object')) return send(rows[0] ?? null)
    return send(rows)
  }
  send({}, 404)
}).listen(54321, () => console.log('mock supabase on 54321'))
