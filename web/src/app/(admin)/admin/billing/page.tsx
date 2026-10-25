import { adminBillingHealth, adminSubscriptions, type BillingHealth } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { fmtAsOf, fmtDateTime, fmtDay, shareWords } from '@/lib/admin/format'
import { billingSuccessRate, fillDays } from '@/lib/admin/overview'
import { AdminPage, Cell, DataTable, DayBars, Kpi, KpiRow, Panel, Pill, Segmented, type Column, type Tone } from '../_ui/kit'

export const dynamic = 'force-dynamic'

// No Suspense here: Alerts links to #not-applied and #no-end-date, and a
// hash only scrolls if its target is in the first render. No action here.

type Reconcile = BillingHealth['reconciliation'][number]
type Anomaly = BillingHealth['anomalies'][number]

const STATUS: Record<string, { tone: Tone; word: string }> = {
  applied: { tone: 'good', word: 'Applied' },
  failed_permanent: { tone: 'critical', word: 'Could not apply' },
  failed_transient: { tone: 'warn', word: 'Failed, will retry' },
  received: { tone: 'neutral', word: 'Waiting' },
  processing: { tone: 'neutral', word: 'Being applied' },
  ignored: { tone: 'neutral', word: 'Not needed' },
  rejected: { tone: 'neutral', word: 'Refused' },
}
const status = (s: string) => STATUS[s] ?? { tone: 'neutral' as Tone, word: s.replace(/_/g, ' ') }

const PERIODS = [7, 30, 90]

export default async function AdminBilling(props: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await props.searchParams
  const n = Math.min(Math.max(Number(days) || 30, 1), 365)
  const [b, subs] = await Promise.all([adminBillingHealth(n), adminSubscriptions()])
  if (!b) {
    return <AdminPage title="Paystack log"><Notice>The billing functions are not available on this database yet (0054).</Notice></AdminPage>
  }

  // Accounts by name, not by id: the subscriptions read already has them.
  const names = new Map((subs?.rows ?? []).map((r) => [r.account_id, r.account_name]))
  const account = (id: string | null) =>
    id === null
      ? <span className="ad-warn-text">Not matched to an account</span>
      : <Cell main={names.get(id) ?? 'Unknown account'} sub={<span className="ad-mono">{id}</span>} />

  const perDay = new Map<string, Record<string, number>>()
  for (const e of b.events_by_day) perDay.set(e.day, { ...(perDay.get(e.day) ?? {}), [e.status]: e.n })
  const series = fillDays([...perDay.entries()].map(([day, s]) => ({ day, accounts: Object.values(s).reduce((a, x) => a + x, 0) })), n)
  const dayRows = [...perDay.entries()].sort((x, y) => y[0].localeCompare(x[0]))
  const failed = (b.totals.failed_permanent ?? 0) + (b.totals.failed_transient ?? 0)
  const rate = billingSuccessRate(b.totals)

  const reconcileCols: Column<Reconcile>[] = [
    { label: 'Message', primary: true, cell: (r) => <Cell main={r.event_type ?? 'Unknown message'} sub={fmtDateTime(r.received_at)} /> },
    { label: 'State', nowrap: true, cell: (r) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Pill tone={status(r.status).tone}>{status(r.status).word}</Pill>
        {r.attempts > 1 && <span className="ad-small ad-muted">{r.attempts} tries</span>}
      </span>
    ) },
    { label: 'Account', cell: (r) => account(r.account_id) },
    { label: 'Reason', cell: (r) => (r.last_error_code ? <Cell main={<span className="ad-mono">{r.last_error_code}</span>} sub={r.last_error ?? undefined} /> : '—') },
    { label: 'Paystack reference', cell: (r) => <span className="ad-mono">{r.reference ?? '—'}</span> },
  ]
  const anomalyCols: Column<Anomaly>[] = [
    { label: 'Account', primary: true, cell: (a) => account(a.account_id) },
    { label: 'Status', nowrap: true, cell: (a) => <Pill>{a.status.replace(/_/g, ' ')}</Pill> },
    { label: 'Subscription', cell: (a) => <span className="ad-mono">{a.subscription_id}</span> },
  ]
  const dayCols: Column<[string, Record<string, number>]>[] = [
    { label: 'Day', primary: true, cell: ([day]) => <span className="font-semibold">{fmtDay(day)}</span> },
    { label: 'Applied', num: true, cell: ([, s]) => s.applied ?? 0 },
    { label: 'Could not apply', num: true, cell: ([, s]) => (s.failed_permanent ?? 0) + (s.failed_transient ?? 0) },
    { label: 'Not needed', num: true, wide: true, cell: ([, s]) => s.ignored ?? 0 },
    { label: 'Refused', num: true, wide: true, cell: ([, s]) => s.rejected ?? 0 },
  ]

  return (
    <AdminPage title="Paystack log"
               description="Every message Paystack sent about payments. The problems also show in Alerts; this is where to look at the detail."
               meta={fmtAsOf()}>
      <Panel id="not-applied" title={`Messages we could not apply (${b.reconciliation.length})`} flush
             description="Any date. Money may have moved without the account changing. Look the reference up in Paystack.">
        <DataTable columns={reconcileCols} rows={b.reconciliation}
                   keyOf={(r) => `${r.received_at}-${r.reference ?? ''}-${r.provider_event_id ?? ''}`}
                   empty="Nothing waiting. Every message has either been applied or set aside."
                   caption="Paystack messages that could not be applied" />
      </Panel>

      {b.anomalies.length > 0 && (
        <Panel id="no-end-date" title={`Subscriptions missing a paid-until date (${b.anomalies.length})`} flush
               description="Any date. Without that date the app cannot tell when the plan runs out.">
          <DataTable columns={anomalyCols} rows={b.anomalies} keyOf={(a) => a.subscription_id} empty="None." caption="Subscriptions missing a paid-until date" />
        </Panel>
      )}

      <Panel title={`The last ${n} days`}
             action={<Segmented label="Period" options={PERIODS.map((p) => ({ href: `/admin/billing?days=${p}`, label: `${p} days`, current: p === n }))} />}>
        <div className="grid gap-5">
          <KpiRow>
            <Kpi label="Applied" value={b.totals.applied ?? 0} />
            <Kpi label="Could not apply" value={failed} tone={(b.totals.failed_permanent ?? 0) > 0 ? 'critical' : undefined}
                 sub={`${b.totals.failed_permanent ?? 0} for good, ${b.totals.failed_transient ?? 0} to retry`} />
            <Kpi label="Share that applied" value={shareWords(rate, failed > 0)} />
            <Kpi label="Refused: signature did not match" value={b.signature_rejections}
                 sub="Many at once usually means the Paystack secret key is set wrong, and real payments are being refused." />
          </KpiRow>
          <div>
            <p className="ad-small ad-muted mb-2">Messages each day</p>
            <DayBars series={series} label={`Paystack messages each day, the last ${n} days`} format={fmtDay} />
          </div>
        </div>
      </Panel>

      <Panel title="Day by day" flush>
        <DataTable columns={dayCols} rows={dayRows} keyOf={([day]) => day} empty="No messages in this period." caption="Paystack messages by day" />
      </Panel>
    </AdminPage>
  )
}
