'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { GoogleSignIn } from '@/components/google-sign-in'
import { ResendConfirmation } from '@/components/resend-confirmation'
import { friendlyAuthError } from '@/lib/auth-errors'
import { track } from '@/lib/analytics/client'
import { SOURCE_COOKIE, decodeSource } from '@/lib/analytics/events'

/**
 * The advert or link that brought this visitor (set by the middleware), but
 * only if they accepted cookies -- the privacy policy promises exactly that.
 */
function signupSource() {
  try {
    if (localStorage.getItem('mm_consent') !== 'granted') return null
  } catch {
    return null
  }
  const m = document.cookie.match(new RegExp(`(?:^|; )${SOURCE_COOKIE}=([^;]*)`))
  return decodeSource(m?.[1])
}

export function SignupForm({ google }: { google: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // An invitation link carries the invited address (0056). Filling it in is
  // a convenience only: acceptance is decided by the database from the
  // login's own email, so typing a different address simply is not invited.
  useEffect(() => {
    const given = new URLSearchParams(window.location.search).get('email')
    if (given) setEmail(given)
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    // D7: email confirmation is required. Supabase sends the link; the user
    // lands on /auth/callback, which exchanges the code for a session.
    const source = signupSource()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`,
        ...(source ? { data: { signup_source: source } } : {}),
      },
    })
    if (error) {
      setBusy(false)
      setError(friendlyAuthError(error).text)
      return
    }
    track('sign_up', { method: 'email' })
    // No confirmation pending: the local auth stand-in confirms at once, so
    // signUp already returned a session. Go straight on instead of waiting for
    // an email that is never sent. Where D7 applies there is no session here,
    // and the user is told to check their email as before.
    if (data.session) {
      router.push('/onboarding')
      router.refresh()
      return
    }
    setBusy(false)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Check your email</h2>
        <p className="text-sm">
          We sent a confirmation link to <strong>{email}</strong>. Open it on
          this phone or computer to start your free trial.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--mm-muted)' }}>
          <li>It usually arrives within a minute.</li>
          <li>Not there? Look in <strong>Spam</strong> or <strong>Promotions</strong>, and mark it “Not spam”.</li>
          <li>Wrong address? <button type="button" className="mm-inline-tap underline" onClick={() => setSent(false)}>Change it</button></li>
        </ul>
        <ResendConfirmation email={email} />
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          Already confirmed? <Link href="/login" className="underline">Log in</Link>
          {' · '}
          <Link href="/forgot-password" className="underline">Forgot password?</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Start your free trial</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          14 days free. No card needed.
        </p>
      </div>
      {google && <GoogleSignIn label="Sign up with Google" />}
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
          <span className="text-sm">Password</span>
          <input
            type="password" required minLength={8} autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mm-input mt-1"
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--mm-muted)' }}>At least 8 characters.</span>
        </label>
        {error && <p className="text-sm" role="alert" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
        <Button busy={busy} busyLabel="Creating…" className="w-full">Create account</Button>
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          By creating an account you accept our{' '}
          <Link href="/terms" className="underline">terms</Link> and{' '}
          <Link href="/refunds" className="underline">refund policy</Link>.
        </p>
      </form>
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        Already have one? <Link href="/login" className="underline">Log in</Link>
      </p>
    </div>
  )
}
