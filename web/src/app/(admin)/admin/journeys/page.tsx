import Link from 'next/link'
import { adminActivation } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { fmtAsOf, fmtDate, relDays } from '@/lib/admin/format'
import { funnel, journeyStatus, lastSeen, recordingOff, STEPS, stoppedAt, stuckReasons } from '@/lib/admin/journeys'
import { agoWords } from '@/lib/usage'
import { formatNgMobile } from '@/lib/phone'
import { AdminPage, Cell, DataTable, Email, Kpi, KpiRow, Meter, Panel, Pill, Segmented, type Column } from '../_ui/kit'

export const dynamic = 'force-dynamic'

const VIEWS = [
  { key: 'attention', label: 'Needs a look' },
  { key: 'trial', label: 'On trial' },
  { key: 'all', label: 'Everyone' },
] as const
type View = (typeof VIEWS)[number]['key']

const ORDER: Record<string, number> = { 'Needs you': 0, 'Not renewing': 1, Stuck: 2, New: 3, 'On track': 4, 'Trial ended': 5, Left: 6 }

/**
 * How far each owner got (0069): the setup steps in order -- business,
 * purchase, a costed dish, a price, a sale, paid -- where each one stopped,
 * and who looks stuck and why. The reasons are lib/admin/journeys.ts.
 */
export default async function AdminJourneys(props: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await props.searchParams
  const view: View = VIEWS.some((v) => v.key === show) ? (show as View) : 'attention'
  const rows = await adminActivation()
  if (!rows) {
    return <AdminPage title="Journeys"><Notice>Journeys need database update 0069.</Notice></AdminPage>
  }

  const now = new Date()
  const judged = rows.map((r) => ({ r, status: journeyStatus(r, now), reasons: stuckReasons(r, now), stop: stoppedAt(r) }))
  const attention = judged.filter((j) => j.reasons.length > 0)
  const trial = judged.filter((j) => j.r.status === 'trialing' && j.r.entitled !== false)
  const shown = (view === 'attention' ? attention : view === 'trial' ? trial : judged)
    .sort((a, b) => (ORDER[a.status.word] ?? 9) - (ORDER[b.status.word] ?? 9) || b.r.created_at.localeCompare(a.r.created_at))
  const steps = funnel(rows)
  const count = { attention: attention.length, trial: trial.length, all: judged.length }
  // an owner who turned recording off has no visits to count, so is left out of this figure
  const recorded = rows.filter((r) => !recordingOff(r))
  const active7 = recorded.filter((r) => { const s = lastSeen(r); return s && now.getTime() - new Date(s).getTime() < 7 * 86_400_000 }).length
  const costed = steps.find((s) => s.key === 'costed')

  type J = (typeof judged)[number]
  const cols: Column<J>[] = [
    { label: 'Business', primary: true, cell: ({ r }) => (
      <Cell main={<Link href={`/admin/journeys/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>}
            sub={<><Email address={r.email} />{r.phone ? <> · {formatNgMobile(r.phone)}</> : null}</>} />
    ) },
    { label: 'Status', nowrap: true, cell: ({ status }) => <Pill tone={status.tone}>{status.word}</Pill> },
    { label: 'Got to', cell: ({ r, stop }) => (
      <Cell main={STEPS[Math.max(0, stop.reached - 1)].label}
            sub={stop.next ? `Next: ${STEPS.find((s) => s.key === stop.next)?.label.toLowerCase()}` : 'Every step done'} />
    ) },
    { label: 'Why', cell: ({ reasons }) => (reasons.length ? reasons.join(' · ') : <span className="ad-muted">—</span>) },
    { label: 'Last seen', nowrap: true, cell: ({ r }) => (recordingOff(r)
      ? <Cell main={<span className="ad-muted">Not recorded</span>} sub="the owner turned screen recording off" />
      : <Cell main={agoWords(lastSeen(r), now)} sub={`${r.active_days_14} of the last 14 days`} />) },
    { label: 'Signed up', nowrap: true, wide: true, cell: ({ r }) => <Cell main={fmtDate(r.created_at)} sub={relDays(r.created_at, now)} /> },
  ]

  return (
    <AdminPage title="Journeys" description="How far each owner got, where each one stopped, and who looks stuck. Open one to see their whole story."
               meta={fmtAsOf(now)}>
      <KpiRow>
        <Kpi label="Need a look" value={count.attention} tone={count.attention ? 'warn' : undefined} sub="asked for help, unhappy, stuck or gone quiet" href="/admin/journeys" />
        <Kpi label="Costed a dish" value={costed && costed.pct !== null ? `${Math.round(costed.pct * 100)}%` : '—'} sub={`${costed?.n ?? 0} of ${rows.length} accounts`} />
        <Kpi label="In the app this week" value={active7} sub={`of ${recorded.length} accounts whose screens are recorded`} />
      </KpiRow>

      <Panel title="Where owners get to" description="Every account, and how many reached each step (in any order). A big drop between two steps is where help is needed most. A sale is not expected on the Costing plan.">
        <ul className="ad-rank">
          {steps.map((s, i) => {
            const prev = i > 0 ? steps[i - 1].n : null
            const lost = prev !== null ? prev - s.n : 0
            return (
              <li key={s.key}>
                <span className="ad-rank-label">{s.label}</span>
                <span className="ad-rank-n">{s.n}{s.pct !== null ? <span className="ad-muted"> · {Math.round(s.pct * 100)}%</span> : null}</span>
                <Meter value={s.n} max={Math.max(1, rows.length)} label={`${s.n} of ${rows.length}: ${s.label}`} />
                {lost > 0 && <span className="ad-rank-sub">{lost} fewer than the step before</span>}
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel flush title={`${VIEWS.find((v) => v.key === view)?.label} (${shown.length})`}
             action={<Segmented label="Which owners" options={VIEWS.map((v) => ({ href: v.key === 'attention' ? '/admin/journeys' : `/admin/journeys?show=${v.key}`, label: `${v.label} (${count[v.key]})`, current: v.key === view }))} />}
             description={view === 'attention' ? 'Asked for help or rated us low first, then stuck at a step, then gone quiet. An ended trial is followed up under Paying & trials.' : undefined}>
        <DataTable columns={cols} rows={shown} keyOf={({ r }) => r.id}
                   empty={view === 'attention' ? 'Nobody looks stuck right now.' : 'No accounts here.'} caption="Owners and how far they got" />
      </Panel>
    </AdminPage>
  )
}
