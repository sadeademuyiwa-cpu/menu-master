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

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
})

/** Money. Returns NOT_ENTERED for null — never ₦0.00. */
export function money(
  value: number | string | null | undefined,
  absent: string = NOT_ENTERED,
): string {
  if (value === null || value === undefined || value === '') return absent
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? ngn.format(n) : absent
}

/** Percentage. Returns NOT_AVAILABLE for null — never 0%. */
export function percent(
  value: number | string | null | undefined,
  absent: string = NOT_AVAILABLE,
): string {
  if (value === null || value === undefined || value === '') return absent
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : absent
}

/** Quantity with a unit. Both-or-neither: a bare number is never shown. */
export function quantity(
  value: number | string | null | undefined,
  unit: string | null | undefined,
  absent: string = NOT_MEASURED,
): string {
  if (value === null || value === undefined || !unit) return absent
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? `${n} ${unit}` : absent
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
    case 'missing_conversion': return { label: 'Needs measure', tone: 'warn' }
    case 'excluded':           return { label: 'Not counted',   tone: 'muted' }
    case 'sub_recipe':         return { label: 'Sub-recipe',    tone: 'muted' }
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
      return { label: 'You may be undercharging', tone: 'bad',
               detail: 'This sells for less than it costs you to make.' }
    case 'no_price_yet':
      return { label: 'Ready to sell', tone: 'muted',
               detail: 'The cost is worked out. Set a price to see your profit.' }
    case 'costing_incomplete':
      return { label: 'Costing incomplete', tone: 'muted',
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
