import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement, closedLine, withNotice } from '@/lib/data/context'
import { isSalesLocked } from '@/lib/sales-gate'
import { loadMenu } from '@/lib/data/menu'
import { localToday } from '@/lib/dates'
import { canSeeCosts } from '@/lib/pricing'
import { canRecordSales } from '@/app/(app)/dashboard/roles'
import { BackLink, Empty, PageHeader } from '@/components/ui'
import { TakeOrder } from './take-order'
import { placeOrder } from './actions'
import { loadDishCosts, loadRecentExtras } from './order-data'
import { readCarried } from './carry'

export const dynamic = 'force-dynamic'

/**
 * Taking an order. The menu and customers are read here; everything the
 * owner does on the screen stays in the browser until they confirm.
 *
 * What a dish costs reaches the screen only for the roles that may see costs
 * (owner, manager, accountant). For sales and kitchen it is not read at all,
 * so it cannot travel inside the order screen's props.
 *
 * ?add=... is an order carried from Price per head (carry.ts): the dishes
 * and how many, never a price.
 */
export default async function NewSalePage({
  searchParams,
}: { searchParams: Promise<{ add?: string | string[] }> }) {
  const { add } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/sales/new'))
  // After a trial ends a sale cannot be recorded (D3). Rather than a whole
  // order typed in and then refused at Confirm, back to Sales with why -- as
  // New purchase does. This comes first: a closed account also reads as
  // "no Sales" (fn_account_has_sales needs an entitled account), and the
  // reason it is given must be the real one. Only an explicit "closed" does this.
  const paused = await closedLine(ctx.role, 'new sales can’t be recorded')
  if (paused) redirect(withNotice('/sales', paused))

  // The Sales page explains a plan without Sales; send the owner there.
  const salesPlan = await hasSalesEntitlement()
  if (isSalesLocked(salesPlan)) redirect('/sales')

  // Recording a sale is for owner, manager and sales (0015). Kitchen and the
  // accountant would build a whole basket only for the database to refuse
  // it, and kitchen sees no prices at all, so nothing is read for them: no
  // menu, no customers, no past extras with their charges.
  if (!canRecordSales(ctx.role, salesPlan)) {
    return (
      <div className="space-y-4">
        <BackLink href="/sales">Sales</BackLink>
        <PageHeader title="New sale" />
        <Empty>Sales are recorded by the owner, a manager or sales staff. Ask one of them to record this one.</Empty>
      </div>
    )
  }

  const showCosts = canSeeCosts(ctx.role)
  const [menu, { data: customers }, costs, extras] = await Promise.all([
    loadMenu(supabase, businessId),
    supabase.from('customers').select('id,name,phone').order('name').limit(1000)
      .returns<{ id: string; name: string; phone: string | null }[]>(),
    showCosts ? loadDishCosts(supabase) : Promise.resolve(undefined),
    loadRecentExtras(supabase, showCosts),
  ])
  const carried = readCarried(add, new Set(menu.map((m) => m.value)))

  return (
    <div className="space-y-4">
      <BackLink href="/sales">Sales</BackLink>
      <TakeOrder
        menu={menu}
        customers={customers ?? []}
        today={localToday()}
        action={placeOrder}
        costs={costs}
        extras={extras}
        carried={carried}
      />
    </div>
  )
}
