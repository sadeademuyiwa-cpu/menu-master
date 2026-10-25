import { adminSubscriptions, type SubscriptionRow } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { money } from '@/lib/format'
import { calendarDaysUntil, fmtAsOf, fmtDate, kobo, relDays, slotWords } from '@/lib/admin/format'
import { monthlyValue, payState, subscriptionBuckets, trialCounts, valueAtRisk, type PayState } from '@/lib/admin/overview'
import { billingSelfServe } from '@/lib/site/billing-words'
import { AdminPage, Cell, DataTable, Email, Kpi, KpiRow, Meter, Panel, Pill, type Column, type Tone } from '../_ui/kit'

export const dynamic = 'force-dynamic'

// No Suspense here: the Overview links to #paying, #trials and #trial-ended,
// and a hash only scrolls if its target is in the first render. The page has
// no action, so a skeleton would only be for show.

const STATE: Record<PayState, { tone: Tone; word: string }> = {
  locked: { tone: 'critical', word: 'No access' },
  past_due: { tone: 'warn', word: 'Payment failed' },
  overdue: { tone: 'warn', word: 'Renewal not recorded' },
  cancelling: { tone: 'neutral', word: 'Cancels at period end' },
  ok: { tone: 'good', word: 'Paid' },
}

const business = (r: SubscriptionRow) => (
  <Cell
    main={<span className="inline-flex flex-wrap items-center gap-2">{r.account_name}{r.founder_seq !== null && <Pill>Founder #{r.founder_seq}</Pill>}</span>}
    sub={<Email address={r.owner_email} />}
  />
)
const plan = (r: SubscriptionRow) => <Cell main={r.plan_name} sub={r.founding_price_active ? 'founding price' : undefined} />
const pays = (r: SubscriptionRow) => (r.price_kobo !== null && r.price_kobo > 0 ? money(kobo(r.price_kobo)) : '—')

/** "12 Oct · 7 days overdue" in amber, never "in -7 d". */
function until(iso: string | null, now: Date, pastWord: string) {
  if (!iso) return <span className="ad-muted">not entered</span>
  const past = new Date(iso).getTime() < now.getTime()
  const days = -(calendarDaysUntil(iso, now) ?? 0)
  const pastWords = days <= 0 ? `${pastWord} today` : `${days} ${days === 1 ? 'day' : 'days'} ${pastWord}`
  return (
    <>
      <div>{fmtDate(iso)}</div>
      <div className={past ? 'ad-small ad-warn-text' : 'ad-small ad-muted'}>{past ? pastWords : relDays(iso, now)}</div>
    </>
  )
}

export default async function AdminSubscriptions() {
  const s = await adminSubscriptions()
  if (!s) {
    return <AdminPage title="Paying & trials"><Notice>The subscription functions are not available on this database yet (0054).</Notice></AdminPage>
  }

  const now = new Date()
  const b = subscriptionBuckets(s.rows, now)
  const value = monthlyValue(s.rows, now)
  const risk = valueAtRisk(s.rows, now)
  const trials = trialCounts(s.rows, 7, now)
  const trouble = b.paying.filter((r) => ['locked', 'past_due', 'overdue'].includes(payState(r, now)))
  const locked = trouble.filter((r) => payState(r, now) === 'locked').length
  const slots = s.founder_slots
  const selfServe = billingSelfServe()

  const payingCols: Column<SubscriptionRow>[] = [
    { label: 'Business', primary: true, cell: business },
    { label: 'State', nowrap: true, cell: (r) => { const st = STATE[payState(r, now)]; return <Pill tone={st.tone}>{st.word}</Pill> } },
    { label: 'Plan', cell: plan },
    { label: 'Pays a month', num: true, cell: pays },
    { label: 'Paid until', nowrap: true, cell: (r) => until(r.current_period_end, now, 'overdue') },
    { label: 'Can use the app', wide: true, cell: (r) => (r.entitled ? 'Yes' : <span className="ad-bad-text">No</span>) },
    { label: 'Since', wide: true, nowrap: true, cell: (r) => fmtDate(r.created_at) },
  ]
  const trialCols: Column<SubscriptionRow>[] = [
    { label: 'Business', primary: true, cell: business },
    { label: 'Plan', wide: true, cell: plan },
    { label: 'Trial ends', nowrap: true, cell: (r) => until(r.trial_ends_at, now, 'ago') },
    { label: 'Signed up', wide: true, nowrap: true, cell: (r) => fmtDate(r.created_at) },
  ]
  const endedTrialCols: Column<SubscriptionRow>[] = [
    { label: 'Business', primary: true, cell: business },
    { label: 'Plan', wide: true, cell: plan },
    { label: 'Trial ended', nowrap: true, cell: (r) => <><div>{fmtDate(r.trial_ends_at)}</div><div className="ad-small ad-muted">{relDays(r.trial_ends_at, now)}</div></> },
    { label: 'Signed up', wide: true, nowrap: true, cell: (r) => fmtDate(r.created_at) },
  ]
  const endedCols: Column<SubscriptionRow>[] = [
    { label: 'Business', primary: true, cell: business },
    { label: 'Status', nowrap: true, cell: (r) => <Pill>{r.status.replace(/_/g, ' ')}</Pill> },
    { label: 'Plan', wide: true, cell: plan },
    { label: 'Period ended', nowrap: true, cell: (r) => fmtDate(r.current_period_end) },
    { label: 'Can use the app', wide: true, cell: (r) => (r.entitled ? 'Yes' : 'No') },
    { label: 'Since', wide: true, nowrap: true, cell: (r) => fmtDate(r.created_at) },
  ]

  return (
    <AdminPage
      title="Paying & trials"
      description="Every account's plan, with the database's own verdict on whether it can use the app."
      meta={`${fmtAsOf(now)} · Self-serve billing is ${selfServe ? 'on' : 'off'}${selfServe ? '' : ': paying owners message you to change plan or cancel'}`}
    >
      <KpiRow>
        <Kpi label="Plan value a month" value={money(value.kobo === null ? null : value.kobo / 100, 'not known')}
             sub={`${value.accounts} paying${value.unpriced ? ` · ${value.unpriced} without a price` : ''}${risk.accounts ? ` · ${risk.kobo === null ? 'an unknown amount' : money(risk.kobo / 100)} at risk` : ''}`} />
        <Kpi label="Need a look" value={trouble.length} tone={locked ? 'critical' : trouble.length ? 'warn' : undefined} href="#paying"
             sub={trouble.length ? (locked ? `${locked} with no access` : 'payment or renewal problems') : 'every paying account is fine'} />
        <Kpi label="Trials running" value={trials.running} href="#trials"
             sub={trials.endingSoon ? `${trials.endingSoon} end within 7 days` : 'none end this week'} />
        <Kpi label="Trials ended unpaid" value={trials.endedUnpaid} href="#trial-ended"
             sub={trials.endedUnpaid ? 'worth a message' : 'none to follow up'} />
      </KpiRow>

      <Panel id="paying" title={`Paying (${b.paying.length})`} flush
             description="Problems first: no access, then a failed payment, then a renewal that was not recorded.">
        <DataTable columns={payingCols} rows={b.paying} keyOf={(r) => r.account_id} empty="No paying accounts yet." caption="Paying accounts" />
      </Panel>

      <Panel id="trials" title={`On trial (${b.trials.length})`} flush description="Trials still running, the soonest to end first.">
        <DataTable columns={trialCols} rows={b.trials} keyOf={(r) => r.account_id} empty="No trial is running." caption="Trials running" />
      </Panel>

      <Panel id="trial-ended" title={`Trial ended, not paying (${b.trialEnded.length})`} flush
             description="They tried the app and stopped at the end of the trial. A message from you is worth more than an email from the app.">
        <DataTable columns={endedTrialCols} rows={b.trialEnded} keyOf={(r) => r.account_id} empty="No trial has ended without paying." caption="Trials that ended without paying" />
      </Panel>

      {b.ended.length > 0 && (
        <Panel id="ended" title={`Cancelled and ended (${b.ended.length})`} flush>
          <DataTable columns={endedCols} rows={b.ended} keyOf={(r) => r.account_id} empty="None." caption="Cancelled and ended subscriptions" />
        </Panel>
      )}

      <Panel title="Founding places" description="The founding price, for the first customers only.">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums">{slots.free} of {slots.total} left</span>
            <span className="ad-small ad-muted">{slotWords(slots)}</span>
          </div>
          <Meter value={slots.total - slots.free} max={slots.total} label="Founding places taken" />
        </div>
      </Panel>
    </AdminPage>
  )
}
