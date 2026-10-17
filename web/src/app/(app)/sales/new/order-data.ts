import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * What one of each dish costs to make, keyed like the menu
 * ("recipeId:variantId"), for the basket's "you keep about".
 *
 * ROLE GATE: call this only when canSeeCosts(ctx.role). The figure goes to
 * the phone inside the order screen, so for sales and kitchen it must never
 * be read at all. v_product_attention also returns nothing to them; the
 * check on the page is what keeps it out of the payload.
 *
 * true_cost is v_price_check's cost_per_portion, which is already null while
 * the costing is incomplete: an unknown cost stays unknown, never 0.
 */
export async function loadDishCosts(supabase: Supabase): Promise<Record<string, number | null>> {
  const { data } = await supabase.from('v_product_attention').select('recipe_id,variant_id,true_cost')
    .returns<{ recipe_id: string; variant_id: string | null; true_cost: string | null }[]>()
  const out: Record<string, number | null> = {}
  for (const r of Array.isArray(data) ? data : []) {
    out[`${r.recipe_id}:${r.variant_id ?? ''}`] = r.true_cost === null ? null : Number(r.true_cost)
  }
  return out
}

/** Something not on the menu that this business has charged for before. */
export type RecentExtra = {
  name: string
  /** What the customer was charged for one, last time. */
  price: number
  /**
   * What one cost the owner last time, as a hint only ("last time ₦3,000").
   * Read only for roles that may see costs; undefined for everyone else.
   */
  lastCost?: number | null
}

/**
 * Recent extras (0061: delivery, serving staff, drinks bought in), newest
 * first, one per name. A chip fills in the name and the charge only. The cost
 * is typed fresh each time, because the driver's fare is not the same every
 * day; last time's is shown beside the box, never copied into it.
 *
 * Read from v_sale_lines, which already leaves out cancelled sales. The cost
 * column is not even selected unless `withCost`, so a sales or kitchen phone
 * is never sent it.
 */
export async function loadRecentExtras(supabase: Supabase, withCost: boolean): Promise<RecentExtra[]> {
  const cols = withCost ? 'description,unit_price,unit_cost_at_sale,order_date' : 'description,unit_price,order_date'
  const { data } = await supabase.from('v_sale_lines').select(cols)
    .is('recipe_id', null).not('description', 'is', null)
    .order('order_date', { ascending: false }).limit(60)
    .returns<{ description: string | null; unit_price: string | null; unit_cost_at_sale?: string | null }[]>()

  // Newest first, so the first row for a name is its latest charge. Its cost
  // may still be blank (a draft is not costed until it is confirmed), so the
  // hint is the latest cost actually recorded for that name.
  const byName = new Map<string, RecentExtra>()
  for (const r of Array.isArray(data) ? data : []) {
    const name = (r.description ?? '').trim()
    const price = r.unit_price === null ? NaN : Number(r.unit_price)
    if (!name || !Number.isFinite(price) || price < 0) continue
    const c = r.unit_cost_at_sale === null || r.unit_cost_at_sale === undefined ? null : Number(r.unit_cost_at_sale)
    const cost = c !== null && Number.isFinite(c) ? c : null
    const k = name.toLowerCase()
    const had = byName.get(k)
    if (!had) {
      if (byName.size >= 6) continue
      byName.set(k, withCost ? { name, price, lastCost: cost } : { name, price })
    } else if (withCost && had.lastCost === null && cost !== null) {
      had.lastCost = cost
    }
  }
  return [...byName.values()]
}
