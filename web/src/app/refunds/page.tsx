import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, H2, SupportContact } from '@/components/legal-page'
import { LEGAL } from '@/lib/legal'
import { billingSelfServe, billingWords } from '@/lib/site/billing-words'

export const metadata: Metadata = { title: 'Refunds and cancellation — Menu Master NG' }

// The support contact comes from Admin -> Website; refreshed within a minute.
export const revalidate = 60

/**
 * The money rules, stated the way the database already enforces them:
 * monthly plans, cancel any time, access to the end of the period paid for,
 * history never hidden, and the founding price forfeited on a lapse and never
 * re-issued (0049, founding_price_policy). Nothing here promises what the
 * system does not do. How to cancel, change plan and put a failed payment
 * right follows the web's billing safety switch (BILLING_SELF_SERVE): the
 * Account page's Cancel plan and Plans & billing when it is "on" (the old
 * Paystack subscription is switched off once the new one is paid), "message
 * us" otherwise. Those sentences come from lib/site/billing-words.ts, the one
 * source for both states. A copy of your records is sent on request, because
 * there is no download yet (tests/public-promises).
 *
 * This is the owner's draft to review, not legal advice.
 */
export default function RefundsPage() {
  const L = LEGAL
  const W = billingWords(billingSelfServe())
  return (
    <LegalPage title="Refunds and cancellation">
      <p>
        This page explains how paying for {L.productName} works, how to stop,
        and when we refund. It forms part of our{' '}
        <Link href="/terms" className="underline">terms of service</Link>.
      </p>

      <H2>How billing works</H2>
      <p>
        Plans are monthly. When you subscribe, Paystack charges your card for
        one month and your plan starts immediately. On the renewal date shown
        on the Account page, the same amount is charged again unless you have
        cancelled. Prices are in Nigerian naira and include any applicable tax.
      </p>

      <H2>Cancelling</H2>
      <p>
        {W.refundsCancel} A founding subscription that is cancelled loses the
        founding price once its paid month ends (see below).
      </p>
      <p>
        If you want a copy of your records, message us and we send you a copy
        of your records as a spreadsheet, within one working day. Write
        to <SupportContact />.
      </p>

      <H2>Refunds</H2>
      <p>
        Monthly charges are not refunded for part of a month you have started,
        because the plan was available to you for that month. We do refund, in
        full, when:
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>you were charged twice for the same month;</li>
        <li>you were charged after you had cancelled, or after you had asked us to cancel;</li>
        <li>your old plan was charged again after you had moved to a new one;</li>
        <li>a fault on our side meant you could not use the product for most of the month you paid for.</li>
      </ul>
      <p>
        Write to <SupportContact /> within {L.billingDisputeDays} days of the
        charge with the email on your account and the date of the charge. We
        reply within two working days, and an agreed refund is returned to the
        card that paid, through Paystack, which can take a few days to show.
      </p>

      <H2>Failed payments</H2>
      <p>{W.refundsFailed}</p>

      <H2>The founding-member price</H2>
      <p>
        The first one hundred businesses to subscribe pay a founding price for
        as long as their subscription runs without a break. It is a price for
        staying, not a first-month discount. If a founding subscription lapses
        — it is cancelled and its paid month ends, or a failed payment is not
        put right within the grace period — the founding price is forfeited.
        Subscribing again is welcome, at the standard price. A forfeited
        founding place is not offered to anyone else.
      </p>

      <H2>Changing plan</H2>
      <p>
        {W.refundsChange} Moving to a smaller plan never hides anything you
        entered on the larger one; it only stops new entries of that kind.
      </p>

      <H2>Questions</H2>
      <p>
        Anything about a charge, a refund or a cancellation: write to <SupportContact />.
      </p>
    </LegalPage>
  )
}
