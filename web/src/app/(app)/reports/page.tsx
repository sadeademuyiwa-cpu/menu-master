import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { PageHeader, Card, Empty, DataList, Disclosure, BackLink, SectionHeading } from '@/components/ui'
import { money, percent, saleLabel, NOT_ENTERED } from '@/lib/format'
import { formatDay, formatMoment, localToday } from '@/lib/dates'
import { parentTab } from '@/lib/nav'
import { canSeeCosts, canSeeSellingPrices } from '@/lib/pricing'
import { MonthBars } from './month-bars'
import { DishBars } from './dish-bars'
import {
  num, monthOf, pickMonth, monthRange, monthName, monthChoices, monthDays, saleCount, dishBars,
  coverageOf, coveragePercent, coverageNote,
  type DayRow,
} from './report-data'
import Loading from './skeleton'
import '../recipes/_list/lists.css'

export const dynamic = 'force-dynamic'

/** v_profit_by_period, one row a month. The money columns are read only by the roles that may see them. */
type ByPeriod = {
  period: string
  revenue?: number | string | null
  costed_revenue?: number | string | null
  gross_profit?: number | string | null
  gross_margin_pct?: number | string | null
  cost_coverage_pct?: number | string | null
  revenue_without_cost?: number | string | null
}
type ByProduct = {
  recipe_id: string
  name: string
  units_sold: number | string | null
  revenue?: number | string | null
  costed_revenue?: number | string | null
  gross_profit?: number | string | null
  gross_margin_pct?: number | string | null
  cost_coverage_pct?: number | string | null
}
type Voided = {
  record_id: string
  reference: string | null
  sale_date: string | null
  voided_at: string | null
  void_reason: string | null
  /** Who cancelled it. v_voided_sales has always carried these two; nothing
   *  selected them, so the audit trail was less complete on screen than it was
   *  in the database. */
  voided_by: string | null
  /** The sale issued to replace it, if one was. */
  replaced_by: string | null
}

/**
 * A dish's money with no known cost, or null when either figure is missing.
 * v_profit_by_product has no such column; only whether it is above zero is
 * used, to keep the dish's coverage from reading 100% when it is not.
 */
function uncostedOf(r: ByProduct): number | null {
  const sold = num(r.revenue)
  const costed = num(r.costed_revenue)
  return sold === null || costed === null ? null : sold - costed
}

/** How many dishes the chart draws; the rest are in the figures one tap below. */
const TOP_DISHES = 8

/**
 * Charts first, the tables one tap away.
 *
 * What each role is SENT, decided here so nothing else leaves the server:
 *   owner, manager, accountant   sold and kept, by day and by dish
 *   sales                        what came in, by day and by dish; no cost,
 *                                no kept, no margin
 *   kitchen                      how many were sold; no money at all
 * The views (security_invoker) would hand a sales member the cost columns if
 * they were asked for, so they are never asked for.
 *
 * Revenue always counts. Kept is worked out only over the sales whose cost
 * was known when they were made -- counting the rest as pure profit would
 * flatter the figure exactly where least is known -- and the page says, in
 * one sentence, how much of the month that covers.
 */
async function ReportsPageBody({ m }: { m: string }) {
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, '/reports'))
  const { supabase, userId, role } = ctx
  const costs = canSeeCosts(role)
  const takings = costs || canSeeSellingPrices(role)

  const today = localToday()
  const thisMonth = monthOf(today)
  const month = pickMonth(m, thisMonth)
  const range = monthRange(month)

  const [{ data: byPeriod }, { data: days }, { data: byProduct }, { data: voided }] = await Promise.all([
    supabase.from('v_profit_by_period')
      .select(costs
        ? 'period,revenue,costed_revenue,gross_profit,gross_margin_pct,cost_coverage_pct,revenue_without_cost'
        : takings ? 'period,revenue' : 'period')
      .order('period', { ascending: false }).limit(12).returns<ByPeriod[]>(),
    supabase.from('v_sales_summary')
      .select(costs ? 'sale_date,sale_count,revenue,gross_profit' : takings ? 'sale_date,sale_count,revenue' : 'sale_date,sale_count')
      .gte('sale_date', range.start).lte('sale_date', range.end).returns<DayRow[]>(),
    supabase.from('v_profit_by_product')
      .select(costs
        ? 'recipe_id,name,units_sold,revenue,costed_revenue,gross_profit,gross_margin_pct,cost_coverage_pct'
        : takings ? 'recipe_id,name,units_sold,revenue' : 'recipe_id,name,units_sold')
      .order(costs ? 'gross_profit' : takings ? 'revenue' : 'units_sold', { ascending: false, nullsFirst: false })
      .limit(50).returns<ByProduct[]>(),
    supabase.from('v_voided_sales')
      .select('record_id,reference,sale_date,voided_at,void_reason,voided_by,replaced_by')
      .order('voided_at', { ascending: false }).limit(20).returns<Voided[]>(),
  ])

  const periods = byPeriod ?? []
  const products = byProduct ?? []
  const cancelled = voided ?? []
  const choices = monthChoices(periods.map((p) => p.period), thisMonth)
  const name = monthName(month, thisMonth)
  const soFar = month === thisMonth
  const row = periods.find((p) => monthOf(p.period) === month)
  const dayRows = days ?? []
  const sales = saleCount(dayRows)
  const sold = num(row?.revenue)
  const kept = num(row?.gross_profit)
  const coverage = num(row?.cost_coverage_pct)
  const withoutCost = num(row?.revenue_without_cost)
  const covered = coverageOf(kept, withoutCost, coverage)
  const tab = parentTab('/reports')

  const bars = dishBars(products.map((p) => ({
    id: p.recipe_id,
    name: p.name,
    value: num(costs ? p.gross_profit : takings ? p.revenue : p.units_sold),
  })), TOP_DISHES)

  return (
    <div className="space-y-6">
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader
        title="Reports"
        sub="Money in always counts. What you kept is worked out only over the sales whose cost was known at the time, so it never looks better than it is."
      />

      {choices.length > 1 && (
        <nav className="mm-chips" aria-label="Choose a month">
          {choices.map((c) => (
            <Link key={c} href={c === thisMonth ? '/reports' : `/reports?m=${c}`} className="mm-chip"
              aria-current={c === month ? 'page' : undefined}>
              {monthName(c, thisMonth)}
            </Link>
          ))}
        </nav>
      )}

      {/* THE MONTH ---------------------------------------------------------- */}
      <Card>
        <section className="space-y-4" aria-label={`${name}${soFar ? ' so far' : ''}`}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--mm-muted)' }}>
              {name}{soFar ? ' so far' : ''}
            </p>
            {sales === 0 ? (
              <p className="mt-1 text-lg font-semibold">No sales recorded{soFar ? ' yet' : ''}.</p>
            ) : costs ? (
              <>
                {kept !== null ? (
                  <p className="mm-num mt-1 text-3xl font-bold tracking-tight" style={{ color: 'var(--mm-accent-strong)' }}>
                    {money(kept)} <span className="text-base font-semibold" style={{ color: 'var(--mm-fg)' }}>kept</span>
                  </p>
                ) : (
                  <p className="mt-1 text-lg font-semibold">Kept: <span className="mm-absent">not known yet</span></p>
                )}
                <p className="mm-num mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                  from {money(sold)} sold · {sales} sale{sales === 1 ? '' : 's'}
                </p>
              </>
            ) : takings ? (
              <>
                <p className="mm-num mt-1 text-3xl font-bold tracking-tight">
                  {money(sold)} <span className="text-base font-semibold">sold</span>
                </p>
                <p className="mm-num mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{sales} sale{sales === 1 ? '' : 's'}</p>
              </>
            ) : (
              <p className="mm-num mt-1 text-3xl font-bold tracking-tight">
                {sales} <span className="text-base font-semibold">sale{sales === 1 ? '' : 's'}</span>
              </p>
            )}
          </div>

          {takings && sales > 0 && (
            <MonthBars
              days={monthDays(dayRows, month, costs)}
              withKept={costs}
              ariaLabel={costs ? `Sold and kept, each day of ${name}.` : `Sold, each day of ${name}.`}
              empty={<p className="text-sm" style={{ color: 'var(--mm-muted)' }}>Record sales on three days and the month shows here as a chart.</p>}
            />
          )}

          {costs && sales > 0 && sold !== null && sold > 0 && (
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
              {covered === 'all'
                ? `Every sale in ${name} had a known cost.`
                : covered === 'none'
                  ? `No sale in ${name} had a known cost yet, so what you kept is not known.`
                  : withoutCost !== null
                    ? `Kept covers ${coveragePercent(coverage, covered, 'part')} of what you sold; ${money(withoutCost)} of sales had no known cost yet.`
                    : `Kept covers ${coveragePercent(coverage, covered, 'part')} of what you sold.`}
            </p>
          )}
        </section>
      </Card>

      {/* BY DISH ------------------------------------------------------------ */}
      <section className="space-y-3">
        <div>
          <SectionHeading>By dish</SectionHeading>
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            {costs ? 'What each dish kept' : takings ? 'What each dish brought in' : 'How many of each were sold'}, since you started.
          </p>
        </div>
        {bars.length === 0 ? (
          <Empty>No dish sold yet.</Empty>
        ) : (
          <Card>
            <DishBars
              bars={bars}
              kind={costs ? 'kept' : takings ? 'sold' : 'units'}
              ariaLabel={costs ? 'What each dish kept, since you started.' : takings ? 'What each dish brought in, since you started.' : 'How many of each dish were sold, since you started.'}
            />
            {products.length > bars.length && (
              <p className="mt-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                Your top {bars.length}. Every dish is in the figures below.
              </p>
            )}
          </Card>
        )}
      </section>

      {/* THE FIGURES, ONE TAP AWAY ------------------------------------------- */}
      {(periods.length > 0 || products.length > 0) && (
        <Disclosure summary="See the figures">
          <div className="space-y-5">
            {takings && periods.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">By month</h3>
                <DataList
                  rows={periods}
                  keyOf={(r) => r.period}
                  empty="No sales recorded yet."
                  render={(r) => costs ? [
                    { label: 'Month', value: monthName(monthOf(r.period), thisMonth) },
                    { label: 'Money in', value: money(r.revenue) },
                    { label: 'Of that, with a known cost', value: money(r.costed_revenue) },
                    { label: 'Money kept', value: money(r.gross_profit) },
                    { label: 'Margin', value: percent(r.gross_margin_pct) },
                    { label: 'Sales with a known cost', value: coverageNote(num(r.cost_coverage_pct),
                      coverageOf(num(r.gross_profit), num(r.revenue_without_cost), num(r.cost_coverage_pct))) },
                    { label: 'Money in with no known cost', value: money(r.revenue_without_cost) },
                  ] : [
                    { label: 'Month', value: monthName(monthOf(r.period), thisMonth) },
                    { label: 'Money in', value: money(r.revenue) },
                  ]}
                />
              </section>
            )}
            {products.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">By dish</h3>
                <DataList
                  rows={products}
                  keyOf={(r) => r.recipe_id}
                  empty="No dish sold yet."
                  render={(r) => [
                    { label: 'Dish', value: r.name },
                    // No `?? 0` here. An absent figure says so; it is never a zero.
                    { label: 'Units sold', value: num(r.units_sold)?.toLocaleString('en-NG') ?? NOT_ENTERED },
                    ...(takings ? [{ label: 'Money in', value: money(r.revenue) }] : []),
                    ...(costs ? [
                      { label: 'Money kept', value: money(r.gross_profit) },
                      { label: 'Margin', value: percent(r.gross_margin_pct) },
                      { label: 'Sales with a known cost', value: coverageNote(num(r.cost_coverage_pct),
                        coverageOf(num(r.gross_profit), uncostedOf(r), num(r.cost_coverage_pct))) },
                    ] : []),
                  ]}
                />
              </section>
            )}
          </div>
        </Disclosure>
      )}

      {/* CANCELLED SALES ------------------------------------------------------ */}
      {cancelled.length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub="Corrections are made by cancelling and reissuing, never by editing history, so nothing disappears without a trace.">
            Cancelled sales
          </SectionHeading>
          <ul className="space-y-2 text-sm">
            {cancelled.map((v) => (
              <li key={v.record_id}>
                <Card>
                  <p>
                    <Link href={`/sales/${v.record_id}`} className="mm-inline-tap font-medium">
                      {saleLabel(v.reference) ?? `Sale of ${formatDay(v.sale_date).toLowerCase()}`}
                    </Link>
                  </p>
                  <p className="mm-absent">
                    {formatDay(v.sale_date)} · cancelled {formatMoment(v.voided_at)} · {v.void_reason ?? 'no reason given'}
                  </p>
                  <p className="mm-absent">
                    {v.voided_by
                      ? (v.voided_by === userId
                          ? 'cancelled by you'
                          : 'cancelled by another user on this account')
                      : 'no record of who cancelled it'}
                    {' · '}
                    {v.replaced_by
                      ? <Link href={`/sales/${v.replaced_by}`} className="mm-inline-tap">see the sale that replaced it</Link>
                      : 'not replaced'}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default async function ReportsPage(props: { searchParams: Promise<{ m?: string }> }) {
  const { m = '' } = await props.searchParams
  return <Suspense fallback={<Loading />}><ReportsPageBody m={m} /></Suspense>
}
