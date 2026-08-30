import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext } from '@/lib/data/context'
import {
  PageHeader, Card, Notice, Empty, SectionHeading, Badge, HeroStat, StatRow, Stat,
} from '@/components/ui'
import { money, percent, productState, priceState, NOT_ENTERED } from '@/lib/format'

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

export default async function DashboardPage() {
  const { supabase, accountId, businessName } = await currentContext()
  if (!accountId) redirect('/onboarding')

  const [{ data: setupRows }, { data: products }, { data: prices }] = await Promise.all([
    supabase.from('v_onboarding_status')
      .select('name,ingredients,prices_entered,recipes,complete_costings,blocking_conversions,' +
              'selling_prices_set,recipes_with_yield,serving_formats,packaging_lines,' +
              'labour_rates,overhead_items,products_ready')
      .limit(1).returns<Setup[]>(),
    // Every figure here is decided in PostgreSQL. The page ranks nothing and
    // computes nothing; it reads a state and chooses words for it.
    supabase.from('v_product_attention')
      .select('recipe_id,variant_id,product_name,format_name,is_complete,true_cost,' +
              'selling_price,profit,margin_pct,recommended_price,state,attention_rank')
      .order('attention_rank').order('product_name').returns<Product[]>(),
    // Only ingredients the business ACTUALLY USES. Every account is seeded
    // with a starter catalogue of ~180 items, and listing the ones nobody has
    // put in a recipe would fill this with "price needed" for food the owner
    // has never bought. A task list that is mostly noise gets ignored.
    supabase.from('v_ingredient_price_status')
      .select('ingredient_id,ingredient_name,price_state,used_in_recipes,last_purchase_date')
      .neq('price_state', 'current').gt('used_in_recipes', 0)
      .order('used_in_recipes', { ascending: false })
      .limit(8).returns<PriceRow[]>(),
  ])

  const setup = setupRows?.[0]
  const all = products ?? []
  const needsAttention = all.filter((p) => p.attention_rank <= 3)
  const ready = all.filter((p) => p.state === 'healthy')

  // The guided journey. Each step is answered by a count the database keeps,
  // so the list reflects what the business has actually done.
  const steps = [
    { done: true, label: 'Tell us about your business', href: '/account',
      hint: businessName ?? 'Your business' },
    { done: (setup?.ingredients ?? 0) > 0, label: 'Add what you buy', href: '/ingredients',
      hint: 'Rice, oil, chicken, containers — anything you pay for.' },
    { done: (setup?.prices_entered ?? 0) > 0, label: 'Record what you paid', href: '/purchases',
      hint: 'A market run or a delivery. Menu Master works out the unit cost.' },
    { done: (setup?.recipes ?? 0) > 0, label: 'Add what you make', href: '/recipes',
      hint: 'Your dishes and products.' },
    { done: (setup?.recipes_with_yield ?? 0) > 0, label: 'Say how much one batch makes',
      href: '/recipes', hint: 'A pot of soup, a tray of puff-puff, a batch of dough.' },
    { done: (setup?.serving_formats ?? 0) > 0 || (setup?.selling_prices_set ?? 0) > 0,
      label: 'Say how you sell it', href: '/formats',
      hint: 'By the plate, or in your own sizes — 1 litre, 2.5 litres, a 6-pack.' },
    { done: (setup?.packaging_lines ?? 0) > 0, label: 'Add your packaging', href: '/formats',
      hint: 'Bowls, lids, labels. Optional, but it is real money.' },
    { done: (setup?.labour_rates ?? 0) > 0, label: 'Add the work you pay for', href: '/settings',
      hint: 'Optional. What you pay an hour for cooking or prep.' },
    { done: (setup?.overhead_items ?? 0) > 0, label: 'Add your monthly bills', href: '/settings',
      hint: 'Optional. Rent, gas, electricity.' },
    { done: (setup?.selling_prices_set ?? 0) > 0, label: 'Set your selling price', href: '/recipes',
      hint: 'Then Menu Master shows your real profit.' },
  ]
  const nextStep = steps.find((s) => !s.done)
  const doneCount = steps.filter((s) => s.done).length

  // A first-time business sees the guide, not a wall of zeros.
  const settingUp = (setup?.complete_costings ?? 0) === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={businessName ? `${businessName}` : 'Menu Master NG'}
        sub={settingUp
          ? 'Let us find out what your food really costs you.'
          : 'What is happening in your business, and what needs you.'}
      />

      {/* GETTING STARTED -------------------------------------------------- */}
      {settingUp && (
        <section className="space-y-3">
          <SectionHeading sub={`${doneCount} of ${steps.length} done. Each step takes a minute.`}>
            Getting started
          </SectionHeading>
          {nextStep && (
            <Notice>
              <p className="font-medium">Next: {nextStep.label}</p>
              <p className="mt-1">{nextStep.hint}</p>
              <p className="mt-2">
                <Link href={nextStep.href} className="underline">Do this now →</Link>
              </p>
            </Notice>
          )}
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className={s.done ? '' : 'font-medium'}>
                      {s.done ? '✓ ' : `${i + 1}. `}{s.label}
                    </span>
                    {!s.done && (
                      <Link href={s.href} className="text-sm underline">Open</Link>
                    )}
                  </div>
                  {!s.done && (
                    <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{s.hint}</div>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* NEEDS YOU -------------------------------------------------------- */}
      {!settingUp && (
        <section className="space-y-3">
          <SectionHeading sub="Sorted by what costs you most to ignore.">
            Needs your attention
          </SectionHeading>
          {!needsAttention.length ? (
            <Empty>
              Nothing needs attention. Every product you have priced is at or
              above the margin you asked for.
            </Empty>
          ) : (
            <ul className="space-y-2">
              {needsAttention.map((p) => {
                const st = productState(p.state)
                return (
                  <li key={`${p.recipe_id}-${p.variant_id ?? 'base'}`}>
                    <Link href={`/recipes/${p.recipe_id}`} className="block">
                      <Card>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            {p.product_name}
                            {p.format_name && (
                              <span style={{ color: 'var(--mm-muted)' }}>· {p.format_name}</span>
                            )}
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </span>
                          <span className="tabular-nums text-sm" style={{ color: 'var(--mm-muted)' }}>
                            {p.margin_pct !== null ? percent(Number(p.margin_pct)) : ''}
                          </span>
                        </div>
                        <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                          {st.detail}
                          {p.recommended_price !== null && p.state !== 'costing_incomplete' && (
                            <> Charging {money(Number(p.recommended_price))} would reach your target.</>
                          )}
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

      {/* WHAT YOU MAKE ON EACH ------------------------------------------- */}
      {ready.length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="Cost, price and profit for one of each.">
            Your products
          </SectionHeading>
          <ul className="space-y-2">
            {ready.slice(0, 6).map((p) => (
              <li key={`${p.recipe_id}-${p.variant_id ?? 'base'}-ok`}>
                <Link href={`/recipes/${p.recipe_id}`} className="block">
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="font-medium">
                        {p.product_name}
                        {p.format_name && (
                          <span style={{ color: 'var(--mm-muted)' }}> · {p.format_name}</span>
                        )}
                      </span>
                      <Badge tone="good">{productState(p.state).label}</Badge>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                      <div>
                        <dt style={{ color: 'var(--mm-muted)' }}>It costs you</dt>
                        <dd className="tabular-nums">{money(Number(p.true_cost))}</dd>
                      </div>
                      <div>
                        <dt style={{ color: 'var(--mm-muted)' }}>You charge</dt>
                        <dd className="tabular-nums">{money(Number(p.selling_price))}</dd>
                      </div>
                      <div>
                        <dt style={{ color: 'var(--mm-muted)' }}>You keep</dt>
                        <dd className="tabular-nums">{money(Number(p.profit))}</dd>
                      </div>
                      <div>
                        <dt style={{ color: 'var(--mm-muted)' }}>Margin</dt>
                        <dd className="tabular-nums">{percent(Number(p.margin_pct))}</dd>
                      </div>
                    </dl>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PRICES THAT MAY BE OLD ------------------------------------------ */}
      {(prices ?? []).length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="Your costs are only as good as these. Recording a purchase updates them.">
            Ingredient prices to check
          </SectionHeading>
          <ul className="space-y-2">
            {(prices ?? []).map((r) => (
              <li key={r.ingredient_id}>
                <Link href={`/ingredients/${r.ingredient_id}`} className="block">
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {r.ingredient_name}
                        <Badge tone={priceState(r.price_state).tone}>
                          {priceState(r.price_state).label}
                        </Badge>
                      </span>
                      <span className="text-sm" style={{ color: 'var(--mm-muted)' }}>
                        {r.last_purchase_date
                          ? `last bought ${r.last_purchase_date}`
                          : 'never bought'}
                        {r.used_in_recipes > 0 && ` · used in ${r.used_in_recipes}`}
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* QUICK ACTIONS ---------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="The things you do most.">Quick actions</SectionHeading>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { href: '/purchases', label: 'Record a purchase' },
            { href: '/ingredients', label: 'Add an ingredient' },
            { href: '/recipes', label: 'Add something you make' },
            { href: '/formats', label: 'Add a size you sell' },
            { href: '/settings', label: 'Your costs and target' },
            { href: '/reports', label: 'See your reports' },
          ].map((a) => (
            <Link key={a.href} href={a.href} className="block">
              <Card><span className="font-medium">{a.label}</span></Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
