import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { adminCheckins, adminSignups, type CheckinContact, type CheckinDue, type Signups } from '@/lib/data/admin'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Notice, Field, Submit } from '@/components/ui'
import { noticeTone } from '@/lib/ui/notice-tone'
import { fmtAsOf, fmtDate, fmtDay, relDays } from '@/lib/admin/format'
import { fillDays, setUpCount, signupsToday, weekOverWeek } from '@/lib/admin/overview'
import { CHECKIN_CHANNELS, CHECKIN_OUTCOMES, CHECKIN_REASONS, checkinMessage, outcomeWords } from '@/lib/admin/checkins'
import { billingSelfServe } from '@/lib/site/billing-words'
import { formatNgMobile, waLink } from '@/lib/phone'
import { AdminPage, Cell, DataTable, DayBars, Email, Kpi, KpiRow, Panel, Pill, type Column } from '../_ui/kit'

export const dynamic = 'force-dynamic'

// No Suspense here: the Overview links to #checkins, #trials and #stalled,
// and a hash only scrolls if its target is in the first render; and "Mark
// done" is a server action that redirects back here, which a boundary would
// stall (components/skeleton.tsx).

const HERE = '/admin/signups'

async function recordCheckin(formData: FormData) {
  'use server'
  const s = (k: string) => String(formData.get(k) ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('fn_admin_record_checkin', {
    p_account_id: s('account_id'), p_kind: s('kind'), p_channel: s('channel'),
    p_outcome: s('outcome'), p_note: s('note'),
  })
  revalidatePath(HERE)
  revalidatePath('/admin')
  redirect(withNotice(HERE, describeWriteError(error) ?? 'Check-in recorded.'))
}

type Trial = Signups['trials_ending_soon'][number]
type Stalled = Signups['accounts_without_business'][number]

const owner = (email: string | null) => <Email address={email} />

/** The owner's number, whether someone has reached them on it, and whether offers are allowed. */
function PhoneCell({ phone, confirmed, wrong, offers }: { phone: string | null; confirmed: boolean; wrong?: boolean; offers?: boolean }) {
  if (!phone) return wrong ? <Pill tone="warn">Wrong number, removed</Pill> : <span className="ad-muted">No number</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{formatNgMobile(phone)}</span>
      {confirmed && <Pill tone="good">Confirmed</Pill>}
      {offers && <Pill>Offers OK</Pill>}
    </span>
  )
}

/** "Mark done" / "Record": what happened when the admin got in touch. */
function RecordForm({ accountId, kind, hasPhone, label }: { accountId: string; kind: string; hasPhone: boolean; label: string }) {
  return (
    <details className="ad-resolve">
      <summary>{label}</summary>
      <form action={recordCheckin} className="ad-resolve-body">
        <input type="hidden" name="account_id" value={accountId} />
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="How">
            <select name="channel" defaultValue={hasPhone ? 'whatsapp' : 'email'} className="mm-input mt-1">
              {CHECKIN_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="What happened">
            <select name="outcome" defaultValue="reached" className="mm-input mt-1">
              {CHECKIN_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Note (optional)">
          <input name="note" maxLength={500} className="mm-input mt-1" placeholder="Costing jollof first; will price it this week" />
        </Field>
        <Submit>Save check-in</Submit>
        <p className="ad-small ad-muted">
          &quot;Wrong number&quot; removes the number and asks the owner for the right one. &quot;Replied STOP&quot; stops offers only.
          &quot;Asked not to be contacted&quot; removes the number and keeps them off this list. Each is recorded.
        </p>
      </form>
    </details>
  )
}

export default async function AdminSignups(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const [g, checkins] = await Promise.all([adminSignups(30), adminCheckins()])
  if (!g) {
    return <AdminPage title="Signups"><Notice>The signup functions are not available on this database yet (0054).</Notice></AdminPage>
  }

  const now = new Date()
  const selfServe = billingSelfServe()
  const week = weekOverWeek(g.per_day, now)
  const month = g.per_day.reduce((a, p) => a + p.accounts, 0)
  const setUp = setUpCount(g.total_accounts, g.accounts_without_business.length)
  const stalled = [...g.accounts_without_business].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const contacts = new Map((checkins?.contacts ?? []).map((c) => [c.account_id, c]))
  const numbers = (checkins?.contacts ?? []).filter((c) => c.phone || c.opted_out || c.phone_wrong)

  const dueCols: Column<CheckinDue>[] = [
    { label: 'Business', primary: true, cell: (d) => <Cell main={d.name} sub={owner(d.owner_email)} /> },
    { label: 'Why', nowrap: true, cell: (d) => {
      const r = CHECKIN_REASONS[d.reason]
      return <Pill tone={r.tone}>{d.reason === 'trial_end' && d.trial_ends_at ? `Trial ends ${relDays(d.trial_ends_at, now)}` : r.label}</Pill>
    } },
    { label: 'WhatsApp', cell: (d) => <PhoneCell phone={d.phone} confirmed={d.phone_confirmed} wrong={d.phone_wrong} /> },
    { label: 'Last check-in', wide: true, cell: (d) => (d.last_at
      ? <Cell main={outcomeWords(d.last_outcome)} sub={relDays(d.last_at, now)} />
      : <span className="ad-muted">Never</span>) },
    { label: 'Do it', cell: (d) => {
      const text = checkinMessage(d.reason, { business: d.name, endsOn: d.trial_ends_at ? fmtDate(d.trial_ends_at) : null, selfServe })
      return (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            {d.phone ? (
              <>
                <a className="mm-btn mm-btn-primary" href={waLink(d.phone, text)} target="_blank" rel="noopener">WhatsApp</a>
                <a className="mm-btn mm-btn-secondary" href={`tel:+${d.phone}`}>Call</a>
              </>
            ) : d.owner_email ? (
              <a className="mm-btn mm-btn-secondary" href={`mailto:${d.owner_email}?body=${encodeURIComponent(text)}`}>Email</a>
            ) : null}
          </div>
          <RecordForm accountId={d.account_id} kind={d.reason} hasPhone={Boolean(d.phone)} label="Mark done" />
        </div>
      )
    } },
  ]
  const numberCols: Column<CheckinContact>[] = [
    { label: 'Business', primary: true, cell: (c) => <Cell main={c.name} sub={owner(c.owner_email)} /> },
    { label: 'WhatsApp', cell: (c) => (c.opted_out
      ? <Pill>Asked not to be contacted</Pill>
      : <PhoneCell phone={c.phone} confirmed={c.phone_confirmed} wrong={c.phone_wrong} offers={c.marketing_ok} />) },
    { label: 'Last check-in', wide: true, cell: (c) => (c.last_at
      ? <Cell main={outcomeWords(c.last_outcome)} sub={relDays(c.last_at, now)} />
      : <span className="ad-muted">Never</span>) },
    { label: 'Record', cell: (c) => <RecordForm accountId={c.account_id} kind="other" hasPhone={Boolean(c.phone)} label="Record contact" /> },
  ]
  const trialCols: Column<Trial>[] = [
    { label: 'Business', primary: true, cell: (t) => <Cell main={t.name} sub={owner(t.owner_email)} /> },
    { label: 'WhatsApp', cell: (t) => {
      const c = contacts.get(t.account_id)
      return c?.opted_out ? <Pill>Asked not to be contacted</Pill>
        : <PhoneCell phone={c?.phone ?? null} confirmed={Boolean(c?.phone_confirmed)} wrong={c?.phone_wrong} />
    } },
    { label: 'Trial ends', nowrap: true, cell: (t) => fmtDate(t.trial_ends_at) },
    { label: 'In', nowrap: true, num: true, cell: (t) => relDays(t.trial_ends_at, now) },
  ]
  const stalledCols: Column<Stalled>[] = [
    { label: 'Account', primary: true, cell: (a) => <Cell main={a.name} sub={owner(a.owner_email)} /> },
    { label: 'Signed up', nowrap: true, cell: (a) => <><div>{fmtDate(a.created_at)}</div><div className="ad-small ad-muted">{relDays(a.created_at, now)}</div></> },
  ]

  return (
    <AdminPage title="Signups" description="Who joined, who to check in with today, whose trial is about to end, and who signed up but never set up a business."
               meta={`${fmtAsOf(now)} · days run midnight to midnight UTC`}>
      {notice && <Notice tone={noticeTone(notice)}>{notice}</Notice>}

      <KpiRow>
        <Kpi label="Today" value={signupsToday(g.per_day, now)} />
        <Kpi label="This week" value={week.thisWeek} sub={`${week.lastWeek} the week before`} />
        <Kpi label="Gave a WhatsApp number" value={checkins ? `${checkins.new_30d_with_phone} of ${checkins.new_30d}` : 'not yet'}
             sub={checkins ? 'new owners, last 30 days' : 'needs database update 0068'} />
        <Kpi label="Accounts in all" value={g.total_accounts}
             sub={`${setUp.done} set up a business · ${g.users_without_account} logins never made an account`} />
      </KpiRow>

      {checkins && (
        <Panel id="checkins" title={`Check-ins due (${checkins.due.length})`} flush
               description="A failed payment first, then trials ending in the next 2 days, then a hello in the first 2 days and a day-3 check. The message is written for you; mark it done after. Owners who asked not to be contacted are left out.">
          <DataTable columns={dueCols} rows={checkins.due} keyOf={(d) => `${d.account_id}-${d.reason}`}
                     empty="Nobody is due a check-in right now." caption="Owners to check in with" />
        </Panel>
      )}

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
               description="They made an account and stopped before setting up their business, so they never reached the WhatsApp question. Newest first.">
          <DataTable columns={stalledCols} rows={stalled} keyOf={(a) => a.account_id}
                     empty="Everyone who made an account set up a business." caption="Accounts with no business set up" />
        </Panel>
      </div>

      {checkins && (
        <Panel id="numbers" title={`WhatsApp numbers (${numbers.length})`} flush
               description="Every owner who gave a number, newest first. Record any contact here too, such as a STOP reply to offers, even when nobody is due.">
          <DataTable columns={numberCols} rows={numbers} keyOf={(c) => c.account_id}
                     empty="No owner has given a WhatsApp number yet." caption="Owners' WhatsApp numbers" />
        </Panel>
      )}
    </AdminPage>
  )
}
