import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { entitlementStatus } from '@/lib/data/context'
import { loadPlanOffers } from '@/lib/data/plans'
import { PageHeader, Card, Badge, Disclosure, SectionHeading } from '@/components/ui'
import { money } from '@/lib/format'
import { daysLeft, planStatusLabel } from '@/lib/trial'
import { PlanChooser } from '@/components/plan-chooser'
import { COSTING_FEATURES, TRADING_FEATURES, PLAN_FAQ as FAQ } from '@/lib/site/plan-features'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

async function SubscribePageBody() {
  const supabase = await createClient()
  const [{ offers, slotsLeft }, { data: sub }, entitlement] = await Promise.all([
    loadPlanOffers(supabase),
    supabase.from('subscriptions').select('plan_id,status,current_period_end')
      .maybeSingle<{ plan_id: string; status: string; current_period_end: string | null }>(),
    entitlementStatus(),
  ])

  const { data: currentPlan } = sub
    ? await supabase.from('plans').select('name,tier').eq('id', sub.plan_id).maybeSingle<{ name: string; tier: string }>()
    : { data: null }
  const paying = sub?.status === 'active'
  const days = entitlement?.reason === 'trial_active' ? daysLeft(entitlement.boundary) : null
  const renews = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  const statusLine = !sub ? null
    : sub.status === 'trialing'
      ? (entitlement?.entitled
          ? `You are on the free trial${days !== null ? ` — ${days === 0 ? 'it ends today' : `${days} day${days === 1 ? '' : 's'} left`}` : ''}.`
          : 'Your free trial has ended. Choose a plan to record new work again.')
      : sub.status === 'active'
        ? `You are on ${currentPlan?.name ?? 'a paid plan'}${renews ? `, renewing on ${renews}` : ''}.`
        : sub.status === 'past_due'
          ? 'We could not take your last payment. Choose your plan below to pay again.'
          : `Your plan: ${planStatusLabel(sub.status)}.`

  return (
    <div className="space-y-5">
      <PageHeader title="Choose your plan" sub="Monthly billing in naira. Cancel whenever you like." />

      {statusLine && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{statusLine}</span>
            {sub && <Badge tone={sub.status === 'active' ? 'good' : sub.status === 'trialing' ? 'plain' : 'warn'}>{planStatusLabel(sub.status)}</Badge>}
          </div>
        </Card>
      )}

      {slotsLeft > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Founding offer</div>
            <Badge tone="good">{slotsLeft} of 100 left</Badge>
          </div>
          <p className="mt-2 text-sm" style={{ color: 'var(--mm-muted)' }}>
            Keep the founding price for as long as your subscription stays active.
          </p>
        </Card>
      )}

      <PlanChooser rows={offers.map((o) => ({
        tier: o.tier,
        name: o.name,
        price: money(o.monthly),
        monthly: o.monthly,
        was: o.isFounding && o.standard !== null ? money(o.standard) : null,
        isFounding: o.isFounding,
        available: o.monthly !== null && o.available,
        blurb: o.tier === 'costing'
          ? 'Know what your food costs and what to charge.'
          : 'Costing, plus everything you sell and who you sell to.',
        features: o.tier === 'costing' ? COSTING_FEATURES : TRADING_FEATURES,
        current: paying && currentPlan?.tier === o.tier,
      }))} />

      <section className="space-y-2">
        <SectionHeading>Questions</SectionHeading>
        {FAQ.map(([q, a]) => (
          <Disclosure key={q} summary={q}>
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>{a}</p>
          </Disclosure>
        ))}
      </section>

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        Secure checkout by Paystack. Menu Master NG does not store your card details.{' '}
        <Link href="/refunds" className="underline">Refunds and cancellation</Link> ·{' '}
        <Link href="/terms" className="underline">Terms</Link>
      </p>
    </div>
  )
}

export default function SubscribePage() {
  return <Suspense fallback={<Loading />}><SubscribePageBody /></Suspense>
}
