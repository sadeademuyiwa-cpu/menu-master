import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function VerifyEmailPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (user.email_confirmed_at) redirect('/onboarding')

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Confirm your email</h2>
      <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
        We sent a link to <strong>{user.email}</strong>. Open it to finish
        setting up. You cannot create a business until your email is confirmed.
      </p>
    </div>
  )
}
