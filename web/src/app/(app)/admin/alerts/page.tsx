import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { adminAlerts } from '@/lib/data/admin'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Card, SectionHeading, Notice, Badge, Empty, Field, Submit } from '@/components/ui'
import { alertWords, severityTone, alertFacts, fmtDateTime } from '@/lib/admin/format'

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

export default async function AdminAlerts(props: {
  searchParams: Promise<{ notice?: string; all?: string }>
}) {
  const { notice, all } = await props.searchParams
  const showAll = all === '1'
  const alerts = await adminAlerts(!showAll)

  if (!alerts) return <Notice>The alert functions are not available on this database yet (0055).</Notice>

  return (
    <div className="space-y-6">
      {notice && <Notice tone={/could not|say what/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading sub={`${alerts.open} open, ${alerts.critical} critical. Resolving records who and why; nothing is deleted.`}>
          Alerts
        </SectionHeading>
        <Link href={showAll ? '/admin/alerts' : '/admin/alerts?all=1'} className="mm-tap text-sm underline">
          {showAll ? 'Open only' : 'Show resolved too'}
        </Link>
      </div>

      {alerts.rows.length === 0 ? (
        <Empty>Nothing open. The scan runs hourly.</Empty>
      ) : (
        <ul className="space-y-3">
          {alerts.rows.map((a) => (
            <li key={a.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <Badge tone={a.resolved_at ? 'muted' : severityTone(a.severity)}>
                      {a.resolved_at ? 'resolved' : a.severity}
                    </Badge>
                    {alertWords(a.kind)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                    first seen {fmtDateTime(a.first_seen)} · last {fmtDateTime(a.last_seen)}
                  </span>
                </div>
                <p className="mt-1 text-sm">{a.summary}</p>
                {alertFacts(a.detail).length > 0 && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
                    {alertFacts(a.detail).map((f) => (
                      <div key={f.label} className="contents">
                        <dt style={{ color: 'var(--mm-muted)' }}>{f.label}</dt>
                        <dd className="truncate">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {a.resolved_at ? (
                  <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
                    Resolved {fmtDateTime(a.resolved_at)}: {a.resolution}
                  </p>
                ) : (
                  <form action={resolveAlert} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <input type="hidden" name="id" value={a.id} />
                    <Field label="What was done about it">
                      <input name="note" required className="mm-input mt-1" placeholder="Mapped the plan code and re-delivered the event" />
                    </Field>
                    <Submit>Resolve</Submit>
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
