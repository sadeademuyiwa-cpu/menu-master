import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty, SectionHeading } from '@/components/ui'

export const dynamic = 'force-dynamic'

type Supplier = {
  id: string; name: string; phone: string | null; location: string | null
  notes: string | null; is_active: boolean
}

async function addSupplier(formData: FormData) {
  'use server'
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect(withNotice('/suppliers', 'No account found for your login.'))
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
  const { supabase } = await currentContext()
  const { error } = await supabase.from('suppliers')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? ''))
  revalidatePath('/suppliers')
  redirect(withNotice('/suppliers', describeWriteError(error) ?? 'Supplier hidden. Past purchases keep it.'))
}

export default async function SuppliersPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect('/onboarding')

  const { data: suppliers } = await supabase.from('suppliers')
    .select('id,name,phone,location,notes,is_active')
    .order('is_active', { ascending: false }).order('name').returns<Supplier[]>()

  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers and markets"
        sub="Who you buy from. Optional — you can record a purchase without one." />
      {notice && <Notice tone={/could not|give the/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Card>
        <SectionHeading sub="A market name is fine. You do not need a formal supplier.">
          Add a supplier or market
        </SectionHeading>
        <form action={addSupplier} className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Name"><input name="name" required className={inputClass} style={inputStyle} /></Field>
          <Field label="Phone (optional)"><input name="phone" className={inputClass} style={inputStyle} /></Field>
          <Field label="Where (optional)"><input name="location" className={inputClass} style={inputStyle} /></Field>
          <div className="flex items-end"><Submit>Add</Submit></div>
        </form>
      </Card>

      {!suppliers?.length ? (
        <Empty>No suppliers yet. Add one above, or record purchases without one.</Empty>
      ) : (
        <ul className="space-y-2">
          {suppliers.map((s) => (
            <li key={s.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">
                    {s.name}{!s.is_active && <span className="mm-absent"> · hidden</span>}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--mm-muted)' }}>
                    {[s.phone, s.location].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {s.is_active && (
                  <form action={deactivate} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <InlineSubmit>Hide</InlineSubmit>
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
