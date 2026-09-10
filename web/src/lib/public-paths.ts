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
  '/login',
  '/signup',
  '/verify-email',
  '/auth/callback',
  '/terms',
  '/refunds',
] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}
