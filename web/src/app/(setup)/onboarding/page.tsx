import { redirect } from 'next/navigation'
import { currentContext } from '@/lib/data/context'
import { SetupSteps } from '../steps'
import { OnboardingForm } from './onboarding-form'

export const dynamic = 'force-dynamic'

/**
 * Step 1 of setup. A login that already has a business goes straight on:
 * submitting this form again would quietly create a second business inside
 * the same account.
 */
export default async function OnboardingPage() {
  const ctx = await currentContext()
  if (ctx.status === 'unauthenticated') redirect('/login')
  if (ctx.status === 'ok') redirect('/start')

  return (
    <div className="space-y-6">
      <SetupSteps view="business" />
      <OnboardingForm />
    </div>
  )
}
