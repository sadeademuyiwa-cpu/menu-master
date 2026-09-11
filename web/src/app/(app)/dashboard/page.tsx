import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
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

const STEP_ICONS: IconName[] = [
  'store', 'ingredients', 'purchases', 'recipes', 'recipes', 'formats',
  'package', 'people', 'settings', 'pricing', 'sales',
]

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

  const { count: tradingDays } = await supabase
    .from('v_sales_summary').select('sale_date', { count: 'exact', head: true })

  const setup = setupRows?.[0]
  const all = products ?? []
  const needsAttention = all.filter((p) => p.attention_rank <= 3)
  const ready = all.filter((p) => p.state === 'healthy')

  const steps = [
    { done: true, label: 'Business details', href: '/account', hint: businessName ?? 'Your business' },
    { done: (setup?.ingredients ?? 0) > 0, label: 'Add ingredients', href: '/ingredients', hint: 'Add what you buy.' },
    { done: (setup?.prices_entered ?? 0) > 0, label: 'Record a purchase', href: '/purchases', hint: 'Enter what you paid.' },
    { done: (setup?.recipes ?? 0) > 0, label: 'Add a recipe', href: '/recipes', hint: 'Add what you make.' },
    { done: (setup?.recipes_with_yield ?? 0) > 0, label: 'Set batch yield', href: '/recipes', hint: 'Say how much one batch makes.' },
    { done: (setup?.serving_formats ?? 0) > 0 || (setup?.selling_prices_set ?? 0) > 0,
      label: 'Add selling sizes', href: '/formats', hint: 'Plate, litre, pack or your own size.' },
    { done: (setup?.packaging_lines ?? 0) > 0, label: 'Add packaging', href: '/formats', hint: 'Bowls, lids and labels.' },
    { done: (setup?.labour_rates ?? 0) > 0, label: 'Add labour', href: '/settings', hint: 'Optional paid work.' },
    { done: (setup?.overhead_items ?? 0) > 0, label: 'Add overheads', href: '/settings', hint: 'Optional monthly bills.' },
    { done: (setup?.selling_prices_set ?? 0) > 0, label: 'Set selling price', href: '/recipes', hint: 'See real profit.' },
    { done: (tradingDays ?? 0) > 0, label: 'Record a sale', href: '/sales', hint: 'Start tracking what you keep.' },
  ]
  const nextStep = steps.find((s) => !s.done)
  const doneCount = steps.filter((s) => s.done).length
  const settingUp = (setup?.complete_costings ?? 0) === 0
  const progress = Math.round((doneCount / steps.length) * 100)

  const quickActions: { href: string; icon: IconName; label: string; meta: string }[] = [
    { href: '/sales', icon: 'sales', label: 'New sale', meta: 'Record what you sold' },
    { href: '/purchases', icon: 'purchases', label: 'New purchase', meta: 'Record what you paid' },
    { href: '/recipes', icon: 'recipes', label: 'New recipe', meta: 'Cost what you make' },
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
                <div className="text-sm font-semibold">Setup</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--mm-muted)' }}>{doneCount}/{steps.length} complete</div>
              </div>
              <div className="text-sm font-semibold tabular-nums">{progress}%</div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--mm-line)' }}>
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--mm-accent)' }} />
            </div>

            {nextStep && (
              <Link href={nextStep.href} className="mt-4 flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--mm-surface)' }}>
                <span className="mm-action-icon"><AppIcon name={STEP_ICONS[steps.indexOf(nextStep)] ?? 'check'} size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--mm-muted)' }}>Next</span>
                  <span className="block font-semibold">{nextStep.label}</span>
                </span>
                <AppIcon name="chevron-right" size={18} style={{ color: 'var(--mm-muted)' }} />
              </Link>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium" style={{ color: 'var(--mm-accent)' }}>View setup steps</summary>
              <ol className="mt-3 space-y-1">
                {steps.map((s, i) => (
                  <li key={s.label}>
                    <Link href={s.href} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--mm-surface)]">
                      <span style={{ color: s.done ? 'var(--mm-accent)' : 'var(--mm-muted)' }}>
                        <AppIcon name={s.done ? 'check' : STEP_ICONS[i]} size={17} />
                      </span>
                      <span className={s.done ? '' : 'font-medium'}>{s.label}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </details>
          </Card>
        </section>
      )}

      {!settingUp && (
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
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
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
                <Link href={`/ingredients/${r.ingredient_id}`} className="block">
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

export default function DashboardPage() {
  return <Suspense fallback={<Loading />}><DashboardPageBody /></Suspense>
}
