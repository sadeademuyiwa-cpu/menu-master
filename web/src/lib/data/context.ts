import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { resolveContext, type ResolvedContext } from './resolve-context'

export {
  contextRedirect, withNotice,
  type ContextStatus, type ResolvedContext,
} from './resolve-context'

/**
 * The caller's account and default business.
 *
 * This is a CONVENIENCE LOOKUP, never an authorization decision. Every write
 * still passes through RLS, which refuses a foreign account_id regardless of
 * what this returns.
 *
 * `status` says WHICH of the four outcomes happened -- signed out, no account,
 * no business, or a failed lookup. Callers must branch on it through
 * contextRedirect() rather than inferring a cause from a missing id: an
 * unauthenticated PostgREST request returns zero rows without raising, so an
 * absent id alone cannot tell those cases apart.
 */
export async function currentContext(): Promise<
  ResolvedContext & { supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()

  // Set by getUserId, which resolveContext awaits before getMembership.
  let userId: string | null = null
  const port = {
    // Awaited first and alone: validates the token with the auth server, and
    // completes any refresh before the two lookups run.
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser()
      userId = data?.user?.id ?? null
      return { userId, error }
    },
    // THE CALLER'S OWN membership. RLS lets every member of an account read
    // every membership of it, so without the user filter a sales member on a
    // two-person account was handed the owner's row -- and the page believed
    // it was an owner. The database still refused everything an owner may do
    // (0056 proved that in the browser); only the courtesy gating was wrong.
    // await, not returned directly: the PostgREST builder is a thenable, not a
    // Promise, so it does not satisfy the port's return type on its own.
    getMembership: async () =>
      await supabase.from('memberships').select('account_id, role')
        .eq('user_id', userId ?? '').order('created_at').limit(1).maybeSingle(),
    getBusiness: async () =>
      await supabase.from('businesses').select('id, name').is('deleted_at', null)
        .order('created_at').limit(1).maybeSingle(),
  }
  let resolved = await resolveContext(port)

  // A login on no account may have been INVITED to one (0056). Accepting is
  // the database's decision -- it matches the login's own email to open
  // invitations -- and happens here, once, so an invited person who signs up
  // lands in the right business with no extra step. A genuinely new user
  // gets 0 and goes to onboarding as before.
  if (resolved.status === 'no_membership') {
    const { data } = await supabase.rpc('fn_accept_invitations')
    const accepted = (data as { accepted?: number } | null)?.accepted ?? 0
    if (accepted > 0) resolved = await resolveContext(port)
  }

  // The real reason stays on the server. contextRedirect() sends the browser a
  // fixed generic sentence, so nothing about the database travels in a URL.
  if (resolved.status === 'error') {
    console.error('[currentContext] lookup failed:', resolved.failure)
  }

  return { supabase, ...resolved }
}

export type EntitlementStatus = {
  entitled: boolean
  status: string
  boundary: string | null
  reason: string
}

/**
 * The caller's entitlement, from the database.
 *
 * fn_my_entitlement_status() derives from fn_account_is_entitled, so this is
 * the same rule the 69 write policies enforce -- not a second reading of
 * subscription dates that could drift from it. If the function is not present
 * (0032 not yet applied) this returns null and callers fall back to saying
 * nothing, which is honest.
 */
export async function entitlementStatus(): Promise<EntitlementStatus | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_my_entitlement_status')
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null
  const row = Array.isArray(data) ? data[0] : data
  return row as EntitlementStatus
}

/**
 * Whether this account has paid for Sales.
 *
 * fn_my_has_sales() is the SAME predicate the thirteen Sales write policies
 * consult, so the screen and the database cannot disagree about what a plan
 * grants. The database remains the authority -- a false here hides a button,
 * it does not protect anything. RLS does that, and still would if this
 * returned true wrongly.
 *
 * Null when the function is absent (0051 not yet applied) or the lookup fails.
 * Callers treat null as "do not claim either way" rather than as "no": telling
 * a paying customer they cannot sell would be worse than showing a button the
 * database will refuse.
 */
export async function hasSalesEntitlement(): Promise<boolean | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_my_has_sales')
  if (error || data === null || data === undefined) return null
  return data === true
}

type PgError = { code?: string; message?: string; details?: string | null } | null

/**
 * Turn a database refusal into something a food-business owner can act on.
 *
 * A raw RLS denial reads as "new row violates row-level security policy" and
 * tells the customer nothing. The database is still the authority -- this only
 * translates its verdict. It never decides whether a write is allowed, and it
 * never invents a reason the database did not give.
 */
export function describeWriteError(error: PgError): string | null {
  if (!error) return null

  const code = error.code ?? ''
  const message = error.message ?? ''

  // Row-level security refused. During a live trial this is a role problem;
  // after the trial boundary it is the entitlement gate. Both are "you cannot
  // record new work right now", and neither should surface as SQL.
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'Menu Master could not save that. Your subscription or your role on ' +
      'this account does not allow recording new work at the moment. Everything ' +
      'you have already entered is still here and still readable.'
  }

  if (code === '23505') return 'That already exists. Give it a different name.'
  if (code === '23503') return 'That refers to something which no longer exists. Reload and try again.'
  if (code === '23514' || code === '23502') {
    return 'Some of those values are not valid. Quantities and amounts must be ' +
      'greater than zero, and every field marked required must be filled in.'
  }

  // A raise exception from one of our own guards already reads as English.
  if (message) return message

  return 'Menu Master could not save that. Nothing was changed.'
}
