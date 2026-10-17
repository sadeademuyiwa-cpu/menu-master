import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, InlineSubmit, Empty, Notice, Disclosure, SectionHeading, BackLink } from '@/components/ui'
import { money, priceState } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { parentTab } from '@/lib/nav'
import { canSeeCosts } from '@/lib/pricing'
import { NOT_CHANGED, canEditItems } from '../purchases/buy-roles'
import { inSentence, perBuyingUnit } from '../purchases/buy-figures'
import '../purchases/buy.css'

export const dynamic = 'force-dynamic'

type Row = { id: string; name: string; kind: 'ingredient' | 'packaging'; category_id: string | null; base_unit_id: string }
type Unit = { id: string; code: string; name: string; kind: string }
type PutAway = { id: string; name: string; deleted_at: string }
type Status = { ingredient_id: string; price_state: string; used_in_recipes: number }


/** An item that was put away comes back exactly as it was. */
async function restoreIngredient(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('ingredients')
    .update({ deleted_at: null }).eq('id', id).select('name').maybeSingle<{ name: string }>()
  revalidatePath('/ingredients')
  if (error) {
    redirect(withNotice('/ingredients?show=away', error.code === '23505'
      ? 'You now have another item with that name. Rename the new one first, then bring this one back.'
      : describeWriteError(error)))
  }
  // No row back: refused quietly, so it is still put away and its page would
  // not open. Stay on the put-away list and say so.
  if (!data) redirect(withNotice('/ingredients?show=away', NOT_CHANGED))
  redirect(withNotice(`/ingredients/${id}`, `${data.name} is back.`))
}

/** The three ways almost everything is measured, in the owner's words. */
const COMMON_UNITS: { code: string; label: string }[] = [
  { code: 'g', label: 'Weight — grams (g)' },
  { code: 'ml', label: 'Volume — millilitres (ml)' },
  { code: 'unit', label: 'Count — pieces' },
]
/** How a base unit is spoken of on the list. */
const MEASURED: Record<string, string> = { g: 'by weight', ml: 'by volume', unit: 'by the piece' }

async function addIngredient(formData: FormData) {
  'use server'
  const here = '/ingredients'
  const ctx = await currentContext()
  const { supabase, accountId } = ctx

  // account_id is required by the table; RLS still refuses a foreign one, so
  // this is a convenience lookup, never an authorization decision.
  if (!accountId) redirect(contextRedirect(ctx, here))

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'Give the item a name.'))

  const { error } = await supabase.from('ingredients').insert({
    account_id: accountId,
    name,
    kind: String(formData.get('kind') ?? 'ingredient'),
    base_unit_id: String(formData.get('base_unit_id') ?? ''),
  })

  revalidatePath(here)
  // A duplicate name used to fail in silence: the form cleared and nothing
  // appeared. The database's refusal is now shown to the customer.
  redirect(withNotice(here, error
    ? (error.code === '23505'
        ? `You already have an item called “${name}”. Open it to record a purchase, or use a different name.`
        : describeWriteError(error))
    : `${name} added.`))
}

/** Ask a few at a time: one request per priced item, without a flood at once. */
async function inBatches<T, R>(list: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < list.length; i += size) out.push(...await Promise.all(list.slice(i, i + size).map(fn)))
  return out
}

/** A price's state as a dot and its words. "Used in a dish" without a price is the one that needs her. */
function stateOf(state: string | undefined, usedInDishes: boolean): { tone: 'good' | 'warn' | 'muted'; label: string } {
  if (!state || state === 'never_priced') {
    return usedInDishes
      ? { tone: 'warn', label: 'Used in a dish, no price yet' }
      : { tone: 'muted', label: 'No price yet' }
  }
  return priceState(state)
}

type View = 'mine' | 'unpriced' | 'all' | 'priced' | 'away'

export default async function IngredientsPage(props: {
  searchParams: Promise<{ notice?: string; q?: string; cat?: string; show?: string; add?: string }>
}) {
  const { notice, q = '', cat = '', show = 'mine', add = '' } = await props.searchParams
  const view: View = (['mine', 'unpriced', 'all', 'priced', 'away'] as const).find((v) => v === show) ?? 'mine'
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, '/ingredients'))
  const { supabase, businessId } = ctx

  // Ingredient prices are costs (fn_can_see_costs, 0004). For sales and
  // kitchen no price, price state or cost is asked for at all; their list
  // says how each item is measured instead.
  const costs = canSeeCosts(ctx.role)
  const canEdit = canEditItems(ctx.role)

  const [{ data: ingredients }, { data: categories }, { data: units }, { data: status }, { data: bought }, { data: missing }, { data: putAway }] = await Promise.all([
    supabase.from('ingredients').select('id,name,kind,category_id,base_unit_id')
      .is('deleted_at', null).order('name').returns<Row[]>(),
    supabase.from('ingredient_categories').select('id,name').order('name')
      .returns<{ id: string; name: string }[]>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
    // Whether each item is in a dish, and (for a role that may see costs)
    // whether its price is current, old or an estimate. 0026's own rule.
    businessId
      ? supabase.from('v_ingredient_price_status').select('ingredient_id,price_state,used_in_recipes')
          .eq('business_id', businessId).returns<Status[]>()
      : Promise.resolve({ data: null }),
    // What she has bought before. Only which items: no amount is read.
    supabase.from('purchase_lines').select('ingredient_id').limit(5000)
      .returns<{ ingredient_id: string }[]>(),
    supabase.from('v_missing_unit_conversions').select('ingredient_id,ingredient_name,unit_code,reason')
      .neq('reason', 'suggested')
      .returns<{ ingredient_id: string; ingredient_name: string; unit_code: string; reason: string }[]>(),
    supabase.from('ingredients').select('id,name,deleted_at')
      .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).returns<PutAway[]>(),
  ])

  const all = ingredients ?? []
  const away = putAway ?? []
  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const groupOf = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const statusOf = new Map((status ?? []).map((s) => [s.ingredient_id, s]))
  const boughtIds = new Set((bought ?? []).map((b) => b.ingredient_id))
  const priced = (id: string) => costs && (statusOf.get(id)?.price_state ?? 'never_priced') !== 'never_priced'
  const inDishes = (id: string) => (statusOf.get(id)?.used_in_recipes ?? 0) > 0

  // "Your items": what she has bought, what her dishes use, and what she added
  // herself (the starter list always files an item under a category; her own
  // have none). The rest of the starter list is one tap away under All.
  const mine = all.filter((i) => priced(i.id) || boughtIds.has(i.id) || inDishes(i.id) || i.category_id === null)
  const needsPrice = costs ? mine.filter((i) => !priced(i.id)) : []

  const term = q.trim().toLowerCase()
  const base = term ? all
    : view === 'all' ? all
    : view === 'unpriced' ? needsPrice
    : view === 'priced' ? all.filter((i) => priced(i.id))
    : mine
  const shown = base.filter((i) =>
    (!term || i.name.toLowerCase().includes(term)) &&
    (!cat || (cat === 'packaging' ? i.kind === 'packaging' : i.category_id === cat)))

  // The price every dish is costed at now: fn_ingredient_unit_cost, the
  // engine's own figure (an average over her costing window), so this list
  // and the item's page always say the same. Asked only for priced items.
  const price = new Map<string, number>()
  if (costs && businessId) {
    const ask = shown.filter((i) => priced(i.id)).map((i) => i.id)
    const answers = await inBatches(ask, 10, async (id) => {
      const { data } = await supabase.rpc('fn_ingredient_unit_cost', { p_ingredient_id: id, p_business_id: businessId })
      return [id, data === null || data === undefined ? null : Number(data)] as const
    })
    for (const [id, v] of answers) if (v !== null && Number.isFinite(v)) price.set(id, v)
  }

  const commonUnits = COMMON_UNITS.flatMap((c) => {
    const u = (units ?? []).find((x) => x.code === c.code)
    return u ? [{ id: u.id, label: c.label }] : []
  })
  const otherUnits = (units ?? []).filter((u) => !COMMON_UNITS.some((c) => c.code === u.code))
  const missingByItem = new Map<string, { name: string; units: string[] }>()
  for (const m of missing ?? []) {
    const e = missingByItem.get(m.ingredient_id) ?? { name: m.ingredient_name, units: [] }
    e.units.push(m.unit_code)
    missingByItem.set(m.ingredient_id, e)
  }

  // The full starter list reads better in its shelves; your own items are few
  // enough to read A to Z.
  const shelved = (view === 'all' || term) && shown.length > 12
  const shelves = new Map<string, Row[]>()
  if (shelved) {
    for (const r of shown) {
      const shelf = r.kind === 'packaging' ? 'Packaging' : (groupOf.get(r.category_id ?? '') ?? 'Your own items')
      shelves.set(shelf, [...(shelves.get(shelf) ?? []), r])
    }
  }

  const row = (r: Row) => {
    const unit = unitById.get(r.base_unit_id)
    const st = stateOf(statusOf.get(r.id)?.price_state, inDishes(r.id))
    const p = price.get(r.id)
    const per = p !== undefined ? perBuyingUnit(p, unit?.code) : null
    return (
      <li key={r.id}>
        <Link href={`/ingredients/${r.id}`} className="mm-buy-row">
          {costs && <span className="mm-buy-dot" data-tone={st.tone} title={st.label} aria-hidden />}
          <span className="min-w-0 flex-1 truncate font-medium">
            {r.name}
            {costs && <span className="sr-only">, {st.label}</span>}
          </span>
          {costs ? (
            per
              ? <span className="mm-num shrink-0 text-sm">{money(per.value)} <span style={{ color: 'var(--mm-muted)' }}>{per.per}</span></span>
              : <span className="shrink-0 text-sm" style={{ color: 'var(--mm-muted)' }}>No price yet</span>
          ) : (
            <span className="shrink-0 text-sm" style={{ color: 'var(--mm-muted)' }}>
              {MEASURED[unit?.code ?? ''] ?? `in ${unit?.name.toLowerCase() ?? 'its own unit'}`}
            </span>
          )}
        </Link>
      </li>
    )
  }

  const tab = parentTab('/ingredients')
  const link = (v: View) => (v === 'mine' ? '/ingredients' : `/ingredients?show=${v}`)
  const chips: [View, string, number][] = [
    ['mine', 'Your items', mine.length],
    ...(needsPrice.length > 0 ? [['unpriced', 'No price yet', needsPrice.length] as [View, string, number]] : []),
    ['all', 'All items', all.length],
  ]

  return (
    <div className="space-y-5">
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader
        title="Ingredients"
        sub={costs
          ? 'Your own items and what you paid for them. The dot shows each price: green is current, amber is old or an estimate, an empty ring has no price yet. Menu Master never supplies a price or a conversion for you.'
          : 'Your own items and how each is measured. Prices are kept for the owner, managers and the accountant.'}
      />

      {notice && (
        <Notice tone={/already|could not|not allow/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>
      )}

      {canEdit && (
        <Disclosure summary="Add your own item" open={all.length === 0 || add === '1'}>
          <form action={addIngredient} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <Field label="Name">
              <input name="name" required placeholder="e.g. Ofada rice" className="mm-input mt-1" />
            </Field>
            <Field label="Type">
              <select name="kind" className="mm-input mt-1">
                <option value="ingredient">Ingredient</option>
                <option value="packaging">Packaging (bowls, lids, bags)</option>
              </select>
            </Field>
            <Field label="Measured by">
              <select name="base_unit_id" required className="mm-input mt-1">
                {commonUnits.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                <optgroup label="Other units">
                  {otherUnits.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                </optgroup>
              </select>
            </Field>
            <Submit>Add</Submit>
          </form>
        </Disclosure>
      )}

      {missingByItem.size > 0 && (
        <Notice>
          <p className="font-medium">Say how much these local measures hold:</p>
          <ul className="mt-1 space-y-1">
            {[...missingByItem.entries()].slice(0, 8).map(([id, m]) => (
              <li key={id}>
                <Link href={`/ingredients/${id}`} className="mm-inline-tap">{m.name}: one {m.units.join(', one ')}</Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/* Finding things: plain links and a GET form, so they work before the page has loaded fully. */}
      <section className="space-y-3">
        <form action="/ingredients" className="flex gap-2" role="search">
          {view !== 'mine' && <input type="hidden" name="show" value={view} />}
          <input type="search" name="q" defaultValue={q} placeholder="Find any item…" aria-label="Find an item"
                 className="mm-input min-w-0 flex-1" />
          <button type="submit" className="mm-btn mm-btn-secondary">Find</button>
        </form>
        {!term && view !== 'away' && (
          <nav aria-label="Show" className="flex flex-wrap gap-2">
            {chips.map(([v, label, n]) => (
              <Link key={v} href={link(v)} aria-current={view === v ? 'page' : undefined} className="mm-buy-chip">
                {label} <span className="mm-num font-normal" style={{ color: 'var(--mm-muted)' }}>{n}</span>
              </Link>
            ))}
          </nav>
        )}

        {term && (
          <h2 className="text-base font-semibold tracking-tight">
            Found {shown.length} <span className="font-normal" style={{ color: 'var(--mm-muted)' }}>for “{q}”</span>
          </h2>
        )}

        {all.length === 0 ? (
          <Empty>You have not added anything you buy yet. Add your first item (rice, oil, a pack of containers) and Menu Master starts working out what your food costs.</Empty>
        ) : shown.length === 0 ? (
          term
            ? <Empty>Nothing matches. <Link href="/ingredients" className="mm-inline-tap">Show your items</Link>.</Empty>
            : view === 'mine'
              ? <Empty>Nothing bought yet. Record your first purchase and its items show here, with what you paid.</Empty>
              : <Empty>Nothing here. <Link href="/ingredients" className="mm-inline-tap">Show your items</Link>.</Empty>
        ) : shelved ? (
          <div className="space-y-4">
            {[...shelves.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([shelf, list]) => (
              <div key={shelf} className="space-y-1.5">
                <h3 className="px-1 text-sm font-semibold">{shelf}</h3>
                <ul className="mm-buy-rows">{list.map(row)}</ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="mm-buy-rows">{shown.map(row)}</ul>
        )}

        {!term && view !== 'all' && all.length > mine.length && (
          <p className="text-sm">
            <Link href="/ingredients?show=all" className="mm-tap underline">Show all {all.length} items →</Link>
          </p>
        )}
      </section>

      {away.length > 0 && (
        <section className="space-y-3">
          {view === 'away' ? (
            <>
              <SectionHeading sub="Items you put away. Dishes and purchases that use them keep them.">
                Put away ({away.length})
              </SectionHeading>
              <ul className="space-y-2">
                {away.map((r) => (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="font-medium">{r.name}</span>
                          <span className="text-sm" style={{ color: 'var(--mm-muted)' }}> · put away {inSentence(formatDay(r.deleted_at))}</span>
                        </span>
                        {canEdit && (
                          <form action={restoreIngredient}>
                            <input type="hidden" name="ingredient_id" value={r.id} />
                            <InlineSubmit>Bring back</InlineSubmit>
                          </form>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              <p className="text-sm"><Link href="/ingredients" className="mm-tap underline">Hide put-away items</Link></p>
            </>
          ) : (
            <p className="text-sm">
              <Link href="/ingredients?show=away" className="mm-tap underline">
                {away.length} item{away.length === 1 ? '' : 's'} put away →
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  )
}
