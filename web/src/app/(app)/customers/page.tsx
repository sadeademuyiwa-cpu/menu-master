import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, Notice, Empty, SectionHeading } from '@/components/ui'

export const dynamic = 'force-dynamic'

type Customer = {
  id: string; name: string; company: string | null
  phone: string | null; email: string | null; notes: string | null
}

async function addCustomer(formData: FormData) {
  'use server'
  const { supabase, accountId, businessId } = await currentContext()
  if (!accountId || !businessId) redirect(withNotice('/customers', 'No business found for your login.'))

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/customers', 'A customer needs a name.'))

  const { error } = await supabase.from('customers').insert({
    account_id: accountId,
    business_id: businessId,
    name,
    company: String(formData.get('company') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
  })
  revalidatePath('/customers')
  redirect(withNotice('/customers', describeWriteError(error) ?? `${name} added.`))
}

export default async function CustomersPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect('/onboarding')

  const { data: customers } = await supabase.from('customers')
    .select('id,name,company,phone,email,notes').order('name').returns<Customer[]>()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        sub="The people and companies you cook for."
      />
      {notice && <Notice tone={/could not|cannot|needs/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Card>
        <SectionHeading sub="Only what you actually need to remember. Menu Master does not collect addresses or birthdays — what is not collected cannot be lost.">
          Add a customer
        </SectionHeading>
        <form action={addCustomer} className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <input name="name" className="mm-input mt-1" />
          </Field>
          <Field label="Company (optional)">
            <input name="company" placeholder="who they order for" className="mm-input mt-1" />
          </Field>
          <Field label="Phone (optional)">
            <input name="phone" inputMode="tel" className="mm-input mt-1" />
          </Field>
          <Field label="Email (optional)">
            <input name="email" type="email" className="mm-input mt-1" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Anything to remember (optional)">
              <input name="notes" placeholder="e.g. no pepper, always pays on delivery"
                     className="mm-input mt-1" />
            </Field>
          </div>
          <div className="flex items-end"><Submit>Add customer</Submit></div>
        </form>
      </Card>

      <section className="space-y-3">
        <SectionHeading sub="Tap a name to see what they have bought.">Your customers</SectionHeading>
        {!customers?.length ? (
          <Empty>No customers yet. You can record sales without one — add a customer when you want to see what a particular client is worth to you.</Empty>
        ) : (
          <ul className="space-y-2">
            {customers.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="block">
                  <Card>
                    <div className="font-medium">
                      {c.name}{c.company ? ` · ${c.company}` : ''}
                    </div>
                    <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                      {[c.phone, c.email, c.notes].filter(Boolean).join(' · ') || 'No other details'}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
