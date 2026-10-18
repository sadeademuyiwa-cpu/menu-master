'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { Notice } from '@/components/ui'
import {
  FOUNDER_WARNING, billingErrorText, cancelConfirmText, endingText, lagosLongDate,
} from '@/app/(app)/subscribe/billing-choices'

/**
 * "Cancel plan", with one plain confirm step first.
 *
 * Shown only to the OWNER of an account that is paying and still renewing
 * (subscribe/billing-choices.ts, accountBilling). That is a courtesy:
 * /api/billing and paystack-manage both refuse anyone else on the server.
 *
 * Cancelling stops renewal at Paystack. Nothing here writes the subscription
 * row: the webhook records it when Paystack's subscription.not_renew arrives,
 * which is why the "ends on" answer is kept on screen after a refresh that may
 * still show the old row for a moment. There is no undo; the owner chooses a
 * plan again.
 */
export function CancelPlan({ endsOn, founder, support }: {
  /** The paid-through date in words ("18 November 2026"), or null when unknown. */
  endsOn: string | null
  /** On the founding price: they are warned it is lost. */
  founder: boolean
  /** How to reach us, rendered on the server (components/legal-page.tsx). */
  support?: React.ReactNode
}) {
  const router = useRouter()
  const [stage, setStage] = useState<'idle' | 'confirm' | 'done'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; askUs: boolean } | null>(null)
  const [doneOn, setDoneOn] = useState<string | null>(null)

  async function cancel() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.ok) {
        setDoneOn(lagosLongDate(typeof body.ends_on === 'string' ? body.ends_on : null) ?? endsOn)
        setStage('done')
        setBusy(false)
        router.refresh()
        return
      }
      const code = body?.error
      setError({
        text: billingErrorText(code, 'cancel'),
        askUs: code === 'no_subscription' || code === 'not_configured',
      })
    } catch {
      setError({ text: billingErrorText(null, 'cancel'), askUs: false })
    }
    setBusy(false)
  }

  if (stage === 'done') {
    return <Notice tone="info">{endingText(doneOn)}</Notice>
  }

  if (stage === 'idle') {
    return (
      <Button type="button" variant="secondary" onClick={() => setStage('confirm')}>
        Cancel plan
      </Button>
    )
  }

  return (
    <div role="group" aria-label="Cancel your plan" className="mm-card space-y-3">
      <p className="font-semibold">Cancel your plan?</p>
      <p className="text-sm">{cancelConfirmText(endsOn)}</p>
      {founder && <Notice tone="warn"><span className="text-sm">{FOUNDER_WARNING}</span></Notice>}
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        There is no undo. To carry on later, you choose a plan again.
      </p>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>
          {error.text}{error.askUs && support ? <> Write to {support}.</> : null}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" busy={busy} busyLabel="Cancelling…" onClick={cancel}>
          Yes, cancel my plan
        </Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={() => { setError(null); setStage('idle') }}>
          Keep my plan
        </Button>
      </div>
    </div>
  )
}
