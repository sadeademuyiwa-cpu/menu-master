import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ResendConfirmation } from '@/components/resend-confirmation'
import { Button } from '@/components/button'
import { signOut } from '@/lib/auth-actions'

export default async function VerifyEmailPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (user.email_confirmed_at) redirect('/onboarding')

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Confirm your email</h2>
      <p className="text-sm">
        We sent a link to <strong>{user.email}</strong>. Open it to finish
        setting up. You cannot create a business until your email is confirmed.
      </p>
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        Not there? Look in <strong>Spam</strong> or <strong>Promotions</strong>, and mark it “Not spam”.
      </p>
      <ResendConfirmation email={user.email ?? ''} />
      <form action={signOut}>
        <Button variant="quiet" busyLabel="Signing out…">Use a different email</Button>
      </form>
    </div>
  )
}
