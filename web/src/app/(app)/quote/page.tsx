import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { PageHeader, Notice } from '@/components/ui'
import { PerHead, type PerHeadItem } from './per-head'

export const dynamic = 'force-dynamic'

type Row = {
  recipe_id: string; variant_id: string | null
  product_name: string; format_name: string | null
  true_cost: string | null; selling_price: string | null; recommended_price: string | null
}

/**
 * Per-head costing for an event: pick the dishes on the menu, say how many
 * heads, and read what the food costs per head and what to charge to keep
 * the margin you asked for. Every figure is the database's own cost and
 * price per item (v_product_attention); this screen only multiplies and
 * adds. Nothing is saved.
 */
export default async function QuotePage() {
  const ctx = await currentContext()
  const { supabase, accountId, businessId, businessName } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/quote'))

  const [{ data: rows }, { data: settings }] = await Promise.all([
    supabase.from('v_product_attention')
      .select('recipe_id,variant_id,product_name,format_name,true_cost,selling_price,recommended_price')
      .order('product_name').returns<Row[]>(),
    supabase.from('business_settings').select('default_target_margin')
      .eq('business_id', businessId ?? '').maybeSingle<{ default_target_margin: string | null }>(),
  ])

  const items: PerHeadItem[] = (rows ?? []).map((r) => ({
    key: `${r.recipe_id}:${r.variant_id ?? ''}`,
    name: r.format_name ? `${r.product_name} · ${r.format_name}` : r.product_name,
    cost: r.true_cost === null ? null : Number(r.true_cost),
    price: r.selling_price === null ? null : Number(r.selling_price),
    suggested: r.recommended_price === null ? null : Number(r.recommended_price),
  }))
  const target = settings?.default_target_margin === null || settings?.default_target_margin === undefined
    ? null : Number(settings.default_target_margin)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Price per head"
        sub="For an event: pick what each guest gets, say how many guests, and see what the food costs you per head and what to charge to keep your margin. Nothing here is saved; take the order when they confirm."
      />
      {items.length === 0 ? (
        <Notice tone="info">Cost a dish first. Once a dish has a cost, it appears here.</Notice>
      ) : (
        <PerHead items={items} targetMargin={target} businessName={businessName ?? 'Menu Master NG'} />
      )}
    </div>
  )
}
