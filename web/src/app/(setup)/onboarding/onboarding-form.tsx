'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { track } from '@/lib/analytics/client'
import { BUSINESS_TYPES } from '@/lib/business-types'

/**
 * The database's refusal, in words an owner can act on. The raw text goes to
 * the console for us, never to the screen.
 */
function friendly(error: { code?: string; message?: string }): string {
  const message = error.message ?? ''
  if (/idempotency/i.test(message) && /different/i.test(message)) {
    return 'Your business was already being set up with the details you entered first. Reload this page to carry on.'
  }
  if (error.code === '23505') {
    return 'You already have a business with that name. Try a slightly different name.'
  }
  if (error.code === '42501' || /row-level security/i.test(message)) {
    return 'We could not set up a business for this login. Sign out, sign back in and try once more.'
  }
  return 'We could not set up your business just now. Check your connection and press Continue again.'
}

export function OnboardingForm() {
  const router = useRouter()
  const [businessName, setBusinessName] = useState('')
  const [businessType, setBusinessType] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // C10 CONTRACT: one idempotency key per onboarding ATTEMPT, reused on every
  // retry. Generated once when this form mounts and deliberately not
  // regenerated on submit, so a retry after a timeout cannot create a second
  // account.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!businessType) {
      setError('Choose what you sell, so we can set things up for you.')
      return
    }
    setBusy(true)
    setError(null)

    const name = businessName.trim()
    const supabase = createClient()
    // The account holds the business; most owners have one of each, so the
    // account simply takes the business's name. It can be renamed later.
    const { error } = await supabase.rpc('fn_create_account_and_business', {
      p_account_name: name,
      p_business_name: name,
      p_business_type: businessType,
      p_idempotency_key: idempotencyKey,
    })

    if (error) {
      console.error('[onboarding] fn_create_account_and_business refused:', error)
      setBusy(false)
      setError(friendly(error))
      return
    }
    track('business_created')
    router.push('/start')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Welcome! Tell us about your business</h1>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
          Four short steps and Menu Master will show you what one plate of your food really
          costs, and what to charge for it.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Business name</span>
        <input
          required value={businessName} onChange={(e) => setBusinessName(e.target.value)}
          placeholder="e.g. Iya Basira Foods" autoComplete="organization"
          className="mm-input mt-1"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">What do you sell?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {BUSINESS_TYPES.map((t) => {
            const chosen = businessType === t.value
            return (
              <label
                key={t.value}
                className="mm-card flex cursor-pointer items-start gap-3"
                style={chosen ? { borderColor: 'var(--mm-accent)', boxShadow: '0 0 0 1px var(--mm-accent)' } : undefined}
              >
                <input
                  type="radio" name="business_type" value={t.value}
                  checked={chosen} onChange={() => { setBusinessType(t.value); setError(null) }}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--mm-accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: 'var(--mm-muted)' }}>{t.example}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {error && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}

      <Button busy={busy} busyLabel="Setting up your business…" className="w-full">Continue</Button>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
        We add a starter list of common Nigerian ingredients, with no prices. You enter what
        you actually pay in the next step. Menu Master only ever calculates from your own figures.
      </p>
    </form>
  )
}
