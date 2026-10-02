'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { friendlyAuthError } from '@/lib/auth-errors'

/**
 * Ask for a password-reset link.
 *
 * The answer is the same whether or not the address has an account, so this
 * page cannot be used to find out who is a customer. Only a rate limit is
 * reported, because "wait a minute" is something the person can act on.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${site}/auth/confirm?next=/reset-password`,
    })
    setBusy(false)
    if (error) {
      const p = friendlyAuthError(error)
      if (p.transient) {
        setError(p.text)
        return
      }
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Check your email</h2>
        <p className="text-sm">
          If <strong>{email}</strong> has a Menu Master account, a link to choose
          a new password is on its way. It works once, for one hour.
        </p>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          Not there in a minute? Look in <strong>Spam</strong> or <strong>Promotions</strong>.
        </p>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          <button type="button" className="mm-inline-tap underline" onClick={() => setSent(false)}>Try another address</button>
          {' · '}
          <Link href="/login" className="underline">Back to log in</Link>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Reset your password</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          Enter the email you signed up with. We will send you a link to choose a new password.
        </p>
      </div>
      <label className="block">
        <span className="text-sm">Email</span>
        <input
          type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mm-input mt-1"
        />
      </label>
      {error && <p className="text-sm" role="alert" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
      <Button busy={busy} busyLabel="Sending…" className="w-full">Send reset link</Button>
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        Remembered it? <Link href="/login" className="underline">Log in</Link>
      </p>
    </form>
  )
}
