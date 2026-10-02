import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement } from '@/lib/data/context'
import { isSalesLocked } from '@/lib/sales-gate'
import { loadMenu } from '@/lib/data/menu'
import { localToday } from '@/lib/dates'
import { BackLink } from '@/components/ui'
import { TakeOrder } from './take-order'
import { placeOrder } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Taking an order. The menu and customers are read here; everything the
 * owner does on the screen stays in the browser until they confirm.
 */
export default async function NewSalePage() {
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/sales/new'))
  // The Sales page explains a plan without Sales; send the owner there.
  if (isSalesLocked(await hasSalesEntitlement())) redirect('/sales')

  const [menu, { data: customers }] = await Promise.all([
    loadMenu(supabase),
    supabase.from('customers').select('id,name,phone').order('name').limit(1000)
      .returns<{ id: string; name: string; phone: string | null }[]>(),
  ])

  return (
    <div className="space-y-4">
      <BackLink href="/sales">Sales</BackLink>
      <TakeOrder menu={menu} customers={customers ?? []} today={localToday()} action={placeOrder} />
    </div>
  )
}
