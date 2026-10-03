'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { GoogleSignIn } from '@/components/google-sign-in'
import { ResendConfirmation } from '@/components/resend-confirmation'
import { friendlyAuthError, type AuthProblem } from '@/lib/auth-errors'

export function LoginForm({ google }: { google: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<AuthProblem | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setBusy(false)
      setProblem(friendlyAuthError(error))
      return
    }
    // Left busy: the dashboard is loading.
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Log in</h2>
      {google && <GoogleSignIn />}
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mm-input mt-1"
          />
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span>Password</span>
            <Link href="/forgot-password" className="mm-inline-tap underline">Forgot password?</Link>
          </span>
          <input
            type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mm-input mt-1"
          />
        </label>
        {problem && <p className="text-sm" role="alert" style={{ color: 'var(--mm-warn)' }}>{problem.text}</p>}
        <Button busy={busy} busyLabel="Logging in…" className="w-full">Log in</Button>
      </form>
      {problem?.canResend && <ResendConfirmation email={email} />}
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        No account yet? <Link href="/signup" className="underline">Start your free trial</Link>
      </p>
    </div>
  )
}
