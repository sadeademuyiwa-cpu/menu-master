import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement } from '@/lib/data/context'
import {
  PageHeader, Card, Notice, Empty, SectionHeading, Badge, ActionTile,
} from '@/components/ui'
import { AppIcon, type IconName } from '@/components/icons'
import { money, percent, productState, priceState } from '@/lib/format'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

type Setup = {
  name: string
  ingredients: number; prices_entered: number; recipes: number
  complete_costings: number; blocking_conversions: number; selling_prices_set: number
  recipes_with_yield: number; serving_formats: number; packaging_lines: number
  labour_rates: number; overhead_items: number; products_ready: number
}
type Product = {
  recipe_id: string; variant_id: string | null
  product_name: string; format_name: string | null
  is_complete: boolean | null
  true_cost: string | null; selling_price: string | null
  profit: string | null; margin_pct: string | null
  recommended_price: string | null; state: string; attention_rank: number
}
type PriceRow = {
  ingredient_id: string; ingredient_name: string
  price_state: string; used_in_recipes: number; last_purchase_date: string | null
}

type Step = { done: boolean; label: string; href: string; hint: string; icon: IconName }

async function DashboardPageBody() {
  const ctx = await currentContext()
  const { supabase, accountId, businessName } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/dashboard'))

  const [{ data: setupRows }, { data: products }, { data: prices }] = await Promise.all([
    supabase.from('v_onboarding_status')
      .select('name,ingredients,prices_entered,recipes,complete_costings,blocking_conversions,' +
              'selling_prices_set,recipes_with_yield,serving_formats,packaging_lines,' +
              'labour_rates,overhead_items,products_ready')
      .limit(1).returns<Setup[]>(),
    supabase.from('v_product_attention')
      .select('recipe_id,variant_id,product_name,format_name,is_complete,true_cost,' +
              'selling_price,profit,margin_pct,recommended_price,state,attention_rank')
      .order('attention_rank').order('product_name').returns<Product[]>(),
    supabase.from('v_ingredient_price_status')
      .select('ingredient_id,ingredient_name,price_state,used_in_recipes,last_purchase_date')
      .neq('price_state', 'current').gt('used_in_recipes', 0)
      .order('used_in_recipes', { ascending: false })
      .limit(8).returns<PriceRow[]>(),
  ])

  const [{ count: tradingDays }, canSell] = await Promise.all([
    supabase.from('v_sales_summary').select('sale_date', { count: 'exact', head: true }),
    hasSalesEntitlement(),
  ])

  const setup = setupRows?.[0]
  const all = products ?? []
  const needsAttention = all.filter((p) => p.attention_rank <= 3)
  const ready = all.filter((p) => p.state === 'healthy')

  // The few things that make Menu Master useful, in the order they unlock each
  // other. Each is ticked only by data the owner entered: the starter
  // catalogue does not count as "adding what you buy".
  const core: Step[] = [
    { done: (setup?.prices_entered ?? 0) > 0, label: 'Enter what you paid', href: '/purchases/new',
      hint: 'Record a market run or delivery.', icon: 'purchases' },
    { done: (setup?.complete_costings ?? 0) > 0, label: 'Cost one dish', href: (setup?.recipes ?? 0) > 0 ? '/recipes' : '/recipes/new',
      hint: 'See what one plate really costs you.', icon: 'recipes' },
    { done: (setup?.selling_prices_set ?? 0) > 0, label: 'Set its selling price', href: '/recipes',
      hint: 'See what you keep on every plate.', icon: 'pricing' },
    // A Costing-only plan cannot record sales, so it is never asked to.
    ...(canSell === false ? [] : [{ done: (tradingDays ?? 0) > 0, label: 'Record your first sale',
      href: '/sales/new', hint: 'Start tracking what you actually make.', icon: 'sales' as IconName }]),
  ]
  // Optional detail that makes a cost more accurate. Never blocks anything.
  const extras: Step[] = [
    { done: (setup?.serving_formats ?? 0) > 0, label: 'Sizes you sell', href: '/formats',
      hint: 'Plates, litres, packs or your own sizes.', icon: 'formats' },
    { done: (setup?.packaging_lines ?? 0) > 0, label: 'Packaging', href: '/formats',
      hint: 'Bowls, lids and labels.', icon: 'package' },
    { done: (setup?.labour_rates ?? 0) > 0, label: 'Paid work', href: '/settings',
      hint: 'What you pay someone to cook or prep.', icon: 'people' },
    { done: (setup?.overhead_items ?? 0) > 0, label: 'Monthly bills', href: '/settings',
      hint: 'Rent, gas, electricity.', icon: 'settings' },
  ]
  const nextStep = core.find((s) => !s.done)
  const doneCount = core.filter((s) => s.done).length
  const settingUp = doneCount < core.length
  const progress = Math.round((doneCount / core.length) * 100)
  const extrasLeft = extras.filter((s) => !s.done).length
  // The guided setup (/start) is for owners and managers, and only until one
  // dish is costed and priced -- the same test the middleware uses.
  const wizardOpen = (ctx.role === 'owner' || ctx.role === 'manager') &&
    ((setup?.complete_costings ?? 0) === 0 || (setup?.selling_prices_set ?? 0) === 0)

  const quickActions: { href: string; icon: IconName; label: string; meta: string }[] = [
    { href: '/sales/new', icon: 'sales', label: 'New sale', meta: 'Record what you sold' },
    { href: '/purchases/new', icon: 'purchases', label: 'New purchase', meta: 'Record what you paid' },
    { href: '/recipes/new', icon: 'recipes', label: 'New dish', meta: 'Cost what you make' },
    { href: '/ingredients', icon: 'ingredients', label: 'Ingredient', meta: 'Add or update an item' },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={businessName || 'Menu Master NG'}
        sub={settingUp ? 'Finish setup to see your real food costs and profit.' : 'Your business at a glance.'}
      />

      <section>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quickActions.map((a) => (
            <ActionTile key={a.href} href={a.href} icon={a.icon} label={a.label} meta={a.meta} />
          ))}
        </div>
      </section>

      {settingUp && (
        <section className="space-y-3">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Getting started</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--mm-muted)' }}>{doneCount} of {core.length} done</div>
              </div>
              <div className="text-sm font-semibold tabular-nums">{progress}%</div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--mm-line)' }}>
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--mm-accent)' }} />
            </div>

            {nextStep && (
              <Link href={nextStep.href} className="mt-4 flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--mm-surface)' }}>
                <span className="mm-action-icon"><AppIcon name={nextStep.icon} size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--mm-muted)' }}>Next</span>
                  <span className="block font-semibold">{nextStep.label}</span>
                  <span className="block text-xs" style={{ color: 'var(--mm-muted)' }}>{nextStep.hint}</span>
                </span>
                <AppIcon name="chevron-right" size={18} style={{ color: 'var(--mm-muted)' }} />
              </Link>
            )}

            <StepList steps={core} />

            {/* The guided steps, for an owner who skipped them: picks up where
                they stopped, and every finished step can be opened to change. */}
            {wizardOpen && (
              <Link href="/start" className="mm-btn mm-btn-primary mt-4 w-full">
                Continue guided setup <AppIcon name="arrow-right" size={16} />
              </Link>
            )}
          </Card>
        </section>
      )}

      {(!settingUp || needsAttention.length > 0) && (
        <section className="space-y-3">
          <SectionHeading sub="Items that need a price, conversion or margin decision.">Needs attention</SectionHeading>
          {!needsAttention.length ? (
            <Empty>Everything looks healthy.</Empty>
          ) : (
            <ul className="space-y-2">
              {needsAttention.map((p) => {
                const st = productState(p.state)
                return (
                  <li key={`${p.recipe_id}-${p.variant_id ?? 'base'}`}>
                    <Link href={`/recipes/${p.recipe_id}`} className="block">
                      <Card>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold">
                              {p.product_name}{p.format_name ? <span style={{ color: 'var(--mm-muted)' }}> · {p.format_name}</span> : null}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge tone={st.tone}>{st.label}</Badge>
                              {p.margin_pct !== null && <span className="text-xs tabular-nums" style={{ color: 'var(--mm-muted)' }}>{percent(Number(p.margin_pct))}</span>}
                            </div>
                          </div>
                          <AppIcon name="chevron-right" size={18} style={{ color: 'var(--mm-muted)' }} />
                        </div>
                      </Card>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {ready.length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="Cost, price, profit and margin per item.">Products</SectionHeading>
          <div className="grid gap-2 lg:grid-cols-2">
            {ready.slice(0, 6).map((p) => (
              <Link key={`${p.recipe_id}-${p.variant_id ?? 'base'}-ok`} href={`/recipes/${p.recipe_id}`} className="block">
                <Card>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{p.product_name}{p.format_name ? ` · ${p.format_name}` : ''}</span>
                    <Badge tone="good">{productState(p.state).label}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-[13px]">
                    <div><dt style={{ color: 'var(--mm-muted)' }}>Cost</dt><dd className="mt-0.5 font-semibold tabular-nums">{money(Number(p.true_cost))}</dd></div>
                    <div><dt style={{ color: 'var(--mm-muted)' }}>Price</dt><dd className="mt-0.5 font-semibold tabular-nums">{money(Number(p.selling_price))}</dd></div>
                    <div><dt style={{ color: 'var(--mm-muted)' }}>Profit</dt><dd className="mt-0.5 font-semibold tabular-nums">{money(Number(p.profit))}</dd></div>
                    <div><dt style={{ color: 'var(--mm-muted)' }}>Margin</dt><dd className="mt-0.5 font-semibold tabular-nums">{percent(Number(p.margin_pct))}</dd></div>
                  </dl>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(prices ?? []).length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="Recording a new purchase updates these prices.">Prices to check</SectionHeading>
          <ul className="space-y-2">
            {(prices ?? []).map((r) => (
              <li key={r.ingredient_id}>
                <Link href={`/purchases/new?ingredient=${r.ingredient_id}`} className="block">
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold">{r.ingredient_name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={priceState(r.price_state).tone}>{priceState(r.price_state).label}</Badge>
                        <AppIcon name="chevron-right" size={17} style={{ color: 'var(--mm-muted)' }} />
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extrasLeft > 0 && (
        <section>
          <Card>
            <details>
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Make your costs more accurate</span>
                  <span className="block text-xs" style={{ color: 'var(--mm-muted)' }}>
                    Optional · {extras.length - extrasLeft} of {extras.length} added
                  </span>
                </span>
                <AppIcon name="chevron-right" size={18} style={{ color: 'var(--mm-muted)' }} />
              </summary>
              <p className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>
                Your costs already work without these. Add them when you have the figures.
              </p>
              <StepList steps={extras} />
            </details>
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading>More shortcuts</SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ActionTile href="/formats" icon="formats" label="Sizes" />
          <ActionTile href="/settings" icon="settings" label="Costs & targets" />
          <ActionTile href="/reports" icon="reports" label="Reports" />
        </div>
      </section>
    </div>
  )
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-3 space-y-1">
      {steps.map((s) => (
        <li key={s.label}>
          <Link href={s.href} className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--mm-surface)]">
            <span style={{ color: s.done ? 'var(--mm-accent)' : 'var(--mm-muted)' }}>
              <AppIcon name={s.done ? 'check' : s.icon} size={17} />
            </span>
            <span className={s.done ? '' : 'font-medium'}>{s.label}</span>
            {!s.done && <span className="ml-auto hidden truncate pl-2 text-xs sm:block" style={{ color: 'var(--mm-muted)' }}>{s.hint}</span>}
          </Link>
        </li>
      ))}
    </ol>
  )
}

export default function DashboardPage() {
  return <Suspense fallback={<Loading />}><DashboardPageBody /></Suspense>
}
