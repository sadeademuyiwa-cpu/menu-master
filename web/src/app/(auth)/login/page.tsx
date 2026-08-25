'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-medium">Log in</h2>
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
          type="password" required autoComplete="current-password" value={password}
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
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        No account yet? <Link href="/signup" className="underline">Sign up</Link>
      </p>
    </form>
  )
}
