'use client'

import { useState } from 'react'
import { Card } from '@/components/ui'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { track } from '@/lib/analytics/client'
import { rememberCheckout } from '@/components/activation-reporter'

export type PlanRow = {
  tier: 'costing' | 'trading'
  name: string
  price: string
  /** The same price as a number of naira, for advert measurement. */
  monthly?: number | null
  was: string | null
  isFounding: boolean
  available: boolean
  blurb: string
  /** What the plan includes, one line each. */
  features?: string[]
  /** The plan this account is paying for now. */
  current?: boolean
}

export function PlanChooser({ rows }: { rows: PlanRow[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(tier: 'costing' | 'trading') {
    setBusy(tier)
    setError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.authorization_url) {
        const monthly = rows.find((r) => r.tier === tier)?.monthly ?? undefined
        track('checkout_started', { plan: tier, value: monthly ?? undefined })
        rememberCheckout(tier, monthly ?? null)
        // A moment for the advert tags to send before the page is left.
        await new Promise((r) => setTimeout(r, 300))
        window.location.href = body.authorization_url
        return
      }
      setError(message(body?.error))
    } catch {
      setError('We could not reach the payment page. Please try again.')
    }
    setBusy(null)
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.tier}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="mm-page-icon"><AppIcon name={r.tier === 'trading' ? 'sales' : 'recipes'} size={20} /></span>
                <div>
                  <div className="font-semibold">{r.name}</div>
                  {r.isFounding && <div className="text-xs font-medium" style={{ color: 'var(--mm-accent)' }}>Founding price</div>}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-end gap-1">
              <span className="text-3xl font-semibold tabular-nums">{r.price}</span>
              <span className="pb-1 text-sm" style={{ color: 'var(--mm-muted)' }}>/month</span>
            </div>
            {r.was && <div className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>Normally {r.was}</div>}

            <p className="mt-3 text-sm" style={{ color: 'var(--mm-muted)' }}>{r.blurb}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(r.features ?? []).map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <AppIcon name="check" size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--mm-accent)' }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Button
              type="button"
              className="mt-5 w-full"
              busy={busy === r.tier}
              busyLabel="Opening Paystack…"
              disabled={!r.available || busy !== null || r.current}
              onClick={() => choose(r.tier)}
            >
              {r.current ? 'Your current plan' : 'Choose plan'}
            </Button>
            {!r.available && <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>Online payment unavailable.</p>}
          </Card>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
    </>
  )
}

function message(code: unknown): string {
  switch (code) {
    case 'unauthenticated': return 'Your session has expired. Please sign in again.'
    case 'no_account': return 'This login is not on a business account yet.'
    case 'ambiguous_account': return 'This login belongs to more than one business. Please contact us.'
    case 'no_email': return 'Your login needs an email address before checkout.'
    case 'no_price_available':
    case 'plan_not_mapped': return 'This plan is not open for online payment yet.'
    case 'provider_unavailable': return 'Paystack did not respond. Nothing has been charged — please try again.'
    default: return 'We could not start checkout. Nothing has been charged.'
  }
}
