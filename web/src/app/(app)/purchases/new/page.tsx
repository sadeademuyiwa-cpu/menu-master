import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, closedLine, withNotice } from '@/lib/data/context'
import { loadBuyingHistory, loadPurchaseCatalog } from '@/lib/data/purchase-catalog'
import { localToday } from '@/lib/dates'
import { canSeeCosts } from '@/lib/pricing'
import { BackLink, Empty, PageHeader } from '@/components/ui'
import { createOwnItem } from '@/lib/actions/items'
import { canAddMeasures, canEditItems, canRecordPurchases } from '../buy-roles'
import { NewPurchase } from './new-purchase'
import { recordPurchase, saveMeasure } from './actions'
import '../buy.css'

export const dynamic = 'force-dynamic'

export default async function NewPurchasePage(props: {
  searchParams: Promise<{ ingredient?: string }>
}) {
  const { ingredient } = await props.searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/purchases/new'))

  // Recording a purchase is for owner, manager and accountant (0015,
  // fn_post_purchase). Anyone else would fill in a whole market run only to
  // have it refused, so they are told who can do it instead.
  if (!canRecordPurchases(ctx.role)) {
    return (
      <div className="space-y-4">
        <BackLink href="/purchases">Purchases</BackLink>
        <PageHeader title="Record a purchase" />
        <Empty>Purchases are recorded by the owner, a manager or the accountant. Ask one of them to record this one.</Empty>
      </div>
    )
  }

  // After a trial ends a purchase cannot be recorded (D3). Rather than a
  // whole market run typed in and then refused, back to Purchases with why.
  const paused = await closedLine(ctx.role, 'new purchases can’t be recorded')
  if (paused) redirect(withNotice('/purchases', paused))

  const [{ items }, history, { data: suppliers }] = await Promise.all([
    loadPurchaseCatalog(supabase),
    // What was paid last time is a cost; it is only read for a role that may see costs.
    loadBuyingHistory(supabase, { withAmounts: canSeeCosts(ctx.role) }),
    supabase.from('suppliers').select('id,name').eq('is_active', true).order('name')
      .returns<{ id: string; name: string }[]>(),
  ])

  return (
    <div className="space-y-4">
      <BackLink href="/purchases">Purchases</BackLink>
      <NewPurchase
        items={items} often={history.often} lastRun={history.lastRun} lastRunDay={history.lastRunDay}
        lastBought={history.lastBought} suppliers={suppliers ?? []}
        today={localToday()} first={ingredient ?? null} action={recordPurchase}
        canMeasure={canAddMeasures(ctx.role)} saveMeasure={saveMeasure}
        canAddItems={canEditItems(ctx.role)} createItem={createOwnItem}
      />
    </div>
  )
}
