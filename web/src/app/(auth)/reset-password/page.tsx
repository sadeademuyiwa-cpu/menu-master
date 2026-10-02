'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { friendlyAuthError } from '@/lib/auth-errors'

/**
 * Choose a new password.
 *
 * Reached from the reset email (via /auth/confirm, which signs the person in
 * for this purpose) or from Account → Change password. Either way there is a
 * session, so the middleware sends anyone without one to /login.
 */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== again) {
      setError('The two passwords are different. Type the same one twice.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setBusy(false)
      setError(friendlyAuthError(error).text)
      return
    }
    router.push(`/dashboard?notice=${encodeURIComponent('Password changed. Use it next time you log in.')}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Choose a new password</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          At least 8 characters. You will stay logged in on this device.
        </p>
      </div>
      <label className="block">
        <span className="text-sm">New password</span>
        <input
          type="password" required minLength={8} autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mm-input mt-1"
        />
      </label>
      <label className="block">
        <span className="text-sm">Type it again</span>
        <input
          type="password" required minLength={8} autoComplete="new-password" value={again}
          onChange={(e) => setAgain(e.target.value)}
          className="mm-input mt-1"
        />
      </label>
      {error && <p className="text-sm" role="alert" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
      <Button busy={busy} busyLabel="Saving…" className="w-full">Save new password</Button>
    </form>
  )
}
