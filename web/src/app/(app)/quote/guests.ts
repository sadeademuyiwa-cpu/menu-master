/**
 * How many guests, as typed on Price per head.
 *
 * Kept free of React, Next and the '@/' alias, so node --test can load it
 * straight from its path, like ../sales/new/carry.ts.
 */

/**
 * "1,000" is a thousand, as on the sale and purchase screens, which strip the
 * commas too. Null for a blank or anything that is not a whole number above
 * zero, so an unreadable count is never quietly worked out as 0 guests
 * ("₦0 for 0 guests", and an empty New sale).
 */
export function guestsOf(raw: string): number | null {
  const t = raw.replace(/,/g, '').trim()
  if (t === '') return null
  const v = Number(t)
  return Number.isInteger(v) && v > 0 ? v : null
}
