'use client'

import { useState } from 'react'
import { Card, Notice } from '@/components/ui'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { track } from '@/lib/analytics/client'
import { rememberCheckout } from '@/components/activation-reporter'
import {
  CHANGE_CAUTION, OWNER_ONLY_NOTE, PAY_NOW_TEXT, PLAN_UNREADABLE_TEXT,
  billingErrorText, checkoutErrorText,
  type PlanAction, type Tier,
} from '@/app/(app)/subscribe/billing-choices'
import { MESSAGE_US } from '@/lib/site/billing-words'

export type PlanRow = {
  tier: Tier
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
  /**
   * What this card offers, decided on the server from the subscription, the
   * caller's role and the web's safety switch (subscribe/billing-choices.ts).
   * Left out, it is a first payment, as before.
   */
  action?: PlanAction
  /** The 'change' button's words ("Switch to this plan"); see changeLabel. */
  changeLabel?: string
  /** The 'change' caution shown before paying; see changeCaution. */
  caution?: string
}

/**
 * Start a Paystack checkout for a tier. Leaves the page on success; returns
 * the sentence to show otherwise.
 */
async function startCheckout(tier: Tier, monthly: number | null | undefined): Promise<string> {
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body?.authorization_url) {
      track('checkout_started', { plan: tier, value: monthly ?? undefined })
      rememberCheckout(tier, monthly ?? null)
      // A moment for the advert tags to send before the page is left.
      await new Promise((r) => setTimeout(r, 300))
      window.location.href = body.authorization_url
      return ''
    }
    return checkoutErrorText(body?.error)
  } catch {
    return 'We could not reach the payment page. Please try again.'
  }
}

/**
 * The plan cards on Plans & billing.
 *
 * Every refusal here is a courtesy: /api/checkout and paystack-checkout
 * refuse already_on_plan, owner_only and switch_needs_support themselves,
 * before any quote or founder hold, whatever this shows.
 */
export function PlanChooser({ rows, support }: {
  rows: PlanRow[]
  /** How to reach us, rendered on the server (components/legal-page.tsx). */
  support?: React.ReactNode
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The card whose caution is open: a change of plan is never one tap.
  const [confirming, setConfirming] = useState<string | null>(null)

  async function choose(tier: Tier) {
    setBusy(tier)
    setError(null)
    const failed = await startCheckout(tier, rows.find((r) => r.tier === tier)?.monthly)
    if (failed) {
      setError(failed)
      setBusy(null)
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const action = r.action ?? 'pay'
          return (
            <Card key={r.tier}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="mm-page-icon"><AppIcon name={r.tier === 'trading' ? 'sales' : 'recipes'} size={20} /></span>
                  <div>
                    <div className="font-semibold">{r.name}</div>
                    {r.isFounding && <div className="text-xs font-semibold" style={{ color: 'var(--mm-gold-text)' }}>Founding price</div>}
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

              <div className="mt-5" data-plan-action={action}>
                {action === 'your_plan' && (
                  <Button type="button" variant="secondary" className="w-full" disabled>Your plan</Button>
                )}

                {action === 'pay_now' && (
                  <div className="space-y-3">
                    <Notice tone="warn"><span className="text-sm">{PAY_NOW_TEXT}</span></Notice>
                    <Button
                      type="button"
                      className="w-full"
                      busy={busy === r.tier}
                      busyLabel="Opening Paystack…"
                      disabled={!r.available || busy !== null}
                      onClick={() => choose(r.tier)}
                    >
                      Pay now
                    </Button>
                    <UpdateCardButton className="w-full" variant="secondary" />
                  </div>
                )}

                {action === 'owner_only' && (
                  <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>{OWNER_ONLY_NOTE}</p>
                )}

                {/* The page says MESSAGE_US once, under the title; the card
                    says how. */}
                {action === 'message_us' && (
                  <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
                    {support ? <>Message us and we do it for you. Write to {support}.</> : MESSAGE_US}
                  </p>
                )}

                {action === 'reload' && (
                  <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>{PLAN_UNREADABLE_TEXT}</p>
                )}

                {action === 'pay' && (
                  <Button
                    type="button"
                    className="w-full"
                    busy={busy === r.tier}
                    busyLabel="Opening Paystack…"
                    disabled={!r.available || busy !== null}
                    onClick={() => choose(r.tier)}
                  >
                    Choose plan
                  </Button>
                )}

                {action === 'change' && (confirming === r.tier ? (
                  <div role="group" aria-label={`Pay for ${r.name}`} className="space-y-3">
                    <Notice tone="warn"><span className="text-sm">{r.caution ?? CHANGE_CAUTION}</span></Notice>
                    <Button
                      type="button"
                      className="w-full"
                      busy={busy === r.tier}
                      busyLabel="Opening Paystack…"
                      disabled={!r.available || busy !== null}
                      onClick={() => choose(r.tier)}
                    >
                      Pay for {r.name}
                    </Button>
                    <Button type="button" variant="quiet" className="w-full" disabled={busy !== null}
                      onClick={() => setConfirming(null)}>
                      Not now
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!r.available || busy !== null}
                    onClick={() => { setError(null); setConfirming(r.tier) }}
                  >
                    {r.changeLabel ?? 'Switch to this plan'}
                  </Button>
                ))}
              </div>
              {!r.available && (action === 'pay' || action === 'change' || action === 'pay_now') && (
                <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>Online payment unavailable.</p>
              )}
            </Card>
          )
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
    </>
  )
}

/**
 * "Pay now" after a failed payment, on the Account page (X2). The same
 * checkout as the plan card: a new subscription on the same tier that
 * replaces the failed one. Shown only to the owner, only while the web's
 * safety switch is on; /api/checkout refuses anyone else.
 */
export function PayNowButton({ tier, className = '' }: { tier: Tier; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setBusy(true)
    setError(null)
    const failed = await startCheckout(tier, null)
    if (failed) {
      setError(failed)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" className={className} busy={busy} busyLabel="Opening Paystack…" onClick={pay}>
        Pay now
      </Button>
      {error && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
    </div>
  )
}

/**
 * "Update your card": asks /api/billing for Paystack's manage link and goes
 * there. Owner only -- the route and paystack-manage both refuse anyone else,
 * so this is shown only to the owner of an account whose payment failed,
 * and only while the web's safety switch is on.
 */
export function UpdateCardButton({ className = '', variant }: {
  className?: string
  variant?: 'secondary'
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'card_link' }),
      })
      const body = await res.json().catch(() => ({}))
      // Only ever leave for an https page. The link comes from Paystack
      // through our own edge function, but a browser redirect is not the
      // place to trust a value blindly.
      if (res.ok && body?.ok && typeof body.link === 'string' && /^https:\/\//.test(body.link)) {
        window.location.href = body.link
        return
      }
      setError(billingErrorText(body?.error, 'card_link'))
    } catch {
      setError(billingErrorText(null, 'card_link'))
    }
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant={variant} className={className} busy={busy} busyLabel="Opening Paystack…" onClick={open}>
        Update your card
      </Button>
      {error && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
    </div>
  )
}
