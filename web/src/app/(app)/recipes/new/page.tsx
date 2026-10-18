import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { loadBuyingHistory, loadPricedItems, loadPurchaseCatalog } from '@/lib/data/purchase-catalog'
import { createOwnItem } from '@/lib/actions/items'
import { canSeeCosts } from '@/lib/pricing'
import { localToday } from '@/lib/dates'
import { BackLink, Empty, PageHeader } from '@/components/ui'
import { canEditItems, canRecordPurchases } from '../../purchases/buy-roles'
import { canEditDish } from '../[id]/roles'
import { NewDish } from './new-dish'
import { addSuggestedItem, createDish } from './actions'

export const dynamic = 'force-dynamic'

/** How a batch can be counted, in the order most owners need them. */
const YIELD_UNITS: { code: string; label: string }[] = [
  { code: 'portion', label: 'Plates or portions' },
  { code: 'unit', label: 'Pieces' },
  { code: 'g', label: 'Grams (g)' },
  { code: 'kg', label: 'Kilograms (kg)' },
  { code: 'ml', label: 'Millilitres (ml)' },
  { code: 'l', label: 'Litres (l)' },
]

export default async function NewDishPage() {
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/recipes/new'))

  // A dish is added by the owner, a manager or the kitchen (0015). Anyone
  // else reaching this page by its address would fill in a whole dish only
  // to have it refused, so they are told who can add it instead.
  if (!canEditDish(ctx.role)) {
    return (
      <div className="space-y-4">
        <BackLink href="/recipes">Dishes</BackLink>
        <PageHeader title="New dish" />
        <Empty>Dishes are added by the owner, a manager or the kitchen. Ask one of them to add this one.</Empty>
      </div>
    )
  }
  // Saying what was paid records a purchase. Of the dish roles, the owner and
  // a manager may (0015); the kitchen may not, and sees no price boxes.
  const canBuy = canRecordPurchases(ctx.role)
  const costs = canSeeCosts(ctx.role)

  const [{ items, recent }, buy, history, priced, { data: units }] = await Promise.all([
    loadPurchaseCatalog(supabase, 'cook'),
    canBuy ? loadPurchaseCatalog(supabase, 'buy') : Promise.resolve(null),
    // What each item came to last time; amounts only for a role that may see costs.
    canBuy ? loadBuyingHistory(supabase, { withAmounts: costs }) : Promise.resolve(null),
    // Which items have a price, for a role that may know.
    costs && businessId ? loadPricedItems(supabase, businessId) : Promise.resolve(null),
    supabase.from('units').select('id,code').returns<{ id: string; code: string }[]>(),
  ])
  const buyUnits = new Map((buy?.items ?? []).map((i) => [i.id, i.units]))
  const idOf = new Map((units ?? []).map((u) => [u.code, u.id]))
  const yieldUnits = YIELD_UNITS.flatMap((u) => {
    const id = idOf.get(u.code)
    return id ? [{ id, code: u.code, label: u.label }] : []
  })

  return (
    <div className="space-y-4">
      <BackLink href="/recipes">Dishes</BackLink>
      <NewDish items={items.map((i) => ({ ...i, buyUnits: buyUnits.get(i.id) ?? [] }))} priced={priced} recent={recent}
               lastBought={history?.lastBought ?? {}} yieldUnits={yieldUnits} today={localToday()} action={createDish}
               canAddItems={canEditItems(ctx.role)} canBuy={canBuy} addItem={addSuggestedItem} createItem={createOwnItem} />
    </div>
  )
}
