/**
 * Which billing buttons an account sees, and what they say.
 *
 * Kept free of React, Next and imports so it is tested directly
 * (tests/billing-choices.test.mts). Plans & billing, the Account page and the
 * /api/checkout pre-check all read these rules, so the screen and the route
 * cannot disagree about who may do what.
 *
 * NONE OF THIS IS THE AUTHORITY. paystack-checkout and paystack-manage decide
 * on the server, from the subscription row read with the service role, and
 * refuse with already_on_plan / owner_only / nothing_to_cancel whatever this
 * file says. A wrong answer here hides or shows a button; it never lets anyone
 * pay twice or cancel someone else's plan.
 *
 * The rules (owner decisions D5 and D6):
 *   - Paying means active, past_due, or cancelled but still inside the month
 *     already paid for.
 *   - Paying again for the SAME tier while active or past_due is refused
 *     (already_on_plan). Past_due on that tier is offered "Update your card"
 *     instead.
 *   - A different tier goes ahead. The new plan starts the day you pay and the
 *     old Paystack subscription is switched off, so nobody pays for both.
 *     Unused days are not refunded, and that is said before payment.
 *   - On a paying account, changing plan, cancelling and updating the card are
 *     for the owner only. The first payment from a trial is open to any member.
 */

export type Tier = 'costing' | 'trading'

export type BillingSub = {
  status: string | null | undefined
  /** plans.tier of the plan the account is on: 'trial', 'costing' or 'trading'. */
  tier: string | null | undefined
  current_period_end: string | null | undefined
  cancel_at_period_end?: boolean | null
}

/** The paid-through date, or null when there is none or it is not a date. */
function periodEnd(sub: BillingSub): number | null {
  if (!sub.current_period_end) return null
  const t = new Date(sub.current_period_end).getTime()
  return Number.isNaN(t) ? null : t
}

/** Active, past_due, or cancelled but still inside the period already paid for. */
export function isPaying(sub: BillingSub | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false
  if (sub.status === 'active' || sub.status === 'past_due') return true
  if (sub.status === 'cancelled') {
    const end = periodEnd(sub)
    return end !== null && end > now.getTime()
  }
  return false
}

/**
 * Renewal has been switched off and the paid month has not run out yet:
 * "Your plan ends on <date>. You will not be charged again."
 */
export function isEnding(sub: BillingSub | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false
  const stopped = sub.status === 'cancelled' || (sub.status === 'active' && sub.cancel_at_period_end === true)
  if (!stopped) return false
  const end = periodEnd(sub)
  return end !== null && end > now.getTime()
}

/** The tier this account is paying for and expecting to renew, if any. */
function renewingTier(sub: BillingSub | null | undefined): string | null {
  if (!sub) return null
  return sub.status === 'active' || sub.status === 'past_due' ? (sub.tier ?? null) : null
}

/**
 * What one plan card offers.
 *   pay          first payment (trial, ended trial, ended plan): any member
 *   change       owner of a paying account moving to this tier: caution first
 *   your_plan    the tier already paid for: a disabled "Your plan"
 *   update_card  owner, past_due on this tier: Paystack's card page
 *   owner_only   a non-owner on a paying account: "made by the account owner"
 */
export type PlanAction = 'pay' | 'change' | 'your_plan' | 'update_card' | 'owner_only'

export function planAction(
  sub: BillingSub | null | undefined,
  tier: Tier,
  role: string | null | undefined,
  now: Date = new Date(),
): PlanAction {
  const owner = role === 'owner'
  if (renewingTier(sub) === tier) {
    return sub?.status === 'past_due' && owner ? 'update_card' : 'your_plan'
  }
  if (isPaying(sub, now)) return owner ? 'change' : 'owner_only'
  return 'pay'
}

/** The button on a 'change' card: a cancelled plan's own tier is chosen again. */
export function changeLabel(sub: BillingSub | null | undefined, tier: Tier): string {
  return sub?.tier === tier ? 'Choose this plan again' : 'Switch to this plan'
}

/**
 * The refusals paystack-checkout makes (contract K4), in the same order, for
 * /api/checkout to answer before the edge function is called. Null means "let
 * the edge function decide".
 */
export function checkoutRefusal(
  sub: BillingSub | null | undefined,
  tier: Tier,
  role: string | null | undefined,
  now: Date = new Date(),
): { error: 'already_on_plan'; status: 409 } | { error: 'owner_only'; status: 403 } | null {
  if (renewingTier(sub) === tier) return { error: 'already_on_plan', status: 409 }
  if (isPaying(sub, now) && role !== 'owner') return { error: 'owner_only', status: 403 }
  return null
}

/** What the Account page offers the signed-in person about the plan. */
export type AccountBilling = {
  /** The owner may stop renewal: active and still renewing. */
  cancel: boolean
  /** The owner may change the card: a payment failed. */
  updateCard: boolean
  /** Renewal is off and the paid month is still running. */
  ending: boolean
}

export function accountBilling(
  sub: BillingSub | null | undefined,
  role: string | null | undefined,
  now: Date = new Date(),
): AccountBilling {
  const owner = role === 'owner'
  const ending = isEnding(sub, now)
  return {
    cancel: owner && sub?.status === 'active' && !ending,
    updateCard: owner && sub?.status === 'past_due',
    ending,
  }
}

const LAGOS = 'Africa/Lagos'

/** "18 October 2026", on the Lagos calendar. Null for nothing or not a date. */
export function lagosLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  // A bare calendar day ("2026-11-18", as ends_on may be) is that day, not
  // midnight UTC, which Lagos would still read as the same day anyway.
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: LAGOS, day: 'numeric', month: 'long', year: 'numeric',
  }).format(t).replace(',', '')
}

// --- the words -----------------------------------------------------------------

/** Shown before an owner pays for a different plan, with a tap to confirm. */
export const CHANGE_CAUTION =
  'Your new plan starts the day you pay and your old plan stops, so you are ' +
  'never charged for both. Unused days on the old plan are not refunded.'

export const OWNER_ONLY_NOTE = 'Plan changes are made by the account owner.'

/** The confirm step before cancelling. */
export function cancelConfirmText(endsOn: string | null): string {
  const until = endsOn ? `until ${endsOn}` : 'until the end of the month you have paid for'
  return `Your plan stays on ${until}. After that you can still open and read ` +
    'everything, but you cannot record new work. You will not be charged again.'
}

export const FOUNDER_WARNING =
  'You are on the founding price. If you cancel, you lose it for good: a plan ' +
  'chosen later is at the standard price.'

/** After cancelling, until the paid month runs out. */
export function endingText(endsOn: string | null): string {
  return endsOn
    ? `Your plan ends on ${endsOn}. You will not be charged again.`
    : 'Your plan ends at the end of the month you have paid for. You will not be charged again.'
}

/** Words for an error code from /api/checkout (paystack-checkout). */
export function checkoutErrorText(code: unknown): string {
  switch (code) {
    case 'unauthenticated': return 'Your session has expired. Please sign in again.'
    case 'no_account': return 'This login is not on a business account yet.'
    case 'ambiguous_account': return 'This login belongs to more than one business. Please contact us.'
    case 'no_email': return 'Your login needs an email address before checkout.'
    case 'no_price_available':
    case 'plan_not_mapped': return 'This plan is not open for online payment yet.'
    case 'provider_unavailable': return 'Paystack did not respond. Nothing has been charged. Please try again.'
    case 'already_on_plan': return 'You are already paying for this plan, so nothing has been charged. Reload the page to see your plan.'
    case 'owner_only': return 'Plan changes are made by the account owner. Nothing has been charged.'
    default: return 'We could not start checkout. Nothing has been charged.'
  }
}

/** Words for an error code from /api/billing (paystack-manage, contract K3). */
export function billingErrorText(code: unknown, action: 'cancel' | 'card_link'): string {
  switch (code) {
    case 'unauthorised':
    case 'unauthenticated': return 'Your session has expired. Please sign in again.'
    case 'owner_only': return action === 'cancel'
      ? 'Only the account owner can cancel the plan.'
      : 'Only the account owner can update the card.'
    case 'nothing_to_cancel': return 'Your plan is already set to stop, so there is nothing to cancel. Reload the page to see the date it ends.'
    case 'no_subscription': return 'We could not find your Paystack subscription. Nothing has changed. Message us and we will sort it out within one working day.'
    case 'not_configured': return 'Online billing is not switched on yet. Nothing has changed. Message us and we will sort it out within one working day.'
    case 'paystack_error': return 'Paystack did not respond. Nothing has changed. Please try again.'
    default: return 'We could not reach Paystack. Nothing has changed. Please try again.'
  }
}
