import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement } from '@/lib/data/context'
import { canRecordSales } from '@/app/(app)/dashboard/roles'
import { loadMenu } from '@/lib/data/menu'
import { canSeeCosts } from '@/lib/pricing'
import { parentTab } from '@/lib/nav'
import { PageHeader, Notice, BackLink } from '@/components/ui'
import { PerHead, type PerHeadItem } from './per-head'

export const dynamic = 'force-dynamic'

type CostRow = {
  recipe_id: string; variant_id: string | null
  true_cost: string | null; recommended_price: string | null
}

/**
 * Per-head pricing for an event: pick the dishes, say how many guests, and
 * read what to charge. Every figure is the database's own price and cost per
 * item; this screen only multiplies and adds. Nothing is saved: "Take the
 * order" carries the dishes and quantities into New sale, where the owner
 * checks and confirms.
 *
 * The dishes and their selling prices come from the same menu New sale reads
 * (loadMenu, fn_menu_prices), so a sales member can price an event too, and
 * every dish carried across is one New sale knows. What a dish costs and the
 * price that keeps the target are read only for the roles that may see
 * costs; for everyone else they are not fetched and not sent.
 */
export default async function QuotePage() {
  const ctx = await currentContext()
  const { supabase, accountId, businessId, businessName } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/quote'))
  const showCosts = canSeeCosts(ctx.role)
  const tab = parentTab('/quote')

  const [menu, costs, settings, salesPlan] = await Promise.all([
    loadMenu(supabase, businessId),
    showCosts
      ? supabase.from('v_product_attention').select('recipe_id,variant_id,true_cost,recommended_price')
          .returns<CostRow[]>().then((r) => r.data ?? [])
      : Promise.resolve([] as CostRow[]),
    showCosts
      ? supabase.from('business_settings').select('default_target_margin')
          .eq('business_id', businessId ?? '').maybeSingle<{ default_target_margin: string | null }>()
          .then((r) => r.data)
      : Promise.resolve(null),
    hasSalesEntitlement(),
  ])
  // "Take the order" opens New sale, which only owner, manager and sales
  // may record (0015); anyone else is not offered a page that refuses them.
  const canTakeOrder = canRecordSales(ctx.role, salesPlan)

  const costOf = new Map(costs.map((c) => [`${c.recipe_id}:${c.variant_id ?? ''}`, c]))
  const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v))
  const items: PerHeadItem[] = menu.map((m) => {
    const base = {
      key: m.value,
      name: m.size ? `${m.name} · ${m.size}` : m.name,
      dish: m.name,
      photoPath: m.photo_path,
      price: m.price,
    }
    if (!showCosts) return base
    const c = costOf.get(m.value)
    return { ...base, cost: num(c?.true_cost), suggested: num(c?.recommended_price) }
  })
  const target = showCosts ? num(settings?.default_target_margin) : null

  return (
    <div className="space-y-5">
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader
        title="Price per head"
        sub="For an event: pick what each guest gets and how many guests. Nothing here is saved; take the order when they confirm."
      />
      {items.length === 0 ? (
        <Notice tone="info">Add a dish first. Once you have a dish, it appears here.</Notice>
      ) : (
        <PerHead items={items} showCosts={showCosts} targetMargin={target} businessName={businessName ?? 'Menu Master NG'}
          canTakeOrder={canTakeOrder} />
      )}
    </div>
  )
}
