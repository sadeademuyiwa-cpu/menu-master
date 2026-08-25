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
