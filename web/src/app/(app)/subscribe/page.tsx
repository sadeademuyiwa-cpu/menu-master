import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, SectionHeading } from '@/components/ui'
import { money } from '@/lib/format'
import { PlanChooser } from '@/components/plan-chooser'

export const dynamic = 'force-dynamic'

type Plan = {
  id: string
  name: string
  tier: string
  price_tier: string
  price_kobo: number
  provider_plan_code: string | null
}

/**
 * Plan selection.
 *
 * Every price shown here is read from the database. Nothing on this page
 * decides what anyone will be charged: the browser sends a TIER and the server
 * resolves the rest through fn_checkout_quote, so what is displayed and what is
 * charged come from the same row.
 *
 * The founding price is shown only while slots actually remain. Advertising a
 * price we cannot honour is worse than not advertising it.
 */
export default async function SubscribePage() {
  const supabase = await createClient()

  const [{ data: plans }, { count: slotsLeft }, { data: sub }] = await Promise.all([
    supabase.from('plans')
      .select('id,name,tier,price_tier,price_kobo,provider_plan_code')
      .eq('is_active', true)
      .returns<Plan[]>(),
    supabase.from('founder_slots')
      .select('seq', { count: 'exact', head: true })
      .is('account_id', null),
    supabase.from('subscriptions').select('plan_id,status').maybeSingle<
      { plan_id: string; status: string }
    >(),
  ])

  const by = (tier: string, priceTier: string) =>
    plans?.find((p) => p.tier === tier && p.price_tier === priceTier) ?? null

  // Slots free RIGHT NOW. This is a display fact, never the authority: the
  // quote re-checks it at the moment of checkout, under a lock.
  const founding = (slotsLeft ?? 0) > 0

  const rows = (['costing', 'trading'] as const).map((tier) => {
    const standard = by(tier, 'standard')
    const offered = founding ? (by(tier, 'founding') ?? standard) : standard
    return {
      tier,
      name: standard?.name ?? tier,
      offeredKobo: offered?.price_kobo ?? null,
      standardKobo: standard?.price_kobo ?? null,
      isFounding: founding && offered?.price_tier === 'founding',
      mapped: Boolean(offered?.provider_plan_code),
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Choose your plan"
        sub="Monthly, in naira. Cancel whenever you like."
      />

      {founding && (
        <Card>
          <SectionHeading>Founding pricing — {slotsLeft} of 100 left</SectionHeading>
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            The first hundred businesses keep the founding price for as long as
            their subscription runs without a break. It is not a first-month
            discount.
          </p>
        </Card>
      )}

      <PlanChooser rows={rows.map((r) => ({
        tier: r.tier,
        name: r.name,
        price: money(r.offeredKobo === null ? null : r.offeredKobo / 100),
        was: r.isFounding && r.standardKobo !== null
          ? money(r.standardKobo / 100)
          : null,
        isFounding: r.isFounding,
        available: r.offeredKobo !== null && r.mapped,
        blurb: r.tier === 'costing'
          ? 'Recipe costing, ingredient prices, margins and menu pricing.'
          : 'Everything in Costing, plus recording sales, customers and channels.',
      }))} />

      {sub && (
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          You are currently on <span className="font-medium">{sub.plan_id}</span> ({sub.status}).
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        Payments are handled by Paystack. Menu Master NG never sees or stores
        your card details.
      </p>
    </div>
  )
}
