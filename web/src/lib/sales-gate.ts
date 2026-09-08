/**
 * Whether to show the locked Sales page instead of the Sales product.
 *
 * Kept as a pure function so the one decision that matters can be tested
 * without a database or a browser: what to do when we DO NOT KNOW.
 *
 * Only an explicit false locks. Null -- the function is missing, or the lookup
 * failed -- renders the product as before. Locking on uncertainty would tell a
 * paying Costing + Sales customer that they cannot sell, which is a worse
 * failure than showing a button the database will refuse. Nothing is protected
 * by guessing here: RLS refuses the write either way, and it is the security
 * boundary. This only decides what to offer.
 */
export function isSalesLocked(canSell: boolean | null | undefined): boolean {
  return canSell === false
}
