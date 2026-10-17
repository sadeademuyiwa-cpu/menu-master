import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Notice, SectionHeading, Empty, Card, InlineSubmit } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { DishTile } from '@/components/dish-tile'
import { money } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { canSeeCosts, canSeeSellingPrices } from '@/lib/pricing'
import {
  rowsByDish, worstState, stateDot, keepFigure, dishGroup, priceFigure,
  type AttentionRow, type MenuPriceRow, type DishGroup,
} from './_list/dish-figures'
import './_list/lists.css'

export const dynamic = 'force-dynamic'

type Recipe = { id: string; name: string; kind: string | null; photo_path: string | null }
type PutAway = { id: string; name: string; deleted_at: string }

/** A dish that was put away comes back exactly as it was. */
async function restoreRecipe(formData: FormData) {
  'use server'
  const id = String(formData.get('recipe_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('recipes')
    .update({ deleted_at: null }).eq('id', id).select('name').maybeSingle<{ name: string }>()
  revalidatePath('/recipes')
  if (error) {
    redirect(withNotice('/recipes?show=away', error.code === '23505'
      ? 'You now have another dish with that name. Rename the new one first, then bring this one back.'
      : describeWriteError(error)))
  }
  // A refused UPDATE is not an error: RLS (p_recipes_update) just matches no
  // row. Saying "is back" then sent her to a dish that was still put away.
  // The policy wants a dish role and a live subscription; either can be why.
  if (!data) {
    redirect(withNotice('/recipes?show=away', 'That dish could not be brought back. Only the owner, a manager or the ' +
      'kitchen can bring a dish back, and only while the subscription is active.'))
  }
  redirect(withNotice(`/recipes/${id}`, `${data.name} is back.`))
}

/**
 * Who may start a new dish or bring one back: the recipes INSERT and UPDATE
 * policies (0015) admit owner, manager and kitchen. A courtesy, so sales and
 * accountant are not sent to a form the database will refuse; RLS still
 * decides.
 */
const NEW_DISH_ROLES = ['owner', 'manager', 'kitchen']

const FILTERS: { key: '' | DishGroup; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'ready', label: 'Ready' },
]

/** A list address that keeps the search and the chip. */
function listHref(q: string, f: string): string {
  const p = new URLSearchParams()
  if (q) p.set('q', q)
  if (f) p.set('f', f)
  const s = p.toString()
  return s ? `/recipes?${s}` : '/recipes'
}

/**
 * Every dish as a menu: its photo (or its tile until one is taken), its name
 * and ONE figure. What that figure is depends on who is looking, decided here
 * on the server so nothing else reaches the phone:
 *
 *   owner, manager, accountant   what one portion keeps, and a coloured dot
 *                                (v_product_attention, the dashboard's view)
 *   sales                        what it sells for (fn_menu_prices, 0064);
 *                                no cost, no keep, no dot
 *   kitchen                      the name, and how many sizes it comes in
 *
 * A new dish starts on its own screen (/recipes/new). Sizes and Prices live
 * under this tab now (lib/nav.ts), so their way in is at the top.
 */
export default async function DishesPage(props: {
  searchParams: Promise<{ notice?: string; q?: string; show?: string; f?: string }>
}) {
  const { notice, q = '', show = '', f: rawFilter = '' } = await props.searchParams
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, '/recipes'))
  const { supabase, role, businessId } = ctx
  const seesCosts = canSeeCosts(role)
  // Sales reads what a dish sells for and nothing derived from a cost.
  const seesPrices = !seesCosts && canSeeSellingPrices(role)
  const canAdd = NEW_DISH_ROLES.includes(role ?? '')

  const costRows = async (): Promise<AttentionRow[]> => {
    if (!seesCosts) return []
    const { data } = await supabase.from('v_product_attention')
      .select('recipe_id,variant_id,profit,state,attention_rank').returns<AttentionRow[]>()
    return data ?? []
  }
  // Before 0064, or on any error, there are simply no prices to show.
  const menuPrices = async (): Promise<MenuPriceRow[]> => {
    if (!seesPrices || !businessId) return []
    // business_id must be in the select: PostgREST filters a function's
    // result by its returned columns, and without it the call errors, which
    // reads here as "no prices" (a sales member saw "No price yet").
    const { data } = await supabase.rpc('fn_menu_prices').select('business_id,recipe_id,variant_id,selling_price')
      .eq('business_id', businessId)
    return Array.isArray(data) ? (data as MenuPriceRow[]) : []
  }
  // Kitchen's one line: how many sizes a dish comes in. No money at all.
  const sizeRows = async (): Promise<{ recipe_id: string }[]> => {
    if (seesCosts || seesPrices) return []
    const { data } = await supabase.from('recipe_variants').select('recipe_id').eq('is_active', true)
      .returns<{ recipe_id: string }[]>()
    return data ?? []
  }

  const [{ data: recipes }, { data: putAway }, products, prices, sizes] = await Promise.all([
    supabase.from('recipes').select('id,name,kind,photo_path').is('deleted_at', null).order('name')
      .returns<Recipe[]>(),
    supabase.from('recipes').select('id,name,deleted_at').not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }).returns<PutAway[]>(),
    costRows(),
    menuPrices(),
    sizeRows(),
  ])

  const rowsOf = rowsByDish(products)
  const pricesOf = new Map<string, MenuPriceRow[]>()
  for (const p of prices) pricesOf.set(p.recipe_id, [...(pricesOf.get(p.recipe_id) ?? []), p])
  const sizeCount = new Map<string, number>()
  for (const s of sizes) sizeCount.set(s.recipe_id, (sizeCount.get(s.recipe_id) ?? 0) + 1)

  const all = recipes ?? []
  const term = q.trim().toLowerCase()
  const found = all.filter((r) => !term || r.name.toLowerCase().includes(term))
  // Needs attention and Ready are judged from costs, so only a role that sees
  // costs gets the chips; for anyone else every dish is simply listed.
  const filter: '' | DishGroup = seesCosts && (rawFilter === 'attention' || rawFilter === 'ready') ? rawFilter : ''
  const groupOf = (r: Recipe) => dishGroup(rowsOf.get(r.id) ?? [], r.kind)
  const count = (key: '' | DishGroup) => (key ? found.filter((r) => groupOf(r) === key).length : found.length)
  const shown = filter ? found.filter((r) => groupOf(r) === filter) : found
  // Put-away dishes are only listed to a role that can bring one back; for
  // anyone else the list would be a row of buttons the database refuses.
  const away = canAdd ? putAway ?? [] : []

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <PageHeader title="Dishes" sub="What each dish costs to make, from the prices you entered yourself." />
        </div>
        {canAdd && (
          <Link href="/recipes/new" className="mm-btn mm-btn-primary shrink-0">
            <AppIcon name="plus" size={20} /> New dish
          </Link>
        )}
      </div>
      {notice && <Notice tone={/could not|rename/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {/* Sizes and Prices belong to dishes; Prices shows nothing to kitchen. */}
      <div className={`grid gap-2 ${seesCosts || seesPrices ? 'grid-cols-2' : 'grid-cols-1'} sm:max-w-md`}>
        <Link href="/formats" className="mm-entry">
          <span className="mm-entry-icon"><AppIcon name="formats" size={18} /></span>
          <span className="min-w-0 flex-1">Sizes</span>
          <AppIcon name="chevron-right" size={16} className="mm-row-chevron" />
        </Link>
        {(seesCosts || seesPrices) && (
          <Link href="/pricing" className="mm-entry">
            <span className="mm-entry-icon"><AppIcon name="pricing" size={18} /></span>
            <span className="min-w-0 flex-1">Prices</span>
            <AppIcon name="chevron-right" size={16} className="mm-row-chevron" />
          </Link>
        )}
      </div>

      <section className="space-y-3" aria-label="Your dishes">
        {all.length > 6 && (
          <form method="get" action="/recipes" className="flex gap-2" role="search">
            {filter && <input type="hidden" name="f" value={filter} />}
            <input name="q" defaultValue={q} placeholder="Find a dish" aria-label="Find a dish"
              type="search" className="mm-input flex-1" />
            <button className="mm-btn mm-btn-secondary" type="submit">Find</button>
          </form>
        )}

        {seesCosts && all.length > 0 && (
          <nav className="mm-chips" aria-label="Show dishes">
            {FILTERS.map((c) => (
              <Link key={c.key || 'all'} href={listHref(q, c.key)} className="mm-chip"
                aria-current={filter === c.key ? 'page' : undefined}>
                {c.label} <span className="mm-chip-count">{count(c.key)}</span>
              </Link>
            ))}
          </nav>
        )}

        {all.length === 0 ? (
          <Empty>
            {canAdd ? 'No dishes yet. Tap New dish to find out what your first one really costs you.' : 'No dishes yet.'}
          </Empty>
        ) : found.length === 0 ? (
          <Empty>No dish is called “{q}”. <Link href={listHref('', filter)} className="mm-inline-tap">Show all</Link></Empty>
        ) : shown.length === 0 ? (
          <Empty>
            {filter === 'attention' ? 'Nothing needs your attention.' : 'No dish is at your target yet.'}{' '}
            <Link href={listHref(q, '')} className="mm-inline-tap">Show all</Link>
          </Empty>
        ) : (
          <ul className="mm-rows" data-cols="2">
            {shown.map((r) => (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}`} className="mm-row">
                  <DishTile name={r.name} photoPath={r.photo_path} size="md" className="shrink-0" />
                  <span className="mm-row-main">
                    <span className="mm-row-name">{r.name}</span>
                    {seesCosts ? (
                      <CostLine rows={rowsOf.get(r.id) ?? []} kind={r.kind} />
                    ) : seesPrices ? (
                      <PriceLine rows={pricesOf.get(r.id) ?? []} kind={r.kind} />
                    ) : (
                      <KitchenLine sizes={sizeCount.get(r.id) ?? 0} kind={r.kind} />
                    )}
                  </span>
                  <AppIcon name="chevron-right" size={17} className="mm-row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {away.length > 0 && (
        <section className="space-y-3">
          {show === 'away' ? (
            <>
              <SectionHeading sub="Dishes you put away. Their history is kept; bring one back and it is exactly as it was.">
                Put away ({away.length})
              </SectionHeading>
              <ul className="space-y-2">
                {away.map((r) => (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="font-medium">{r.name}</span>
                          <span className="text-sm" style={{ color: 'var(--mm-muted)' }}> · put away {formatDay(r.deleted_at).toLowerCase()}</span>
                        </span>
                        <form action={restoreRecipe}>
                          <input type="hidden" name="recipe_id" value={r.id} />
                          <InlineSubmit>Bring back</InlineSubmit>
                        </form>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              <p className="text-sm"><Link href="/recipes" className="mm-tap underline">Hide put-away dishes</Link></p>
            </>
          ) : (
            <p className="text-sm">
              <Link href="/recipes?show=away" className="mm-tap underline">
                {away.length} dish{away.length === 1 ? '' : 'es'} put away →
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/** A part made for other dishes (the stew in the jollof) is not sold on its own. */
function PartLine() {
  return <span className="mm-row-figure">Used in other dishes</span>
}

/** Owner, manager, accountant: what one portion keeps, with the dish's dot. */
function CostLine({ rows, kind }: { rows: AttentionRow[]; kind: string | null }) {
  if (rows.length === 0 && kind === 'sub_recipe') return <PartLine />
  const dot = stateDot(worstState(rows))
  const fig = keepFigure(rows)
  return (
    <span className="mm-row-figure">
      <span className="mm-dot" data-tone={dot.tone} role="img" aria-label={dot.label} title={dot.label} />
      {fig.kind === 'keep' ? <span>you keep <strong>{money(fig.amount)}</strong></span>
        : fig.kind === 'lose' ? <span>you lose <strong>{money(fig.amount)}</strong></span>
        : fig.kind === 'sizes' ? <span>{fig.count} sizes</span>
        : fig.kind === 'no_price' ? <span>No price yet</span>
        : <span>Cost incomplete</span>}
    </span>
  )
}

/** Sales: what it sells for. Never a cost, so never a dot. */
function PriceLine({ rows, kind }: { rows: MenuPriceRow[]; kind: string | null }) {
  if (rows.length === 0 && kind === 'sub_recipe') return <PartLine />
  const fig = priceFigure(rows)
  return (
    <span className="mm-row-figure">
      {fig.kind === 'one' ? <strong>{money(fig.price)}</strong>
        : fig.kind === 'from' ? <span>from <strong>{money(fig.price)}</strong></span>
        : <span>No price yet</span>}
    </span>
  )
}

/** Kitchen: the dish's shape, never its money. */
function KitchenLine({ sizes, kind }: { sizes: number; kind: string | null }) {
  if (kind === 'sub_recipe') return <PartLine />
  if (sizes > 1) return <span className="mm-row-figure">{sizes} sizes</span>
  return null
}
