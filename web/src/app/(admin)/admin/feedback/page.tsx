import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { adminHelp, type FeedbackRow, type HelpRequest } from '@/lib/data/admin'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Notice, Field, Submit } from '@/components/ui'
import { noticeTone } from '@/lib/ui/notice-tone'
import { fmtAsOf, fmtDateTime } from '@/lib/admin/format'
import { easeAverage, helpReply, isLowScore, npsScore } from '@/lib/admin/journeys'
import { screenName } from '@/lib/admin/screens'
import { agoWords } from '@/lib/usage'
import { formatNgMobile, waLink } from '@/lib/phone'
import { AdminPage, Cell, DataTable, Email, Kpi, KpiRow, Meter, Panel, Pill, type Column } from '../_ui/kit'

export const dynamic = 'force-dynamic'

// No Suspense: "Mark replied" is a server action that redirects back here,
// which a boundary would stall (components/skeleton.tsx).

const HERE = '/admin/feedback'

async function setHelpStatus(formData: FormData) {
  'use server'
  const s = (k: string) => String(formData.get(k) ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('fn_admin_set_help_status', {
    p_id: Number(s('id')), p_status: s('status'), p_note: s('note'),
  })
  revalidatePath(HERE)
  revalidatePath('/admin')
  redirect(withNotice(HERE, describeWriteError(error) ?? (s('status') === 'open' ? 'Opened again.' : 'Saved.')))
}

const QUESTION: Record<string, string> = { first_dish: 'Costing the first dish', first_sale: 'Recording a sale', nps: 'Would recommend us' }
const STATUS: Record<string, { word: string; tone: 'critical' | 'neutral' | 'good' }> = {
  open: { word: 'Waiting', tone: 'critical' }, replied: { word: 'Replied', tone: 'neutral' }, resolved: { word: 'Sorted', tone: 'good' },
}

function HelpForm({ h }: { h: HelpRequest }) {
  return (
    <details className="ad-resolve">
      <summary>{h.status === 'open' ? 'Mark done' : 'Change'}</summary>
      <form action={setHelpStatus} className="ad-resolve-body">
        <input type="hidden" name="id" value={h.id} />
        <Field label="Now">
          <select name="status" defaultValue={h.status === 'open' ? 'replied' : h.status} className="mm-input mt-1">
            <option value="replied">Replied, waiting to hear back</option>
            <option value="resolved">Sorted</option>
            <option value="open">Still waiting for us</option>
          </select>
        </Field>
        <Field label="Note (optional)">
          <input name="note" maxLength={500} defaultValue={h.note ?? ''} className="mm-input mt-1" placeholder="Showed her how to add a pack size" />
        </Field>
        <Submit>Save</Submit>
      </form>
    </details>
  )
}

/**
 * Everything people told us from inside the app (0069): help they asked for,
 * on which screen, answered from here on WhatsApp or by email; the short
 * questions' answers; and the screens that refuse people most.
 */
export default async function AdminFeedback(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const data = await adminHelp()
  if (!data) {
    return <AdminPage title="Help & feedback"><Notice>Help &amp; feedback needs database update 0069.</Notice></AdminPage>
  }
  const now = new Date()
  const open = data.requests.filter((h) => h.status === 'open')
  // every answer of the last 90 days, not only the ones listed below
  const nps = npsScore(data.scores.nps)
  const ease = easeAverage(data.scores.ease)
  const { asked, answered } = data.scores
  const maxRefused = Math.max(1, ...data.refusals.map((r) => r.n))

  const helpCols: Column<HelpRequest>[] = [
    { label: 'Who', primary: true, cell: (h) => (
      <Cell main={h.account_id ? <Link href={`/admin/journeys/${h.account_id}`} className="font-semibold hover:underline">{h.business ?? 'No business yet'}</Link> : (h.business ?? 'No business yet')}
            sub={<><Email address={h.email} />{h.phone ? <> · {formatNgMobile(h.phone)}</> : null}</>} />
    ) },
    { label: 'Asked', cell: (h) => (
      <div>
        <div className="ad-small ad-muted">H{h.id} · {screenName(h.screen, h.path)} · {agoWords(h.created_at, now)}</div>
        {h.channel === 'whatsapp'
          ? <div className="ad-small">Opened WhatsApp to ask{h.message ? ':' : '. Check WhatsApp for the message.'}</div>
          : null}
        {h.message && <p className="ad-quote">{h.message}</p>}
        {h.note && <div className="ad-small ad-muted mt-1">Note: {h.note}</div>}
      </div>
    ) },
    { label: 'Status', nowrap: true, cell: (h) => (
      <Cell main={<Pill tone={STATUS[h.status].tone}>{STATUS[h.status].word}</Pill>} sub={h.handled_at ? fmtDateTime(h.handled_at) : undefined} />
    ) },
    { label: 'Answer', cell: (h) => {
      const text = helpReply({ ref: `H${h.id}`, screen: screenName(h.screen, h.path), asked: h.message })
      return (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            {h.phone && <a className="mm-btn mm-btn-primary" href={waLink(h.phone, text)} target="_blank" rel="noopener">WhatsApp</a>}
            {h.email && <a className="mm-btn mm-btn-secondary" href={`mailto:${h.email}?subject=${encodeURIComponent(`Your question (H${h.id})`)}&body=${encodeURIComponent(text)}`}>Email</a>}
          </div>
          <HelpForm h={h} />
        </div>
      )
    } },
  ]

  const feedbackCols: Column<FeedbackRow>[] = [
    { label: 'Who', primary: true, cell: (f) => (
      <Cell main={f.account_id ? <Link href={`/admin/journeys/${f.account_id}`} className="font-semibold hover:underline">{f.business ?? 'No business yet'}</Link> : (f.business ?? '—')}
            sub={<Email address={f.email} />} />
    ) },
    { label: 'Question', cell: (f) => <Cell main={QUESTION[f.prompt] ?? f.prompt} sub={agoWords(f.created_at, now)} /> },
    { label: 'Answer', nowrap: true, cell: (f) => (f.score === null
      ? <span className="ad-muted">Skipped</span>
      : <Pill tone={isLowScore(f.prompt, f.score) ? 'critical' : f.prompt === 'nps' ? (f.score >= 9 ? 'good' : 'neutral') : f.score >= 4 ? 'good' : 'neutral'}>
          {f.score} of {f.prompt === 'nps' ? 10 : 5}
        </Pill>) },
    { label: 'Said', cell: (f) => (f.comment ? <p className="ad-quote">{f.comment}</p> : <span className="ad-muted">—</span>) },
  ]

  return (
    <AdminPage title="Help & feedback" description="Help people asked for inside the app, with the screen they were on; their answers to the short questions; and the screens that refuse people most."
               meta={fmtAsOf(now)}>
      {notice && <Notice tone={noticeTone(notice)}>{notice}</Notice>}

      <KpiRow>
        <Kpi label="Waiting for an answer" value={data.open_count} tone={data.open_count ? 'critical' : 'good'} sub={data.open_count ? 'oldest first below' : 'all answered'} />
        <Kpi label="How easy (1 to 5)" value={ease.avg ?? '—'} sub={ease.n ? `${ease.n} ${ease.n === 1 ? 'answer' : 'answers'}, ${ease.hard} found it hard` : 'no answers yet'} />
        <Kpi label="Would recommend" value={nps.score === null ? '—' : nps.score > 0 ? `+${nps.score}` : nps.score}
             sub={nps.n ? `${nps.promoters} keen, ${nps.detractors} not · ${nps.n} ${nps.n === 1 ? 'answer' : 'answers'}` : 'asked after a month of use'} />
        <Kpi label="Answered" value={asked ? `${Math.round((answered / asked) * 100)}%` : '—'} sub={`of ${asked} ${asked === 1 ? 'time' : 'times'} asked, last 90 days`} />
      </KpiRow>

      <Panel id="requests" flush title={`Help requests: ${data.open_count} waiting`}
             description="Waiting ones first, then the last 30 days. Answer on WhatsApp or by email: the message is started for you. Then mark it.">
        <DataTable columns={helpCols} rows={[...[...open].sort((a, b) => a.created_at.localeCompare(b.created_at)), ...data.requests.filter((h) => h.status !== 'open')]}
                   keyOf={(h) => String(h.id)} empty="Nobody has asked for help from the app yet." caption="Help requests" />
      </Panel>

      {/* Full width, so the answers read as a table on a computer. */}
      <Panel id="ratings" flush title={`Answers to the short questions (${asked})`}
             description={`Last 90 days${data.feedback.length < asked ? `, the newest ${data.feedback.length} listed` : ''}. A low score is worth a message: the journey shows what they were doing.`}>
        <DataTable columns={feedbackCols} rows={data.feedback} keyOf={(f) => `${f.account_id}-${f.prompt}-${f.created_at}`}
                   empty="Nobody has been asked yet. The first question comes after the first costed dish." caption="Answers to the short questions" />
      </Panel>
      <Panel title="Where people get refused" description="Last 7 days: the screens that said no most. Many refusals on one screen usually means it is unclear.">
        {data.refusals.length === 0 ? (
          <p className="ad-small ad-muted">No refusals in the last 7 days.</p>
        ) : (
          <ul className="ad-rank">
            {data.refusals.map((r) => (
              <li key={`${r.screen}-${r.path}`}>
                <span className="ad-rank-label">{screenName(r.screen, r.path)}</span>
                <span className="ad-rank-n">{r.n}</span>
                <span className="ad-rank-sub">{r.people} {r.people === 1 ? 'person' : 'people'}</span>
                <Meter value={r.n} max={maxRefused} label={`${r.n} refusals on ${screenName(r.screen, r.path)}`} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AdminPage>
  )
}
