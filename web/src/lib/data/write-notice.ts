/**
 * What a save says when it did not save.
 *
 * Kept free of React, Next and Supabase so every sentence is tested directly
 * (tests/write-notice.test.mts). context.ts feeds it the database's own
 * verdict (fn_my_entitlement_status) and re-exports what pages use.
 *
 * WHY THIS EXISTS
 *   Row-level security refuses an UPDATE or DELETE quietly: no error, zero
 *   rows. Once a free trial ends it does that to every role on every edit, and
 *   about twenty actions still said "Ingredient updated." or "Business details
 *   saved." -- some then re-costed every dish anyway. Every edit and remove now
 *   asks for its changed rows back, and when there are none it says "Nothing
 *   was changed." with the real reason: the trial ended on a date, a payment
 *   failed, the subscription ended, or (while the account is live) the row was
 *   changed elsewhere or the role does not allow it.
 *
 * Nothing here decides whether a write is allowed. The database decides; this
 * only puts its verdict into words a food-business owner can act on.
 */

/** A PostgREST error as supabase-js hands it back. */
export type PgError = { code?: string; message?: string; details?: string | null } | null

/** One row of fn_my_entitlement_status() (0032). */
export type AccessVerdict = {
  entitled: boolean
  status?: string | null
  boundary: string | null
  reason: string
}

/**
 * Nothing changed and the account's state is not known (the lookup failed):
 * every cause stays possible, so none is claimed.
 */
export const NOT_CHANGED =
  'Nothing was changed. It may have been changed already, or your subscription ' +
  'or your role on this account does not allow it at the moment.'

/** Nothing changed on a live account: not the plan, so the row or the role. */
export const NOT_CHANGED_LIVE =
  'Nothing was changed. It may have been changed or removed already, or your role ' +
  'on this account does not allow it. Reload the page to see the latest.'

const STILL_HERE = 'Everything you entered is still here.'

/**
 * 0066's guard (fn_require_entitled) raises these with a sentence written for
 * the person who pressed the button, already in plain words and already
 * naming who to ask. It is shown as it is.
 */
const NO_ACCESS = 'MMENT'
const NO_SALES = 'MMSAL'

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
  const message = (error.message ?? '').trim()

  // The trial gate (0066). Its message is the explanation; a fallback only
  // for a server that sent the code without one.
  if (code === NO_ACCESS) {
    return message || 'Nothing was changed. This account cannot record new work until a plan is ' +
      `chosen. ${STILL_HERE}`
  }
  if (code === NO_SALES) {
    return message || 'Nothing was changed. Your plan does not include Sales. Choose Costing + Sales ' +
      'on Plans & billing to record sales.'
  }

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

/** How many rows a `.select()` after an update or delete handed back. */
export function changedRows(data: unknown): number {
  if (Array.isArray(data)) return data.length
  return data === null || data === undefined ? 0 : 1
}

/** True only when the write raised nothing AND changed at least one row. */
export function wrote(error: PgError, data: unknown): boolean {
  return !error && changedRows(data) > 0
}

/** "17 October 2026": the day in Lagos, whatever time zone the server runs in. */
export function lagosDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric',
  }).format(t)
}

/**
 * The verdict, only if it is a real one. A missing function, a failed lookup
 * or a malformed answer is "not known", never "not entitled".
 */
export function knownVerdict(v: unknown): AccessVerdict | null {
  if (!v || typeof v !== 'object') return null
  const row = v as Partial<AccessVerdict>
  if (typeof row.entitled !== 'boolean') return null
  return {
    entitled: row.entitled,
    status: row.status ?? null,
    boundary: typeof row.boundary === 'string' ? row.boundary : null,
    reason: typeof row.reason === 'string' ? row.reason : '',
  }
}

/**
 * Why recording is paused, as the start of a sentence (no full stop), or null
 * when it is not paused -- or when nobody knows, which keeps today's wording.
 */
export function pauseReason(verdict: AccessVerdict | null | undefined): string | null {
  if (!verdict || verdict.entitled !== false) return null
  switch (verdict.reason) {
    case 'trial_ended': {
      const day = lagosDay(verdict.boundary)
      return day ? `Your free trial ended on ${day}` : 'Your free trial has ended'
    }
    case 'payment_failed': return 'We could not take your last payment'
    case 'subscription_ended': return 'Your subscription has ended'
    default: return 'This account has no plan at the moment'
  }
}

/**
 * The owner acts on the plan; everyone else asks the owner. A role that is
 * not known is spoken to as the owner, so an owner is never told to "ask the
 * owner".
 */
const actsOnPlan = (role: string | null | undefined) => role === 'owner' || !role

/** What to do about a paused account, in one sentence. */
export function pauseRemedy(verdict: AccessVerdict, role: string | null | undefined): string {
  const card = verdict.reason === 'payment_failed'
  if (actsOnPlan(role)) {
    return card
      ? 'Update your card on Plans & billing to carry on.'
      : 'Choose a plan on Plans & billing to carry on.'
  }
  return card
    ? 'Ask the owner to update the card on Plans & billing.'
    : 'Ask the owner to choose a plan.'
}

export type RefusalOptions = {
  /** The write was a Sales record and the plan has no Sales (fn_my_has_sales false). */
  noSales?: boolean
}

/**
 * What an edit or remove that changed nothing says.
 *
 *   paused (trial ended, payment failed, ended)  the reason and what to do
 *   live, but the plan has no Sales               that, and what to do
 *   live                                          the row or the role
 *   not known                                     NOT_CHANGED, as before
 */
export function refusalText(
  verdict: AccessVerdict | null | undefined,
  role?: string | null,
  opts: RefusalOptions = {},
): string {
  const reason = pauseReason(verdict)
  if (reason && verdict) return `Nothing was changed. ${reason}. ${pauseRemedy(verdict, role)} ${STILL_HERE}`
  if (opts.noSales) {
    return 'Nothing was changed. Your plan does not include Sales. ' + (actsOnPlan(role)
      ? 'Choose Costing + Sales on Plans & billing to record sales again.'
      : 'Ask the owner about Costing + Sales.')
  }
  if (verdict?.entitled === true) return NOT_CHANGED_LIVE
  return NOT_CHANGED
}

/**
 * The line a page shows where buttons were taken away because recording is
 * paused: "Your free trial ended on 17 October 2026, so purchases can't be
 * recorded, cancelled or corrected. Choose a plan on Plans & billing to carry
 * on." `what` is the middle of that sentence. Null when nothing is paused,
 * including when nobody knows.
 */
export function pausedLine(
  verdict: AccessVerdict | null | undefined,
  role: string | null | undefined,
  what: string,
): string | null {
  const reason = pauseReason(verdict)
  if (!reason || !verdict) return null
  return `${reason}, so ${what}. ${pauseRemedy(verdict, role)}`
}

/**
 * After an update or delete with `.select()`: the database's own refusal if
 * it raised one, null when rows changed (the caller says its success), and
 * otherwise whatever `refusal` says. `refusal` runs only when nothing
 * changed, so a save that worked never pays for an entitlement lookup.
 */
export async function refusalAfterWrite(
  error: PgError,
  data: unknown,
  refusal: () => string | Promise<string>,
): Promise<string | null> {
  if (error) return describeWriteError(error)
  return changedRows(data) > 0 ? null : await refusal()
}
