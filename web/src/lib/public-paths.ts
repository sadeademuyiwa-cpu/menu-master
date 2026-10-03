/**
 * Which paths a signed-out visitor may open.
 *
 * Kept as a pure list so the rule is tested rather than assumed: a legal page
 * that silently redirects to /login is a page nobody can read before they
 * sign up, which defeats its purpose.
 *
 * Everything not listed requires a session. Adding a path here is a product
 * decision, not a convenience.
 */
export const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/verify-email',
  '/forgot-password',
  '/auth/callback',
  '/auth/confirm',
  '/terms',
  '/refunds',
  '/privacy',
] as const

export function isPublicPath(pathname: string): boolean {
  // '/' is the landing page only: every path starts with it, so it never
  // counts as a prefix.
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))
}
