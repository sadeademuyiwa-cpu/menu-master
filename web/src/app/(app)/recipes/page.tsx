import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { PageHeader, Notice, SectionHeading, Empty, Card, Badge } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { money, productState } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Recipe = { id: string; name: string }
type Product = {
  recipe_id: string; variant_id: string | null; format_name: string | null
  true_cost: string | null; selling_price: string | null; state: string; attention_rank: number
}

/**
 * Every dish with what it costs, what it sells for and whether that is
 * healthy -- the live menu costing, read from v_product_attention, the same
 * view the dashboard uses. A new dish starts on its own screen (/recipes/new).
 */
export default async function RecipesPage(props: {
  searchParams: Promise<{ notice?: string }>
}) {
  const { notice } = await props.searchParams
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, '/recipes'))
  const { supabase, role } = ctx
  // Costs and prices are for the roles the database lets see them (fn_can_see_costs).
  const seesCosts = role === 'owner' || role === 'manager' || role === 'accountant'

  const [{ data: recipes }, { data: products }] = await Promise.all([
    supabase.from('recipes').select('id,name').is('deleted_at', null).order('name').returns<Recipe[]>(),
    supabase.from('v_product_attention')
      .select('recipe_id,variant_id,format_name,true_cost,selling_price,state,attention_rank')
      .returns<Product[]>(),
  ])

  const rowsOf = new Map<string, Product[]>()
  for (const p of products ?? []) rowsOf.set(p.recipe_id, [...(rowsOf.get(p.recipe_id) ?? []), p])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recipes"
        sub="What a dish really costs to make, from the prices you entered yourself."
      />
      {notice && <Notice>{notice}</Notice>}

      {/* One obvious thing to do here. The dish screen takes it from there. */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Link href="/recipes/new" className="mm-btn mm-btn-primary w-full text-base">
          <AppIcon name="plus" size={20} /> New dish
        </Link>
        <Link href="/formats" className="mm-btn mm-btn-secondary w-full">
          <AppIcon name="formats" size={18} /> Sizes you sell
        </Link>
      </div>

      <section className="space-y-3">
        <SectionHeading sub="Cost and price per portion, or per size where you sell in sizes.">
          Your dishes {recipes ? `(${recipes.length})` : ''}
        </SectionHeading>

        {!recipes || recipes.length === 0 ? (
          <Empty>No dishes yet. Tap New dish to find out what your first one really costs you.</Empty>
        ) : (
          <ul className="space-y-2">
            {recipes.map((r) => {
              const rows = (rowsOf.get(r.id) ?? []).sort((a, b) => a.attention_rank - b.attention_rank)
              const main = rows[0]
              const st = main ? productState(main.state) : null
              return (
                <li key={r.id}>
                  <Link href={`/recipes/${r.id}`} className="block">
                    <Card>
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-semibold">{r.name}</span>
                        {seesCosts && (st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge tone="muted">No ingredients yet</Badge>)}
                      </div>
                      {!seesCosts ? null : rows.length > 1 ? (
                        <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                          Sold in {rows.length} sizes
                          {rows.some((p) => p.selling_price === null) ? ' · some have no price yet' : ''}
                        </div>
                      ) : main ? (
                        <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                          {main.true_cost !== null ? `Costs you ${money(main.true_cost)}` : 'Cost not complete yet'}
                          {main.selling_price !== null ? ` · you sell it for ${money(main.selling_price)}` : ' · no selling price yet'}
                        </div>
                      ) : (
                        <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>Open it to add what goes into one batch.</div>
                      )}
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
