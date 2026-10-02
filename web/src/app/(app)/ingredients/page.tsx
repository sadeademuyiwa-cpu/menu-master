import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, Empty, Notice, Disclosure } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { money } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Row = { id: string; name: string; kind: 'ingredient' | 'packaging'; category_id: string | null; base_unit_id: string }
type Unit = { id: string; code: string; name: string; kind: string }

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

/** The latest price per base unit, said the way it is bought: per kg, per litre, per piece. */
function priceText(unitCost: number, baseCode: string | undefined): string {
  if (baseCode === 'g') return `${money(unitCost * 1000)} per kg`
  if (baseCode === 'ml') return `${money(unitCost * 1000)} per litre`
  if (baseCode === 'unit') return `${money(unitCost)} each`
  return `${money(unitCost)} per ${baseCode ?? 'unit'}`
}

export default async function IngredientsPage(props: {
  searchParams: Promise<{ notice?: string; q?: string; cat?: string; show?: string }>
}) {
  const { notice, q = '', cat = '', show = 'all' } = await props.searchParams
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, '/ingredients'))
  const { supabase } = ctx

  const [{ data: ingredients }, { data: categories }, { data: units }, { data: prices }, { data: missing }] = await Promise.all([
    supabase.from('ingredients').select('id,name,kind,category_id,base_unit_id')
      .is('deleted_at', null).order('name').returns<Row[]>(),
    supabase.from('ingredient_categories').select('id,name').order('name')
      .returns<{ id: string; name: string }[]>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
    // Newest first, so the first row seen for each item is its latest price.
    supabase.from('ingredient_prices').select('ingredient_id,unit_cost')
      .is('reversed_at', null).order('effective_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(5000)
      .returns<{ ingredient_id: string; unit_cost: string }[]>(),
    supabase.from('v_missing_unit_conversions').select('ingredient_id,ingredient_name,unit_code,reason')
      .neq('reason', 'suggested')
      .returns<{ ingredient_id: string; ingredient_name: string; unit_code: string; reason: string }[]>(),
  ])

  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const groupOf = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const latest = new Map<string, number>()
  for (const p of prices ?? []) if (!latest.has(p.ingredient_id)) latest.set(p.ingredient_id, Number(p.unit_cost))

  const all = ingredients ?? []
  const pricedCount = all.filter((i) => latest.has(i.id)).length
  const term = q.trim().toLowerCase()
  const shown = all.filter((i) =>
    (!term || i.name.toLowerCase().includes(term)) &&
    (!cat || (cat === 'packaging' ? i.kind === 'packaging' : i.category_id === cat)) &&
    (show === 'priced' ? latest.has(i.id) : show === 'unpriced' ? !latest.has(i.id) : true))
  // Priced items first: they are the ones in use.
  shown.sort((a, b) => Number(latest.has(b.id)) - Number(latest.has(a.id)) || a.name.localeCompare(b.name))

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(cat && { cat }), ...(show !== 'all' && { show }), ...patch })
    for (const [k, v] of [...p.entries()]) if (!v || (k === 'show' && v === 'all')) p.delete(k)
    const s = p.toString()
    return `/ingredients${s ? `?${s}` : ''}`
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ingredients"
        sub="Your own items and prices. Menu Master never supplies a price or a conversion for you."
      />

      {notice && (
        <Notice tone={/already|could not|not allow/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>
      )}

      <Link href="/purchases/new" className="mm-btn mm-btn-primary w-full text-base">
        <AppIcon name="purchases" size={20} /> Record what you paid
      </Link>

      <Disclosure summary="Add your own item" open={all.length === 0}>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          For anything not on the starter list. You enter what you pay for it afterwards.
        </p>
        <form action={addIngredient} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
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

      {missingByItem.size > 0 && (
        <Notice>
          <p className="font-medium">Some local measures need a size before they can be costed:</p>
          <ul className="mt-1 space-y-1">
            {[...missingByItem.entries()].slice(0, 8).map(([id, m]) => (
              <li key={id}>
                <Link href={`/ingredients/${id}`} className="underline">{m.name}</Link> — how much is one {m.units.join(', one ')}?
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/* Finding things: plain links and a GET form, so they work before the page has loaded fully. */}
      <section className="space-y-3">
        <form action="/ingredients" className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input type="search" name="q" defaultValue={q} placeholder="Find an item…" aria-label="Find an item"
                 className="mm-input min-w-0" />
          <select name="cat" defaultValue={cat} aria-label="Category" className="mm-input col-span-2 sm:order-none sm:col-span-1 order-last">
            <option value="">All categories</option>
            {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="packaging">Packaging</option>
          </select>
          {show !== 'all' && <input type="hidden" name="show" value={show} />}
          <button type="submit" className="mm-btn mm-btn-secondary">Find</button>
        </form>
        <nav aria-label="Show" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {([['all', `All (${all.length})`], ['priced', `Priced (${pricedCount})`], ['unpriced', `No price yet (${all.length - pricedCount})`]] as const).map(([v, label]) => (
            <Link key={v} href={link({ show: v })} aria-current={show === v ? 'page' : undefined}
                  className="mm-btn shrink-0 whitespace-nowrap text-sm" style={show === v
                    ? { background: 'var(--mm-accent-soft)', color: 'var(--mm-accent-strong)', borderColor: 'var(--mm-accent)' }
                    : { background: 'var(--mm-surface)', borderColor: 'var(--mm-line)' }}>
              {label}
            </Link>
          ))}
        </nav>

        <h2 className="text-base font-semibold tracking-tight">
          Your items <span className="font-normal" style={{ color: 'var(--mm-muted)' }}>({shown.length}{shown.length !== all.length ? ` of ${all.length}` : ''})</span>
        </h2>
        {all.length === 0 ? (
          <Empty>You have not added anything you buy yet. Add your first ingredient — rice, oil, a pack of containers — and Menu Master starts working out what your food costs.</Empty>
        ) : shown.length === 0 ? (
          <Empty>Nothing matches. <Link href="/ingredients" className="underline">Show everything</Link>.</Empty>
        ) : (
          <ul className="space-y-2">
            {shown.map((r) => {
              const base = unitById.get(r.base_unit_id)
              const price = latest.get(r.id)
              return (
                <li key={r.id}>
                  <Link href={`/ingredients/${r.id}`} className="block">
                    <Card>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate font-semibold">{r.name}</span>
                        <span className="shrink-0 text-sm tabular-nums" style={{ color: price === undefined ? 'var(--mm-muted)' : undefined }}>
                          {price === undefined ? 'No price yet' : priceText(price, base?.code)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                        {r.kind === 'packaging' ? 'Packaging' : (groupOf.get(r.category_id ?? '') ?? 'Your own item')}
                        {' · '}{MEASURED[base?.code ?? ''] ?? `in ${base?.name.toLowerCase() ?? 'its own unit'}`}
                      </div>
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
