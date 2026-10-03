import { Suspense } from 'react'
import { adminSignups } from '@/lib/data/admin'
import { Card, SectionHeading, Notice, Empty, StatRow, Stat, DataList } from '@/components/ui'
import { fmtDate, fmtDateTime, sumLastDays, daysUntil } from '@/lib/admin/format'
import Loading from '../skeleton'

export const dynamic = 'force-dynamic'

async function AdminSignupsBody() {
  const g = await adminSignups(30)
  if (!g) return <Notice>The signup functions are not available on this database yet (0054).</Notice>

  const days = [...g.per_day].sort((a, b) => b.day.localeCompare(a.day))

  return (
    <div className="space-y-8">
      <SectionHeading sub="Accounts created, by day, and the ones that stalled.">Signups</SectionHeading>

      <StatRow>
        <Stat label="Today" value={sumLastDays(g.per_day, 1)} />
        <Stat label="Last 7 days" value={sumLastDays(g.per_day, 7)} sub={`${sumLastDays(g.per_day, 30)} in 30 days`} />
        <Stat label="Accounts in all" value={g.total_accounts} sub={`${g.users_without_account} logins never made an account`} />
      </StatRow>

      <section className="space-y-3">
        <SectionHeading sub="Trials ending within seven days. A word from you now is worth more than a reminder email later.">
          Trials ending soon
        </SectionHeading>
        <DataList rows={g.trials_ending_soon} keyOf={(t) => t.account_id}
          empty="No trial ends in the next seven days."
          render={(t) => [
            { label: 'Business', value: t.name },
            { label: 'Owner', value: t.owner_email ?? '—' },
            { label: 'Trial ends', value: fmtDate(t.trial_ends_at) },
            { label: 'In', value: `${daysUntil(t.trial_ends_at) ?? '—'} days` },
          ]} />
      </section>

      <section className="space-y-3">
        <SectionHeading sub="Signed up, made an account, never set up a business. Onboarding lost them.">
          Stalled at onboarding
        </SectionHeading>
        <DataList rows={g.accounts_without_business} keyOf={(a) => a.account_id}
          empty="Everyone who made an account set up a business."
          render={(a) => [
            { label: 'Account', value: a.name },
            { label: 'Owner', value: a.owner_email ?? '—' },
            { label: 'Created', value: fmtDateTime(a.created_at) },
          ]} />
      </section>

      <section className="space-y-3">
        <SectionHeading>By day, last 30</SectionHeading>
        {days.length === 0 ? <Empty>No signups in the last 30 days.</Empty> : (
          <Card>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              {days.map((d) => (
                <li key={d.day} className="flex justify-between tabular-nums">
                  <span style={{ color: 'var(--mm-muted)' }}>{d.day}</span><span>{d.accounts}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default function AdminSignups() {
  return <Suspense fallback={<Loading />}><AdminSignupsBody /></Suspense>
}
