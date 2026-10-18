import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, hasSalesEntitlement, closedLine, recordingOpen } from '@/lib/data/context'
import { SalesLocked } from '@/components/sales-locked'
import { isSalesLocked } from '@/lib/sales-gate'
import { PageHeader, Notice, Empty, SectionHeading, Badge } from '@/components/ui'
import { AppIcon, type IconName } from '@/components/icons'
import { DishTile } from '@/components/dish-tile'
import { WeekBars, Sparkline } from '@/components/charts'
import { money, saleLabel } from '@/lib/format'
import { canSeeCosts, canSeeSellingPrices } from '@/lib/pricing'
import { canRecordSales } from '@/app/(app)/dashboard/roles'
import { localToday, formatDay } from '@/lib/dates'
import { loadPlanOffers } from '@/lib/data/plans'
import { noticeTone } from '@/lib/ui/notice-tone'

export const dynamic = 'force-dynamic'

type Day = {
  sale_date: string
  sale_count: number
  /** Not selected for kitchen, which sees no money. */
  revenue?: string | null
  discount_given?: string | null
  /** Cost roles only: not even selected for sales and kitchen. */
  gross_profit?: string | null
  revenue_without_cost?: string | null
}
type OrderRow = {
  order_id: string
  order_no: string | null
  order_date: string
  status: string
  payment_status: string
  customer_name: string | null
  line_count: number
  /** Not selected for kitchen, which sees no money. */
  net_revenue?: string | null
  attention: string
  what_to_do: string
}
type LineRow = { order_id: string; recipe_id: string | null; product_name: string | null; description: string | null; qty: string }

/** The plain-English state of an order that needs the owner, decided in
 *  PostgreSQL (v_orders_attention) so this page cannot invent a different one. */
function attentionBadge(a: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  switch (a) {
    case 'empty_draft':         return { label: 'Nothing on it yet', tone: 'muted' }
    case 'draft_not_confirmed': return { label: 'Not confirmed',     tone: 'warn' }
    case 'sold_without_cost':   return { label: 'Cost unknown',      tone: 'warn' }
    case 'unpaid_over_a_week':  return { label: 'Unpaid',            tone: 'warn' }
    default:                    return { label: 'Confirmed',         tone: 'good' }
  }
}

/** One badge per row: a draft says so; a sale says how it was paid. */
function rowBadge(o: OrderRow): { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  if (o.status === 'draft') return o.line_count === 0 ? attentionBadge('empty_draft') : attentionBadge('draft_not_confirmed')
  if (o.payment_status === 'paid') return { label: 'Paid', tone: 'good' }
  if (o.payment_status === 'part_paid') return { label: 'Part paid', tone: 'muted' }
  return o.attention === 'unpaid_over_a_week' ? attentionBadge('unpaid_over_a_week') : { label: 'Not paid', tone: 'muted' }
}

/** The n calendar days ending on `today` (YYYY-MM-DD), oldest first. */
function lastDays(today: string, n: number): string[] {
  const [y, m, d] = today.split('-').map(Number)
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10))
}
const weekday = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

const MUTED = { color: 'var(--mm-muted)' } as const
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em]'

export default async function SalesPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string; q?: string; all?: string }> }) {
  const { notice, q = '', all = '' } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
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
  // After a trial (or a lapsed plan) Sales is off because the account is
  // closed, not because the plan lacks it: fn_account_has_sales needs an
  // entitled account. Such an account keeps its own sales list, read only,
  // under the paused line below; the "plan does not include Sales" page is
  // for an open Costing plan only. An unknown verdict (null) keeps today's page.
  const open = await recordingOpen()
  if (isSalesLocked(canSell) && open !== false) {
    const { data: sub } = await supabase
      .from('subscriptions').select('plan_id').maybeSingle<{ plan_id: string }>()
    const { data: plan } = sub
      ? await supabase.from('plans').select('name').eq('id', sub.plan_id)
          .maybeSingle<{ name: string }>()
      : { data: null }
    const { offers } = await loadPlanOffers(supabase)
    const trading = offers.find((o) => o.tier === 'trading')
    // The web's billing safety switch (X4): only the exact "on" makes a plan
    // switch self-serve. The same rule as billing's billingSelfServe()
    // (lib/site/billing-words.ts on that branch), read here on the server.
    const selfServe = process.env.BILLING_SELF_SERVE === 'on'
    return (
      <SalesLocked planName={plan?.name ?? null} price={trading?.monthly ? money(trading.monthly) : null}
                   selfServe={selfServe} />
    )
  }

  // What was kept is a cost figure: read only for the roles that may see
  // costs. A sales or kitchen phone gets what was sold, never what it cost.
  const showCosts = canSeeCosts(ctx.role)
  // Money taken is selling prices times plates, so it follows the
  // selling-price rule, as on Home and Reports: everyone but kitchen. For
  // kitchen the money columns are not selected at all; it sees what was sold
  // and how many sales, never how much.
  const takings = canSeeSellingPrices(ctx.role)
  // Only the roles the database lets record a sale (0015) get the button,
  // and only while recording is open: after a trial the order screen would
  // only be refused (D3), so the button gives way to one line saying why.
  // Only an explicit false closes it; a lookup that fails keeps the button.
  // When closed, whether the plan has Sales cannot be told apart from the
  // closure itself, so the role alone decides who is told why (D3).
  const seller = canRecordSales(ctx.role, open === false ? null : canSell)
  const records = seller && open !== false
  const paused = seller && !records
    ? await closedLine(ctx.role, 'new sales can’t be recorded, though money for a sale already confirmed can still be recorded on that sale')
    : null
  const today = localToday()
  const week = lastDays(today, 7)

  const limit = all ? 1000 : 40
  let dayQuery = supabase.from('v_sales_summary')
    .select(showCosts ? 'sale_date,sale_count,revenue,discount_given,gross_profit,revenue_without_cost'
      : takings ? 'sale_date,sale_count,revenue,discount_given'
      : 'sale_date,sale_count')
    .gte('sale_date', week[0]).lte('sale_date', today)
  if (businessId) dayQuery = dayQuery.eq('business_id', businessId)
  const [{ data: days }, { data: orderRows }, { data: biz }] = await Promise.all([
    dayQuery.returns<Day[]>(),
    supabase.from('v_orders_attention')
      .select('order_id,order_no,order_date,status,payment_status,customer_name,line_count,' +
              (takings ? 'net_revenue,' : '') + 'attention,what_to_do')
      .order('order_date', { ascending: false }).limit(limit + 1).returns<OrderRow[]>(),
    businessId
      ? supabase.from('businesses').select('type').eq('id', businessId).maybeSingle<{ type: string | null }>()
      : Promise.resolve({ data: null }),
  ])

  const dayOf = new Map((days ?? []).map((d) => [d.sale_date, d]))
  const todayRow = dayOf.get(today) ?? null
  const term = q.trim().toLowerCase()
  const more = (orderRows ?? []).length > limit
  // "Cost unknown" is the owner's to fix; a helper cannot, so it is not
  // put in front of them.
  const rows = (orderRows ?? []).slice(0, limit).map((o) =>
    !showCosts && o.attention === 'sold_without_cost' ? { ...o, attention: 'ok' } : o)
  const orders = rows.filter((o) => !term
    || (o.customer_name ?? '').toLowerCase().includes(term)
    || (saleLabel(o.order_no) ?? '').toLowerCase().includes(term)
    || formatDay(o.order_date).toLowerCase().includes(term))
  // Each sale shows once: waiting on the owner, or in the list below.
  const needsAttention = term ? [] : orders.filter((o) => o.attention !== 'ok')
  const listed = term ? orders : orders.filter((o) => o.attention === 'ok')

  // What was on each sale, for its picture and a one-line summary. Only the
  // dish names and quantities; no price or cost is read here.
  const ids = orders.map((o) => o.order_id)
  const { data: lineRows } = ids.length
    ? await supabase.from('v_sale_lines').select('order_id,recipe_id,product_name,description,qty')
        .in('order_id', ids).limit(2000).returns<LineRow[]>()
    : { data: [] as LineRow[] }
  const linesOf = new Map<string, LineRow[]>()
  for (const l of lineRows ?? []) linesOf.set(l.order_id, [...(linesOf.get(l.order_id) ?? []), l])
  const recipeIds = [...new Set((lineRows ?? []).map((l) => l.recipe_id).filter((r): r is string => !!r))]
  // Before 0063 there is no photo_path; the query errors and every dish
  // simply shows its tile.
  const { data: photos } = recipeIds.length
    ? await supabase.from('recipes').select('id,photo_path').in('id', recipeIds)
        .returns<{ id: string; photo_path: string | null }[]>()
    : { data: [] as { id: string; photo_path: string | null }[] }
  const photoOf = new Map((photos ?? []).map((p) => [p.id, p.photo_path]))

  // Price per head comes first for a caterer: an event is priced before it is sold.
  const tiles: { href: string; icon: IconName; label: string }[] = [
    { href: '/customers', icon: 'customers', label: 'Customers' },
    { href: '/quote', icon: 'pricing', label: 'Price per head' },
  ]
  if (biz?.type === 'caterer') tiles.reverse()

  const weekDays = week.map((d) => {
    const row = dayOf.get(d)
    return {
      label: weekday(d),
      // Null when nothing was recorded that day, or when revenue was not
      // read at all (kitchen): a missing figure, never a zero.
      sold: row && row.revenue !== null && row.revenue !== undefined ? Number(row.revenue) : null,
      kept: row && row.gross_profit !== null && row.gross_profit !== undefined ? Number(row.gross_profit) : null,
    }
  })
  const daysWithSales = weekDays.filter((d) => d.sold !== null && d.sold > 0).length
  const weekSold = weekDays.reduce((t, d) => t + (d.sold ?? 0), 0)
  const noCost = todayRow && Number(todayRow.revenue_without_cost ?? 0) > 0 ? Number(todayRow.revenue_without_cost) : 0

  const row = (o: OrderRow, sub?: string) => {
    const items = linesOf.get(o.order_id) ?? []
    const first = items.find((i) => i.recipe_id) ?? items[0]
    const firstName = first ? (first.product_name ?? first.description ?? 'Item') : (o.customer_name ?? 'Sale')
    const summary = items.map((i) => `${i.product_name ?? i.description ?? 'Item'} ×${Number(i.qty).toLocaleString('en-NG')}`).join(', ')
    const badge = rowBadge(o)
    return (
      <li key={o.order_id}>
        <Link href={`/sales/${o.order_id}`} className="flex min-h-[64px] items-center gap-3 px-3 py-2.5">
          <DishTile name={firstName} photoPath={first?.recipe_id ? photoOf.get(first.recipe_id) : null} size="xs" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {summary || o.customer_name || saleLabel(o.order_no) || 'Sale'}
            </span>
            {/* What to do is a sentence the owner must read whole; the date line can be cut. */}
            <span className={`block text-sm ${sub ? 'line-clamp-2' : 'truncate'}`} style={MUTED}>
              {sub ?? [formatDay(o.order_date), o.customer_name, saleLabel(o.order_no)].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {/* An empty draft has no amount; its badge already says so. */}
            {takings && o.line_count > 0 && <span className="mm-num font-semibold">{money(o.net_revenue)}</span>}
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
        </Link>
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales"
        sub={showCosts ? 'What you sold, what it cost you, and what you kept.' : 'What you sold, day by day.'}
      />
      {notice && <Notice tone={noticeTone(notice)}>{notice}</Notice>}

      {/* One obvious thing to do here. The order screen takes it from there. */}
      {records && (
        <Link href="/sales/new" className="mm-btn mm-btn-primary w-full">
          <AppIcon name="plus" size={20} /> New sale
        </Link>
      )}
      {paused && !notice && <Notice tone="warn">{paused}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="mm-action-tile">
            <span className="mm-action-icon"><AppIcon name={t.icon} size={21} /></span>
            <span className="min-w-0 font-semibold leading-tight">{t.label}</span>
          </Link>
        ))}
      </div>

      {/* Today first, because that is what the owner opened the page for.
          With nothing sold today it is one line: no "Nothing yet" figures and
          no hint repeating the New sale button just above it. */}
      <section className="mm-card space-y-4" aria-label="Today">
        {!todayRow ? (
          <p className="text-sm" style={MUTED}>No sales today.</p>
        ) : !takings ? (
          // Kitchen: how many sales, never how much.
          <p className="font-semibold">
            {todayRow.sale_count} sale{todayRow.sale_count === 1 ? '' : 's'} today
          </p>
        ) : (
          <div className={showCosts ? 'grid grid-cols-2 gap-3' : ''}>
            <div className="min-w-0">
              <div className={LABEL} style={MUTED}>Sold today</div>
              <div className="mm-num mt-1 text-2xl font-semibold">{money(todayRow.revenue)}</div>
              <div className="mt-0.5 text-[13px]" style={MUTED}>
                {todayRow.sale_count} sale{todayRow.sale_count === 1 ? '' : 's'}
              </div>
            </div>
            {showCosts && (
              <div className="min-w-0">
                <div className={LABEL} style={MUTED}>Kept today</div>
                <div className="mm-num mt-1 text-2xl font-semibold" style={{ color: 'var(--mm-accent)' }}>
                  {money(todayRow.gross_profit, 'not known yet')}
                </div>
                {noCost > 0 && (
                  <div className="mt-0.5 text-[13px]" style={MUTED}>{money(noCost)} of it has no cost yet</div>
                )}
              </div>
            )}
          </div>
        )}

        {showCosts ? (
          <WeekBars days={weekDays} ariaLabel="Sold and kept, each day for the last seven days." empty={null} />
        ) : takings && daysWithSales >= 3 ? (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className={`block ${LABEL}`} style={MUTED}>Last seven days</span>
              <span className="mm-num block font-semibold">{money(weekSold)}</span>
            </span>
            {/* A day with no sales recorded is a gap, never a drop to ₦0: the
                app knows nothing was entered, not that nothing was taken. */}
            <Sparkline
              points={weekDays.map((d) => d.sold)} labels={weekDays.map((d) => d.label)}
              ariaLabel="Money taken each day for the last seven days. A gap is a day with no sales."
              width={128} height={36}
            />
          </div>
        ) : null}

        {takings && todayRow && Number(todayRow.discount_given) > 0 && (
          <p className="text-sm" style={MUTED}>Given away in discounts today: {money(todayRow.discount_given)}</p>
        )}
      </section>

      {needsAttention.length > 0 && (
        <section className="space-y-2">
          <SectionHeading sub="These are waiting on you.">Needs your attention</SectionHeading>
          <ul className="mm-card divide-y divide-[var(--mm-line)] p-0!">
            {needsAttention.map((o) => row(o, o.what_to_do))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        {/* NOT "All sales". v_orders_attention ends `where o.voided_at is null
            and o.status <> 'cancelled'`, so a cancelled sale is deliberately
            absent here -- it keeps its record, its frozen cost and its reason
            under Reports. The heading has to say what the list actually is. */}
        <SectionHeading sub={
          <>Newest first. Cancelled sales are kept under{' '}
            <Link href="/reports" className="mm-inline-tap">Reports &rarr; Cancelled sales</Link>.</>
        }>Recent sales</SectionHeading>
        {((orderRows ?? []).length > 6 || term) && (
          <form method="get" className="flex gap-2">
            {all && <input type="hidden" name="all" value="1" />}
            <input name="q" defaultValue={q} placeholder="Find by customer, number or date"
              aria-label="Find a sale" className="mm-input flex-1" />
            <button className="mm-btn mm-btn-secondary" type="submit">Find</button>
          </form>
        )}
        {!orders.length ? (
          <Empty>
            {term
              ? <>Nothing matches “{q}”. <Link href="/sales" className="underline">Show all</Link></>
              : records ? <>No sales recorded yet. Tap New sale to record one.</> : <>No sales recorded yet.</>}
          </Empty>
        ) : listed.length > 0 ? (
          <ul className="mm-card divide-y divide-[var(--mm-line)] p-0!">
            {listed.map((o) => row(o))}
          </ul>
        ) : null}
        {more && !all && (
          <p className="text-sm">
            <Link href={`/sales?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="mm-tap underline">
              Show older sales →
            </Link>
          </p>
        )}
      </section>
    </div>
  )
}
