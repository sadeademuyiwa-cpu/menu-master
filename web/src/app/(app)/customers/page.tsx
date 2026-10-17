import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty, SectionHeading, Disclosure, BackLink } from '@/components/ui'
import { money } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { parentTab } from '@/lib/nav'
import { canSeeSellingPrices } from '@/lib/pricing'
import { SALE_ROLES } from '@/app/(app)/dashboard/roles'

export const dynamic = 'force-dynamic'

type Customer = {
  id: string; name: string; company: string | null
  phone: string | null; email: string | null; notes: string | null
}
type PutAway = { id: string; name: string; deleted_at: string }

/** A customer put away (0060) comes back with all their history. */
async function restoreCustomer(formData: FormData) {
  'use server'
  const id = String(formData.get('customer_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  // .select(): an update RLS refuses (customers: owner, manager and sales,
  // 0015) returns no error and no rows, and "Customer is back." would be
  // untrue while they are still put away.
  const { data, error } = await supabase.from('customers').update({ deleted_at: null }).eq('id', id).select('id')
  revalidatePath('/customers')
  if (error) redirect(withNotice('/customers?show=away', describeWriteError(error)))
  if ((data ?? []).length === 0) {
    redirect(withNotice('/customers?show=away', (SALE_ROLES as readonly string[]).includes(ctx.role ?? '')
      ? 'That customer could not be brought back. Reload and try again.'
      : 'Your role cannot bring a customer back. Ask the owner, a manager or sales staff.'))
  }
  redirect(withNotice(`/customers/${id}`, 'Customer is back.'))
}

/** A day from formatDay inside a sentence: "put away today", "put away 12
 *  Oct 2026". The same rule as inSentence in purchases/buy-figures.ts. */
const inSentence = (formatted: string) =>
  formatted === 'Today' || formatted === 'Yesterday' ? formatted.toLowerCase() : formatted

async function addCustomer(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, '/customers'))

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
}: { searchParams: Promise<{ notice?: string; show?: string }> }) {
  const { notice, show = '' } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/customers'))
  const tab = parentTab('/customers')
  // What a customer has bought is takings, so it follows the selling-price
  // rule (0064, as on Home and Reports): everyone but kitchen. For kitchen
  // the amounts are not read at all.
  const takings = canSeeSellingPrices(ctx.role)

  // Before 0060 the column does not exist; the first query then errors and
  // the fallback reads the list as before, so the page never goes blank.
  let { data: customers } = await supabase.from('customers')
    .select('id,name,company,phone,email,notes').is('deleted_at', null).order('name').returns<Customer[]>()
  if (customers === null) {
    ({ data: customers } = await supabase.from('customers')
      .select('id,name,company,phone,email,notes').order('name').returns<Customer[]>())
  }
  const [{ data: putAway }, { data: sold, count }] = await Promise.all([
    supabase.from('customers').select('id,name,deleted_at')
      .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).returns<PutAway[]>(),
    // What each customer has bought: confirmed sales only, one row per sale
    // (v_orders_attention already leaves out cancelled ones).
    takings
      ? supabase.from('v_orders_attention').select('customer_id,net_revenue', { count: 'exact' })
          .not('customer_id', 'is', null).neq('status', 'draft').limit(5000)
          .returns<{ customer_id: string; net_revenue: string | null }[]>()
      : Promise.resolve({ data: null, count: null }),
  ])
  const away = putAway ?? []

  // One figure per customer. If the database handed back fewer sales than it
  // holds (a very long history), a total would be short, so none is shown
  // rather than a wrong one.
  const complete = Array.isArray(sold) && (count === null || count <= sold.length)
  const boughtBy = new Map<string, number>()
  if (complete) {
    for (const s of sold) boughtBy.set(s.customer_id, (boughtBy.get(s.customer_id) ?? 0) + Number(s.net_revenue ?? 0))
  }

  return (
    <div className="space-y-5">
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader
        title="Customers"
        sub="The people and companies you cook for. Tap a name to see what they have bought."
      />
      {notice && <Notice tone={/could not|cannot|needs/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Disclosure summary="Add a customer" open={!customers?.length}>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          Customers can also be added while you take an order.
        </p>
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
      </Disclosure>

      <section className="space-y-2">
        <SectionHeading>Your customers</SectionHeading>
        {!customers?.length ? (
          <Empty>No customers yet. You can record sales without one; add a customer when you want to see what a particular client is worth to you.</Empty>
        ) : (
          <ul className="mm-card divide-y divide-[var(--mm-line)] p-0!">
            {customers.map((c) => {
              const bought = boughtBy.get(c.id)
              return (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex min-h-[56px] items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {c.name}{c.company ? ` · ${c.company}` : ''}
                      </span>
                      {(c.phone || c.notes) && (
                        <span className="block truncate text-sm" style={{ color: 'var(--mm-muted)' }}>
                          {c.phone ?? c.notes}
                        </span>
                      )}
                    </span>
                    {bought !== undefined && <span className="mm-num shrink-0 font-semibold">{money(bought)}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {away.length > 0 && (
        <section className="space-y-3">
          {show === 'away' ? (
            <>
              <SectionHeading sub="Customers you put away. Their sales are kept.">
                Put away ({away.length})
              </SectionHeading>
              <ul className="space-y-2">
                {away.map((c) => (
                  <li key={c.id}>
                    <Card>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-sm" style={{ color: 'var(--mm-muted)' }}> · put away {inSentence(formatDay(c.deleted_at))}</span>
                        </span>
                        <form action={restoreCustomer}>
                          <input type="hidden" name="customer_id" value={c.id} />
                          <InlineSubmit>Bring back</InlineSubmit>
                        </form>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              <p className="text-sm"><Link href="/customers" className="mm-tap underline">Hide put-away customers</Link></p>
            </>
          ) : (
            <p className="text-sm">
              <Link href="/customers?show=away" className="mm-tap underline">
                {away.length} customer{away.length === 1 ? '' : 's'} put away →
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  )
}
