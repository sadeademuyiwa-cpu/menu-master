/**
 * How a trial or a subscription is described to the owner.
 *
 * Kept free of React and Next so it is tested directly. Whether an account
 * may record work is never decided here -- that is fn_my_entitlement_status's
 * verdict. This only turns the database's dates and states into words.
 */

const DAY = 24 * 60 * 60 * 1000

/** Whole days left until the boundary, counting a part-day as a day. Never negative. */
export function daysLeft(boundaryIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!boundaryIso) return null
  const end = new Date(boundaryIso).getTime()
  if (Number.isNaN(end)) return null
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY))
}

export type TrialTone = 'calm' | 'soon' | 'last'

/** Calm for most of the trial, a warning in the last three days, urgent on the last. */
export function trialTone(days: number | null): TrialTone {
  if (days === null || days > 3) return 'calm'
  return days <= 1 ? 'last' : 'soon'
}

export function daysLeftText(days: number | null): string {
  if (days === null) return 'Free trial'
  if (days <= 0) return 'Free trial ends today'
  if (days === 1) return 'Free trial · last day'
  return `Free trial · ${days} days left`
}

/** The subscription status in the owner's words, never the database's. */
export function planStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'trialing': return 'Free trial'
    case 'active': return 'Active'
    case 'past_due': return 'Payment overdue'
    case 'cancelled': return 'Cancelled'
    default: return status ? status.replace(/_/g, ' ') : 'No plan'
  }
}
