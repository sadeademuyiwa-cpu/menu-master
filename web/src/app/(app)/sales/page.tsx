import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement } from '@/lib/data/context'
import { SalesLocked } from '@/components/sales-locked'
import { isSalesLocked } from '@/lib/sales-gate'
import { PageHeader, Card, Notice, Empty, SectionHeading, HeroStat, Badge } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { money, percent, coverageLabel } from '@/lib/format'
import { localToday } from '@/lib/dates'
import { loadPlanOffers } from '@/lib/data/plans'

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

  // Ask the database whether this plan includes Sales, using the same
  // predicate the write policies use. A Costing subscriber was being shown the
  // full Record a Sale form and a Start Sale button that the database was
  // always going to refuse.
  //
  // Null means we could not find out -- the function is absent, or the lookup
  // failed. In that case the page renders as before: showing a button that may
  // fail is better than telling a paying customer they cannot sell. RLS
  // refuses either way, so nothing is protected by guessing.
  const canSell = await hasSalesEntitlement()
  if (isSalesLocked(canSell)) {
    const { data: sub } = await supabase
      .from('subscriptions').select('plan_id').maybeSingle<{ plan_id: string }>()
    const { data: plan } = sub
      ? await supabase.from('plans').select('name').eq('id', sub.plan_id)
          .maybeSingle<{ name: string }>()
      : { data: null }
    const { offers } = await loadPlanOffers(supabase)
    const trading = offers.find((o) => o.tier === 'trading')
    return <SalesLocked planName={plan?.name ?? null} price={trading?.monthly ? money(trading.monthly) : null} />
  }

  const today = localToday()

  const [{ data: days }, { data: orders }] = await Promise.all([
    supabase.from('v_sales_summary').select('*')
      .order('sale_date', { ascending: false }).limit(14).returns<Day[]>(),
    supabase.from('v_orders_attention').select('*')
      .order('order_date', { ascending: false }).limit(40).returns<OrderRow[]>(),
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

      {/* One obvious thing to do here. The order screen takes it from there. */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Link href="/sales/new" className="mm-btn mm-btn-primary w-full text-base">
          <AppIcon name="plus" size={20} /> New sale
        </Link>
        <Link href="/customers" className="mm-btn mm-btn-secondary w-full">
          <AppIcon name="customers" size={18} /> Customers
        </Link>
      </div>

      {/* Today, first, because that is what the owner opened the page for. */}
      <section className="grid gap-0 sm:grid-cols-3 sm:gap-3">
        <HeroStat
          label="Sold today"
          value={todayRow ? money(todayRow.revenue) : money(null, 'nothing yet')}
          sub={todayRow
            ? `${todayRow.sale_count} sale${todayRow.sale_count === 1 ? '' : 's'}`
            : 'Tap New sale to record one.'}
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
        {/* NOT "All sales". v_orders_attention ends `where o.voided_at is null
            and o.status <> 'cancelled'`, so a cancelled sale is deliberately
            absent here -- it keeps its record, its frozen cost and its reason
            under Reports. The heading has to say what the list actually is. */}
        <SectionHeading sub={
          <>Newest first. Cancelled sales are kept under{' '}
            <Link href="/reports" className="mm-inline-tap">Reports &rarr; Voided sales</Link>.</>
        }>Active sales</SectionHeading>
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
