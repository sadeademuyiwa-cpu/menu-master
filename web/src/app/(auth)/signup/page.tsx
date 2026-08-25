'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    // D7: email confirmation is required. Supabase sends the link; the user
    // lands on /auth/callback, which exchanges the code for a session.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`,
      },
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Check your email</h2>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          We sent a confirmation link to <strong>{email}</strong>. You need to
          confirm before you can set up your business.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-medium">Create your account</h2>
      <label className="block">
        <span className="text-sm">Email</span>
        <input
          type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2 text-base"
          style={{ borderColor: 'var(--mm-line)', background: 'transparent' }}
        />
      </label>
      <label className="block">
        <span className="text-sm">Password</span>
        <input
          type="password" required minLength={8} autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2 text-base"
          style={{ borderColor: 'var(--mm-line)', background: 'transparent' }}
        />
      </label>
      {error && <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
      <button
        type="submit" disabled={busy}
        className="w-full rounded px-3 py-2.5 text-base font-medium text-white disabled:opacity-60"
        style={{ background: 'var(--mm-accent)' }}
      >
        {busy ? 'Creating…' : 'Create account'}
      </button>
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        Already have one? <Link href="/login" className="underline">Log in</Link>
      </p>
    </form>
  )
}
