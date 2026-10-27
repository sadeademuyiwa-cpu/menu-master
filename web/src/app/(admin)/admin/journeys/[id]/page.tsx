import Link from 'next/link'
import { notFound } from 'next/navigation'
import { adminActivationOf, adminJourney } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { fmtAsOf, fmtDate } from '@/lib/admin/format'
import { buildTimeline, expectsSale, journeyStatus, lastSeen, recordingOff, STEPS, stoppedAt, stuckReasons, type TimelineEntry } from '@/lib/admin/journeys'
import { screenName } from '@/lib/admin/screens'
import { agoWords, durationWords } from '@/lib/usage'
import { formatNgMobile, waLink } from '@/lib/phone'
import { AdminPage, Email, Kpi, KpiRow, Panel, Pill } from '../../_ui/kit'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LAGOS_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })
const LAGOS_TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })

/** The story newest first, under one heading per Lagos day. */
function byDay(entries: TimelineEntry[]): { day: string; items: TimelineEntry[] }[] {
  const out: { day: string; items: TimelineEntry[] }[] = []
  for (const e of entries) {
    const day = LAGOS_DAY.format(new Date(e.at))
    if (out[out.length - 1]?.day !== day) out.push({ day, items: [] })
    out[out.length - 1].items.push(e)
  }
  return out
}

/**
 * One owner from signup to now (0069): the steps they reached, each time
 * they used the app and the screens they went through, where they were
 * refused, what they asked, how they rated it, and every check-in. The
 * visits are kept 90 days; steps, help and ratings stay.
 */
export default async function AdminJourney(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  if (!UUID.test(id)) notFound()
  const [j, all] = await Promise.all([adminJourney(id), adminActivationOf(id)])
  if (!all) {
    return <AdminPage title="Journey" up={{ href: '/admin/journeys', label: 'Journeys' }}><Notice>Journeys need database update 0069.</Notice></AdminPage>
  }
  if (!j) notFound()

  const now = new Date()
  const act = all[0] ?? null
  const status = act ? journeyStatus(act, now) : null
  const reasons = act ? stuckReasons(act, now) : []
  const stop = act ? stoppedAt(act) : null
  const timeline = buildTimeline(j, act, { nameOf: screenName, duration: durationWords })
  const openHelp = j.help.filter((h) => h.status === 'open')
  const owner = j.members.find((m) => m.role === 'owner') ?? j.members[0]

  return (
    <AdminPage title={j.account.name} up={{ href: '/admin/journeys', label: 'Journeys' }}
               description={reasons.length ? reasons.join(' · ') : 'Nothing here needs you right now.'}
               meta={`Signed up ${fmtDate(j.account.created_at)} · ${fmtAsOf(now)}`}
               actions={owner?.phone ? (
                 <a className="mm-btn mm-btn-primary" target="_blank" rel="noopener"
                    href={waLink(owner.phone, `Hello, this is Menu Master. How is ${j.account.name} getting on? `)}>WhatsApp the owner</a>
               ) : owner?.email ? <a className="mm-btn mm-btn-secondary" href={`mailto:${owner.email}`}>Email the owner</a> : null}>
      <KpiRow>
        <Kpi label="Status" value={status ? <Pill tone={status.tone}>{status.word}</Pill> : '—'} />
        <Kpi label="Got to" value={stop ? STEPS[Math.max(0, stop.reached - 1)].label : '—'}
             sub={stop?.next ? `next: ${STEPS.find((s) => s.key === stop.next)?.label.toLowerCase()}` : undefined} />
        {act && recordingOff(act)
          ? <Kpi label="Last seen" value="Not recorded" sub="the owner turned screen recording off" />
          : <Kpi label="Last seen" value={act ? agoWords(lastSeen(act), now) : '—'} sub={act ? `in the app ${act.active_days_14} of the last 14 days` : undefined} />}
        {/* every open request, as Journeys counts them */}
        <Kpi label="Open help requests" value={act?.open_help ?? openHelp.length} tone={(act?.open_help ?? openHelp.length) ? 'critical' : undefined}
             href={(act?.open_help ?? openHelp.length) ? '/admin/feedback' : undefined} />
      </KpiRow>

      <div className="ad-cols">
        <Panel flush title="What happened" description="Newest first. Each use of the app is one line, with the screens in order. Visits are kept 90 days.">
          {timeline.length === 0 ? (
            <p className="ad-table-empty">Nothing recorded yet.</p>
          ) : (
            <ol className="ad-tl">
              {byDay(timeline).map((d) => (
                <li key={d.day}>
                  <div className="ad-tl-day">{d.day}</div>
                  <ol className="ad-tl">
                    {d.items.map((e, i) => (
                      <li key={`${e.at}-${e.kind}-${i}`} className="ad-tl-item" data-tone={e.tone} data-kind={e.kind}>
                        <span className="ad-tl-time">{LAGOS_TIME.format(new Date(e.at))}</span>
                        <span className="ad-tl-mark" aria-hidden />
                        <div>
                          <div className="ad-tl-title">{e.title}</div>
                          {e.detail && (e.kind === 'help' || e.kind === 'feedback'
                            ? <p className="ad-quote">{e.detail}</p>
                            : <div className="ad-tl-detail">{e.detail}</div>)}
                        </div>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="grid gap-[18px]">
          <Panel title="Setup steps">
            <ul className="ad-rank">
              {STEPS.map((s) => {
                const at = act ? s.at(act) : null
                const skipped = !at && s.key === 'sale' && act !== null && !expectsSale(act)
                return (
                  <li key={s.key}>
                    <span className="ad-rank-label">{at ? '✓ ' : skipped ? '' : '○ '}{s.label}</span>
                    <span className={`ad-rank-n${at ? '' : ' ad-muted'}`}>{at ? fmtDate(at) : skipped ? 'not on the Costing plan' : 'not yet'}</span>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <Panel title={`People (${j.members.length})`}>
            <ul className="ad-rank">
              {j.members.map((m) => (
                <li key={m.user_id}>
                  <span className="ad-rank-label"><Email address={m.email} /></span>
                  <span className="ad-rank-n ad-muted">{m.role}</span>
                  <span className="ad-rank-sub">
                    {m.phone
                      ? <a href={waLink(m.phone, 'Hello, this is Menu Master. ')} target="_blank" rel="noopener" className="font-semibold" style={{ color: 'var(--mm-accent)' }}>{formatNgMobile(m.phone)}</a>
                      : 'No WhatsApp number'}
                    {m.opted_out_usage ? ' · turned off screen recording' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          {openHelp.length > 0 && (
            <Panel title="Waiting for an answer" description="Reply, then mark it on Help & feedback.">
              <ul className="ad-rank">
                {openHelp.map((h) => (
                  <li key={h.id}>
                    <span className="ad-rank-label">{screenName(h.screen, h.path)}</span>
                    <span className="ad-rank-n ad-muted">H{h.id} · {agoWords(h.created_at, now)}</span>
                    {h.message && <p className="ad-quote" style={{ gridColumn: '1 / -1' }}>{h.message}</p>}
                  </li>
                ))}
              </ul>
              <p className="mt-3"><Link href="/admin/feedback" className="ad-small font-semibold" style={{ color: 'var(--mm-accent)' }}>Open Help &amp; feedback</Link></p>
            </Panel>
          )}
        </div>
      </div>
    </AdminPage>
  )
}
