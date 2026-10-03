import Link from 'next/link'

/**
 * Where Paystack sends the browser back.
 *
 * THIS PAGE GRANTS NOTHING, AND THAT IS THE POINT.
 *
 * A browser redirect is not proof of payment. Anyone can open this URL, and a
 * redirect can arrive after a payment that failed, or never arrive after one
 * that succeeded. Entitlement is granted only by the webhook, from an event
 * whose HMAC signature we verified, and only inside fn_billing_apply.
 *
 * So this page reads no reference, calls no function, writes nothing, and does
 * not even look up whether the payment worked. It says "we are checking" and
 * points at the account page, which reads the database's own verdict through
 * fn_my_entitlement_status(). Repeating this URL a thousand times does
 * nothing, which is what makes it safe to be a GET anybody can replay.
 */
export const dynamic = 'force-dynamic'

export default function CheckoutCallbackPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-xl font-medium">Thank you — we are confirming your payment</h1>

      <p className="mt-4 text-sm" style={{ color: 'var(--mm-muted)' }}>
        Paystack has sent us back here. Your subscription starts the moment we
        receive confirmation from them directly, which is usually within a few
        seconds. We do not activate anything from this page, because a browser
        redirect is not proof that a payment succeeded.
      </p>

      <p className="mt-4 text-sm" style={{ color: 'var(--mm-muted)' }}>
        Nothing more is needed from you. If your account still shows as
        unsubscribed in a few minutes, your bank may have declined the charge —
        open your account page to see where things stand, and try again from
        there if you need to.
      </p>

      <p className="mt-6 text-sm">
        <Link href="/account" className="underline">Go to your account</Link>
      </p>
    </main>
  )
}
