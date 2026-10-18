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
 * refuse whatever this file says. A wrong answer here hides or shows a
 * button; it never lets anyone pay twice or cancel someone else's plan.
 *
 * The rules (owner decisions D5, D6; integration decisions X1-X4, X8):
 *   - Paying means active, past_due, or cancelled but still inside the month
 *     already paid for. Live means active or past_due: a Paystack
 *     subscription that renews, or is owed.
 *   - Paying again for the SAME tier while active is refused
 *     (already_on_plan).
 *   - Past_due on the same tier may pay again by itself ("Pay now"): the new
 *     subscription REPLACES the failed one, which the webhook switches off,
 *     so nobody is charged twice. "Update your card" is offered beside it.
 *   - A different tier goes ahead. The new plan starts the day you pay and
 *     the old Paystack subscription is switched off. Unused days are not
 *     refunded, and that is said before payment.
 *   - A plan cancelled inside its paid month (status 'cancelled' with
 *     cancel_at_period_end, as 0067 records not_renew) may choose a tier
 *     again: a new paid month starts that day and the ending one just ends.
 *   - On a paying account, changing plan, Pay now, cancelling and updating
 *     the card are for the owner only. The first payment from a trial is
 *     open to any member.
 *   - All of that self-serve billing for a paying account happens only while
 *     the web's switch is on (selfServe, from lib/site/billing-words.ts).
 *     Off, the owner is told to message us, and checkout refuses a paying
 *     account with switch_needs_support.
 *   - If the plan's tier cannot be read on a paying account, nothing is
 *     offered and checkout refuses: the page is reloaded instead.
 */

export type Tier = 'costing' | 'trading'

export type BillingSub = {
  status: string | null | undefined
  /** plans.tier of the plan the account is on: 'trial', 'costing' or 'trading'. */
  tier: string | null | undefined
  current_period_end: string | null | undefined
  cancel_at_period_end?: boolean | null
}

/** The two tiers a paid plan can be on. Anything else is "unknown". */
export function knownTier(tier: unknown): tier is Tier {
  return tier === 'costing' || tier === 'trading'
}

/** The paid-through date, or null when there is none or it is not a date. */
function periodEnd(sub: BillingSub): number | null {
  if (!sub.current_period_end) return null
  const t = new Date(sub.current_period_end).getTime()
  return Number.isNaN(t) ? null : t
}

/** A Paystack subscription that renews or is owed: active or past_due. */
export function isLive(sub: BillingSub | null | undefined): boolean {
  return sub?.status === 'active' || sub?.status === 'past_due'
}

/** Active, past_due, or cancelled but still inside the period already paid for. */
export function isPaying(sub: BillingSub | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false
  if (isLive(sub)) return true
  if (sub.status === 'cancelled') {
    const end = periodEnd(sub)
    return end !== null && end > now.getTime()
  }
  return false
}

/**
 * Renewal has been switched off and the paid month has not run out yet:
 * "Your plan ends on <date>. You will not be charged again."
 *
 * 0067 records not_renew as status 'cancelled' (X8). An 'active' row with
 * cancel_at_period_end is read as ending too, so the words stay right if one
 * ever appears, but its buttons follow 'active' (see planAction), exactly as
 * paystack-checkout refuses it.
 */
export function isEnding(sub: BillingSub | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false
  const stopped = sub.status === 'cancelled' || (sub.status === 'active' && sub.cancel_at_period_end === true)
  if (!stopped) return false
  const end = periodEnd(sub)
  return end !== null && end > now.getTime()
}

/**
 * What one plan card offers.
 *   pay         first payment (trial, ended trial, ended plan): any member
 *   change      owner of a paying account moving to this tier, or choosing
 *               a cancelled plan again: a caution first
 *   your_plan   the tier already paid for: a disabled "Your plan"
 *   pay_now     owner, past_due on this tier: "Pay now" (a replacement) and
 *               "Update your card"
 *   owner_only  a non-owner on a paying account: "made by the account owner"
 *   message_us  owner of a paying account while the switch is off
 *   reload      owner of a paying account whose tier could not be read
 */
export type PlanAction = 'pay' | 'change' | 'your_plan' | 'pay_now' | 'owner_only' | 'message_us' | 'reload'

export function planAction(
  sub: BillingSub | null | undefined,
  tier: Tier,
  role: string | null | undefined,
  selfServe: boolean,
  now: Date = new Date(),
): PlanAction {
  if (!sub || !isPaying(sub, now)) return 'pay'
  // The tier this account renews (or owes) on. Not a cancelled one: that
  // may be chosen again.
  const own = isLive(sub) && sub.tier === tier
  if (role !== 'owner') return own ? 'your_plan' : 'owner_only'
  if (!knownTier(sub.tier)) return 'reload'
  if (own && sub.status === 'active') return 'your_plan'
  if (!selfServe) return 'message_us'
  return own ? 'pay_now' : 'change'
}

/** The button on a 'change' card: a cancelled plan's own tier is chosen again. */
export function changeLabel(sub: BillingSub | null | undefined, tier: Tier): string {
  return sub?.status === 'cancelled' && sub.tier === tier ? 'Choose this plan again' : 'Switch to this plan'
}

/** The caution shown before paying on a 'change' card. */
export function changeCaution(
  sub: BillingSub | null | undefined,
  tier: Tier,
  endsOn: string | null,
  now: Date = new Date(),
): string {
  return sub?.status === 'cancelled' && sub.tier === tier && isEnding(sub, now)
    ? chooseAgainText(endsOn)
    : CHANGE_CAUTION
}

export type CheckoutRefusal =
  | { error: 'already_on_plan'; status: 409 }
  | { error: 'owner_only'; status: 403 }
  | { error: 'switch_needs_support'; status: 409 }
  | { error: 'plan_unreadable'; status: 503 }

/**
 * The refusals paystack-checkout makes (K4 as amended by X2-X4), in the same
 * order, for /api/checkout to answer before the edge function is called,
 * plus the web's own two: the switch, and a paying account whose tier is not
 * known. Null means "let the edge function decide".
 */
export function checkoutRefusal(
  sub: BillingSub | null | undefined,
  tier: Tier,
  role: string | null | undefined,
  selfServe: boolean,
  now: Date = new Date(),
): CheckoutRefusal | null {
  if (!sub || !isPaying(sub, now)) return null
  if (sub.status === 'active' && sub.tier === tier) return { error: 'already_on_plan', status: 409 }
  if (role !== 'owner') return { error: 'owner_only', status: 403 }
  if (!knownTier(sub.tier)) return { error: 'plan_unreadable', status: 503 }
  if (!selfServe) return { error: 'switch_needs_support', status: 409 }
  return null
}

/**
 * /api/checkout's whole pre-check, from what its reads returned. It fails
 * closed: when it cannot tell whether the account already pays, it refuses
 * (plan_unreadable) rather than let a second subscription start.
 */
export function checkoutGate(f: {
  /** currentContext's status. */
  contextStatus: string
  accountId: string | null | undefined
  role: string | null | undefined
  /** The subscription read failed (an error, not an empty answer). */
  subError: boolean
  sub: Omit<BillingSub, 'tier'> | null | undefined
  /** plans.tier of sub's plan; null when the plan read failed or found nothing. */
  planTier: string | null | undefined
  tier: Tier
  selfServe: boolean
  now?: Date
}): CheckoutRefusal | null {
  // The membership lookup itself failed: we do not know the account.
  if (f.contextStatus === 'error' && !f.accountId) return { error: 'plan_unreadable', status: 503 }
  // No account at all: paystack-checkout answers no_account.
  if (!f.accountId) return null
  if (f.subError) return { error: 'plan_unreadable', status: 503 }
  if (!f.sub) return null
  return checkoutRefusal({ ...f.sub, tier: f.planTier ?? null }, f.tier, f.role, f.selfServe, f.now ?? new Date())
}

/** What the Account page offers the signed-in person about the plan. */
export type AccountBilling = {
  /** The owner may stop renewal: active or past_due, not already ending (X1). */
  cancel: boolean
  /** The last payment failed: the cancel confirm says recording stops now. */
  overdue: boolean
  /** The owner may change the card: a payment failed. */
  updateCard: boolean
  /** The owner may pay again on this tier: a payment failed (X2). */
  payNow: Tier | null
  /** The owner of a paying account, switch off: "message us". */
  messageUs: boolean
  /** Renewal is off and the paid month is still running. */
  ending: boolean
}

export function accountBilling(
  sub: BillingSub | null | undefined,
  role: string | null | undefined,
  selfServe: boolean,
  now: Date = new Date(),
): AccountBilling {
  const owner = role === 'owner'
  const ending = isEnding(sub, now)
  const overdue = sub?.status === 'past_due'
  const self = owner && selfServe
  const tier = sub?.tier
  return {
    cancel: self && isLive(sub) && !ending,
    overdue,
    updateCard: self && overdue,
    payNow: self && overdue && knownTier(tier) ? tier : null,
    messageUs: owner && !selfServe && isPaying(sub, now),
    ending,
  }
}

/** The line under "Plans & billing". messageUs is billing-words' MESSAGE_US. */
export function subscribeHeader(
  sub: BillingSub | null | undefined,
  role: string | null | undefined,
  selfServe: boolean,
  messageUs: string,
  now: Date = new Date(),
): string {
  const base = 'Monthly billing in naira.'
  if (!isPaying(sub, now)) return base
  if (role !== 'owner') return `${base} ${OWNER_ONLY_NOTE}`
  if (!selfServe) return `${base} ${messageUs}`
  if (isLive(sub) && !isEnding(sub, now)) {
    return `${base} Change plan here, and cancel from your Account page whenever you like.`
  }
  return base
}

const LAGOS = 'Africa/Lagos'

/** "18 October 2026", on the Lagos calendar. Null for nothing or not a date. */
export function lagosLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  // A bare calendar day ("2026-11-18", as ends_on is) is that day, not
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

/** Choosing a cancelled plan again inside its paid month (X8). */
export function chooseAgainText(endsOn: string | null): string {
  const until = endsOn ? `until ${endsOn}` : 'until the end of the month you have paid for'
  return `Your plan is on ${until}. Choosing it again starts a new paid month today.`
}

/** Beside "Pay now" after a failed payment (X2). */
export const PAY_NOW_TEXT =
  'Your last payment did not go through. Pay now to carry on. The failed ' +
  'plan is switched off, so you are never charged twice.'

export const OWNER_ONLY_NOTE = 'Plan changes are made by the account owner.'

/** A paying account whose plan could not be read: nothing is offered. */
export const PLAN_UNREADABLE_TEXT = 'We could not read your current plan. Reload the page to see your choices.'

/** The confirm step before cancelling (X1). */
export function cancelConfirmText(endsOn: string | null, overdue = false): string {
  if (overdue) {
    return 'Your last payment did not go through. If you cancel now, recording ' +
      'stops straight away and you will not be charged again.'
  }
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

/** After cancelling a plan whose last payment failed: there is no paid month left. */
export const CANCELLED_NOW_TEXT =
  'Your plan is cancelled. You will not be charged again. You can still open and read everything you entered.'

const SWITCH_NEEDS_SUPPORT_TEXT =
  'To change plan, message us. We switch it over for you so you are never charged twice.'
const CHANGE_IN_PROGRESS_TEXT = 'Your plan change is still finishing. Try again in a minute.'

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
    case 'switch_needs_support': return SWITCH_NEEDS_SUPPORT_TEXT
    case 'change_in_progress': return CHANGE_IN_PROGRESS_TEXT
    case 'plan_unreadable': return 'We could not check your current plan, so nothing has been charged. Reload the page and try again.'
    default: return 'We could not start checkout. Nothing has been charged.'
  }
}

/** Words for an error code from /api/billing (paystack-manage, K3 and X3). */
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
    case 'switch_needs_support': return action === 'cancel'
      ? 'To cancel your plan, message us. We do it for you. Nothing has changed yet.'
      : 'To update your card, message us. We sort it out with you. Nothing has changed yet.'
    case 'change_in_progress': return CHANGE_IN_PROGRESS_TEXT
    case 'paystack_error': return 'Paystack did not respond. Nothing has changed. Please try again.'
    default: return 'We could not reach Paystack. Nothing has changed. Please try again.'
  }
}
