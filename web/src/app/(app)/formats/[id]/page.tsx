import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty,
  SectionHeading, BackLink, Badge, Disclosure,
} from '@/components/ui'
import { money, quantity } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Format = {
  id: string; name: string; description: string | null
  capacity_qty: string | null; is_active: boolean
  capacity_unit: { code: string } | null
}
type PackLine = {
  id: string; qty: string; is_cost_bearing: boolean
  item: { id: string; name: string } | null
}
type PackItem = { id: string; name: string }

/** Packaging is consumed once per sold unit -- one bowl, one lid, one label. */
async function addPackaging(formData: FormData) {
  'use server'
  const fid = String(formData.get('format_id') ?? '')
  const here = `/formats/${fid}`
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, here))

  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'How many of that item does one serving use? It must be more than zero.'))
  }
  const { error } = await supabase.from('serving_format_packaging').insert({
    account_id: accountId, business_id: businessId, format_id: fid,
    packaging_item_id: String(formData.get('packaging_item_id') ?? ''), qty,
  })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Packaging added.'))
}

async function removePackaging(formData: FormData) {
  'use server'
  const fid = String(formData.get('format_id') ?? '')
  const here = `/formats/${fid}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('serving_format_packaging')
    .delete().eq('id', String(formData.get('id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Packaging removed.'))
}

async function updatePackaging(formData: FormData) {
  'use server'
  const fid = String(formData.get('format_id') ?? '')
  const here = `/formats/${fid}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'How many of that item does one use? It must be more than zero.'))
  }
  const { error } = await supabase.from('serving_format_packaging')
    .update({ qty }).eq('id', String(formData.get('id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Packaging updated.'))
}

/**
 * The size itself. A capacity change is logged by trg_serving_formats_log_change
 * (0021) with both values; the dishes sold in it are re-costed from the
 * recipe page's next snapshot.
 */
async function updateFormat(formData: FormData) {
  'use server'
  const fid = String(formData.get('format_id') ?? '')
  const here = `/formats/${fid}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'Give this size a name your customers would recognise.'))
  const qtyRaw = String(formData.get('capacity_qty') ?? '').trim()
  const unitRaw = String(formData.get('capacity_unit_id') ?? '')
  const qty = qtyRaw === '' ? null : Number(qtyRaw)
  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
    redirect(withNotice(here, 'A size must be greater than zero. Leave it blank if you sell by the piece.'))
  }
  if ((qty === null) !== (unitRaw === '')) {
    redirect(withNotice(here, 'Give both a size and its unit, or neither.'))
  }
  const { error } = await supabase.from('serving_formats').update({
    name,
    description: String(formData.get('description') ?? '').trim() || null,
    capacity_qty: qty, capacity_unit_id: unitRaw || null,
  }).eq('id', fid)
  revalidatePath(here)
  revalidatePath('/formats')
  redirect(withNotice(here, error
    ? (error.code === '23505' ? `You already have a size called “${name}”.` : describeWriteError(error))
    : 'Size updated.'))
}

/** Hidden, never deleted: sales and prices in this size keep it. */
async function setActive(formData: FormData) {
  'use server'
  const fid = String(formData.get('format_id') ?? '')
  const here = `/formats/${fid}`
  const active = formData.get('active') === 'true'
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('serving_formats').update({ is_active: active }).eq('id', fid)
  revalidatePath(here)
  revalidatePath('/formats')
  redirect(withNotice(here, describeWriteError(error)
    ?? (active ? 'Size shown again.' : 'Size hidden. Dishes keep any price set for it; it no longer appears when you take an order.')))
}

export default async function FormatDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await params
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/formats'))

  const { data: format } = await supabase.from('serving_formats')
    .select('id,name,description,capacity_qty,is_active,capacity_unit:units(code)')
    .eq('id', id).maybeSingle<Format>()
  if (!format) notFound()

  const [{ data: lines }, { data: items }, { data: units }] = await Promise.all([
    supabase.from('serving_format_packaging')
      .select('id,qty,is_cost_bearing,item:ingredients!fk_sfp_item(id,name)')
      .eq('format_id', id).returns<PackLine[]>(),
    // Packaging is an ingredient of kind 'packaging'; it is bought and priced
    // through the same ledger as food, so its cost is real, not estimated.
    supabase.from('ingredients').select('id,name').eq('kind', 'packaging')
      .is('deleted_at', null).eq('is_active', true).order('name').returns<PackItem[]>(),
    supabase.from('units').select('id,code,name').order('kind').order('code')
      .returns<{ id: string; code: string; name: string }[]>(),
  ])
  const capacityUnitId = format.capacity_unit
    ? (units ?? []).find((u) => u.code === format.capacity_unit?.code)?.id ?? ''
    : ''

  const rows = lines ?? []
  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined

  return (
    <div className="space-y-6">
      <BackLink href="/formats">All sizes</BackLink>
      <PageHeader
        title={format.name}
        sub={(format.capacity_qty !== null && format.capacity_unit
          ? `Holds ${quantity(Number(format.capacity_qty), format.capacity_unit.code)}`
          : 'Sold by the piece') + (format.is_active ? '' : ' · hidden')}
      />
      {notice && <Notice tone={/could not|must be|how many|already|give /i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Disclosure summary="Edit this size">
        <form action={updateFormat} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <input type="hidden" name="format_id" value={id} />
          <Field label="What do you call it?">
            <input name="name" required defaultValue={format.name} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="How much does it hold?">
            <input name="capacity_qty" type="number" step="any" min="0" inputMode="decimal"
              defaultValue={format.capacity_qty ?? ''} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Measured in">
            <select name="capacity_unit_id" defaultValue={capacityUnitId} className={inputClass} style={inputStyle}>
              <option value="">— none —</option>
              {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Submit>Save changes</Submit></div>
          <div className="sm:col-span-4">
            <Field label="Description (optional)">
              <input name="description" defaultValue={format.description ?? ''} className={inputClass} style={inputStyle} />
            </Field>
          </div>
        </form>
        <form action={setActive} className="mt-3">
          <input type="hidden" name="format_id" value={id} />
          <input type="hidden" name="active" value={format.is_active ? 'false' : 'true'} />
          <InlineSubmit>{format.is_active ? 'Hide this size' : 'Show this size again'}</InlineSubmit>
        </form>
      </Disclosure>

      <section className="space-y-3">
        <SectionHeading sub="What you use up for ONE of these — the container, the lid, the label. Counted once for each one you sell, not per litre.">
          Packaging
        </SectionHeading>

        {!rows.length ? (
          <Empty>No packaging yet. If this format uses a container, add it so the cost is counted.</Empty>
        ) : (
          <ul className="space-y-2">
            {rows.map((l) => (
              <li key={l.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="flex items-center gap-2 font-medium">
                      {l.item?.name ?? 'Unknown item'}
                      {!l.is_cost_bearing && <Badge tone="muted">Not counted</Badge>}
                    </span>
                    <span className="tabular-nums text-sm" style={{ color: 'var(--mm-muted)' }}>
                      {Number(l.qty)} for each one
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-4">
                    <form action={updatePackaging} className="flex items-end gap-2">
                      <input type="hidden" name="format_id" value={id} />
                      <input type="hidden" name="id" value={l.id} />
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>For each one</span>
                        <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                          defaultValue={Number(l.qty)} className="mt-1 w-28 rounded border px-2 py-2 text-base" />
                      </label>
                      <InlineSubmit>Update</InlineSubmit>
                    </form>
                    <form action={removePackaging}>
                      <input type="hidden" name="format_id" value={id} />
                      <input type="hidden" name="id" value={l.id} />
                      <InlineSubmit>Remove</InlineSubmit>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <Card>
          <SectionHeading sub="Add the container and anything that goes with it.">
            Add packaging
          </SectionHeading>
          {!items?.length ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--mm-muted)' }}>
              You have no packaging items yet. Add one under Ingredients, choosing
              Packaging as its type, and record what you paid for it.
            </p>
          ) : (
            <form action={addPackaging} className="mt-3 grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="format_id" value={id} />
              <Field label="Item">
                <select name="packaging_item_id" required className={inputClass} style={inputStyle}>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="How many for each one">
                <input name="qty" type="number" step="any" min="0" defaultValue="1"
                  required className={inputClass} style={inputStyle} />
              </Field>
              <div className="flex items-end"><Submit>Add</Submit></div>
            </form>
          )}
        </Card>
      </section>

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        If any packaging item here has no purchase price, every recipe sold in
        this format is reported as incomplete. Menu Master will not price a
        container it does not know the cost of.
      </p>
    </div>
  )
}
