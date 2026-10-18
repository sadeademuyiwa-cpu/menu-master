import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice, refusalNotice } from '@/lib/data/context'
import {
  Card, Field, Submit, InlineSubmit, Notice, Empty, SectionHeading, BackLink, Badge, Disclosure,
} from '@/components/ui'
import { Sparkline } from '@/components/charts'
import { money, percent, saleLabel } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { canSeeCosts, canSeeSellingPrices } from '@/lib/pricing'
import { SALE_ROLES } from '@/app/(app)/dashboard/roles'

export const dynamic = 'force-dynamic'

type Customer = {
  id: string; name: string; company: string | null
  phone: string | null; email: string | null; notes: string | null
}
type Line = {
  order_id: string; order_no: string | null; order_date: string
  is_confirmed: boolean; payment_status: string
  product_name: string | null; format_name: string | null; description: string | null
  /** net_revenue is not selected for kitchen, which sees no money. */
  qty: string; net_revenue?: string
  /** Cost roles only: not even selected for sales and kitchen. */
  cogs?: string | null; gross_profit?: string | null; cost_status?: string
}

/**
 * An update RLS refuses (customers: owner, manager and sales, 0015, and a
 * plan with Sales, 0049) comes back with no error and no rows. Said in words,
 * never reported as done: the role, when it is the role; otherwise the real
 * reason -- the trial ended, a payment failed, the plan has no Sales
 * (refusalNotice) -- instead of "reload and try again", which never helps.
 */
async function notChanged(role: string | null | undefined, action: string): Promise<string> {
  return (SALE_ROLES as readonly string[]).includes(role ?? '')
    ? await refusalNotice(role, { sales: true })
    : `Your role cannot ${action}. Ask the owner, a manager or sales staff.`
}

async function saveCustomer(formData: FormData) {
  'use server'
  const id = String(formData.get('customer_id') ?? '')
  const here = `/customers/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'A customer needs a name.'))

  const { data, error } = await supabase.from('customers').update({
    name,
    company: String(formData.get('company') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
  }).eq('id', id).select('id')
  revalidatePath(here)
  if (!error && (data ?? []).length === 0) redirect(withNotice(here, await notChanged(ctx.role, 'change a customer')))
  redirect(withNotice(here, describeWriteError(error) ?? 'Saved.'))
}

/** Put away, never deleted (0060): every sale keeps pointing at them. */
async function archiveCustomer(formData: FormData) {
  'use server'
  const id = String(formData.get('customer_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('customers')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id')
  if (error) {
    redirect(withNotice(`/customers/${id}`, /deleted_at/.test(error.message)
      ? 'Putting a customer away is not available on this account yet.'
      : describeWriteError(error)))
  }
  if ((data ?? []).length === 0) redirect(withNotice(`/customers/${id}`, await notChanged(ctx.role, 'put a customer away')))
  revalidatePath('/customers')
  redirect(withNotice('/customers', 'Customer put away. Their sales are kept; find them under “Put away” to bring them back.'))
}

const MUTED = { color: 'var(--mm-muted)' } as const
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em]'
/** At most this many sale lines are read for the list and for what was kept. */
const LINE_CAP = 200

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
  // What a customer earned the business is a cost figure: only for the roles
  // that may see costs, and not read at all for anyone else.
  const showCosts = canSeeCosts(ctx.role)
  // What they bought is takings, so it follows the selling-price rule (0064,
  // as on Home and Reports): everyone but kitchen. Kitchen is sent the items
  // and how many sales, no amount at all.
  const takings = canSeeSellingPrices(ctx.role)

  const { data: customer } = await supabase.from('customers')
    .select('id,name,company,phone,email,notes').eq('id', id).maybeSingle<Customer>()
  if (!customer) notFound()

  const [{ data: sales, count: saleCount }, { data: lines, count: lineCount }] = await Promise.all([
    // The headline: one row per confirmed sale, the same read and the same
    // rule as the Customers list (v_orders_attention already leaves out
    // cancelled sales), so both pages give this customer the same total.
    supabase.from('v_orders_attention').select(takings ? 'order_id,net_revenue' : 'order_id', { count: 'exact' })
      .eq('customer_id', id).neq('status', 'draft').limit(5000)
      .returns<{ order_id: string; net_revenue?: string | null }[]>(),
    // The list and what was kept: confirmed lines only, filtered here so
    // drafts do not use up the cap, newest first, and kept together by sale
    // so a cut falls between sales, never inside one.
    supabase.from('v_sale_lines')
      .select('order_id,order_no,order_date,is_confirmed,payment_status,product_name,format_name,description,qty' +
              (takings ? ',net_revenue' : '') + (showCosts ? ',cogs,gross_profit,cost_status' : ''), { count: 'exact' })
      .eq('customer_id', id).eq('is_confirmed', true)
      .order('order_date', { ascending: false }).order('order_id')
      .limit(LINE_CAP).returns<Line[]>(),
  ])

  // A total is shown only when the database sent every sale it holds; a
  // short read would be a short figure dressed as the whole one.
  const salesComplete = Array.isArray(sales) && (saleCount === null || saleCount <= sales.length)
  const saleTotal = takings && salesComplete ? sales.reduce((t, s) => t + Number(s.net_revenue ?? 0), 0) : null
  const salesKnown = salesComplete ? sales.length : null

  // With more lines than the cap, the oldest sale read may be cut part way
  // through its items, so it is dropped, and the list and what was kept say
  // they cover the last N sales, not every sale.
  const read = lines ?? []
  const linesComplete = lineCount === null || lineCount <= read.length
  // (One sale with more items than the cap is kept rather than dropping
  // everything; the heading still says it is not the whole history.)
  const last = read.length ? read[read.length - 1].order_id : null
  const cut = linesComplete || last === null || last === read[0].order_id ? null : last
  const rows = read.filter((l) => l.is_confirmed && l.order_id !== cut)
  const costed = rows.filter((r) => r.cogs !== null && r.cogs !== undefined)
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
  // Their spend, sale by sale, oldest first: a small line, drawn only once
  // there are three sales to draw.
  const spend = takings ? [...orders.values()].reverse().map((items) => ({
    date: items[0].order_date,
    total: items.reduce((t, r) => t + Number(r.net_revenue), 0),
  })).slice(-12) : []
  const lastN = `${orders.size} sale${orders.size === 1 ? '' : 's'}`

  return (
    <div className="space-y-5">
      <BackLink href="/customers">Customers</BackLink>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{customer.name}</h1>
        {(customer.company || customer.phone || customer.email) && (
          <p className="text-sm" style={MUTED}>
            {[customer.company, customer.phone, customer.email].filter(Boolean).join(' · ')}
          </p>
        )}
      </header>
      {notice && <Notice tone={/could not|cannot|needs/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <section className="mm-card space-y-3" aria-label="What they have bought">
        <div className="flex items-end justify-between gap-3">
          {takings ? (
            <div className="min-w-0">
              <div className={LABEL} style={MUTED}>They have bought</div>
              <div className="mm-num mt-1 text-2xl font-semibold">{money(saleTotal, 'not known yet')}</div>
              {salesKnown !== null && (
                <div className="mt-0.5 text-[13px]" style={MUTED}>
                  {salesKnown} confirmed sale{salesKnown === 1 ? '' : 's'}
                </div>
              )}
            </div>
          ) : (
            // Kitchen: how many sales, never how much.
            <div className="min-w-0">
              <div className={LABEL} style={MUTED}>Confirmed sales</div>
              <div className="mm-num mt-1 text-2xl font-semibold">{salesKnown ?? 'not known yet'}</div>
            </div>
          )}
          <Sparkline
            points={spend.map((s) => s.total)} labels={spend.map((s) => formatDay(s.date))}
            ariaLabel={`What ${customer.name} spent on each sale, oldest first.`} width={112} height={36}
            className="shrink-0"
          />
        </div>
        {showCosts && (
          <div className="border-t pt-3" style={{ borderColor: 'var(--mm-line)' }}>
            {/* Kept is summed from the lines read; when those are not every
                sale, it says which sales it covers. */}
            <div className={LABEL} style={MUTED}>{linesComplete ? 'You kept' : `You kept on their last ${lastN}`}</div>
            <div className="mm-num mt-1 text-lg font-semibold" style={{ color: 'var(--mm-accent)' }}>
              {profit === null ? money(null, 'not known yet') : money(profit)}
            </div>
            <div className="mt-0.5 text-[13px]" style={MUTED}>
              {margin === null
                ? 'None of what they bought has a known cost.'
                : `${percent(margin)}${costed.length < rows.length ? ` of ${money(costedRevenue)}, the part with a known cost` : ''}`}
            </div>
          </div>
        )}
      </section>

      {customer.notes && (
        <p className="mm-card text-sm"><span className="font-semibold">Remember: </span>{customer.notes}</p>
      )}

      <section className="space-y-2">
        <SectionHeading sub="Confirmed sales only. Drafts are on the Sales page until you confirm them.">
          {linesComplete ? 'What they have bought' : `Their last ${lastN}`}
        </SectionHeading>
        {orders.size === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ul className="mm-card divide-y divide-[var(--mm-line)] p-0!">
            {[...orders.entries()].map(([orderId, items]) => {
              const total = takings ? items.reduce((t, r) => t + Number(r.net_revenue), 0) : null
              const unknown = showCosts ? items.filter((r) => r.cost_status === 'sold_without_cost').length : 0
              return (
                <li key={orderId}>
                  <Link href={`/sales/${orderId}`} className="flex min-h-[56px] items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {items.map((i) => i.product_name ?? i.description ?? 'item').join(', ')}
                      </span>
                      <span className="block truncate text-sm" style={MUTED}>
                        {formatDay(items[0].order_date)}
                        {saleLabel(items[0].order_no) ? ` · ${saleLabel(items[0].order_no)}` : ''}
                      </span>
                      {unknown > 0 && (
                        <span className="mt-1 block">
                          <Badge tone="warn">{unknown} item{unknown === 1 ? '' : 's'} with no known cost</Badge>
                        </span>
                      )}
                    </span>
                    {total !== null && <span className="mm-num shrink-0 font-semibold">{money(total)}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Card>
        <SectionHeading>Their details</SectionHeading>
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

      <Disclosure summary="Put this customer away">
        <p className="text-sm" style={MUTED}>
          They leave your customer list and the order screen. Every sale they made is kept,
          and you can bring them back from the Customers page.
        </p>
        <form action={archiveCustomer} className="mt-2">
          <input type="hidden" name="customer_id" value={id} />
          <InlineSubmit>Put this customer away</InlineSubmit>
        </form>
      </Disclosure>
    </div>
  )
}
