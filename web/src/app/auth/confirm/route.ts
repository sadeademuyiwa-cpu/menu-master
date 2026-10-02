import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { redirectToPath, safeNext } from '@/lib/safe-next'
import { queueEvent } from '@/lib/analytics/queue'

/**
 * Where links in Menu Master's emails land: confirming an address, resetting
 * a password, accepting an invitation.
 *
 * The emails carry a token_hash and point at THIS site, not at
 * <project>.supabase.co. Two reasons: a link on the sender's own domain is
 * trusted by spam filters, and verifying a token_hash works on any device,
 * whereas the older ?code= exchange needs the browser that signed up. The
 * older form is still accepted, so links already sent keep working.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const code = searchParams.get('code')
  const fallback = type === 'recovery' ? '/reset-password' : '/onboarding'
  const next = safeNext(searchParams.get('next'), fallback)
  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      if (type === 'email' || type === 'signup') await queueEvent('email_confirmed')
      return redirectToPath(next)
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return redirectToPath(next)
  }

  const notice = type === 'recovery'
    ? 'That reset link has expired or was already used. Ask for a new one below.'
    : 'That link has expired or was already used. Log in, or ask for a new link.'
  const to = type === 'recovery' ? '/forgot-password' : '/login'
  return redirectToPath(`${to}?notice=${encodeURIComponent(notice)}`)
}
