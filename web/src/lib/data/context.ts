import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { resolveContext, type ResolvedContext } from './resolve-context'
import {
  asksAboutSales, closedText, knownVerdict, pausedLine, refusalAfterWrite, refusalText,
  type AccessVerdict, type ClosedScope, type PgError,
} from './write-notice'

export {
  contextRedirect, withNotice,
  type ContextStatus, type ResolvedContext,
} from './resolve-context'
export {
  describeWriteError, NOT_CHANGED, changedRows, wrote,
  paymentAnswer, paymentProblem, PAYMENT_STATUSES,
  type AccessVerdict, type PgError, type PaymentAnswer,
} from './write-notice'

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
 * (0032 not yet applied), the lookup fails or the answer is not a verdict at
 * all, this returns null and callers fall back to saying nothing, which is
 * honest.
 *
 * cache(): the bar, the page and a refusal notice in one request share one
 * database call. Outside a render (a server action) it simply calls through.
 */
export const entitlementStatus = cache(async (): Promise<EntitlementStatus | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_my_entitlement_status')
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null
  const row = knownVerdict(Array.isArray(data) ? data[0] : data)
  return row ? { ...row, status: row.status ?? '' } : null
})

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
export const hasSalesEntitlement = cache(async (): Promise<boolean | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_my_has_sales')
  if (error || data === null || data === undefined) return null
  return data === true
})

/**
 * Whether this account may record new work: the database's verdict, or null
 * when it is not known. Only an explicit false hides a control or refuses an
 * action -- null keeps today's behaviour, exactly as hasSalesEntitlement's
 * null does. A courtesy: the database (0066's fn_require_entitled and the
 * write policies) is the boundary either way.
 */
export async function recordingOpen(): Promise<boolean | null> {
  const s = await entitlementStatus()
  return s ? s.entitled : null
}

/** sales: the write was a Sales record, so a plan without Sales is also a reason. */
type RefusalScope = ClosedScope

/** Whether a plan without Sales is the reason, asked only when it could be (asksAboutSales). */
async function salesMissing(verdict: AccessVerdict | null, scope: RefusalScope): Promise<boolean> {
  return asksAboutSales(verdict, scope) && (await hasSalesEntitlement()) === false
}

/**
 * What an edit or remove that changed nothing says: "Nothing was changed."
 * plus the real reason, for this person's role (lib/data/write-notice.ts).
 */
export async function refusalNotice(role?: string | null, scope: RefusalScope = {}): Promise<string> {
  const verdict = await entitlementStatus()
  return refusalText(verdict, role, { noSales: await salesMissing(verdict, scope) })
}

/**
 * After an update or delete that asked for its rows back (.select('id')):
 * null when it changed something, otherwise the notice to show -- the
 * database's own error, or refusalNotice(). Use it to decide whether to
 * re-cost: nothing changed means nothing to re-cost.
 */
export async function writeRefusal(
  error: PgError, data: unknown, role?: string | null, scope: RefusalScope = {},
): Promise<string | null> {
  return refusalAfterWrite(error, data, () => refusalNotice(role, scope))
}

/** writeRefusal, or `saved` when the write really changed something. */
export async function writeNotice(
  error: PgError, data: unknown, saved: string, role?: string | null, scope: RefusalScope = {},
): Promise<string> {
  return (await writeRefusal(error, data, role, scope)) ?? saved
}

/**
 * Before an action the trial gate would refuse (record, cancel or correct a
 * purchase; confirm, cancel or re-issue a sale): the refusal when recording
 * is explicitly closed -- or, with `sales`, when the plan explicitly has no
 * Sales -- and null to go ahead. Unknown goes ahead, as today.
 *
 * Never used for recording a payment on a confirmed sale: that stays open
 * whatever the plan or the trial (fn_record_order_payment, 0066).
 */
export async function closedRefusal(role?: string | null, scope: RefusalScope = {}): Promise<string | null> {
  const verdict = await entitlementStatus()
  // The decision itself is closedText (write-notice.ts, tested); Sales is
  // looked up only when it could be the reason.
  const salesPlan = asksAboutSales(verdict, scope) ? await hasSalesEntitlement() : null
  return closedText(verdict, salesPlan, role, scope)
}

/**
 * The one line a page shows where Record, Cancel or Correct used to be, when
 * recording is closed; null otherwise (including when it is not known).
 */
export async function closedLine(role: string | null | undefined, what: string): Promise<string | null> {
  return pausedLine(await entitlementStatus(), role, what)
}
