/**
 * The price sums the screens show live: what a price keeps, its margin, and
 * the price that reaches the owner's own target.
 *
 * These are the SAME sums v_price_check does in PostgreSQL
 * (migrations/0037_deterministic_snapshot.sql, the profit, margin_pct and
 * recommended_price columns), so "Try a price" on a phone and the database
 * can never disagree. tests/pricing.test.mts pins them to figures computed
 * by PostgreSQL itself.
 *
 * Kept free of React and Next imports so it is tested directly.
 *
 * GOVERNING RULE: a missing figure stays missing. Every function returns null
 * when an input is absent or is not a number. None of them invents a cost,
 * and none of them turns a null into 0.
 *
 * WHY INTEGERS. PostgreSQL does these sums in exact decimals; JavaScript
 * numbers are binary. 700 / (1 - 0.3) is 1000.0000000000001 in binary, and
 * the ceil() in the suggested price then jumps a whole rounding step
 * (₦1,050 instead of ₦1,000). Every figure is therefore read as a whole
 * number of millionths -- costs are numeric(18,4), prices numeric(14,2),
 * targets numeric(5,2) -- and the sums are done on BigInt, where they are
 * exact, exactly as the database's are.
 */

type Figure = number | string | null | undefined

const DP = 6
const ONE = 10n ** BigInt(DP) // one, in millionths

/**
 * A figure as a whole number of millionths, or null. A decimal string (what
 * PostgREST returns for numeric) is read digit by digit, so nothing is lost
 * to binary on the way in. Past six decimals it rounds half away from zero.
 */
function micros(v: Figure): bigint | null {
  if (v === null || v === undefined) return null
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v.trim()
  if (s === '') return null
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s) ?? /^(-?)()\.(\d+)$/.exec(s)
  if (!m) {
    // Exponent form (1e-7, 1e+21) or not a number at all.
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    const r = Math.round(n * 10 ** DP)
    return Number.isSafeInteger(r) ? BigInt(r) : null
  }
  const frac = (m[3] ?? '').padEnd(DP + 1, '0')
  let units = BigInt((m[2] || '0') + frac.slice(0, DP))
  if (frac.charCodeAt(DP) >= 53 /* '5' */) units += 1n
  return m[1] === '-' ? -units : units
}

/** num / den rounded half away from zero, as PostgreSQL's round() does. den > 0. */
function divRound(num: bigint, den: bigint): bigint {
  const neg = num < 0n
  const a = neg ? -num : num
  let q = a / den
  if ((a % den) * 2n >= den) q += 1n
  return neg ? -q : q
}

/** ceil(num / den) for den > 0. BigInt division truncates toward zero. */
function divCeil(num: bigint, den: bigint): bigint {
  const q = num / den
  return num > 0n && num % den !== 0n ? q + 1n : q
}

/**
 * What one portion keeps at this price: price - cost, to the kobo.
 *
 * v_price_check: round(p.price - x.cost_per_portion, 2) AS profit.
 *
 * Pass the cost only when the costing is complete (v_price_check's
 * cost_per_portion is already null when it is not). A price of 0 is a real
 * price and keeps -cost, as the view says.
 */
export function keepAt(price: Figure, cost: Figure): number | null {
  const p = micros(price)
  const c = micros(cost)
  if (p === null || c === null) return null
  return Number(divRound(p - c, 10n ** BigInt(DP - 2))) / 100
}

/**
 * The margin at this price, as a percentage to two decimals.
 *
 * v_price_check: round(100.0 * (p.price - x.cost_per_portion) / p.price, 2)
 * AS margin_pct, and only when p.price > 0. A margin on a free item has no
 * meaning, so a price of 0 or less returns null.
 */
export function marginAt(price: Figure, cost: Figure): number | null {
  const p = micros(price)
  const c = micros(cost)
  if (p === null || c === null || p <= 0n) return null
  // Hundredths of a percent: 100 for the percentage, 100 for two decimals.
  return Number(divRound((p - c) * 10_000n, p)) / 100
}

/**
 * The price that keeps the owner's own target margin, rounded UP to her
 * price rounding (business_settings.price_rounding_to).
 *
 * v_price_check, recommended_price:
 *   ceil(x.cost_per_portion / (1 - target_margin / 100.0) / price_rounding_to)
 *     * price_rounding_to
 *   only when the cost is known and target_margin < 100.
 *
 * Null when any input is missing, when the target is 100% or more (no price
 * can keep all of itself), and when the rounding is not above zero (the
 * database would divide by zero; settings refuse it, see settings/page.tsx).
 * A real cost of 0 suggests 0, as the view does; a caller offering
 * "Use ₦X" should not offer ₦0 (components/use-price.tsx does not).
 */
export function suggestedPrice(cost: Figure, targetMarginPct: Figure, roundTo: Figure): number | null {
  const c = micros(cost)
  const t = micros(targetMarginPct)
  const r = micros(roundTo)
  if (c === null || t === null || r === null) return null
  const hundred = 100n * ONE
  if (t >= hundred || r <= 0n) return null
  // cost / (1 - t/100) / r, with every figure in millionths, is
  // c * 100 * ONE / ((100 * ONE - t) * r): one exact division.
  const steps = divCeil(c * hundred, (hundred - t) * r)
  return Number(steps * r) / Number(ONE)
}

/**
 * The roles the database lets see costs and selling prices, and set prices:
 * fn_can_see_costs (migrations/0004_integrity_and_security_fixes.sql), which
 * guards recipe_prices, ingredient_prices and cost_snapshots.
 *
 * This is a COURTESY, never an authorization: it decides whether a screen
 * shows "you keep ₦X" or a "Use ₦1,450" button, so a sales or kitchen member
 * is not offered something the database will refuse. RLS still refuses it if
 * this is ever wrong. Cost figures for other roles should be left out on the
 * server, not hidden on the screen.
 */
export const PRICE_ROLES = ['owner', 'manager', 'accountant'] as const

export function canSeeCosts(role: string | null | undefined): boolean {
  return (PRICE_ROLES as readonly string[]).includes(role ?? '')
}

/** Who may set a selling price: the same roles (recipe_prices, 0004). */
export function canSetPrices(role: string | null | undefined): boolean {
  return canSeeCosts(role)
}

/**
 * Who may see what a dish SELLS for, once migration 0064 is applied: the
 * price roles plus sales, through fn_menu_prices(), which returns selling
 * prices and nothing derived from a cost. Kitchen stays out (the owner's
 * ruling, 16 Oct 2026). Before 0064, sales members still read no price at all.
 *
 * Seeing a selling price is not seeing a cost: a sales member is never shown
 * "you keep", a margin or a suggested price, which canSeeCosts() guards.
 */
export const MENU_PRICE_ROLES = ['owner', 'manager', 'sales', 'accountant'] as const

export function canSeeSellingPrices(role: string | null | undefined): boolean {
  return (MENU_PRICE_ROLES as readonly string[]).includes(role ?? '')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A dish's id as the database prints it, or null. */
export function recipeIdOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null
}

/**
 * Where the price action (lib/actions/set-price.ts) sends the owner back to.
 *
 * A "Use ₦1,450" on Home must land back on Home with its toast, the same
 * button on the dish page back on the dish. The address arrives in a form
 * field, so it is attacker-controlled: only the pages that show prices are
 * accepted -- Home, the dish list, a dish, Prices and New sale -- matched
 * exactly, so "//evil.example", "https://...", "/dashboard.evil" and every
 * other page fall back to the dish itself. The query string is kept (the dish
 * page's ?view=pro) except an old ?notice=, which the action replaces; it is
 * re-encoded by URLSearchParams, so nothing raw reaches the Location header.
 */
export function priceReturnPath(returnTo: unknown, recipeId: string): string {
  const fallback = `/recipes/${recipeId}`
  if (typeof returnTo !== 'string') return fallback
  const raw = returnTo.trim().split('#')[0]
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  const page = ['/dashboard', '/recipes', '/pricing', '/sales/new'].includes(path)
    || /^\/recipes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
  if (!page) return fallback
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1))
  params.delete('notice')
  const query = params.toString()
  return query ? `${path}?${query}` : path
}
