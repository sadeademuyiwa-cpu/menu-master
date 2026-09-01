import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, Notice, Empty, SectionHeading,
  BackLink, Stat, StatRow, Badge,
} from '@/components/ui'
import { money, percent } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Customer = {
  id: string; name: string; company: string | null
  phone: string | null; email: string | null; notes: string | null
}
type Line = {
  order_id: string; order_no: string | null; order_date: string
  is_confirmed: boolean; payment_status: string
  product_name: string | null; format_name: string | null; description: string | null
  qty: string; net_revenue: string; cogs: string | null; gross_profit: string | null
  cost_status: string
}

async function saveCustomer(formData: FormData) {
  'use server'
  const id = String(formData.get('customer_id') ?? '')
  const here = `/customers/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'A customer needs a name.'))

  const { error } = await supabase.from('customers').update({
    name,
    company: String(formData.get('company') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
  }).eq('id', id)
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Saved.'))
}

export default async function CustomerDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await params
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/customers'))

  const { data: customer } = await supabase.from('customers')
    .select('id,name,company,phone,email,notes').eq('id', id).maybeSingle<Customer>()
  if (!customer) notFound()

  const { data: lines } = await supabase.from('v_sale_lines')
    .select('order_id,order_no,order_date,is_confirmed,payment_status,product_name,' +
            'format_name,description,qty,net_revenue,cogs,gross_profit,cost_status')
    .eq('customer_id', id)
    .order('order_date', { ascending: false }).limit(200).returns<Line[]>()

  const rows = (lines ?? []).filter((l) => l.is_confirmed)
  const revenue = rows.reduce((t, r) => t + Number(r.net_revenue), 0)
  const costed = rows.filter((r) => r.cogs !== null)
  // Profit over the costed part only, and the page says which part that is.
  const costedRevenue = costed.reduce((t, r) => t + Number(r.net_revenue), 0)
  const cogs = costed.reduce((t, r) => t + Number(r.cogs), 0)
  const profit = costed.length ? costedRevenue - cogs : null
  const margin = profit !== null && costedRevenue !== 0 ? (100 * profit) / costedRevenue : null

  const orders = new Map<string, Line[]>()
  for (const l of rows) {
    const list = orders.get(l.order_id) ?? []
    list.push(l)
    orders.set(l.order_id, list)
  }

  return (
    <div className="space-y-6">
      <BackLink href="/customers">← All customers</BackLink>
      <PageHeader
        title={customer.name}
        sub={[customer.company, customer.phone, customer.email].filter(Boolean).join(' · ') || undefined}
      />
      {notice && <Notice tone={/could not|cannot|needs/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <StatRow>
        <Stat label="They have bought" value={money(revenue)}
              sub={`${orders.size} confirmed sale${orders.size === 1 ? '' : 's'}`} />
        <Stat label="You kept" value={profit === null ? money(null, 'not known yet') : money(profit)}
              sub={margin === null
                ? 'None of what they bought has a known cost.'
                : `${percent(margin)} of ${money(costedRevenue)}${
                    costed.length < rows.length ? ' — the part with a known cost' : ''}`} />
        <Stat label="Remember" value={customer.notes ?? <span className="mm-absent">nothing noted</span>} />
      </StatRow>

      <section className="space-y-3">
        <SectionHeading sub="Confirmed sales only. Drafts are on the Sales page until you confirm them.">
          What they have bought
        </SectionHeading>
        {orders.size === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {[...orders.entries()].map(([orderId, items]) => {
              const total = items.reduce((t, r) => t + Number(r.net_revenue), 0)
              const unknown = items.filter((r) => r.cost_status === 'sold_without_cost').length
              return (
                <li key={orderId}>
                  <Link href={`/sales/${orderId}`} className="block">
                    <Card>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="font-medium">
                          {items[0].order_date}
                          {items[0].order_no ? ` · ${items[0].order_no}` : ''}
                        </span>
                        <span className="mm-num font-medium">{money(total)}</span>
                      </div>
                      <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                        {items.map((i) => i.product_name ?? i.description ?? 'item').join(', ')}
                      </div>
                      {unknown > 0 && (
                        <div className="mt-2">
                          <Badge tone="warn">{unknown} item{unknown === 1 ? '' : 's'} with no known cost</Badge>
                        </div>
                      )}
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Card>
        <SectionHeading sub="Change what you keep about them.">Their details</SectionHeading>
        <form action={saveCustomer} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="customer_id" value={id} />
          <Field label="Name">
            <input name="name" defaultValue={customer.name} className="mm-input mt-1" />
          </Field>
          <Field label="Company">
            <input name="company" defaultValue={customer.company ?? ''} className="mm-input mt-1" />
          </Field>
          <Field label="Phone">
            <input name="phone" inputMode="tel" defaultValue={customer.phone ?? ''} className="mm-input mt-1" />
          </Field>
          <Field label="Email">
            <input name="email" type="email" defaultValue={customer.email ?? ''} className="mm-input mt-1" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Anything to remember">
              <input name="notes" defaultValue={customer.notes ?? ''} className="mm-input mt-1" />
            </Field>
          </div>
          <div className="flex items-end"><Submit>Save</Submit></div>
        </form>
      </Card>
    </div>
  )
}
