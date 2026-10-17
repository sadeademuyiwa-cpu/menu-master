import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Field, Submit, InlineSubmit, Notice, Empty, Disclosure, BackLink } from '@/components/ui'
import { parentTab } from '@/lib/nav'
import { NOT_CHANGED, canEditSuppliers } from '../purchases/buy-roles'
import '../purchases/buy.css'

export const dynamic = 'force-dynamic'

type Supplier = {
  id: string; name: string; phone: string | null; location: string | null
  notes: string | null; is_active: boolean
}

async function addSupplier(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/suppliers'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/suppliers', 'Give the supplier or market a name.'))

  const { error } = await supabase.from('suppliers').insert({
    account_id: accountId, name,
    phone: String(formData.get('phone') ?? '').trim() || null,
    location: String(formData.get('location') ?? '').trim() || null,
  })
  revalidatePath('/suppliers')
  redirect(withNotice('/suppliers', describeWriteError(error) ?? 'Supplier added.'))
}

/** Deactivate, never delete: past purchases reference this supplier and that
 *  history must stay readable. */
async function deactivate(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase } = ctx
  // .select: a refused update is not an error, only zero rows (NOT_CHANGED).
  const { data, error } = await supabase.from('suppliers')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? '')).select('id')
  revalidatePath('/suppliers')
  redirect(withNotice('/suppliers', describeWriteError(error)
    ?? (data?.length ? 'Supplier hidden. Past purchases keep it.' : NOT_CHANGED)))
}

async function restore(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('suppliers')
    .update({ is_active: true }).eq('id', String(formData.get('id') ?? '')).select('id')
  revalidatePath('/suppliers')
  redirect(withNotice('/suppliers', describeWriteError(error) ?? (data?.length ? 'Supplier shown again.' : NOT_CHANGED)))
}

async function updateSupplier(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase } = ctx
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/suppliers', 'Give the supplier or market a name.'))
  const { data, error } = await supabase.from('suppliers').update({
    name,
    phone: String(formData.get('phone') ?? '').trim() || null,
    location: String(formData.get('location') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
  }).eq('id', String(formData.get('id') ?? '')).select('id')
  revalidatePath('/suppliers')
  redirect(withNotice('/suppliers', describeWriteError(error) ?? (data?.length ? 'Supplier updated.' : NOT_CHANGED)))
}

export default async function SuppliersPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/suppliers'))
  // Owner, manager and accountant add and change suppliers (0015). Everyone
  // else sees the list, which is all they need to ring a market.
  const canEdit = canEditSuppliers(ctx.role)

  const { data: suppliers } = await supabase.from('suppliers')
    .select('id,name,phone,location,notes,is_active')
    .order('is_active', { ascending: false }).order('name').returns<Supplier[]>()

  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined
  const tab = parentTab('/suppliers')

  return (
    <div className="space-y-5">
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader title="Suppliers and markets"
        sub="Who you buy from. Optional: you can record a purchase without one. A market name is fine; you do not need a formal supplier." />
      {notice && <Notice tone={/could not|give the|nothing was changed/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {canEdit && (
        <Disclosure summary="Add a supplier or market" open={!suppliers?.length}>
          <form action={addSupplier} className="grid gap-3 sm:grid-cols-4">
            <Field label="Name"><input name="name" required placeholder="e.g. Mile 12 market" className={inputClass} style={inputStyle} /></Field>
            <Field label="Phone (optional)"><input name="phone" type="tel" inputMode="tel" className={inputClass} style={inputStyle} /></Field>
            <Field label="Where (optional)"><input name="location" className={inputClass} style={inputStyle} /></Field>
            <div className="flex items-end"><Submit>Add</Submit></div>
          </form>
        </Disclosure>
      )}

      {!suppliers?.length ? (
        <Empty>No suppliers yet. You can record purchases without one.</Empty>
      ) : (
        <ul className="mm-buy-rows">
          {suppliers.map((s) => (
            <li key={s.id} className="space-y-2 px-[.9rem] py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold" style={s.is_active ? undefined : { color: 'var(--mm-muted)' }}>
                    {s.name}{!s.is_active && <span className="mm-absent font-normal"> · hidden</span>}
                  </p>
                  {s.location && <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>{s.location}</p>}
                  {s.notes && <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>{s.notes}</p>}
                </div>
                {s.phone && (
                  // One tap rings the market from the phone it is already in.
                  <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="mm-btn mm-btn-quiet shrink-0 mm-num" style={{ minHeight: 44 }}>
                    {s.phone}
                  </a>
                )}
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Disclosure summary="Edit">
                      <form action={updateSupplier} className="grid gap-3 sm:grid-cols-4">
                        <input type="hidden" name="id" value={s.id} />
                        <Field label="Name"><input name="name" required defaultValue={s.name} className={inputClass} style={inputStyle} /></Field>
                        <Field label="Phone"><input name="phone" type="tel" inputMode="tel" defaultValue={s.phone ?? ''} className={inputClass} style={inputStyle} /></Field>
                        <Field label="Where"><input name="location" defaultValue={s.location ?? ''} className={inputClass} style={inputStyle} /></Field>
                        <Field label="Notes"><input name="notes" defaultValue={s.notes ?? ''} placeholder="e.g. best for tomatoes on Tuesdays" className={inputClass} style={inputStyle} /></Field>
                        <div className="sm:col-span-4"><Submit>Save</Submit></div>
                      </form>
                    </Disclosure>
                  </div>
                  <form action={s.is_active ? deactivate : restore} className="pt-0.5">
                    <input type="hidden" name="id" value={s.id} />
                    <InlineSubmit>{s.is_active ? 'Hide' : 'Show again'}</InlineSubmit>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
