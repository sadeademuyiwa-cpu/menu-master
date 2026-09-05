'use client'

import { useState } from 'react'
import { Card, SectionHeading } from '@/components/ui'

export type PlanRow = {
  tier: 'costing' | 'trading'
  name: string
  price: string
  was: string | null
  isFounding: boolean
  available: boolean
  blurb: string
}

/**
 * The plan buttons.
 *
 * The ONLY thing this sends is the tier. It deliberately posts no amount, no
 * plan id and no price tier, because the server would ignore them anyway --
 * fn_checkout_quote resolves all of it. Keeping the request that small is what
 * makes "a hostile client gets the same quote as an honest one" true of the
 * wire and not only of the database.
 */
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
            <SectionHeading>{r.name}</SectionHeading>
            <p className="text-2xl font-medium">
              {r.price}
              <span className="text-sm font-normal" style={{ color: 'var(--mm-muted)' }}>
                {' '}/month
              </span>
            </p>
            {r.was && (
              <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
                Founding price — normally {r.was}
              </p>
            )}
            <p className="mt-2 text-sm" style={{ color: 'var(--mm-muted)' }}>{r.blurb}</p>
            <button
              type="button"
              className="mm-tap mt-3 w-full rounded px-3 py-2.5 text-base font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--mm-accent)' }}
              disabled={!r.available || busy !== null}
              onClick={() => choose(r.tier)}
            >
              {busy === r.tier ? 'Taking you to Paystack…' : `Choose ${r.name}`}
            </button>
            {!r.available && (
              <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
                Not available for online payment yet.
              </p>
            )}
          </Card>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--mm-warn)' }}>
          {error}
        </p>
      )}
    </>
  )
}

/** Fixed server codes to sentences. The server never sends prose, so nothing a
 *  provider said can reach the screen. */
function message(code: unknown): string {
  switch (code) {
    case 'unauthenticated':
      return 'Your session has expired. Please sign in again.'
    case 'no_account':
      return 'This login is not on a business account yet.'
    case 'no_price_available':
    case 'plan_not_mapped':
      return 'This plan is not open for online payment yet. Please contact us and we will set you up.'
    case 'provider_unavailable':
      return 'Paystack did not respond. Nothing has been charged — please try again in a moment.'
    default:
      return 'We could not start your checkout. Nothing has been charged.'
  }
}
