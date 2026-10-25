import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { adminAlerts } from '@/lib/data/admin'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Notice, Field, Submit } from '@/components/ui'
import { noticeTone } from '@/lib/ui/notice-tone'
import { alertWords, alertAction, alertFacts, factLabel, fmtDateTime, relDays, type AlertRow } from '@/lib/admin/format'
import { groupAlerts } from '@/lib/admin/overview'
import { AdminPage, Panel, Pill, Segmented, type Tone } from '../_ui/kit'

export const dynamic = 'force-dynamic'

async function resolveAlert(formData: FormData) {
  'use server'
  const here = '/admin/alerts'
  const supabase = await createClient()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!note) redirect(withNotice(here, 'Say what was done about it.'))
  const { error } = await supabase.rpc('fn_admin_resolve_alert', { p_id: id, p_note: note })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Alert resolved.'))
}

const SEVERITY: Record<AlertRow['severity'], { tone: Tone; word: string }> = {
  critical: { tone: 'critical', word: 'Critical' },
  warn: { tone: 'warn', word: 'Needs action' },
  info: { tone: 'neutral', word: 'Info' },
}

/** Where to look next for a kind, when there is a page for it. */
const KIND_LINKS: Record<string, { href: string; label: string }> = {
  billing_failed_permanent: { href: '/admin/billing#not-applied', label: 'See them in the Paystack log' },
  billing_stuck: { href: '/admin/billing#not-applied', label: 'See them in the Paystack log' },
  past_due_beyond_grace: { href: '/admin/subscriptions#paying', label: 'See paying accounts' },
  subscription_no_period: { href: '/admin/billing#no-end-date', label: 'See them in the Paystack log' },
  founder_slots_low: { href: '/admin/subscriptions', label: 'See founding places' },
  founder_slots_exhausted: { href: '/admin/subscriptions', label: 'See founding places' },
}

function AlertLine({ a, me }: { a: AlertRow; me: string | null }) {
  const facts = alertFacts(a.detail)
  const resolver = a.resolved_by === null ? 'cleared by the scan' : a.resolved_by === me ? 'by you' : 'by an admin'
  return (
    <div className="ad-alert">
      <div className="ad-alert-line">
        <span className="ad-alert-when" title={fmtDateTime(a.first_seen)}>{relDays(a.first_seen)}</span>
        <span className="ad-alert-summary">{a.summary}</span>
      </div>
      {a.resolved_at ? (
        <p className="mt-1 ad-small ad-muted">
          Resolved {fmtDateTime(a.resolved_at)}, {resolver}{a.resolution ? `: ${a.resolution}` : ''}
        </p>
      ) : (
        <details className="ad-resolve">
          <summary>Details and resolve</summary>
          <div className="ad-resolve-body">
            <dl className="ad-facts">
              {facts.map((f) => (
                <div key={f.label}><dt>{factLabel(f.label)}</dt><dd>{f.value}</dd></div>
              ))}
              <div><dt>First seen</dt><dd>{fmtDateTime(a.first_seen)}</dd></div>
              <div><dt>Last seen</dt><dd>{fmtDateTime(a.last_seen)}</dd></div>
              <div><dt>Email</dt><dd>{a.notified_at ? `sent ${fmtDateTime(a.notified_at)}` : 'not sent yet'}</dd></div>
            </dl>
            <form action={resolveAlert} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="id" value={a.id} />
              <Field label="What was done about it">
                <input name="note" required className="mm-input mt-1" placeholder="Mapped the plan code and re-delivered the event" />
              </Field>
              <Submit>Resolve</Submit>
            </form>
            <p className="ad-small ad-muted">
              Resolving records who and why; nothing is deleted. If the problem is still there, the next hourly scan opens it again.
            </p>
          </div>
        </details>
      )}
    </div>
  )
}

export default async function AdminAlerts(props: {
  searchParams: Promise<{ notice?: string; all?: string }>
}) {
  const { notice, all } = await props.searchParams
  const showAll = all === '1'
  const supabase = await createClient()
  const [alerts, { data: { user } }] = await Promise.all([adminAlerts(!showAll), supabase.auth.getUser()])

  if (!alerts) {
    return <AdminPage title="Alerts"><Notice>The alert functions are not available on this database yet (0055).</Notice></AdminPage>
  }

  const openRows = alerts.rows.filter((a) => a.resolved_at === null)
  const resolved = alerts.rows.filter((a) => a.resolved_at !== null)
  const groups = groupAlerts(openRows)
  const warn = openRows.filter((a) => a.severity === 'warn').length

  return (
    <AdminPage
      title="Alerts"
      description="What the hourly scan has noticed and nobody has resolved, grouped by kind, the most serious first."
      actions={
        <Segmented label="Which alerts" options={[
          { href: '/admin/alerts', label: `Open (${alerts.open})`, current: !showAll },
          { href: '/admin/alerts?all=1', label: 'Resolved too', current: showAll },
        ]} />
      }
    >
      {notice && <Notice tone={noticeTone(notice, /say what/i)}>{notice}</Notice>}

      {alerts.open > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {alerts.critical > 0 && <Pill tone="critical">{alerts.critical} critical</Pill>}
          {warn > 0 && <Pill tone="warn">{warn} need action</Pill>}
          <span className="ad-small ad-muted">{groups.length} {groups.length === 1 ? 'kind' : 'kinds'} of problem</span>
        </div>
      )}

      {groups.length === 0 ? (
        <Panel>
          <p className="font-semibold">Nothing open</p>
          <p className="ad-small ad-muted">The scan runs every hour; a new problem appears here first, and on the Overview.</p>
        </Panel>
      ) : groups.map((g) => {
        const link = KIND_LINKS[g.kind]
        const action = alertAction(g.kind)
        return (
          <Panel key={g.kind} id={`kind-${g.kind}`} flush
                 title={<span className="flex flex-wrap items-center gap-2">
                   <Pill tone={SEVERITY[g.severity].tone}>{SEVERITY[g.severity].word}</Pill>
                   <span>{alertWords(g.kind)}</span>
                   <span className="ad-muted tabular-nums">· {g.rows.length}</span>
                 </span>}
                 description={action ?? undefined}
                 action={link ? <Link href={link.href} className="ad-link">{link.label}</Link> : undefined}>
            {g.rows.map((a) => <AlertLine key={a.id} a={a} me={user?.id ?? null} />)}
          </Panel>
        )
      })}

      {showAll && (
        <Panel title="Resolved" description="Closed by hand or cleared by the scan once the problem went away." flush>
          {resolved.length === 0
            ? <p className="ad-table-empty">Nothing resolved yet.</p>
            : resolved.map((a) => (
              <div key={a.id} className="ad-alert">
                <div className="ad-alert-line">
                  <span className="ad-alert-when">{relDays(a.first_seen)}</span>
                  <span className="ad-alert-summary"><span className="font-semibold">{alertWords(a.kind)}</span> · {a.summary}</span>
                </div>
                <p className="mt-1 ad-small ad-muted">
                  Resolved {fmtDateTime(a.resolved_at)}, {a.resolved_by === null ? 'cleared by the scan' : a.resolved_by === user?.id ? 'by you' : 'by an admin'}
                  {a.resolution ? `: ${a.resolution}` : ''}
                </p>
              </div>
            ))}
        </Panel>
      )}
    </AdminPage>
  )
}
