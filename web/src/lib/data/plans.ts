import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type PlanOffer = {
  tier: 'costing' | 'trading'
  name: string
  /** What a new subscriber pays a month, in naira: the founding price while slots last. */
  monthly: number | null
  /** The standard price, shown struck through beside a founding price. */
  standard: number | null
  isFounding: boolean
  /** True when the plan can be paid for online right now. */
  available: boolean
}

/**
 * The plans on offer, as /subscribe sells them: founding prices while founder
 * slots remain, standard prices after. One reader, so the trial bar, the
 * setup screen and the plans page can never quote different numbers.
 */
export async function loadPlanOffers(supabase: Supabase): Promise<{ offers: PlanOffer[]; slotsLeft: number }> {
  const [{ data: plans }, { count }] = await Promise.all([
    supabase.from('plans').select('id,tier,price_tier,price_kobo,provider_plan_code').eq('is_active', true)
      .returns<{ id: string; tier: string; price_tier: string; price_kobo: number; provider_plan_code: string | null }[]>(),
    supabase.from('founder_slots').select('seq', { count: 'exact', head: true }).is('account_id', null),
  ])
  const slotsLeft = count ?? 0
  const by = (tier: string, priceTier: string) => plans?.find((p) => p.tier === tier && p.price_tier === priceTier) ?? null
  const offers = (['costing', 'trading'] as const).map((tier): PlanOffer => {
    const standard = by(tier, 'standard')
    const offered = slotsLeft > 0 ? (by(tier, 'founding') ?? standard) : standard
    return {
      tier,
      name: tier === 'costing' ? 'Costing' : 'Costing + Sales',
      monthly: offered ? offered.price_kobo / 100 : null,
      standard: standard ? standard.price_kobo / 100 : null,
      isFounding: slotsLeft > 0 && offered?.price_tier === 'founding',
      available: Boolean(offered?.provider_plan_code),
    }
  })
  return { offers, slotsLeft }
}

/** The lowest monthly price on offer, for "plans from ₦X a month". */
export function cheapest(offers: PlanOffer[]): number | null {
  const prices = offers.map((o) => o.monthly).filter((p): p is number => p !== null && p > 0)
  return prices.length ? Math.min(...prices) : null
}
