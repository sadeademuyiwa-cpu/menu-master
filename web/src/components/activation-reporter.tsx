'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics/client'

const KEY = 'mm_checkout'
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** Called as the browser leaves for Paystack: which plan, at what price. */
export function rememberCheckout(plan: string, value: number | null) {
  try { localStorage.setItem(KEY, JSON.stringify({ plan, value, at: Date.now() })) } catch { /* private mode */ }
}

/**
 * Reports a paid subscription to the advert tools, once, in the browser that
 * paid.
 *
 * The return page from Paystack proves nothing (see checkout/callback), so
 * the conversion is reported only when the DATABASE says the account is paid
 * (this renders only then) AND this browser started a checkout in the last
 * three days. Customers who were already paying before this existed are
 * never counted as new.
 */
export function ActivationReporter() {
  useEffect(() => {
    let saved: { plan?: unknown; value?: unknown; at?: unknown } | null = null
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { saved = null }
    if (!saved || typeof saved.at !== 'number' || Date.now() - saved.at > WINDOW_MS) return
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    track('subscription_activated', {
      plan: typeof saved.plan === 'string' ? saved.plan : undefined,
      value: typeof saved.value === 'number' ? saved.value : undefined,
    })
  }, [])
  return null
}
