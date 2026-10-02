'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { friendlyAuthError } from '@/lib/auth-errors'

const WAIT_SECONDS = 60

/**
 * "Send the confirmation email again."
 *
 * Confirmation emails were landing in Spam and owners had no way to ask for
 * another, so they signed up again under a new address or gave up. The
 * button waits a minute between sends; Supabase limits sends anyway, and a
 * button that does nothing on the second press reads as broken.
 */
export function ResendConfirmation({ email }: { email: string }) {
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function resend() {
    if (!email) return
    setBusy(true)
    setNote(null)
    const supabase = createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`,
      },
    })
    setBusy(false)
    if (error) {
      setNote(friendlyAuthError(error).text)
      return
    }
    setNote(`Sent again to ${email}. It can take a minute — check Spam or Promotions too.`)
    setWait(WAIT_SECONDS)
  }

  return (
    <div className="space-y-2">
      <Button
        type="button" variant="secondary" className="w-full"
        busy={busy} busyLabel="Sending…" disabled={!email || wait > 0}
        onClick={resend}
      >
        {wait > 0 ? `Send again in ${wait}s` : 'Send the email again'}
      </Button>
      {note && <p className="text-sm" role="status" style={{ color: 'var(--mm-muted)' }}>{note}</p>}
    </div>
  )
}
