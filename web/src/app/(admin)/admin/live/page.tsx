import Link from 'next/link'
import { adminLive, type LiveRow } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { fmtAsOf } from '@/lib/admin/format'
import { screenName } from '@/lib/admin/screens'
import { agoWords, durationWords, stateWords } from '@/lib/usage'
import { AdminPage, Cell, DataTable, Email, Kpi, KpiRow, Meter, Panel, Pill, type Column } from '../_ui/kit'
import { AutoRefresh } from '../_ui/auto-refresh'

export const dynamic = 'force-dynamic'

const DEVICE: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' }

/**
 * Who is in the app right now, and on which screen (0069). "In the app now" is
 * a beat in the last 150 seconds from a screen that is showing; the list also
 * keeps everyone seen in the last 30 minutes, so someone who just put the
 * phone down is still there to call. Screens only: never what they typed.
 */
export default async function AdminLive() {
  const live = await adminLive()
  if (!live) {
    return <AdminPage title="Live now"><Notice>Live now needs database update 0069.</Notice></AdminPage>
  }
  const now = new Date()
  const liveRows = live.rows.filter((r) => r.live)
  const maxScreen = Math.max(1, ...live.by_screen.map((s) => s.n))
  const phones = liveRows.filter((r) => r.device === 'phone').length
  const using = liveRows.filter((r) => r.state === 'active').length

  const cols: Column<LiveRow>[] = [
    { label: 'Who', primary: true, cell: (r) => (
      <span className="ad-who">
        <span className="ad-dot" data-live={r.live || undefined} aria-hidden />
        <span><Cell main={r.business ?? 'No business yet'} sub={<Email address={r.email} />} /></span>
      </span>
    ) },
    { label: 'Screen', cell: (r) => <Cell main={screenName(r.screen, r.path)} sub={`for ${durationWords(r.active_seconds)}`} /> },
    { label: 'Now', nowrap: true, cell: (r) => {
      const s = stateWords(r.last_seen_at, r.state, now)
      return <Cell main={<Pill tone={s.tone}>{s.word}</Pill>} sub={r.live ? undefined : agoWords(r.last_seen_at, now)} />
    } },
    { label: 'Device', nowrap: true, wide: true, cell: (r) => DEVICE[r.device] ?? r.device },
    { label: 'Plan', nowrap: true, wide: true, cell: (r) => (r.price_tier === 'trial' || r.plan_status === 'trialing' ? 'Trial' : r.plan_status ?? '—') },
    { label: '', nowrap: true, cell: (r) => (r.account_id
      ? <Link className="ad-small font-semibold" style={{ color: 'var(--mm-accent)' }} href={`/admin/journeys/${r.account_id}`}>Journey</Link>
      : null) },
  ]

  return (
    <AdminPage title="Live now" description="Who is in the app, on which screen, and for how long. Everyone seen in the last 30 minutes; a green dot means the app is open on their screen this minute."
               meta={<>{fmtAsOf(now)} · <AutoRefresh seconds={30} /></>}>
      <KpiRow>
        <Kpi label="In the app now" value={live.live} tone={live.live > 0 ? 'good' : undefined}
             sub={live.live ? `${using} using it, ${live.live - using} open but not in use · ${phones} on a phone` : 'nobody this minute'} />
        <Kpi label="Last 30 minutes" value={live.recent} sub="people seen" />
        <Kpi label="Today" value={live.today} sub="people who opened the app (Lagos day)" />
      </KpiRow>

      {/* The screens first, short; then everyone, full width, so the list reads as a table on a computer. */}
      <Panel title="Screens open now" description="Where the people in the app this minute are, in use or not.">
        {live.by_screen.length === 0 ? (
          <p className="ad-small ad-muted">Nobody is on a screen this minute.</p>
        ) : (
          <ul className="ad-rank">
            {live.by_screen.map((s) => (
              <li key={`${s.screen}-${s.path}`}>
                <span className="ad-rank-label">{screenName(s.screen, s.path)}</span>
                <span className="ad-rank-n">{s.n}</span>
                <Meter value={s.n} max={maxScreen} label={`${s.n} on ${screenName(s.screen, s.path)}`} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`People (${live.rows.length})`} flush description="In the app now first. Open a journey to see everything they did.">
        <DataTable columns={cols} rows={live.rows} keyOf={(r) => r.user_id}
                   empty="Nobody has been in the app in the last 30 minutes." caption="People in the app" />
      </Panel>
    </AdminPage>
  )
}
