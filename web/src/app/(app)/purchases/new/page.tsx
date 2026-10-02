import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { loadPurchaseCatalog } from '@/lib/data/purchase-catalog'
import { localToday } from '@/lib/dates'
import { BackLink } from '@/components/ui'
import { NewPurchase } from './new-purchase'
import { recordPurchase } from './actions'

export const dynamic = 'force-dynamic'

export default async function NewPurchasePage(props: {
  searchParams: Promise<{ ingredient?: string }>
}) {
  const { ingredient } = await props.searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/purchases/new'))

  const [{ items, recent }, { data: suppliers }] = await Promise.all([
    loadPurchaseCatalog(supabase),
    supabase.from('suppliers').select('id,name').eq('is_active', true).order('name')
      .returns<{ id: string; name: string }[]>(),
  ])

  return (
    <div className="space-y-4">
      <BackLink href="/purchases">Purchases</BackLink>
      <NewPurchase
        items={items} recent={recent} suppliers={suppliers ?? []}
        today={localToday()} first={ingredient ?? null} action={recordPurchase}
      />
    </div>
  )
}
