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
 * and each remaining page sits under the tab it belongs to (TOOLS below).
 *
 * Sales took the fifth slot from Ingredients. Recording what you sold is a
 * daily act; opening the ingredient list is not, now that purchases are what
 * set prices.
 *
 * The fourth tab is called Dishes, because that is what an owner makes and
 * sells; "recipe" was our word. The address stays /recipes so no link,
 * bookmark or saved shortcut breaks.
 */
export const NAV = [
  { href: '/dashboard', label: 'Home' },
  { href: '/sales', label: 'Sales' },
  { href: '/purchases', label: 'Purchases' },
  { href: '/recipes', label: 'Dishes' },
  { href: '/more', label: 'More' },
] as const

export type NavItem = (typeof NAV)[number]
export type NavHref = NavItem['href']

/**
 * The tools that have no tab of their own, each under the tab it belongs to.
 *
 * Customers and Price per head are part of selling; Ingredients and Suppliers
 * are part of buying; Sizes and Prices are part of making a dish. They used to
 * all light More, so an owner on Customers saw "More" lit and looked for it
 * there, though she had reached it from Sales. The tab she came from is the
 * one that lights, and it is where her back link goes.
 *
 * Settings, People (/settings/people), Reports, Plans, Account, the setup
 * guide and Administration really are "everything else", so they light More.
 */
const TOOLS: Record<string, NavHref> = {
  '/customers': '/sales',
  '/quote': '/sales',
  '/ingredients': '/purchases',
  '/suppliers': '/purchases',
  '/formats': '/recipes',
  '/pricing': '/recipes',
  '/settings': '/more',
  '/reports': '/more',
  '/subscribe': '/more',
  '/account': '/more',
  '/start': '/more',
  '/admin': '/more',
}

/** pathname is `prefix` itself or a page under it. */
function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * Which of the five the current URL belongs to.
 *
 * A child page counts as its parent: /sales/<id> is Sales, /recipes/<id> is
 * Dishes, /customers/<id> is Sales because Customers is. Anything else -- a
 * page added later and not yet placed -- lights More. That leaves no page
 * without an active item, which is the failure a user notices: a navigation
 * where nothing is lit.
 *
 * The prefix test requires a '/' boundary, so a future /salesforce would not
 * light up Sales, and /pricing-history would not light Dishes.
 */
export function activeHref(pathname: string): NavHref {
  const tab = NAV.find((i) => within(pathname, i.href))
  if (tab) return tab.href
  const tool = Object.keys(TOOLS).find((prefix) => within(pathname, prefix))
  return tool ? TOOLS[tool] : '/more'
}

/**
 * The tab a tool page belongs to, for its back link: Customers goes back to
 * Sales, Ingredients to Purchases, Prices to Dishes. Null on a tab's own pages
 * (/sales, /sales/<id>), whose back link, if any, is their own business, and
 * on a page that has not been placed under a tab.
 */
export function parentTab(pathname: string): NavItem | null {
  if (NAV.some((i) => within(pathname, i.href))) return null
  const tool = Object.keys(TOOLS).find((prefix) => within(pathname, prefix))
  return tool ? NAV.find((i) => i.href === TOOLS[tool]) ?? null : null
}
