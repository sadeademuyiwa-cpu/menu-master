import { Suspense } from 'react'
import { adminBillingHealth } from '@/lib/data/admin'
import { Card, SectionHeading, Notice, Empty, StatRow, Stat, DataList } from '@/components/ui'
import { fmtDateTime } from '@/lib/admin/format'
import Loading from '../skeleton'

export const dynamic = 'force-dynamic'

async function AdminBillingBody(props: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await props.searchParams
  const n = Math.min(Math.max(Number(days) || 30, 1), 365)
  const b = await adminBillingHealth(n)
  if (!b) return <Notice>The billing functions are not available on this database yet (0054).</Notice>

  const byDay = new Map<string, Record<string, number>>()
  for (const e of b.events_by_day) {
    const row = byDay.get(e.day) ?? {}
    row[e.status] = e.n
    byDay.set(e.day, row)
  }
  const dayRows = [...byDay.entries()].sort((x, y) => y[0].localeCompare(x[0]))

  return (
    <div className="space-y-8">
      <SectionHeading sub={`Webhook events in the last ${b.days} days. Every count is the database's own; nothing here is a payload.`}>
        Billing health
      </SectionHeading>

      <StatRow>
        <Stat label="Applied" value={b.totals.applied ?? 0} />
        <Stat label="Failed" value={(b.totals.failed_permanent ?? 0) + (b.totals.failed_transient ?? 0)}
              sub={`${b.totals.failed_permanent ?? 0} permanent`} />
        <Stat label="Rejected signatures" value={b.signature_rejections}
              sub="requests whose HMAC did not verify" />
      </StatRow>

      <section className="space-y-3">
        <SectionHeading sub="Money that moved without a matching entitlement change, or an event nothing has finished with.">
          Reconciliation
        </SectionHeading>
        <DataList
          rows={b.reconciliation}
          keyOf={(r) => `${r.received_at}-${r.reference ?? ''}-${r.provider_event_id ?? ''}`}
          empty="Nothing to reconcile. Every event has either applied or been dismissed."
          render={(r) => [
            { label: 'Received', value: fmtDateTime(r.received_at) },
            { label: 'Event', value: r.event_type ?? '—' },
            { label: 'Status', value: `${r.status}${r.attempts ? ` (${r.attempts} attempts)` : ''}` },
            { label: 'Reference', value: r.reference ?? '—' },
            { label: 'Account', value: r.account_id ?? '—' },
            { label: 'Error', value: r.last_error_code ? `${r.last_error_code}: ${r.last_error ?? ''}` : '—' },
          ]}
        />
      </section>

      <section className="space-y-3">
        <SectionHeading>Anomalies</SectionHeading>
        {b.anomalies.length === 0
          ? <Empty>None.</Empty>
          : <DataList rows={b.anomalies} keyOf={(a) => a.subscription_id}
              empty="None."
              render={(a) => [
                { label: 'Subscription', value: a.subscription_id },
                { label: 'Account', value: a.account_id },
                { label: 'Status', value: a.status },
                { label: 'Anomaly', value: a.anomaly.replace(/_/g, ' ') },
              ]} />}
      </section>

      <section className="space-y-3">
        <SectionHeading>By day</SectionHeading>
        {dayRows.length === 0 ? <Empty>No events in this period.</Empty> : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--mm-muted)' }}>
                    <th className="py-1 text-left font-normal">Day</th>
                    <th className="py-1 text-right font-normal">Applied</th>
                    <th className="py-1 text-right font-normal">Failed</th>
                    <th className="py-1 text-right font-normal">Ignored</th>
                    <th className="py-1 text-right font-normal">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map(([day, s]) => (
                    <tr key={day}>
                      <td className="py-1">{day}</td>
                      <td className="py-1 text-right tabular-nums">{s.applied ?? 0}</td>
                      <td className="py-1 text-right tabular-nums">{(s.failed_permanent ?? 0) + (s.failed_transient ?? 0)}</td>
                      <td className="py-1 text-right tabular-nums">{s.ignored ?? 0}</td>
                      <td className="py-1 text-right tabular-nums">{s.rejected ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default function AdminBilling(props: Parameters<typeof AdminBillingBody>[0]) {
  return <Suspense fallback={<Loading />}><AdminBillingBody {...props} /></Suspense>
}
