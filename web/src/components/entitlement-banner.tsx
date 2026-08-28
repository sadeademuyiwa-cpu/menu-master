import Link from 'next/link'
import { entitlementStatus } from '@/lib/data/context'

/**
 * Shown when the database says this account can no longer record new work.
 *
 * The verdict and the reason both come from fn_my_entitlement_status(), which
 * derives from the same predicate the write policies use. Nothing here
 * interprets a date.
 */
export async function EntitlementBanner() {
  const status = await entitlementStatus()
  if (!status || status.entitled) return null

  const when = status.boundary
    ? new Date(status.boundary).toLocaleDateString('en-NG',
        { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  const headline =
    status.reason === 'trial_ended'
      ? `Your free trial ended${when ? ` on ${when}` : ''}.`
      : status.reason === 'payment_failed'
        ? 'We could not take your last payment.'
        : 'Your subscription has ended.'

  return (
    <div
      role="status"
      className="rounded border px-3 py-2 text-sm"
      style={{ borderColor: 'var(--mm-warn)', color: 'var(--mm-warn)' }}
    >
      <span className="font-medium">{headline}</span>{' '}
      Everything you entered is still here — you can open, read and export every
      recipe and price. To add or change anything, you will need to subscribe.{' '}
      <Link href="/account" className="underline">See your account</Link>
    </div>
  )
}
