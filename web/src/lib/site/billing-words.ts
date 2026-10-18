/**
 * The web's billing safety switch, and every public billing promise in both
 * of its states. One file, so the terms, the refunds page, the plans FAQ and
 * the buttons cannot drift apart.
 *
 * THE SWITCH (integration decision X4)
 *   BILLING_SELF_SERVE, a server-side environment variable (Vercel). Only the
 *   exact value "on" turns on self-serve billing for an account that already
 *   pays: switching plan, Pay now after a failed payment, Cancel plan and
 *   Update your card. Anything else -- unset, "off", "On", " on" -- is off:
 *     - those buttons are hidden, and the owner is told MESSAGE_US;
 *     - /api/checkout refuses a paying account with switch_needs_support
 *       before the edge function is called;
 *     - /api/billing answers not_configured;
 *     - the terms, refunds page and FAQ say "message us" (billingWords(false)).
 *   The first payment from a trial is never affected.
 *
 *   It is set to "on" only after 0067, paystack-webhook, paystack-manage and
 *   paystack-checkout are live (deploy order X9). Before that, nothing
 *   switches off a replaced Paystack subscription, and a self-serve switch
 *   would charge the owner for two plans. The edge function's own kill
 *   switch (BILLING_SELF_SERVE=off as a Supabase secret) is separate and
 *   stays as built.
 *
 *   Read it on the server only (billingSelfServe). A browser bundle never
 *   carries the value, so a client component that calls it always sees off.
 *
 * Kept free of imports so tests/public-promises.test.mts reads it directly
 * and checks both states.
 */

/** True only for the exact string "on". */
export function selfServeOn(value: string | null | undefined): boolean {
  return value === 'on'
}

/** The switch as this server sees it. */
export function billingSelfServe(): boolean {
  return selfServeOn(typeof process === 'undefined' ? undefined : process.env.BILLING_SELF_SERVE)
}

/** What the owner of a paying account is told while the switch is off. */
export const MESSAGE_US =
  'To change or cancel your plan, message us. We do it for you, so you are never charged twice.'

/** What cancelling does, whoever presses the button. The same in both states. */
const CANCEL_EFFECT =
  'Cancelling stops future charges. Your paid plan continues to the end of ' +
  'the month you have already paid for, and then your account becomes ' +
  'read-only: you can still open and read everything you entered, you ' +
  'simply cannot record new work until you choose a plan again. If your ' +
  'last payment did not go through, there is no paid month left, so ' +
  'recording stops straight away.'

/** The billing sentences of the terms and the refunds page. */
export type BillingWords = {
  /** Terms, section 4: how a plan is changed. */
  termsChange: string
  /** Terms, section 8: how the owner cancels. */
  termsCancel: string
  /** Refunds, "Cancelling": how, and what it does. */
  refundsCancel: string
  /** Refunds, "Changing plan". */
  refundsChange: string
  /** Refunds, "Failed payments". */
  refundsFailed: string
}

export function billingWords(selfServe: boolean): BillingWords {
  if (selfServe) {
    return {
      termsChange:
        'The account owner changes plan on the Plans & billing page. A new ' +
        'plan starts the day you pay for it and the old one stops at the same ' +
        'time, so you are never charged for both. Unused days on the old plan ' +
        'are not refunded.',
      termsCancel:
        'The account owner can cancel at any time from the Account page in the app.',
      refundsCancel:
        'The account owner can cancel at any time from the Account page in ' +
        'the app: press Cancel plan, then confirm. ' + CANCEL_EFFECT +
        ' There is no undo button; to carry on, choose a plan again.',
      refundsChange:
        'The account owner changes plan on the Plans & billing page. Your new ' +
        'plan starts the day you pay for it and your old plan stops at the ' +
        'same time, so you are never charged for both. Unused days on the old ' +
        'plan are not refunded, in the same way as a month you have started.',
      refundsFailed:
        'If a renewal fails, we do not cut you off the same day. You keep full ' +
        'access for a short grace period while you put it right: the account ' +
        'owner presses Pay now or Update your card on Plans & billing. Paying ' +
        'now switches the failed plan off, so you are never charged twice. If ' +
        'the payment still cannot be taken, your account becomes read-only ' +
        'until it is.',
    }
  }
  return {
    termsChange:
      'To change plan, the account owner messages us and we switch it over ' +
      'for you, so you are never charged for both. A new plan starts the day ' +
      'you pay for it. Unused days on the old plan are not refunded.',
    termsCancel:
      'The account owner can cancel at any time by messaging us, and we ' +
      'cancel it for you within one working day.',
    refundsCancel:
      'The account owner can cancel at any time: message us and we cancel it ' +
      'for you within one working day. ' + CANCEL_EFFECT +
      ' To carry on after that, choose a plan again.',
    refundsChange:
      'To change plan, the account owner messages us and we switch it over ' +
      'for you. Your new plan starts the day you pay for it and your old plan ' +
      'stops at the same time, so you are never charged for both. Unused days ' +
      'on the old plan are not refunded, in the same way as a month you have ' +
      'started.',
    refundsFailed:
      'If a renewal fails, we do not cut you off the same day. You keep full ' +
      'access for a short grace period while you put it right: the account ' +
      'owner messages us and we help you pay again, so you are never charged ' +
      'twice. If the payment still cannot be taken, your account becomes ' +
      'read-only until it is.',
  }
}

/**
 * The plans FAQ, on /subscribe and the landing page (plan-features.ts
 * PLAN_FAQ is this, for the switch as the server sees it).
 */
export function planFaq(selfServe: boolean): [string, string][] {
  return [
    ['What happens when my free trial ends?',
     'Nothing is deleted. You can still open and read everything you entered. To record new purchases, dishes or sales, choose a plan.'],
    ['Can I cancel?',
     selfServe
       ? 'Yes, whenever you like. The account owner cancels from the Account page. Your plan runs to the end of the month you paid for, you are not charged again, and your records stay yours. If your last payment did not go through, recording stops straight away.'
       : `Yes, whenever you like. ${MESSAGE_US} Your plan runs to the end of the month you paid for, you are not charged again, and your records stay yours.`],
    ['Can I change plan later?',
     selfServe
       ? 'Yes. The account owner changes plan on Plans & billing. Your new plan starts the day you pay and your old plan stops, so you are never charged for both. Unused days on the old plan are not refunded. Everything you have entered stays as it is.'
       : `Yes. ${MESSAGE_US} Your new plan starts the day you pay, and unused days on the old plan are not refunded. Everything you have entered stays as it is.`],
    ['Can I get a copy of my records?',
     'Yes. Message us and we send you a copy of your records as a spreadsheet, within one working day. You can also open and read everything in the app at any time.'],
    ['Is paying safe?',
     'Payment is handled by Paystack. Menu Master NG never sees or stores your card details.'],
    ['What is the founding price?',
     'The first 100 businesses to subscribe keep the lower founding price for as long as their subscription stays active.'],
  ]
}
