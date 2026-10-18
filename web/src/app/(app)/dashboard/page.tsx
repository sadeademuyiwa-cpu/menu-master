import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement, recordingOpen } from '@/lib/data/context'
import { Badge, Empty } from '@/components/ui'
import { AppIcon, type IconName } from '@/components/icons'
import { DishTile } from '@/components/dish-tile'
import { WeekBars } from '@/components/charts'
import { UsePrice } from '@/components/use-price'
import { setPrice } from '@/lib/actions/set-price'
import { money, percent, productState, priceState } from '@/lib/format'
import { canSeeCosts, canSetPrices, canSeeSellingPrices } from '@/lib/pricing'
import { canAddDishPhotos } from '@/lib/dish-photo'
import { localToday } from '@/lib/dates'
import { canRecordSales, canRecordPurchases, canAddDishes, runsSetup } from './roles'
import {
  num, daysBefore, sumDays, lastSevenDays, trend, uniqueRows, byDish, needGroups, orderDishes,
  keepFigure, worstState, priceFigure, bestSellers,
  type SalesDay, type ProductRow, type Dish, type MenuPriceRow, type NeedGroup, type Trend, type WeekTotal,
  type ChartDay,
} from './home-data'
import { SoldBars } from './sold-bars'
import { PhotoNudge } from './photo-nudge'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

type Setup = { prices_entered: number; recipes: number; complete_costings: number; selling_prices_set: number }
type PriceRow = { ingredient_id: string; ingredient_name: string; price_state: string }
type Step = { done: boolean; label: string; href: string; hint: string; icon: IconName }

/** A read this person's role does not make: resolves at once, with nothing. */
const skip = <T,>() => Promise.resolve({ data: null as T | null, error: null, count: null as number | null })

/**
 * Home, as a food business's front page: the two things she records most, then
 * what the week brought in, what needs her, and her dishes as a menu.
 *
 * WHO SEES WHAT is decided here, on the server, and a figure a role may not
 * see is never asked for, so it cannot reach the phone:
 *   owner, manager, accountant   what they kept this week, "you keep" on each
 *                                dish, Needs you with its "Use ₦X" fix
 *   sales                        what they sold this week and what each dish
 *                                sells for (fn_menu_prices, 0064); no cost,
 *                                no kept, no suggested price
 *   kitchen                      dishes by name and photo; no money at all
 * Buttons follow the database's write rules (./roles.ts, from 0015).
 */
async function HomeBody() {
  const ctx = await currentContext()
  const { supabase, accountId, role, businessName } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/dashboard'))

  const seesCosts = canSeeCosts(role)
  const setsPrices = canSetPrices(role)
  // Money in is selling prices times plates, so the week's takings follow the
  // selling-price rule: everyone but kitchen.
  const seesTakings = canSeeSellingPrices(role)
  // Sales reads prices on their own; the cost roles read them with their costs.
  const readsMenuPrices = seesTakings && !seesCosts
  const setsUp = runsSetup(role)
  const buys = canRecordPurchases(role)
  const takesPhotos = canAddDishPhotos(role)

  const today = localToday()

  const [setupRes, productsRes, dishesRes, menuRes, checkRes, tradingRes, salesPlan, daysRes, bestRes, open] = await Promise.all([
    setsUp
      ? supabase.from('v_onboarding_status').select('prices_entered,recipes,complete_costings,selling_prices_set')
          .limit(1).returns<Setup[]>()
      : skip<Setup[]>(),
    seesCosts
      ? supabase.from('v_product_attention')
          .select('recipe_id,variant_id,product_name,format_name,profit,recommended_price,target_margin,state,attention_rank')
          .order('attention_rank').order('product_name').returns<ProductRow[]>()
      : skip<ProductRow[]>(),
    supabase.from('recipes').select('id,name,photo_path')
      .eq('kind', 'dish').is('deleted_at', null).order('name').returns<Dish[]>(),
    readsMenuPrices ? supabase.rpc('fn_menu_prices') : skip<MenuPriceRow[]>(),
    seesCosts && buys
      ? supabase.from('v_ingredient_price_status').select('ingredient_id,ingredient_name,price_state')
          .neq('price_state', 'current').gt('used_in_recipes', 0)
          .order('used_in_recipes', { ascending: false }).limit(4).returns<PriceRow[]>()
      : skip<PriceRow[]>(),
    setsUp || seesTakings
      ? supabase.from('v_sales_summary').select('sale_date', { count: 'exact', head: true })
      : skip<never[]>(),
    hasSalesEntitlement(),
    seesTakings
      ? supabase.from('v_sales_summary')
          // What was kept is asked for only by a role that may see it.
          .select(seesCosts ? 'sale_date,sale_count,revenue,gross_profit,revenue_without_cost' : 'sale_date,sale_count,revenue')
          .gte('sale_date', daysBefore(today, 13)).order('sale_date', { ascending: false })
          .returns<SalesDay[]>()
      : skip<SalesDay[]>(),
    // Plates sold, never money: kitchen reads this too.
    takesPhotos
      ? supabase.from('v_product_performance').select('recipe_id,units_sold')
          .order('units_sold', { ascending: false }).limit(60)
          .returns<{ recipe_id: string | null; units_sold: string | null }[]>()
      : skip<{ recipe_id: string | null; units_sold: string | null }[]>(),
    recordingOpen(),
  ])

  const tradingDays = tradingRes.count ?? 0
  const sells = canRecordSales(role, salesPlan)
  // After a trial (an explicit false) Record a sale and Record a purchase
  // would only send the owner back with the reason (D3); the access bar at
  // the top already says what happened and what to do.
  const sellsNow = sells && open !== false
  const buysNow = buys && open !== false

  // --- first day ------------------------------------------------------------
  // The few things that make Menu Master useful, in the order they unlock each
  // other. Each is ticked only by data the owner entered: the starter
  // catalogue does not count as "adding what you buy".
  const setup = setupRes.data?.[0]
  const core: Step[] = [
    { done: (setup?.prices_entered ?? 0) > 0, label: 'Enter what you paid', href: '/purchases/new',
      hint: 'A market run or a delivery.', icon: 'purchases' },
    { done: (setup?.complete_costings ?? 0) > 0, label: 'Cost one dish', href: (setup?.recipes ?? 0) > 0 ? '/recipes' : '/recipes/new',
      hint: 'See what one plate really costs you.', icon: 'recipes' },
    { done: (setup?.selling_prices_set ?? 0) > 0, label: 'Set its selling price', href: '/recipes',
      hint: 'See what you keep on every plate.', icon: 'pricing' },
    // A Costing-only plan cannot record sales, so it is never asked to.
    ...(salesPlan === false ? [] : [{ done: tradingDays > 0, label: 'Record your first sale',
      href: '/sales/new', hint: 'Start tracking what you actually make.', icon: 'sales' as IconName }]),
  ]
  const settingUp = setsUp && core.some((s) => !s.done)
  // The guided setup (/start) is open until one dish is costed and priced --
  // the same test the middleware uses.
  const wizardOpen = setsUp && ((setup?.complete_costings ?? 0) === 0 || (setup?.selling_prices_set ?? 0) === 0)

  // --- the week -------------------------------------------------------------
  const days = daysRes.data ?? []
  const week = sumDays(days, daysBefore(today, 6), today)
  const lastWeek = sumDays(days, daysBefore(today, 13), daysBefore(today, 7))
  const showMoney = seesTakings && salesPlan !== false && tradingDays > 0

  // --- dishes ---------------------------------------------------------------
  const rowsOf = byDish(uniqueRows(productsRes.data ?? []))
  const needs = needGroups(productsRes.data ?? [])
  const dishes = orderDishes(dishesRes.data ?? [], rowsOf)
  const photoOf = new Map(dishes.map((d) => [d.id, d.photo_path]))
  // Before 0064 the price function does not exist: no prices, as before.
  const pricesOf = byDish<MenuPriceRow>(menuRes.error ? [] : ((menuRes.data ?? []) as MenuPriceRow[]))
  const toCheck = checkRes.data ?? []

  // The three best sellers still without a photo.
  const dishById = new Map(dishes.map((d) => [d.id, d]))
  const unphotographed = bestSellers(bestRes.data ?? [])
    .map((id) => dishById.get(id))
    .filter((d): d is Dish => !!d && !d.photo_path)

  // Two columns from lg, when there is something for the first one: kitchen
  // and a quiet week leave just the dishes, which then take the width.
  const firstColumn = settingUp || showMoney || needs.length > 0

  return (
    <div className={`space-y-5 ${firstColumn ? 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-6 lg:space-y-0' : ''}`}>
      {/* The header already shows the logo and the business name; this names
          the page for a screen reader without saying it twice on screen. */}
      <h1 className="sr-only">{businessName || 'Home'}</h1>

      {/* The two things recorded most come first, at every width: at the foot
          they sat two or three phone screens down for an owner with a menu.
          From lg they span both columns (the sr-only h1 takes no grid cell). */}
      {(sellsNow || buysNow) && (
        <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2" data-quick-actions>
          {sellsNow && (
            <Link href="/sales/new" className="mm-btn mm-btn-primary w-full">
              <AppIcon name="sales" size={19} /> Record a sale
            </Link>
          )}
          {buysNow && (
            <Link href="/purchases/new" className={`mm-btn ${sellsNow ? 'mm-btn-secondary' : 'mm-btn-primary'} w-full`}>
              <AppIcon name="purchases" size={19} /> Record a purchase
            </Link>
          )}
        </div>
      )}

      {firstColumn && (
        <div className="space-y-5">
          {settingUp && <SetupCard steps={core} wizardOpen={wizardOpen} />}
          {showMoney && (
            <WeekHero week={week} lastWeek={lastWeek} withKept={seesCosts}
                      chart={lastSevenDays(days, today, seesCosts)} />
          )}
          {needs.length > 0 && (
            <NeedsYou groups={needs} photoOf={photoOf} setsPrices={setsPrices} />
          )}
        </div>
      )}

      <div className="space-y-5">
        {takesPhotos && unphotographed.length > 0 && (
          <PhotoNudge title="Add photos of your best sellers">
            <ul className="grid gap-1">
              {unphotographed.map((d) => (
                <li key={d.id}>
                  <Link href={`/recipes/${d.id}`}
                        className="flex min-h-[48px] items-center gap-3 rounded-xl px-1 py-1 hover:bg-[var(--mm-surface-2)]">
                    <DishTile name={d.name} photoPath={d.photo_path} size="sm" />
                    {/* "Add a photo" sits under the name, not beside it: beside it
                        a 360px phone left the name about 119px, so "Peppered
                        Chicken" lost its last letters. */}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-medium leading-snug">{d.name}</span>
                      <span className="block text-[13px] font-semibold" style={{ color: 'var(--mm-accent)' }}>Add a photo</span>
                    </span>
                    <AppIcon name="chevron-right" size={16} className="shrink-0" style={{ color: 'var(--mm-muted)' }} />
                  </Link>
                </li>
              ))}
            </ul>
          </PhotoNudge>
        )}

        {dishes.length > 0 ? (
          <section aria-labelledby="home-dishes" className="space-y-3">
            <Heading id="home-dishes" title="Your dishes" link={{ href: '/recipes', label: 'All dishes' }} />
            <ul className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${firstColumn ? '' : 'lg:grid-cols-4'}`}>
              {dishes.slice(0, 6).map((d) => (
                <li key={d.id} className="min-w-0">
                  <DishCard dish={d} figure={
                    seesCosts ? <CostLine rows={rowsOf.get(d.id) ?? []} />
                      : readsMenuPrices ? <PriceLine rows={pricesOf.get(d.id) ?? []} />
                      : null
                  } />
                </li>
              ))}
            </ul>
          </section>
        ) : !settingUp && (
          <Empty>
            No dishes yet.{' '}
            {canAddDishes(role) && <Link href="/recipes/new" className="mm-inline-tap font-semibold">Add your first dish</Link>}
          </Empty>
        )}

        {toCheck.length > 0 && (
          <section aria-labelledby="home-prices" className="space-y-3">
            <Heading id="home-prices" title="Prices to check"
                     link={toCheck.length > 3 ? { href: '/ingredients', label: 'See all' } : undefined} />
            <ul className="space-y-2">
              {toCheck.slice(0, 3).map((r) => {
                const st = priceState(r.price_state)
                return (
                  <li key={r.ingredient_id}>
                    <Link href={`/purchases/new?ingredient=${r.ingredient_id}`}
                          className="mm-card flex min-h-[44px] items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold">{r.ingredient_name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <AppIcon name="chevron-right" size={17} style={{ color: 'var(--mm-muted)' }} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PIECES
// ---------------------------------------------------------------------------

function Heading({ id, title, link }: { id: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
      {link && (
        <Link href={link.href} className="inline-flex min-h-[44px] shrink-0 items-center gap-0.5 text-sm font-semibold"
              style={{ color: 'var(--mm-accent)' }}>
          {link.label}<AppIcon name="chevron-right" size={16} />
        </Link>
      )}
    </div>
  )
}

/** The four first-day steps, the next one plain to see. */
function SetupCard({ steps, wizardOpen }: { steps: Step[]; wizardOpen: boolean }) {
  const doneCount = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)
  return (
    <section aria-labelledby="home-setup" className="mm-card">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-setup" className="text-lg font-semibold tracking-tight">Getting started</h2>
        <Badge tone="good">{doneCount} of {steps.length} done</Badge>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--mm-line)' }} aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${(doneCount / steps.length) * 100}%`, background: 'var(--mm-accent)' }} />
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => {
          const isNext = s === next
          return (
            <li key={s.label}>
              <Link href={s.href}
                    className="flex min-h-[48px] items-center gap-3 rounded-xl border px-3 py-2"
                    style={{
                      borderColor: isNext ? 'var(--mm-accent)' : 'var(--mm-line)',
                      boxShadow: isNext ? '0 0 0 1px var(--mm-accent)' : undefined,
                    }}
                    aria-current={isNext ? 'step' : undefined}>
                <span className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold"
                      style={s.done
                        // The tick takes the page colour, not white: in dark mode
                        // the accent turns light Leaf, and white on it is about 2.1:1.
                        ? { background: 'var(--mm-accent)', color: 'var(--mm-bg)' }
                        : { border: `1.5px solid ${isNext ? 'var(--mm-accent)' : 'var(--mm-line)'}`, color: isNext ? 'var(--mm-accent)' : 'var(--mm-muted)' }}
                      aria-hidden>
                  {s.done ? <AppIcon name="check" size={15} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {isNext && (
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-accent)' }}>Next</span>
                  )}
                  <span className={`block ${isNext ? 'font-semibold' : s.done ? '' : 'font-medium'}`}>{s.label}</span>
                  {isNext && <span className="block text-[13px]" style={{ color: 'var(--mm-muted)' }}>{s.hint}</span>}
                </span>
                {s.done
                  ? <span className="shrink-0 text-[13px]" style={{ color: 'var(--mm-muted)' }}>Done</span>
                  : <AppIcon name="chevron-right" size={17} className="shrink-0"
                             style={{ color: isNext ? 'var(--mm-accent)' : 'var(--mm-muted)' }} />}
              </Link>
            </li>
          )
        })}
      </ol>
      {/* The guided steps, for an owner who skipped them: they pick up where
          she stopped, and every finished step can be opened to change. */}
      {wizardOpen && (
        <Link href="/start" className="mm-btn mm-btn-secondary mt-3 w-full">
          Continue guided setup <AppIcon name="arrow-right" size={16} />
        </Link>
      )}
    </section>
  )
}

/**
 * One big figure for the week and seven days of bars under it. A role that
 * sees costs is shown what it kept; sales is shown what came in, and its
 * chart has no kept series at all, because that figure is withheld from it,
 * not unknown.
 */
function WeekHero({ week, lastWeek, withKept, chart }: {
  week: WeekTotal; lastWeek: WeekTotal; withKept: boolean; chart: ChartDay[]
}) {
  const showKept = withKept && week.kept !== null
  // A week below cost is said as a loss, not as "kept -₦200".
  const lost = showKept && (week.kept as number) < 0
  const label = !showKept ? 'This week you sold' : lost ? 'This week you lost' : 'This week you kept'
  const figure = showKept ? Math.abs(week.kept as number) : week.sold
  const change = showKept ? trend(week.kept, lastWeek.kept) : trend(week.sold, lastWeek.sold)
  const empty = (
    <p className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>Your chart shows once you have sales on three days.</p>
  )

  return (
    <section aria-labelledby="home-week" className="mm-card">
      <h2 id="home-week" className="text-sm font-medium" style={{ color: 'var(--mm-muted)' }}>
        {week.sold === null ? 'This week' : label}
      </h2>
      {figure === null ? (
        <p className="mt-1 text-xl font-semibold tracking-tight">No sales yet this week</p>
      ) : (
        <p className="mm-num mt-0.5 text-[2rem] font-semibold leading-tight tracking-tight"
           style={{ color: lost ? 'var(--mm-bad)' : showKept ? 'var(--mm-accent-strong)' : undefined }}>
          {money(figure)}
        </p>
      )}
      {change && <TrendLine t={change} />}
      {/* Honest about what the figure covers. */}
      {withKept && week.sold !== null && week.kept === null && (
        <p className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>Kept: not known yet</p>
      )}
      {showKept && week.partly && (
        <p className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>Only sales with a known cost count.</p>
      )}
      <div className="mt-4">
        {withKept ? (
          <WeekBars days={chart} empty={empty}
                    ariaLabel="What you sold and what you kept, each day for the last seven days." />
        ) : (
          <SoldBars days={chart} empty={empty} ariaLabel="What you sold each day for the last seven days." />
        )}
      </div>
    </section>
  )
}

function TrendLine({ t }: { t: Trend }) {
  if (t.dir === 'same') {
    return <p className="mt-1 text-[13px] font-medium" style={{ color: 'var(--mm-muted)' }}>Same as last week</p>
  }
  return (
    <p className="mm-num mt-1 text-[13px] font-medium"
       style={{ color: t.dir === 'up' ? 'var(--mm-accent)' : 'var(--mm-muted)' }}>
      <span aria-hidden>{t.dir === 'up' ? '↑' : '↓'}</span>
      <span className="sr-only">{t.dir === 'up' ? 'Up' : 'Down'}</span> {percent(t.pct)} on last week
    </p>
  )
}

/** Short enough for a phone row; the dish page says the rest. */
function diagnosis(state: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  switch (state) {
    case 'losing_money': return { label: 'Selling at a loss', tone: 'bad' }
    case 'below_target': return { label: 'Below your target', tone: 'warn' }
    case 'no_price_yet': return { label: 'No price yet', tone: 'muted' }
    default: return { label: productState(state).label, tone: productState(state).tone }
  }
}

/**
 * At most three dishes, worst first, each with its fix. The fix is the
 * database's own suggested price from her own target, offered only to the
 * roles that may set prices -- the figure is left out for anyone else.
 */
function NeedsYou({ groups, photoOf, setsPrices }: {
  groups: NeedGroup[]; photoOf: Map<string, string | null>; setsPrices: boolean
}) {
  return (
    <section aria-labelledby="home-needs" className="space-y-3">
      <Heading id="home-needs" title="Needs you"
               link={groups.length > 3 ? { href: '/recipes', label: 'See all' } : undefined} />
      <ul className="space-y-2">
        {groups.slice(0, 3).map((g) => {
          const first = g.rows[0]
          const single = g.rows.length === 1
          const size = single ? first.format_name : null
          const price = single ? num(first.recommended_price) : null
          const sizes = !single && g.rows.every((r) => r.variant_id && (num(r.recommended_price) ?? 0) > 0)
            ? g.rows.map((r) => ({ variantId: r.variant_id as string, size: r.format_name ?? 'one size', price: num(r.recommended_price) }))
            : null
          const offer = setsPrices && (single ? (price ?? 0) > 0 : sizes !== null)
          const target = num(first.target_margin)
          const st = diagnosis(first.state)
          return (
            <li key={g.recipeId} className="mm-card flex gap-3">
              <DishTile name={g.name} photoPath={photoOf.get(g.recipeId)} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Link href={`/recipes/${g.recipeId}`} className="flex min-h-[44px] items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold leading-snug">
                    {g.name}
                    {size && <span style={{ color: 'var(--mm-muted)' }}> · {size}</span>}
                    {!single && <span style={{ color: 'var(--mm-muted)' }}> · {g.rows.length} sizes</span>}
                  </span>
                  {!offer && <AppIcon name="chevron-right" size={17} className="shrink-0" style={{ color: 'var(--mm-muted)' }} />}
                </Link>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {offer && (
                    <UsePrice
                      recipeId={g.recipeId}
                      variantId={single ? first.variant_id : undefined}
                      price={single ? price : undefined}
                      sizes={sizes ?? undefined}
                      dishName={size ? `${g.name} (${size})` : g.name}
                      action={setPrice}
                      returnTo="/dashboard"
                      variant="secondary"
                      note={target !== null ? `That keeps your ${percent(target)} target.` : undefined}
                    />
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A dish as a menu card: its photo or tile, its name, and at most one figure. */
function DishCard({ dish, figure }: { dish: Dish; figure: React.ReactNode }) {
  return (
    <Link href={`/recipes/${dish.id}`}
          className="block h-full rounded-2xl border p-2 transition-transform active:scale-[.985]"
          style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-surface)', boxShadow: 'var(--mm-shadow-soft)' }}>
      <DishTile name={dish.name} photoPath={dish.photo_path} size="card" />
      <span className="mt-2 line-clamp-2 px-0.5 text-sm font-semibold leading-snug">{dish.name}</span>
      {figure}
    </Link>
  )
}

const DOT: Record<string, string> = {
  healthy: 'var(--mm-accent)',
  below_target: 'var(--mm-warn)',
  losing_money: 'var(--mm-bad)',
}

/** "You keep ₦1,160" and a green, amber or red dot, for a role that sees costs. */
function CostLine({ rows }: { rows: ProductRow[] }) {
  const f = keepFigure(rows)
  const state = worstState(rows)
  const colour = state ? DOT[state] : undefined
  const words =
    f.kind === 'keep' ? `You keep ${money(f.amount)}`
    : f.kind === 'lose' ? `You lose ${money(f.amount)}`
    : f.kind === 'sizes' ? `${f.count} sizes`
    : f.kind === 'no_price' ? 'No price yet'
    : 'Cost incomplete'
  return (
    <span className="mt-1 flex items-center gap-1.5 px-0.5 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden
            style={colour ? { background: colour } : { border: '1.5px solid var(--mm-muted)' }} />
      <span className="sr-only">{productState(state).label}:</span>
      <span className="mm-num min-w-0 truncate">{words}</span>
    </span>
  )
}

/** What a dish sells for, for sales: a price and nothing worked out from a cost. */
function PriceLine({ rows }: { rows: MenuPriceRow[] }) {
  const f = priceFigure(rows)
  return (
    <span className="mm-num mt-1 block truncate px-0.5 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
      {f.kind === 'none' ? 'No price yet' : f.kind === 'from' ? `From ${money(f.price)}` : money(f.price)}
    </span>
  )
}

export default function DashboardPage() {
  return <Suspense fallback={<Loading />}><HomeBody /></Suspense>
}
