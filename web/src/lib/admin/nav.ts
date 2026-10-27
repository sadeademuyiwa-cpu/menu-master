/**
 * The platform admin's own navigation: grouped the way the work is (watch,
 * money, customers, the website), and the trail of names above every page.
 * Pure, so the rules are tested directly.
 */

export type AdminNavKey =
  | 'overview' | 'alerts' | 'live' | 'journeys' | 'feedback'
  | 'subscriptions' | 'billing' | 'signups' | 'site' | 'help'

export type AdminNavItem = { key: AdminNavKey; href: string; label: string }

// The daily two at the top; then the customers -- who is in the app now,
// how far each got, who asked for help, who pays, who is new -- what the
// public sees, and the Paystack log, which is for working out what went
// wrong, not for every day.
export const ADMIN_NAV_GROUPS: { label: string | null; items: AdminNavItem[] }[] = [
  { label: null, items: [
    { key: 'overview', href: '/admin', label: 'Overview' },
    { key: 'alerts', href: '/admin/alerts', label: 'Alerts' },
  ] },
  { label: 'Customers', items: [
    { key: 'live', href: '/admin/live', label: 'Live now' },
    { key: 'journeys', href: '/admin/journeys', label: 'Journeys' },
    { key: 'feedback', href: '/admin/feedback', label: 'Help & feedback' },
    { key: 'subscriptions', href: '/admin/subscriptions', label: 'Paying & trials' },
    { key: 'signups', href: '/admin/signups', label: 'Signups' },
  ] },
  { label: 'Website', items: [
    { key: 'site', href: '/admin/site', label: 'Website' },
    { key: 'help', href: '/admin/help', label: 'Help videos' },
  ] },
  { label: 'System', items: [{ key: 'billing', href: '/admin/billing', label: 'Paystack log' }] },
]

export const ADMIN_NAV: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items)

/** The pages inside Website, by the last part of their address. */
export const SITE_AREAS = [
  { slug: 'company', label: 'Company details' },
  { slug: 'sign-in', label: 'Sign in with Google' },
  { slug: 'tracking', label: 'Tracking pixels' },
  { slug: 'landing', label: 'Landing page' },
  { slug: 'privacy', label: 'Privacy policy' },
] as const

/** Overview lights only on /admin itself; every other item lights for its pages below it. */
export function isCurrent(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin' || pathname === '/admin/'
  return pathname === href || pathname.startsWith(href + '/')
}

/** "Admin / Website / Landing page", as links up to the current page. */
export function adminCrumbs(pathname: string): { label: string; href: string }[] {
  const trail = [{ label: 'Admin', href: '/admin' }]
  const item = ADMIN_NAV.find((i) => i.href !== '/admin' && isCurrent(i.href, pathname))
  if (!item) return [{ label: 'Admin', href: '/admin' }, { label: 'Overview', href: '/admin' }]
  trail.push({ label: item.label, href: item.href })
  if (item.key === 'site') {
    const slug = pathname.slice('/admin/site/'.length).split('/')[0]
    const area = SITE_AREAS.find((a) => a.slug === slug)
    if (area) trail.push({ label: area.label, href: `/admin/site/${area.slug}` })
  }
  return trail
}

/** The browser tab: "Admin · Landing page · Menu Master NG". */
export function adminTitle(pathname: string): string {
  const crumbs = adminCrumbs(pathname)
  return `Admin · ${crumbs[crumbs.length - 1].label} · Menu Master NG`
}
