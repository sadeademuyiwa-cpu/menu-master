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

  const resolved = await resolveContext({
    // Awaited first and alone: validates the token with the auth server, and
    // completes any refresh before the two lookups run.
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser()
      return { userId: data?.user?.id ?? null, error }
    },
    // await, not returned directly: the PostgREST builder is a thenable, not a
    // Promise, so it does not satisfy the port's return type on its own.
    getMembership: async () =>
      await supabase.from('memberships').select('account_id, role').limit(1).maybeSingle(),
    getBusiness: async () =>
      await supabase.from('businesses').select('id, name').is('deleted_at', null)
        .order('created_at').limit(1).maybeSingle(),
  })

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
