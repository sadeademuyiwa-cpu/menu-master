import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, Notice, Empty, SectionHeading } from '@/components/ui'
import { quantity } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Format = {
  id: string; name: string; description: string | null
  capacity_qty: string | null; is_active: boolean
  capacity_unit: { code: string } | null
}
type Unit = { id: string; code: string; name: string; kind: string }

/**
 * A serving format is whatever THIS business sells: a 2.5 L family bowl, a
 * 250 g pack, a tray of 12, a single loaf. Menu Master ships no catalogue of
 * sizes -- the size and the unit both come from the business, because a
 * "bowl" is not a fixed quantity anywhere.
 */
async function addFormat(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, '/formats'))

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/formats', 'Give this format a name your customers would recognise.'))

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
  redirect(withNotice('/formats', describeWriteError(error) ?? 'Format added.'))
}

export default async function FormatsPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/formats'))

  const [{ data: formats }, { data: units }] = await Promise.all([
    supabase.from('serving_formats')
      .select('id,name,description,capacity_qty,is_active,capacity_unit:units(code)')
      .order('sort_order').order('name').returns<Format[]>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
  ])

  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined

  return (
    <div className="space-y-6">
      <PageHeader title="How you sell it"
        sub="The sizes and containers your customers actually buy. You define these — Menu Master does not assume them." />
      {notice && <Notice tone={/could not|must be|give /i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Card>
        <SectionHeading sub="A 2.5 litre bowl, a 250 g pack, a tray of 12, one loaf — whatever you sell.">
          Add a format
        </SectionHeading>
        <form action={addFormat} className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="What do you call it?">
            <input name="name" required placeholder="Family bowl" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="How much does it hold?">
            <input name="capacity_qty" type="number" step="any" min="0" placeholder="2.5"
              className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Measured in">
            <select name="capacity_unit_id" className={inputClass} style={inputStyle}>
              <option value="">— none —</option>
              {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Submit>Add format</Submit></div>
          <p className="sm:col-span-4 text-xs" style={{ color: 'var(--mm-muted)' }}>
            Leave the size blank if you sell it by the piece. If you do give a size,
            give its unit too — otherwise Menu Master cannot work out how many
            servings a batch makes, and it will not guess.
          </p>
        </form>
      </Card>

      {!formats?.length ? (
        <Empty>No formats yet. Add the sizes you actually sell, then attach them to a recipe.</Empty>
      ) : (
        <ul className="space-y-2">
          {formats.map((f) => (
            <li key={f.id}>
              <Link href={`/formats/${f.id}`} className="block">
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">
                      {f.name}{!f.is_active && <span className="mm-absent"> · hidden</span>}
                    </span>
                    <span className="tabular-nums text-sm" style={{ color: 'var(--mm-muted)' }}>
                      {f.capacity_qty !== null && f.capacity_unit
                        ? quantity(Number(f.capacity_qty), f.capacity_unit.code)
                        : 'sold by the piece'}
                    </span>
                  </div>
                  {f.description && (
                    <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{f.description}</div>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
