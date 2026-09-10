import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, H2 } from '@/components/legal-page'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Refunds and cancellation — Menu Master NG' }

/**
 * The money rules, stated the way the database already enforces them:
 * monthly plans, cancel any time, access to the end of the period paid for,
 * history never hidden, and the founding price forfeited on a lapse and never
 * re-issued (0049, founding_price_policy). Nothing here promises what the
 * system does not do.
 *
 * This is the owner's draft to review, not legal advice.
 */
export default function RefundsPage() {
  const L = LEGAL
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
        on your account page, the same amount is charged again unless you have
        cancelled. Prices are in Nigerian naira and include any applicable tax.
      </p>

      <H2>Cancelling</H2>
      <p>
        You can cancel from your account page at any time. Cancelling stops
        future charges. Your paid plan continues to the end of the month you
        have already paid for, and then your account returns to read-only:
        you can still open and export everything you entered, you simply
        cannot record new work until you subscribe again.
      </p>

      <H2>Refunds</H2>
      <p>
        Monthly charges are not refunded for part of a month you have started,
        because the plan was available to you for that month. We do refund, in
        full, when:
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>you were charged twice for the same month;</li>
        <li>you were charged after you had cancelled;</li>
        <li>a fault on our side meant you could not use the product for most of the month you paid for.</li>
      </ul>
      <p>
        Write to {L.supportEmail} within {L.billingDisputeDays} days of the
        charge with the email on your account and the date of the charge. We
        reply within two working days, and an agreed refund is returned to the
        card that paid, through Paystack, which can take a few days to show.
      </p>

      <H2>Failed payments</H2>
      <p>
        If a renewal fails, we do not cut you off the same day. You keep full
        access for a short grace period while you update your card. If the
        payment still cannot be taken, your account becomes read-only until it
        is.
      </p>

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
        Moving between Costing and Costing + Sales takes effect immediately.
        Moving to a smaller plan never hides anything you entered on the
        larger one; it only stops new entries of that kind.
      </p>

      <H2>Questions</H2>
      <p>
        Anything about a charge, a refund or a cancellation: {L.supportEmail}.
      </p>
    </LegalPage>
  )
}
