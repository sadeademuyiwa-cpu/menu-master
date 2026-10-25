import { adminSignups, type Signups } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { fmtAsOf, fmtDate, fmtDay, relDays } from '@/lib/admin/format'
import { fillDays, setUpCount, signupsToday, weekOverWeek } from '@/lib/admin/overview'
import { AdminPage, Cell, DataTable, DayBars, Email, Kpi, KpiRow, Panel, type Column } from '../_ui/kit'

export const dynamic = 'force-dynamic'

// No Suspense here: the Overview links to #trials and #stalled, and a hash
// only scrolls if its target is in the first render. No action on the page.

type Trial = Signups['trials_ending_soon'][number]
type Stalled = Signups['accounts_without_business'][number]

const owner = (email: string | null) => <Email address={email} />

export default async function AdminSignups() {
  const g = await adminSignups(30)
  if (!g) {
    return <AdminPage title="Signups"><Notice>The signup functions are not available on this database yet (0054).</Notice></AdminPage>
  }

  const now = new Date()
  const week = weekOverWeek(g.per_day, now)
  const month = g.per_day.reduce((a, p) => a + p.accounts, 0)
  const setUp = setUpCount(g.total_accounts, g.accounts_without_business.length)
  const stalled = [...g.accounts_without_business].sort((a, b) => b.created_at.localeCompare(a.created_at))

  const trialCols: Column<Trial>[] = [
    { label: 'Business', primary: true, cell: (t) => <Cell main={t.name} sub={owner(t.owner_email)} /> },
    { label: 'Trial ends', nowrap: true, cell: (t) => fmtDate(t.trial_ends_at) },
    { label: 'In', nowrap: true, num: true, cell: (t) => relDays(t.trial_ends_at, now) },
  ]
  const stalledCols: Column<Stalled>[] = [
    { label: 'Account', primary: true, cell: (a) => <Cell main={a.name} sub={owner(a.owner_email)} /> },
    { label: 'Signed up', nowrap: true, cell: (a) => <><div>{fmtDate(a.created_at)}</div><div className="ad-small ad-muted">{relDays(a.created_at, now)}</div></> },
  ]

  return (
    <AdminPage title="Signups" description="Who joined, who is about to reach the end of a trial, and who signed up but never set up a business."
               meta={`${fmtAsOf(now)} · days run midnight to midnight UTC`}>
      <KpiRow>
        <Kpi label="Today" value={signupsToday(g.per_day, now)} />
        <Kpi label="This week" value={week.thisWeek} sub={`${week.lastWeek} the week before`} />
        <Kpi label="Last 30 days" value={month} />
        <Kpi label="Accounts in all" value={g.total_accounts}
             sub={`${setUp.done} set up a business · ${g.users_without_account} logins never made an account`} />
      </KpiRow>

      <Panel title="New accounts, last 30 days">
        <DayBars series={fillDays(g.per_day, 30, now)} label="New accounts each day, the last 30 days" format={fmtDay} />
      </Panel>

      <div className="ad-cols">
        <Panel id="trials" title={`Trials ending within 7 days (${g.trials_ending_soon.length})`} flush
               description="A word from you now is worth more than the reminder email later.">
          <DataTable columns={trialCols} rows={g.trials_ending_soon} keyOf={(t) => t.account_id}
                     empty="No trial ends in the next seven days." caption="Trials ending within seven days" />
        </Panel>
        <Panel id="stalled" title={`Signed up, no business yet (${stalled.length})`} flush
               description="They made an account and stopped before setting up their business. Newest first.">
          <DataTable columns={stalledCols} rows={stalled} keyOf={(a) => a.account_id}
                     empty="Everyone who made an account set up a business." caption="Accounts with no business set up" />
        </Panel>
      </div>
    </AdminPage>
  )
}
