import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Badge } from '@/components/ui'
import { money } from '@/lib/format'
import { PlanChooser } from '@/components/plan-chooser'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

type Plan = {
  id: string
  name: string
  tier: string
  price_tier: string
  price_kobo: number
  provider_plan_code: string | null
}

async function SubscribePageBody() {
  const supabase = await createClient()

  const [{ data: plans }, { count: slotsLeft }, { data: sub }] = await Promise.all([
    supabase.from('plans')
      .select('id,name,tier,price_tier,price_kobo,provider_plan_code')
      .eq('is_active', true)
      .returns<Plan[]>(),
    supabase.from('founder_slots')
      .select('seq', { count: 'exact', head: true })
      .is('account_id', null),
    supabase.from('subscriptions').select('plan_id,status').maybeSingle<{ plan_id: string; status: string }>(),
  ])

  const by = (tier: string, priceTier: string) =>
    plans?.find((p) => p.tier === tier && p.price_tier === priceTier) ?? null

  const founding = (slotsLeft ?? 0) > 0
  const rows = (['costing', 'trading'] as const).map((tier) => {
    const standard = by(tier, 'standard')
    const offered = founding ? (by(tier, 'founding') ?? standard) : standard
    return {
      tier,
      name: tier === 'costing' ? 'Costing' : 'Costing + Sales',
      offeredKobo: offered?.price_kobo ?? null,
      standardKobo: standard?.price_kobo ?? null,
      isFounding: founding && offered?.price_tier === 'founding',
      mapped: Boolean(offered?.provider_plan_code),
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Choose your plan" sub="Monthly billing in naira. Cancel whenever you like." />

      {founding && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Founding offer</div>
            <Badge tone="good">{slotsLeft} of 100 left</Badge>
          </div>
          <p className="mt-2 text-sm" style={{ color: 'var(--mm-muted)' }}>
            Keep the founding price while your subscription stays active.
          </p>
        </Card>
      )}

      <PlanChooser rows={rows.map((r) => ({
        tier: r.tier,
        name: r.name,
        price: money(r.offeredKobo === null ? null : r.offeredKobo / 100),
        was: r.isFounding && r.standardKobo !== null ? money(r.standardKobo / 100) : null,
        isFounding: r.isFounding,
        available: r.offeredKobo !== null && r.mapped,
        blurb: r.tier === 'costing'
          ? 'Cost recipes, ingredients, prices and margins.'
          : 'Everything in Costing, plus sales and customers.',
      }))} />

      {sub && (
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          Current plan: <span className="font-medium">{sub.plan_id}</span> · {sub.status}
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        Secure checkout by Paystack. Menu Master NG does not store your card details.{' '}
        <Link href="/refunds" className="underline">Refunds & cancellation</Link>
      </p>
    </div>
  )
}

export default function SubscribePage() {
  return <Suspense fallback={<Loading />}><SubscribePageBody /></Suspense>
}
