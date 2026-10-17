/**
 * Carrying an order into New sale by its address: Price per head's "Take the
 * order" sends the dishes and how many of each, so 100 guests and four dishes
 * are not typed a second time.
 *
 *   /sales/new?add=<recipeId>:<variantId>*<qty>&add=...
 *
 * The address only names WHICH dishes and HOW MANY. Prices are never carried:
 * New sale takes each price from the menu it reads itself, so a link cannot
 * set what a dish sells for. Nothing is saved by opening it; the owner still
 * checks and confirms. Nothing here needs a new database function.
 *
 * Kept free of React and Next so it is tested directly
 * (tests/receipt-and-dates.test.mts).
 */

export type CarriedLine = { key: string; qty: number }

/** More than this many lines is not an order anyone typed; the rest is dropped. */
const MAX_LINES = 100
/** order_lines.qty is numeric(14,3): a thousandth is the finest step it keeps. */
const round3 = (n: number) => Math.round(n * 1000) / 1000
const KEY = /^[0-9a-f-]{36}:(?:[0-9a-f-]{36})?$/i

/** The New sale address for these lines. Lines with no quantity are left out. */
export function orderLink(lines: CarriedLine[]): string {
  const q = new URLSearchParams()
  for (const l of lines) {
    const qty = round3(l.qty)
    if (KEY.test(l.key) && Number.isFinite(qty) && qty > 0) q.append('add', `${l.key}*${qty}`)
  }
  const s = q.toString()
  return s ? `/sales/new?${s}` : '/sales/new'
}

/**
 * The lines an address carries, checked. Only a dish on this business's own
 * menu (`known`, the "recipeId:variantId" values New sale read) is accepted;
 * a quantity must be a number above zero. The same dish twice is added up.
 * Anything else is ignored rather than refused: the owner sees what arrived
 * and can add the rest by hand.
 */
export function readCarried(raw: string | string[] | undefined, known: ReadonlySet<string>): CarriedLine[] {
  const parts = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  const out = new Map<string, number>()
  for (const p of parts) {
    const star = p.lastIndexOf('*')
    if (star < 0) continue
    const key = p.slice(0, star).toLowerCase()
    const text = p.slice(star + 1).trim()
    // Number('') is 0 and Number(' ') is 0: a blank is not a quantity.
    if (!KEY.test(key) || !known.has(key) || !/^\d+(?:\.\d+)?$/.test(text)) continue
    const qty = round3(Number(text))
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) continue
    if (!out.has(key) && out.size >= MAX_LINES) continue
    out.set(key, round3((out.get(key) ?? 0) + qty))
  }
  return [...out.entries()].map(([key, qty]) => ({ key, qty }))
}
