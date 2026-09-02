/**
 * The primary navigation's destinations and its current-section rule.
 *
 * Kept free of React and Next imports so the rule can be tested directly,
 * without a browser or a running app.
 */

/**
 * Five primary destinations, not ten.
 *
 * Ten equally weighted items did not fit a 360px phone: the bar scrolled, and
 * the last entries sat off-screen behind a gesture most owners never make.
 * These five are the daily journey -- see, sell, buy, make, everything else --
 * and each remaining page is reached from the one it belongs to: Ingredients
 * from Purchases and Recipes, Customers from Sales, Suppliers from Purchases,
 * Formats from Recipes, Account from Settings.
 *
 * Sales took the fifth slot from Ingredients. Recording what you sold is a
 * daily act; opening the ingredient list is not, now that purchases are what
 * set prices.
 */
export const NAV = [
  { href: '/dashboard', label: 'Home' },
  { href: '/sales', label: 'Sales' },
  { href: '/purchases', label: 'Purchases' },
  { href: '/recipes', label: 'Recipes' },
  { href: '/more', label: 'More' },
] as const

/**
 * Which of the five the current URL belongs to.
 *
 * A child page counts as its parent: /sales/<id> is Sales, /recipes/<id> is
 * Recipes. Everything with no section of its own -- customers, ingredients,
 * suppliers, formats, pricing, settings, reports, account -- is reached from
 * More, which is exactly what /more lists, so More is where it highlights.
 * That leaves no page without an active item, which is the failure a user
 * notices: a navigation where nothing is lit.
 *
 * The prefix test requires a '/' boundary, so a future /salesforce would not
 * light up Sales.
 */
export function activeHref(pathname: string): string {
  const match = NAV.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
  return match ? match.href : '/more'
}
