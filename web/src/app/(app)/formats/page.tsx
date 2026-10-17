import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Field, Submit, Notice, Empty, Disclosure, BackLink } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { quantity } from '@/lib/format'
import { parentTab } from '@/lib/nav'
import { canChangeSizes } from './roles'
import '../recipes/_list/lists.css'

export const dynamic = 'force-dynamic'

type Format = {
  id: string; name: string; description: string | null
  capacity_qty: string | null; is_active: boolean
  capacity_unit: { code: string } | null
}
type Unit = { id: string; code: string; name: string; kind: string }

/**
 * A size is whatever THIS business sells: a 2.5 L family bowl, a 250 g pack,
 * a tray of 12, a single loaf. Menu Master ships no catalogue of sizes -- the
 * size and the unit both come from the business, because a "bowl" is not a
 * fixed quantity anywhere.
 */
async function addFormat(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, '/formats'))

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/formats', 'Give this size a name your customers would recognise.'))

  const qtyRaw = String(formData.get('capacity_qty') ?? '').trim()
  const unitRaw = String(formData.get('capacity_unit_id') ?? '')
  const qty = qtyRaw === '' ? null : Number(qtyRaw)
  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
    redirect(withNotice('/formats', 'A size must be greater than zero. Leave it blank if you sell by the piece.'))
  }
  // Size and unit travel together: a number with no unit means nothing, and
  // the engine would have no way to convert a batch into servings.
  if ((qty === null) !== (unitRaw === '')) {
    redirect(withNotice('/formats', 'Give both a size and its unit, or neither.'))
  }

  const { error } = await supabase.from('serving_formats').insert({
    account_id: accountId, business_id: businessId, name,
    description: String(formData.get('description') ?? '').trim() || null,
    capacity_qty: qty, capacity_unit_id: unitRaw || null,
  })
  revalidatePath('/formats')
  redirect(withNotice('/formats', error
    ? (error.code === '23505' ? `You already have a size called “${name}”. Open it to change it, or hide it.` : describeWriteError(error))
    : 'Size added.'))
}

export default async function FormatsPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId, role } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/formats'))
  const changes = canChangeSizes(role)

  const [{ data: formats }, { data: units }] = await Promise.all([
    supabase.from('serving_formats')
      .select('id,name,description,capacity_qty,is_active,capacity_unit:units(code)')
      .order('sort_order').order('name').returns<Format[]>(),
    changes
      ? supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>()
      : Promise.resolve({ data: [] as Unit[] }),
  ])
  const tab = parentTab('/formats')

  return (
    <div className="space-y-5">
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader title="Sizes"
        sub="The sizes and containers your customers actually buy. You name them; Menu Master assumes none." />
      {notice && <Notice tone={/could not|must be|give |already/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {changes && (
        <Disclosure summary="Add a size" open={!formats?.length}>
          <form action={addFormat} className="grid gap-3 sm:grid-cols-4">
            <Field label="What do you call it?">
              <input name="name" required placeholder="Family bowl" className="mm-input mt-1" />
            </Field>
            <Field label="How much does it hold?">
              <input name="capacity_qty" type="number" step="any" min="0" placeholder="2.5" inputMode="decimal"
                className="mm-input mt-1" />
            </Field>
            <Field label="Measured in">
              <select name="capacity_unit_id" className="mm-input mt-1">
                <option value="">— none —</option>
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><Submit>Add size</Submit></div>
            <p className="sm:col-span-4 text-xs" style={{ color: 'var(--mm-muted)' }}>
              Sold by the piece? Leave the amount and its unit both blank.
            </p>
          </form>
        </Disclosure>
      )}

      {!formats?.length ? (
        <Empty>
          {changes ? 'No sizes yet. Add the sizes you actually sell, then attach them to a dish.' : 'No sizes yet.'}
        </Empty>
      ) : (
        <ul className="mm-rows" data-cols="2">
          {formats.map((f) => (
            <li key={f.id}>
              <Link href={`/formats/${f.id}`} className="mm-row" data-size="short">
                <span className="mm-row-main">
                  <span className="mm-row-name">
                    {f.name}{!f.is_active && <span className="mm-absent font-normal"> · hidden</span>}
                  </span>
                  {f.description && <span className="mm-row-figure">{f.description}</span>}
                </span>
                <span className="mm-num shrink-0 text-sm" style={{ color: 'var(--mm-muted)' }}>
                  {f.capacity_qty !== null && f.capacity_unit
                    ? quantity(Number(f.capacity_qty), f.capacity_unit.code)
                    : 'by the piece'}
                </span>
                <AppIcon name="chevron-right" size={17} className="mm-row-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
