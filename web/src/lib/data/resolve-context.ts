/**
 * Tenancy context resolution, as pure decision logic.
 *
 * Kept free of Next and Supabase imports so every branch can be tested without
 * a network, a database or a request. context.ts supplies the real port.
 *
 * WHY THIS EXISTS
 *   On 2026-09-01 a live smoke test hit "No business found for your login."
 *   while starting a sale, on a login that had just created that very business.
 *   The lookup discarded its error, and an unauthenticated PostgREST request
 *   does not raise -- RLS simply returns zero rows. So a lapsed session and a
 *   genuinely missing business were byte-identical to the caller, and the code
 *   reported the one it happened to be written for.
 *
 *   These four outcomes are now distinct, and the caller is told which.
 */

export type ContextStatus =
  | 'ok'              // signed in, has an account, has a business
  | 'unauthenticated' // no valid session: the token is absent, expired or rejected
  | 'no_membership'   // signed in, but on no account yet -- a real new user
  | 'no_business'     // signed in, on an account, but the account has no business
  | 'error'           // a lookup actually failed; we do NOT pretend data is missing

export type ResolvedContext = {
  status: ContextStatus
  userId?: string
  accountId?: string
  role?: string
  businessId?: string
  businessName?: string
  /**
   * Only set when status is 'error'. The underlying message, kept for
   * SERVER-SIDE diagnostics only.
   *
   * It must never reach the browser: it can carry table, column, constraint,
   * policy and network detail. contextRedirect() deliberately ignores it and
   * emits a fixed generic sentence instead; currentContext() logs it.
   */
  failure?: string
}

type QueryResult<T> = { data: T | null; error: { message?: string } | null }

/**
 * The three reads this needs, as a port.
 *
 * getUserId is separate and is awaited FIRST, on purpose. The previous version
 * fired the two lookups concurrently through Promise.all against a client that
 * might be mid token-refresh; serialising the authentication removes that race
 * and means an invalid session is identified explicitly rather than inferred
 * from an empty result set.
 */
export type ContextPort = {
  getUserId: () => Promise<{ userId: string | null; error: unknown }>
  getMembership: () => Promise<QueryResult<{ account_id: string; role: string }>>
  getBusiness: () => Promise<QueryResult<{ id: string; name: string }>>
}

export async function resolveContext(port: ContextPort): Promise<ResolvedContext> {
  // 1. AUTHENTICATE, alone and first. getUser() validates the token against the
  //    auth server rather than trusting whatever is in the cookie.
  const auth = await port.getUserId()
  if (auth.error || !auth.userId) return { status: 'unauthenticated' }
  const userId = auth.userId

  // 2. MEMBERSHIP. An error here is an error, not an absence.
  const membership = await port.getMembership()
  if (membership.error) {
    return { status: 'error', userId, failure: membership.error.message }
  }
  if (!membership.data) return { status: 'no_membership', userId }

  const accountId = membership.data.account_id
  const role = membership.data.role

  // 3. BUSINESS. Same rule.
  const business = await port.getBusiness()
  if (business.error) {
    return { status: 'error', userId, accountId, role, failure: business.error.message }
  }
  if (!business.data) return { status: 'no_business', userId, accountId, role }

  return {
    status: 'ok',
    userId,
    accountId,
    role,
    businessId: business.data.id,
    businessName: business.data.name,
  }
}

/** Append a notice to a path. Server actions cannot return a value to a plain
 *  form, so the outcome rides on the URL, where it survives a refresh. */
export function withNotice(path: string, notice: string | null): string {
  if (!notice) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}notice=${encodeURIComponent(notice)}`
}

/**
 * The only thing a failed lookup is allowed to tell the browser. Fixed text,
 * no interpolation, so no database or network detail can travel in a URL.
 */
export const GENERIC_FAILURE = 'We couldn\u2019t complete that request. Please try again.'

/**
 * Where an incomplete context must send the caller, and what to tell them.
 *
 * It never claims data is missing when the real problem is the session, and it
 * never claims the session lapsed when a query actually failed.
 */
export function contextRedirect(ctx: ResolvedContext, here: string): string {
  switch (ctx.status) {
    case 'unauthenticated':
      return withNotice('/login', 'Your session expired — sign in again.')
    case 'no_membership':
      return '/onboarding'
    case 'no_business':
      return withNotice('/onboarding',
        'Finish setting up your business before recording that.')
    case 'error':
      // A FIXED string. ctx.failure is intentionally NOT used here: the notice
      // travels in the URL, which is visible to the user, shared, logged by
      // proxies and kept in browser history. The real message is logged
      // server-side by currentContext().
      return withNotice(here, GENERIC_FAILURE)
    default:
      return here
  }
}
