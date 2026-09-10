import { Suspense } from 'react'
import Link from 'next/link'
import { adminAlerts, adminSubscriptions, adminSignups, adminBillingHealth } from '@/lib/data/admin'
import { Card, SectionHeading, StatRow, Stat, Notice, Badge, Empty } from '@/components/ui'
import { alertWords, severityTone, slotWords, sumLastDays, fmtDateTime } from '@/lib/admin/format'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

async function AdminOverviewBody() {
  const [alerts, subs, signups, billing] = await Promise.all([
    adminAlerts(true), adminSubscriptions(), adminSignups(30), adminBillingHealth(7),
  ])

  if (!alerts || !subs || !signups || !billing) {
    return (
      <Notice>
        The platform functions are not available on this database yet (migrations
        0053–0055). Nothing here is estimated; there is simply nothing to show.
      </Notice>
    )
  }

  const paid = subs.rows.filter((r) => r.price_tier !== 'trial' && r.status === 'active').length
  const failed = (billing.totals.failed_permanent ?? 0) + (billing.totals.failed_transient ?? 0)

  return (
    <div className="space-y-8">
      <StatRow>
        <Stat label="Open alerts" value={alerts.open}
              sub={alerts.critical ? `${alerts.critical} critical` : 'none critical'} />
        <Stat label="Paying subscriptions" value={paid}
              sub={`${subs.rows.length} subscriptions in all`} />
        <Stat label="Signups, last 7 days" value={sumLastDays(signups.per_day, 7)}
              sub={`${signups.total_accounts} accounts in all`} />
      </StatRow>

      <section className="space-y-3">
        <SectionHeading sub="What the hourly scan has noticed and nobody has resolved.">
          Needs you
        </SectionHeading>
        {alerts.rows.length === 0 ? (
          <Empty>Nothing open. The scan runs hourly; a new condition appears here first.</Empty>
        ) : (
          <ul className="space-y-2">
            {alerts.rows.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link href="/admin/alerts" className="block">
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                        {alertWords(a.kind)}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                        since {fmtDateTime(a.first_seen)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{a.summary}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {alerts.rows.length > 5 && (
          <p className="text-sm"><Link href="/admin/alerts" className="mm-tap underline">All {alerts.open} open alerts →</Link></p>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading>At a glance</SectionHeading>
        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt style={{ color: 'var(--mm-muted)' }}>Founding slots</dt>
            <dd className="sm:col-span-3">{slotWords(subs.founder_slots)}</dd>
            <dt style={{ color: 'var(--mm-muted)' }}>Billing, last 7 days</dt>
            <dd className="sm:col-span-3">
              {Object.entries(billing.totals).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(' · ') || 'no events'}
              {failed > 0 && <span style={{ color: 'var(--mm-warn)' }}> · {failed} failed</span>}
            </dd>
            <dt style={{ color: 'var(--mm-muted)' }}>By status</dt>
            <dd className="sm:col-span-3">
              {Object.entries(subs.by_status).map(([k, v]) => `${v} ${k}`).join(' · ') || 'no subscriptions'}
            </dd>
            <dt style={{ color: 'var(--mm-muted)' }}>Logins with no account</dt>
            <dd className="sm:col-span-3">{signups.users_without_account}</dd>
          </dl>
        </Card>
      </section>
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default function AdminOverview() {
  return <Suspense fallback={<Loading />}><AdminOverviewBody /></Suspense>
}
