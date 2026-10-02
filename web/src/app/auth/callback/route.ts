import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { redirectToPath, safeNext } from '@/lib/safe-next'

/**
 * Email-confirmation and sign-in-with-Google landing (D7). Supabase redirects
 * here with a code; we exchange it for a session and send the user on.
 * Email links now land on /auth/confirm; this stays for Google sign-in and
 * for confirmation emails already sent.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  // Only a path on this site. An unchecked next made this an open redirect.
  const next = safeNext(searchParams.get('next'), '/onboarding')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return redirectToPath(next)
  }

  const notice = 'We could not finish signing you in. The link may have expired — please try again.'
  return redirectToPath(`/login?notice=${encodeURIComponent(notice)}`)
}
