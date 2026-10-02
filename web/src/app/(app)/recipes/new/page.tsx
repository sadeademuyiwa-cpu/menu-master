import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { loadPurchaseCatalog } from '@/lib/data/purchase-catalog'
import { BackLink } from '@/components/ui'
import { NewDish } from './new-dish'
import { createDish } from './actions'

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
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/recipes/new'))

  const [{ items, recent }, { data: units }] = await Promise.all([
    loadPurchaseCatalog(supabase, 'cook'),
    supabase.from('units').select('id,code').returns<{ id: string; code: string }[]>(),
  ])
  const idOf = new Map((units ?? []).map((u) => [u.code, u.id]))
  const yieldUnits = YIELD_UNITS.flatMap((u) => {
    const id = idOf.get(u.code)
    return id ? [{ id, code: u.code, label: u.label }] : []
  })

  return (
    <div className="space-y-4">
      <BackLink href="/recipes">Dishes</BackLink>
      <NewDish items={items} priced={recent} yieldUnits={yieldUnits} action={createDish} />
    </div>
  )
}
