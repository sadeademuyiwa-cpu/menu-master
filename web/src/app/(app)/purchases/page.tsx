import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, closedLine, recordingOpen } from '@/lib/data/context'
import { PageHeader, Notice, Empty, SectionHeading } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { Sparkline } from '@/components/charts'
import { money, purchaseReference } from '@/lib/format'
import { formatDay, localToday } from '@/lib/dates'
import { canSeeCosts } from '@/lib/pricing'
import { canRecordPurchases } from './buy-roles'
import { dayShort, groupByDay, lastWeeks, monthStart, nameList, spendByWeek, sumMoney } from './buy-figures'
import './buy.css'

export const dynamic = 'force-dynamic'

type Row = {
  purchase_id: string; purchase_date: string; status: string
  reference: string | null; supplier_name: string | null
  line_count: number
  /** Selected only for a role that may see costs. */
  total_amount?: string | null
}

/** Weeks in the spend line on the month card. */
const WEEKS = 8

export default async function PurchasesPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string; q?: string; all?: string }> }) {
  const { notice, q = '', all = '' } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/purchases'))

  // What was paid is a cost: it is what every ingredient price is worked out
  // from. The database lets every member read purchase lines, so the gate is
  // here, on the server: for sales and kitchen no amount is selected at all.
  const costs = canSeeCosts(ctx.role)
  // Only an explicit false closes (a lookup that fails keeps the button).
  const open = await recordingOpen()
  const canRecord = canRecordPurchases(ctx.role) && open !== false
  const paused = canRecordPurchases(ctx.role) && !canRecord
    ? await closedLine(ctx.role, 'new purchases can’t be recorded')
    : null
  const today = localToday()
  const weeks = lastWeeks(today, WEEKS)
  const month = monthStart(today)
  const spendFrom = weeks[0] < month ? weeks[0] : month

  const limit = all ? 1000 : 50
  const [{ data: rows }, { data: spend }] = await Promise.all([
    // v_purchase_summary (0035). purchase_lines carries two foreign keys to
    // both ingredients and purchases, so an unhinted PostgREST embed returns
    // PGRST201 and the list silently renders zero items. The view resolves the
    // joins in SQL and sums the amounts in PostgreSQL, where money belongs.
    // fn_reverse_purchase files its bookkeeping twin as a second, empty
    // purchase pointing back (reverses). The cancelled original already says
    // "Cancelled"; the twin only read as "Cancelled · 0 items", so it is left out.
    supabase.from('v_purchase_summary')
      .select(costs
        ? 'purchase_id,purchase_date,status,reference,supplier_name,line_count,total_amount'
        : 'purchase_id,purchase_date,status,reference,supplier_name,line_count')
      .is('reverses', null)
      .order('purchase_date', { ascending: false }).limit(limit + 1).returns<Row[]>(),
    costs
      ? supabase.from('v_purchase_summary').select('purchase_date,total_amount')
          .eq('status', 'posted').is('reverses', null).gte('purchase_date', spendFrom)
          .returns<{ purchase_date: string; total_amount: string | null }[]>()
      : Promise.resolve({ data: null }),
  ])

  const listed = (rows ?? []).slice(0, limit)
  const more = (rows ?? []).length > limit

  // What was bought, by name, so a row says "Rice, Tomato and Pepper" rather
  // than "3 items". Asked in batches: a thousand ids do not fit one address.
  const ids = listed.map((p) => p.purchase_id)
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100))
  const lineSets = await Promise.all(batches.map((b) =>
    supabase.from('purchase_lines')
      .select('purchase_id,ingredient:ingredients!fk_purchase_lines_ingredient_id_account(name)')
      .in('purchase_id', b)
      .returns<{ purchase_id: string; ingredient: { name: string } | null }[]>()))
  const namesOf = new Map<string, string[]>()
  for (const set of lineSets) {
    for (const l of set.data ?? []) {
      namesOf.set(l.purchase_id, [...(namesOf.get(l.purchase_id) ?? []), l.ingredient?.name ?? ''])
    }
  }

  const term = q.trim().toLowerCase()
  const purchases = listed.filter((p) => !term
    || (p.supplier_name ?? '').toLowerCase().includes(term)
    || (purchaseReference(p.reference) ?? '').toLowerCase().includes(term)
    || formatDay(p.purchase_date).toLowerCase().includes(term)
    || (namesOf.get(p.purchase_id) ?? []).some((n) => n.toLowerCase().includes(term)))

  // This month and the last eight weeks, from recorded purchases only. A
  // draft has not happened and a cancelled purchase was undone.
  const spent = (spend ?? []).map((s) => ({ date: s.purchase_date, amount: s.total_amount }))
  const thisMonth = spent.filter((s) => s.date >= month && s.date <= today)
  const monthTotal = sumMoney(thisMonth.map((s) => s.amount))
  const weekly = spendByWeek(spent, today, WEEKS)
  const weeksWithSpend = weekly.filter((w) => w !== null).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchases"
        sub="What you actually paid. Every ingredient cost in Menu Master comes from here."
      />
      {notice && <Notice tone={/could not|cannot|can’t|nothing was changed/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <nav aria-label="Buying" className="grid grid-cols-2 gap-2">
        <Link href="/ingredients" className="mm-buy-tile">
          <span className="mm-buy-tile-icon" aria-hidden><AppIcon name="ingredients" size={19} /></span>
          <span className="min-w-0">Ingredients</span>
        </Link>
        <Link href="/suppliers" className="mm-buy-tile">
          <span className="mm-buy-tile-icon" aria-hidden><AppIcon name="supplier" size={19} /></span>
          <span className="min-w-0">Suppliers</span>
        </Link>
      </nav>

      {costs && (
        <section className="mm-card flex items-center justify-between gap-4" aria-label="Spent this month">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
              This month
            </div>
            {monthTotal !== null ? (
              <>
                <div className="mm-num mm-buy-hero mt-1">{money(monthTotal)}</div>
                <div className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                  {thisMonth.length} purchase{thisMonth.length === 1 ? '' : 's'}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>Nothing recorded yet</div>
            )}
          </div>
          {weeksWithSpend >= 3 && (
            <div className="shrink-0 text-right">
              <Sparkline
                points={weekly}
                labels={weeks.map((w) => `Week of ${dayShort(w)}`)}
                ariaLabel={`What you spent each week, the last ${WEEKS} weeks.`}
                width={112} height={40}
              />
              <div className="text-[11px]" style={{ color: 'var(--mm-muted)' }}>Last {WEEKS} weeks</div>
            </div>
          )}
        </section>
      )}

      {canRecord && (
        <Link href="/purchases/new" className="mm-btn mm-btn-primary w-full">
          <AppIcon name="plus" size={20} /> New purchase
        </Link>
      )}
      {paused && !notice && <Notice tone="warn">{paused}</Notice>}

      <section className="space-y-3">
        <SectionHeading>Purchase history</SectionHeading>
        {(listed.length > 6 || term) && (
          <form method="get" className="flex gap-2">
            {all && <input type="hidden" name="all" value="1" />}
            <input name="q" type="search" defaultValue={q} placeholder="Item, market or date"
              aria-label="Find a purchase" className="mm-input min-w-0 flex-1" />
            <button className="mm-btn mm-btn-secondary" type="submit">Find</button>
          </form>
        )}
        {!purchases.length ? (
          <Empty>
            {term
              ? <>Nothing matches “{q}”. <Link href="/purchases" className="mm-inline-tap">Show all</Link></>
              : canRecord
                ? 'No purchases yet. Tap New purchase after your next market run and your dish costs start working.'
                : 'No purchases recorded yet.'}
          </Empty>
        ) : (
          <div className="space-y-4">
            {groupByDay(purchases).map((g) => {
              const dayTotal = costs
                ? sumMoney(g.rows.filter((p) => p.status === 'posted').map((p) => p.total_amount))
                : null
              return (
                <div key={g.day} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 px-1">
                    <h3 className="text-sm font-semibold">{formatDay(g.day)}</h3>
                    {dayTotal !== null && (
                      <span className="mm-num text-sm" style={{ color: 'var(--mm-muted)' }}>{money(dayTotal)}</span>
                    )}
                  </div>
                  <ul className="mm-buy-rows">
                    {g.rows.map((p) => (
                      <li key={p.purchase_id}>
                        <PurchaseRow p={p} names={namesOf.get(p.purchase_id) ?? []} costs={costs} />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
        {more && !all && (
          <p className="text-sm">
            <Link href={`/purchases?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="mm-tap underline">
              Show older purchases →
            </Link>
          </p>
        )}
      </section>
    </div>
  )
}

/**
 * One purchase: where from and what was bought, and what it came to. The
 * market leads when there is one, because that is how she remembers a trip.
 */
function PurchaseRow({ p, names, costs }: { p: Row; names: string[]; costs: boolean }) {
  const items = nameList(names)
  const title = p.supplier_name || items || 'Purchase'
  const sub = [p.supplier_name ? items : '', purchaseReference(p.reference) ?? ''].filter(Boolean).join(' · ')
  const cancelled = p.status === 'reversed'
  const count = `${p.line_count} item${p.line_count === 1 ? '' : 's'}`
  return (
    <Link href={`/purchases/${p.purchase_id}`} className="mm-buy-row">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {(sub || p.status !== 'posted') && (
          <span className="block truncate text-sm" style={{ color: 'var(--mm-muted)' }}>
            <StatusWord status={p.status} />
            {p.status !== 'posted' && sub ? ' · ' : ''}
            {sub}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        {costs ? (
          <>
            {p.total_amount !== null && p.total_amount !== undefined
              ? <span className={`mm-num block font-semibold ${cancelled ? 'line-through' : ''}`}
                  style={cancelled ? { color: 'var(--mm-muted)' } : undefined}>{money(p.total_amount)}</span>
              : <span className="mm-absent block text-sm">no items yet</span>}
            <span className="block text-xs" style={{ color: 'var(--mm-muted)' }}>{count}</span>
          </>
        ) : (
          <span className="block text-sm" style={{ color: 'var(--mm-muted)' }}>{count}</span>
        )}
      </span>
    </Link>
  )
}

/** Database words are not customer words. A recorded purchase needs no label. */
function StatusWord({ status }: { status: string }) {
  if (status === 'draft') return <span style={{ color: 'var(--mm-warn)' }}>Not recorded yet — finish it</span>
  if (status === 'reversed') return <span style={{ color: 'var(--mm-warn)' }}>Cancelled</span>
  if (status === 'posted') return null
  return <>{status}</>
}
