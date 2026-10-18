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
 * only puts its verdict into words a food-business owner can act on. The
 * same goes for the two decisions at the bottom: closedText (refuse before
 * calling the database when it has already said the account is closed) and
 * paymentAnswer (what Save payment says when fn_record_order_payment answers).
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
 * fn_record_order_payment's own refusals (0066, integration decision X5): a
 * draft, a cancelled sale, a negative amount, a payment state that is not one
 * of the three, a sale that is not there. Each is a plain sentence, shown as
 * it is.
 */
const PAYMENT_REFUSED = 'MMPAY'

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
  if (code === PAYMENT_REFUSED) return message || PAYMENT_NOT_SAVED

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

// ---------------------------------------------------------------------------
// Before an action the trial gate would refuse
// ---------------------------------------------------------------------------

export type ClosedScope = {
  /** The action is a Sales record (orders, order_lines, customers): a plan
   *  without Sales is then also a reason. */
  sales?: boolean
}

/**
 * Whether the plan's Sales is worth asking about: only for a Sales record, and
 * only while the account is not already closed (a closed account's reason is
 * the trial or the payment, whatever the plan).
 */
export function asksAboutSales(verdict: AccessVerdict | null | undefined, scope: ClosedScope = {}): boolean {
  return !!scope.sales && verdict?.entitled !== false
}

/**
 * Before recording, cancelling or correcting a purchase, or confirming,
 * cancelling or re-issuing a sale: the refusal when recording is explicitly
 * closed -- or, for a Sales record, when the plan explicitly has no Sales --
 * and null to go ahead. Not known (null) goes ahead, as today: the database
 * still decides.
 *
 * `salesPlan` is fn_my_has_sales(): true, false, or null when not known.
 */
export function closedText(
  verdict: AccessVerdict | null | undefined,
  salesPlan: boolean | null | undefined,
  role?: string | null,
  scope: ClosedScope = {},
): string | null {
  if (verdict?.entitled === false) return refusalText(verdict, role)
  if (asksAboutSales(verdict, scope) && salesPlan === false) return refusalText(verdict, role, { noSales: true })
  return null
}

// ---------------------------------------------------------------------------
// Money received on a confirmed sale (fn_record_order_payment, 0066)
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = ['unpaid', 'part_paid', 'paid'] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]

/** A role that takes no money (kitchen, accountant): fn_require_account_role's 42501. */
export const PAYMENT_ROLE_REFUSED = 'Your role can’t record payments. Ask the owner or a manager.'

/** The payment was refused and the database's words are not for an owner. */
export const PAYMENT_NOT_SAVED =
  'Menu Master could not record that payment. Nothing was changed. Reload the page and try again.'

/**
 * Text that is the database talking to us, not to the owner: a constraint
 * name, a policy, a missing function, a dropped connection.
 */
const RAW_DATABASE = /violates|row-level security|constraint|relation "|column "|syntax|permission denied|duplicate key|null value|function .*\(|PGRST|JWT|TypeError|fetch failed/i

/**
 * markPaid's own check, before it asks the database: an amount of zero or
 * more and one of the three states. Null when both are fine.
 */
export function paymentProblem(paid: number, status: string): string | null {
  if (!Number.isFinite(paid) || paid < 0) {
    return 'What they have paid so far is an amount in naira, and cannot be negative.'
  }
  if (!(PAYMENT_STATUSES as readonly string[]).includes(status)) {
    return 'Choose whether the sale is not paid, part paid or paid in full.'
  }
  return null
}

export type PaymentAnswer =
  | { kind: 'saved' }
  /** fn_record_order_payment is not there yet (before 0066): write it the old way. */
  | { kind: 'not_there' }
  | { kind: 'refused'; notice: string }

/**
 * What fn_record_order_payment's answer means for the person who pressed
 * Save payment.
 *
 *   no error              saved
 *   PGRST202 / 42883      the function is not there yet (before 0066)
 *   MMPAY                 its own refusal, a plain sentence: shown as it is
 *   42501                 the role takes no money: PAYMENT_ROLE_REFUSED --
 *                         never the subscription sentence, because the
 *                         subscription never stops a payment (D2)
 *   MMENT / MMSAL         the trial gate's own words, as everywhere
 *   anything else         its message if it reads as English, else
 *                         PAYMENT_NOT_SAVED
 */
export function paymentAnswer(error: PgError): PaymentAnswer {
  if (!error) return { kind: 'saved' }
  const code = error.code ?? ''
  if (code === 'PGRST202' || code === '42883') return { kind: 'not_there' }
  const message = (error.message ?? '').trim()
  if (code === PAYMENT_REFUSED) return { kind: 'refused', notice: message || PAYMENT_NOT_SAVED }
  if (code === '42501') return { kind: 'refused', notice: PAYMENT_ROLE_REFUSED }
  if (code === NO_ACCESS || code === NO_SALES) {
    return { kind: 'refused', notice: describeWriteError(error) ?? PAYMENT_NOT_SAVED }
  }
  return { kind: 'refused', notice: message && !RAW_DATABASE.test(message) ? message : PAYMENT_NOT_SAVED }
}
