import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, Notice, Empty, SectionHeading, HeroStat, Badge,
} from '@/components/ui'
import { money, percent, coverageLabel } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Day = {
  sale_date: string
  sale_count: number
  gross_revenue: string | null
  discount_given: string | null
  revenue: string | null
  costed_revenue: string | null
  cogs: string | null
  gross_profit: string | null
  gross_margin_pct: string | null
  cost_coverage_pct: string | null
  revenue_without_cost: string | null
}
type OrderRow = {
  order_id: string
  order_no: string | null
  order_date: string
  status: string
  payment_status: string
  customer_name: string | null
  line_count: number
  net_revenue: string | null
  lines_without_cost: number
  attention: string
  what_to_do: string
}
type Customer = { id: string; name: string }

/** Start a draft. Nothing is revenue and nothing is costed until it is
 *  confirmed, so an abandoned draft affects no report. */
async function startSale(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, '/sales'))

  const customerRaw = String(formData.get('customer_id') ?? '')
  const { data, error } = await supabase.from('orders').insert({
    account_id: accountId,
    business_id: businessId,
    order_date: String(formData.get('order_date') || new Date().toISOString().slice(0, 10)),
    customer_id: customerRaw || null,
    order_no: String(formData.get('order_no') ?? '').trim() || null,
  }).select('id').single()

  if (error || !data) redirect(withNotice('/sales', describeWriteError(error) ?? 'Could not start that sale.'))
  revalidatePath('/sales')
  redirect(`/sales/${data.id}`)
}

/** The plain-English state of an order, decided in PostgreSQL
 *  (v_orders_attention) so this page cannot invent a different one. */
function attentionBadge(a: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  switch (a) {
    case 'empty_draft':         return { label: 'Nothing on it yet', tone: 'muted' }
    case 'draft_not_confirmed': return { label: 'Not confirmed',     tone: 'warn' }
    case 'sold_without_cost':   return { label: 'Cost unknown',      tone: 'warn' }
    case 'unpaid_over_a_week':  return { label: 'Unpaid',            tone: 'warn' }
    default:                    return { label: 'Confirmed',         tone: 'good' }
  }
}

export default async function SalesPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/sales'))

  const today = new Date().toISOString().slice(0, 10)

  const [{ data: days }, { data: orders }, { data: customers }] = await Promise.all([
    supabase.from('v_sales_summary').select('*')
      .order('sale_date', { ascending: false }).limit(14).returns<Day[]>(),
    supabase.from('v_orders_attention').select('*')
      .order('order_date', { ascending: false }).limit(40).returns<OrderRow[]>(),
    supabase.from('customers').select('id,name').order('name').returns<Customer[]>(),
  ])

  const recent = days ?? []
  const todayRow = recent.find((d) => d.sale_date === today) ?? null
  const needsAttention = (orders ?? []).filter((o) => o.attention !== 'ok')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        sub="What you sold, what it cost you, and what you kept."
      />
      {notice && <Notice tone={/could not|cannot|do not/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {/* Today, first, because that is what the owner opened the page for. */}
      <section className="grid gap-0 sm:grid-cols-3 sm:gap-3">
        <HeroStat
          label="Sold today"
          value={todayRow ? money(todayRow.revenue) : money(null, 'nothing yet')}
          sub={todayRow
            ? `${todayRow.sale_count} sale${todayRow.sale_count === 1 ? '' : 's'}`
            : 'Record your first sale of the day below.'}
        />
        <HeroStat
          label="You kept"
          value={todayRow ? money(todayRow.gross_profit, 'not known yet') : money(null, '—')}
          tone="good"
          sub={todayRow ? percent(todayRow.gross_margin_pct) + ' of what you were paid' : undefined}
        />
        <HeroStat
          label="Given away in discounts"
          value={todayRow ? money(todayRow.discount_given) : money(null, '—')}
          sub={todayRow && Number(todayRow.revenue_without_cost) > 0
            ? `${money(todayRow.revenue_without_cost)} of today's sales has no cost recorded`
            : undefined}
        />
      </section>
      {todayRow && (
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          {coverageLabel(todayRow.cost_coverage_pct === null ? null : Number(todayRow.cost_coverage_pct))}.
          Profit is worked out only on the sales whose cost we actually know.
        </p>
      )}

      <Card>
        <SectionHeading sub="Start it here, add what they bought on the next screen, then confirm it.">
          Record a sale
        </SectionHeading>
        <form action={startSale} className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Date">
            <input name="order_date" type="date" defaultValue={today} className="mm-input mt-1" />
          </Field>
          <Field label="Customer (optional)">
            <select name="customer_id" className="mm-input mt-1">
              <option value="">Not recorded</option>
              {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Your reference (optional)">
            <input name="order_no" placeholder="e.g. Sat wedding" className="mm-input mt-1" />
          </Field>
          <div className="flex items-end"><Submit>Start sale</Submit></div>
        </form>
        <p className="mt-3 text-sm">
          <Link href="/customers" className="mm-tap underline">Your customers →</Link>
        </p>
      </Card>

      {needsAttention.length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="These are waiting on you.">Needs your attention</SectionHeading>
          <ul className="space-y-2">
            {needsAttention.map((o) => (
              <li key={o.order_id}>
                <Link href={`/sales/${o.order_id}`} className="block">
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="font-medium">
                        {o.order_no ?? o.order_date}
                        {o.customer_name ? ` · ${o.customer_name}` : ''}
                      </span>
                      <Badge tone={attentionBadge(o.attention).tone}>
                        {attentionBadge(o.attention).label}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                      {o.what_to_do}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading sub="Newest first.">All sales</SectionHeading>
        {!orders?.length ? (
          <Empty>
            No sales recorded yet. Record one above and Menu Master starts telling you
            what you are really making.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => (
              <li key={o.order_id}>
                <Link href={`/sales/${o.order_id}`} className="block">
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="font-medium">
                        {o.order_date}
                        {o.customer_name ? ` · ${o.customer_name}` : ''}
                        {o.order_no ? ` · ${o.order_no}` : ''}
                      </span>
                      <span className="mm-num font-medium">
                        {o.line_count === 0
                          ? <span className="mm-absent">nothing on it yet</span>
                          : money(o.net_revenue)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                      {o.line_count} item{o.line_count === 1 ? '' : 's'}
                      {' · '}
                      {attentionBadge(o.attention).label}
                      {o.lines_without_cost > 0
                        ? ` · ${o.lines_without_cost} without a known cost`
                        : ''}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="The last two weeks of trading.">Day by day</SectionHeading>
          <ul className="space-y-2">
            {recent.map((d) => (
              <li key={d.sale_date}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">{d.sale_date}</span>
                    <span className="mm-num font-medium">{money(d.revenue)}</span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                    Kept {money(d.gross_profit, 'not known')}
                    {' · '}{percent(d.gross_margin_pct)}
                    {Number(d.discount_given) > 0 ? ` · ${money(d.discount_given)} discounted` : ''}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
