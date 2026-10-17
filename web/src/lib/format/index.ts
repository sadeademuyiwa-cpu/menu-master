/**
 * GOVERNING RULE, IN CODE.
 *
 * Personal data is the source of truth. A missing price, conversion, yield or
 * labour rate stays NULL and the record is incomplete. NULL is NEVER rendered
 * as zero, a dash that reads as zero, or an estimate.
 *
 * Every numeric formatter here returns an explicit "not entered" string for
 * null/undefined. Do not add a `?? 0` anywhere in this file or its callers.
 */

export const NOT_ENTERED = 'not entered'
export const NOT_MEASURED = 'not measured'
export const NOT_AVAILABLE = 'not available'

/**
 * A sale's number, said plainly.
 *
 * fn_reissue_order (0014) numbers a replacement by suffixing the original:
 * S-0012-R, then -R2, -R3. That is a sound unique key and an unreadable
 * label. The database keeps the key; the screen says what it means.
 */
export function saleLabel(orderNo: string | null | undefined): string | null {
  if (!orderNo) return null
  const m = /^(.*?)-R(\d*)$/.exec(orderNo)
  if (!m) return orderNo
  const nth = m[2] ? Number(m[2]) : 1
  return `${m[1]} (replacement${nth > 1 ? ` ${nth}` : ''})`
}

/**
 * A purchase reference without the database's own marker.
 *
 * fn_reverse_purchase (0016) files the reversing record under the original
 * reference plus " (reversal)". The status column already says "Cancelled";
 * the marker only told the owner something in a voice that was not theirs.
 */
export function purchaseReference(reference: string | null | undefined): string | null {
  if (!reference) return null
  const cleaned = reference.replace(/\s*\(reversal\)$/, '').trim()
  return cleaned || null
}

const ngnWhole = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
const ngnKobo = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** A finite number from a figure as the database or a form hands it over, or null. */
function figure(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : null
}

/**
 * Money, the way an owner says it: ₦850, ₦184,500, ₦213 for 212.93. From
 * ₦100 up the figure is whole naira; below ₦100 kobo show when there are kobo
 * (₦1.70 a gram, ₦0.40 of salt), because there they carry the meaning.
 * Returns NOT_ENTERED for null -- never ₦0. moneyExact shows every kobo.
 *
 * Small amounts are judged to the kobo first, so a float like 0.1 + 0.2 reads
 * ₦0.30, and -0.004 is ₦0, not "-₦0".
 */
export function money(
  value: number | string | null | undefined,
  absent: string = NOT_ENTERED,
): string {
  const n = figure(value)
  if (n === null) return absent
  // From ₦100 up, whole naira: the owner asked for fewer numbers, and the
  // 93 kobo in "₦212.93" is noise on a plate. Halves round away from zero,
  // as PostgreSQL's round() does. Below ₦100 the kobo carry meaning (₦1.70
  // a gram), so they stay. moneyExact is there for anything that must show
  // every kobo.
  if (Math.abs(n) >= 99.995) return ngnWhole.format(Math.sign(n) * Math.round(Math.abs(n)) + 0)
  const kobo = Math.round(n * 100)
  const naira = kobo / 100 + 0 // + 0 turns -0 into 0
  return kobo % 100 === 0 ? ngnWhole.format(naira) : ngnKobo.format(naira)
}

/**
 * Money with its kobo always shown: ₦850.00. For the places where kobo
 * matter even when there are none, such as a table of ingredient unit prices
 * that must line up. Returns NOT_ENTERED for null -- never ₦0.00.
 */
export function moneyExact(
  value: number | string | null | undefined,
  absent: string = NOT_ENTERED,
): string {
  const n = figure(value)
  return n === null ? absent : ngnKobo.format(Math.round(n * 100) / 100 + 0)
}

/**
 * Percentage in whole numbers: 15%, -13%. One decimal only below 1%
 * (0.4%), where rounding to a whole number would say 0% about a margin that
 * is not zero. Returns NOT_AVAILABLE for null -- never 0%.
 *
 * toFixed rounds a half away from zero (12.5 -> 13, -12.5 -> -13), as
 * PostgreSQL's round() does on the figures this displays.
 */
export function percent(
  value: number | string | null | undefined,
  absent: string = NOT_AVAILABLE,
): string {
  const n = figure(value)
  if (n === null) return absent
  if (Math.abs(n) >= 1) return `${n.toFixed(0)}%`
  // 0.04 -> "0.0" and 0.96 -> "1.0": say those as 0% and 1%, without a sign on zero.
  const s = n.toFixed(1)
  const whole = s.endsWith('.0') ? String(Number(s) + 0) : s
  return `${whole}%`
}

/**
 * The business's own target margin, as she set it: 40%, 37.5%. Never rounded:
 * Settings holds 37.5 (numeric(5,2)), and "your 38% target" would be a figure
 * she never chose. Trailing zeros go ("40.00" from PostgREST is 40%).
 */
export function targetPercent(
  value: number | string | null | undefined,
  absent: string = NOT_AVAILABLE,
): string {
  const n = figure(value)
  if (n === null) return absent
  return `${Number(n.toFixed(2)) + 0}%`
}

/**
 * A margin printed beside its target. Whole numbers, as percent(), except
 * where rounding would make it read as the target or as past it: 39.6
 * against 40 would print "40%" beside "Below your target". There it keeps one
 * decimal, cut toward the truth (down when under the target, up when over),
 * so 39.96 is "39.9%", never "40.0%". A margin exactly at the target prints
 * as the target does.
 */
export function marginPercent(
  margin: number | string | null | undefined,
  target: number | string | null | undefined,
  absent: string = NOT_AVAILABLE,
): string {
  const m = figure(margin)
  if (m === null) return absent
  const t = figure(target)
  if (t === null) return percent(m, absent)
  if (m === t) return targetPercent(t)
  // The figure percent() would print, as a number.
  const shown = Number(Math.abs(m) >= 1 ? m.toFixed(0) : m.toFixed(1))
  const misleads = m < t ? shown >= t : shown <= t
  if (!misleads) return percent(m, absent)
  // The epsilon keeps a float such as 37.3 * 10 = 372.99999999999994 at
  // 37.3; it must never carry the figure onto the target itself.
  const down = Math.floor(m * 10 + 1e-9) / 10
  const up = Math.ceil(m * 10 - 1e-9) / 10
  const cut = m < t
    ? (down < t ? down : Math.floor(m * 10) / 10)
    : (up > t ? up : Math.ceil(m * 10) / 10)
  return `${(cut + 0).toFixed(1)}%`
}

/** Quantity with a unit. Both-or-neither: a bare number is never shown. */
export function quantity(
  value: number | string | null | undefined,
  unit: string | null | undefined,
  absent: string = NOT_MEASURED,
): string {
  if (value === null || value === undefined || !unit) return absent
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return absent

  /*
    PRESENTATION ONLY -- no cost is derived from this.

    Quantities are stored in the ingredient's base unit, so a 50 kg bag is
    held as 50000 g and was being shown that way: "You bought 50000 g for
    N85,000". That is true and unreadable, and it is not what the owner
    bought. Scale grams and millilitres up when the number is large enough to
    say plainly. The pairs below are exact factors within one measurement
    kind, so nothing is rounded into existence and no conversion is invented.
  */
  const SCALE: Record<string, { to: string; per: number }> = {
    g: { to: 'kg', per: 1000 },
    ml: { to: 'l', per: 1000 },
  }
  const s = SCALE[unit]
  if (s && Math.abs(n) >= s.per && n % s.per === 0) {
    return `${(n / s.per).toLocaleString('en-NG')} ${s.to}`
  }
  return `${n.toLocaleString('en-NG')} ${unit}`
}

/**
 * Cost coverage must always accompany a profit figure (frontend blueprint
 * rule 3): a margin over 40% coverage is not the same claim as one over 100%.
 */
export function coverageLabel(pct: number | string | null | undefined): string {
  if (pct === null || pct === undefined) return 'coverage unknown'
  const n = typeof pct === 'string' ? Number(pct) : pct
  if (!Number.isFinite(n)) return 'coverage unknown'
  return `${n.toFixed(0)}% of revenue has a verified cost`
}

/**
 * Margin health, as words a food-business owner uses.
 *
 * PRESENTATION ONLY. The threshold is the business's own
 * `default_target_margin` (or the channel's, where one is set) -- it is not
 * invented here, and this function decides nothing financial. It is isolated so
 * it can become configurable without touching any page.
 *
 * A negative margin is NEVER "fair". Selling below cost is its own verdict.
 */
export type MarginVerdict = {
  label: 'Loss' | 'Low' | 'Fair' | 'Healthy'
  tone: 'bad' | 'warn' | 'ok' | 'good'
  sentence: string
}

export function marginVerdict(
  marginPct: number | null,
  targetPct: number | null,
): MarginVerdict | null {
  if (marginPct === null || !Number.isFinite(marginPct)) return null

  if (marginPct < 0) {
    return {
      label: 'Loss',
      tone: 'bad',
      sentence: 'You are selling this for less than it costs you to make.',
    }
  }

  const target = targetPct !== null && Number.isFinite(targetPct) && targetPct > 0
    ? targetPct
    : null

  if (target === null) {
    return {
      label: 'Fair',
      tone: 'ok',
      sentence: 'Set a target margin in your settings to see whether this is where you want it.',
    }
  }
  if (marginPct >= target) {
    return {
      label: 'Healthy',
      tone: 'good',
      sentence: `At or above your ${target}% target.`,
    }
  }
  if (marginPct >= target * 0.75) {
    return {
      label: 'Fair',
      tone: 'ok',
      sentence: `A little under your ${target}% target.`,
    }
  }
  return {
    label: 'Low',
    tone: 'warn',
    sentence: `Well under your ${target}% target.`,
  }
}

/**
 * The state of one ingredient line on the costing worksheet, in the owner's
 * words. `problem` comes from v_recipe_line_costs, which derives it from the
 * same functions that produce the cost -- so a line can never show a healthy
 * status beside a cost the engine refused to compute.
 */
export function lineStatus(problem: string | null | undefined): {
  label: string
  tone: 'good' | 'warn' | 'muted'
} {
  switch (problem) {
    case 'ok':                 return { label: 'Costed',        tone: 'good' }
    case 'missing_price':      return { label: 'No price yet',  tone: 'warn' }
    case 'missing_conversion': return { label: 'Needs a measure', tone: 'warn' }
    case 'excluded':           return { label: 'Not counted',     tone: 'muted' }
    case 'sub_recipe':         return { label: 'Made from another dish', tone: 'muted' }
    default:                   return { label: 'Unknown',       tone: 'warn' }
  }
}

/**
 * A product's state, in words a food-business owner uses. The state itself is
 * decided in PostgreSQL (v_product_attention) so the page cannot invent a
 * different one; this only chooses the wording and the colour.
 *
 * Nothing not-yet-finished is shown in a warning colour. A business still
 * setting up has done nothing wrong, and colouring its half-built products
 * like losses would teach it to ignore the colour that matters.
 */
export function productState(state: string | null | undefined): {
  label: string
  detail: string
  tone: 'good' | 'warn' | 'bad' | 'muted'
} {
  switch (state) {
    case 'healthy':
      return { label: 'Healthy margin', tone: 'good',
               detail: 'This is at or above the margin you asked for.' }
    case 'below_target':
      return { label: 'Below your target', tone: 'warn',
               detail: 'You are making money, but less than you planned.' }
    case 'losing_money':
      return { label: 'Selling at a loss', tone: 'bad',
               detail: 'This sells for less than it costs you to make.' }
    case 'no_price_yet':
      return { label: 'No price yet', tone: 'muted',
               detail: 'The cost is worked out. Set a price to see your profit.' }
    case 'costing_incomplete':
      return { label: 'Cost incomplete', tone: 'muted',
               detail: 'A few figures are still missing before this can be costed.' }
    default:
      return { label: 'Not costed yet', tone: 'muted', detail: '' }
  }
}

/** The state of an ingredient's price, in the same register. */
export function priceState(state: string | null | undefined): {
  label: string
  tone: 'good' | 'warn' | 'muted'
} {
  switch (state) {
    case 'current':      return { label: 'Up to date',        tone: 'good' }
    case 'out_of_date':  return { label: 'Price may be old',  tone: 'warn' }
    case 'estimate_only':return { label: 'Estimate only',     tone: 'warn' }
    case 'never_priced': return { label: 'Price needed',      tone: 'muted' }
    default:             return { label: 'Unknown',           tone: 'muted' }
  }
}
