import Link from 'next/link'
import { entitlementStatus } from '@/lib/data/context'
import { daysLeft, daysLeftText, trialTone } from '@/lib/trial'
import { AppIcon } from '@/components/icons'
import { ActivationReporter } from '@/components/activation-reporter'
import { TrackOnce } from '@/components/track-once'

/**
 * The account's access, on every page: the free trial and how long is left,
 * a payment that failed, or access that has ended -- each with the one thing
 * to do about it. A paying subscriber sees nothing.
 *
 * The verdict and the date both come from fn_my_entitlement_status(), which
 * derives from the same predicate the write policies use. The only
 * arithmetic here is turning that date into "9 days left" for display.
 */
export async function EntitlementBanner() {
  const status = await entitlementStatus()
  if (!status) return null

  const when = status.boundary
    ? new Date(status.boundary).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  if (status.entitled) {
    if (status.reason === 'trial_active') {
      const days = daysLeft(status.boundary)
      const tone = trialTone(days)
      return (
        <div role="status" className="mm-access-bar" data-tone={tone}>
          <span className="flex min-w-0 items-center gap-2">
            <AppIcon name={tone === 'calm' ? 'info' : 'alert'} size={18} className="shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold">{daysLeftText(days)}</span>
              {when && <span className="hidden sm:inline"> · ends {when}</span>}
            </span>
          </span>
          <Link href="/subscribe" className="mm-access-cta">Choose a plan</Link>
        </div>
      )
    }
    if (status.reason === 'payment_failed_in_grace') {
      return (
        <div role="status" className="mm-access-bar" data-tone="soon">
          <span className="flex min-w-0 items-center gap-2">
            <AppIcon name="alert" size={18} className="shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold">We could not take your last payment.</span>
              {when && <span> Your access continues until {when}.</span>}
            </span>
          </span>
          <Link href="/subscribe" className="mm-access-cta">Update payment</Link>
        </div>
      )
    }
    // Paying: nothing to show. If this browser just paid, the advert tools
    // hear about it now that the database agrees.
    return <ActivationReporter />
  }

  const headline =
    status.reason === 'trial_ended'
      ? `Your free trial ended${when ? ` on ${when}` : ''}.`
      : status.reason === 'payment_failed'
        ? 'We could not take your last payment.'
        : 'Your subscription has ended.'

  return (
    <div role="status" className="mm-access-bar" data-tone="ended">
      <TrackOnce event="trial_ended_seen" oncePer="session" />
      <span className="min-w-0">
        <span className="block font-semibold">{headline}</span>
        <span className="block text-sm">
          Everything you entered is still here to read. Choose a plan to record new work again.
        </span>
      </span>
      <Link href="/subscribe" className="mm-access-cta">Choose a plan</Link>
    </div>
  )
}
