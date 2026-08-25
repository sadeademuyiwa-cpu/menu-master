'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Exactly the values in the business_type enum (migrations/0001_init.sql:41).
// Read from the schema, not assumed -- an invented label is a failed insert.
const BUSINESS_TYPES = [
  'soup_seller', 'caterer', 'restaurant', 'baker', 'small_chops',
  'meal_prep', 'cloud_kitchen', 'corporate_supplier', 'other',
] as const

export default function OnboardingPage() {
  const router = useRouter()
  const [accountName, setAccountName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessType, setBusinessType] = useState<string>('restaurant')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // C10 CONTRACT: one idempotency key per onboarding ATTEMPT, reused on every
  // retry. Generated once when this form mounts and deliberately not
  // regenerated on submit, so a retry after a timeout cannot create a second
  // account.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.rpc('fn_create_account_and_business', {
      p_account_name: accountName,
      p_business_name: businessName,
      p_business_type: businessType,
      p_idempotency_key: idempotencyKey,
    })

    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold">Set up your business</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
        You can add more businesses to this account later.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm">Account name</span>
          <input
            required value={accountName} onChange={(e) => setAccountName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 text-base"
            style={{ borderColor: 'var(--mm-line)', background: 'transparent' }}
          />
        </label>
        <label className="block">
          <span className="text-sm">Business name</span>
          <input
            required value={businessName} onChange={(e) => setBusinessName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 text-base"
            style={{ borderColor: 'var(--mm-line)', background: 'transparent' }}
          />
        </label>
        <label className="block">
          <span className="text-sm">Business type</span>
          <select
            value={businessType} onChange={(e) => setBusinessType(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 text-base"
            style={{ borderColor: 'var(--mm-line)', background: 'transparent' }}
          >
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}

        <button
          type="submit" disabled={busy}
          className="w-full rounded px-3 py-2.5 text-base font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--mm-accent)' }}
        >
          {busy ? 'Setting up…' : 'Create business'}
        </button>
      </form>

      <p className="mt-6 text-xs" style={{ color: 'var(--mm-muted)' }}>
        Your starter catalogue arrives with no prices. Menu Master calculates
        only from figures you enter yourself.
      </p>
    </div>
  )
}
