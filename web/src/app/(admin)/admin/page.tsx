import { Suspense } from 'react'
import Link from 'next/link'
import { adminAlerts, adminSubscriptions, adminSignups, adminBillingHealth, adminWebsiteFacts } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { money } from '@/lib/format'
import { alertWords, fmtAsOf, fmtDay, relDays, shareWords } from '@/lib/admin/format'
import {
  attentionItems, billingSuccessRate, fillDays, monthlyValue, setUpCount, subscriptionBuckets, trialCounts, weekOverWeek,
} from '@/lib/admin/overview'
import { customersCannotReach, websiteChecklist } from '@/lib/admin/website'
import { billingSelfServe } from '@/lib/site/billing-words'
import { AdminPage, AttentionList, DayBars, Kpi, KpiRow, Meter, Panel, Pill, StackBar } from './_ui/kit'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

async function AdminOverviewBody() {
  const now = new Date()
  const [alerts, subs, signups, billing, site] = await Promise.all([
    adminAlerts(true), adminSubscriptions(), adminSignups(30), adminBillingHealth(7), adminWebsiteFacts(),
  ])

  if (!alerts || !subs || !signups || !billing) {
    return (
      <AdminPage title="Overview">
        <Notice>
          The platform functions are not available on this database yet (migrations
          0053–0055). Nothing here is estimated; there is simply nothing to show.
        </Notice>
      </AdminPage>
    )
  }

  const checklist = site ? websiteChecklist(site.facts) : []
  const open = checklist.filter((i) => !i.done)
  const items = attentionItems({
    alerts: alerts.rows,
    subs: subs.rows,
    trialsEndingSoon: signups.trials_ending_soon,
    stalled: signups.accounts_without_business,
    website: site ? { missing: open.map((i) => i.label), unreachable: customersCannotReach(site.facts) } : null,
    say: { alert: alertWords, money: (n) => money(n), ago: (iso) => relDays(iso, now) },
    now,
  })

  const value = monthlyValue(subs.rows, now)
  const trials = trialCounts(subs.rows, 7, now)
  const week = weekOverWeek(signups.per_day, now)
  const setUp = setUpCount(signups.total_accounts, signups.accounts_without_business.length)
  const buckets = subscriptionBuckets(subs.rows, now)
  const rate = billingSuccessRate(billing.totals)
  const slots = subs.founder_slots
  const selfServe = billingSelfServe()

  return (
    <AdminPage title="Overview" description="What needs you first, then how the platform is doing.">
      <Panel
        title="Needs attention"
        description={items.length ? `${items.length} ${items.length === 1 ? 'thing' : 'things'}, the most urgent first.` : undefined}
        action={<span className="ad-small ad-muted">{fmtAsOf(now)} · <Link href="/admin" prefetch={false} className="ad-link">Refresh</Link></span>}
        flush
      >
        <AttentionList items={items} checkedAt={fmtAsOf(now)} />
      </Panel>

      <KpiRow>
        <Kpi label="Plan value a month" value={money(value.kobo === null ? null : value.kobo / 100, 'not known')} href="/admin/subscriptions#paying"
             sub={`${value.accounts} paying${value.notRenewed ? ` · ${value.notRenewed} renewal${value.notRenewed === 1 ? '' : 's'} not recorded` : ''}${value.unpriced ? ` · ${value.unpriced} without a price` : ''}`} />
        <Kpi label="Trials running" value={trials.running} href="/admin/subscriptions#trials"
             sub={trials.endingSoon ? `${trials.endingSoon} end within 7 days` : 'none end this week'} />
        <Kpi label="Trials ended unpaid" value={trials.endedUnpaid} href="/admin/subscriptions#trial-ended"
             sub={trials.endedUnpaid ? 'worth a message' : 'none to follow up'} />
        <Kpi label="Signups this week" value={week.thisWeek} href="/admin/signups"
             sub={`${week.lastWeek} the week before`} />
      </KpiRow>

      <div className="ad-cols">
        <Panel title="Signups, last 30 days"
               description={`${setUp.done} of ${setUp.total} accounts went on to set up a business.`}
               action={<Link href="/admin/signups" className="ad-link">See signups</Link>}>
          <DayBars series={fillDays(signups.per_day, 30, now)} label="New accounts each day, the last 30 days" format={fmtDay} />
        </Panel>

        <div className="ad-stack">
          <Panel title="Paystack, last 7 days" action={<Link href="/admin/billing" className="ad-link">Open the log</Link>}>
            <div className="ad-figs">
              <div><p className="ad-fig-label">Applied</p><p className="ad-fig-value">{billing.totals.applied ?? 0}</p></div>
              <div>
                <p className="ad-fig-label">Could not apply</p>
                <p className="ad-fig-value" style={{ color: (billing.totals.failed_permanent ?? 0) > 0 ? 'var(--mm-bad)' : undefined }}>
                  {(billing.totals.failed_permanent ?? 0) + (billing.totals.failed_transient ?? 0)}
                </p>
              </div>
              <div><p className="ad-fig-label">Share that applied</p><p className="ad-fig-value">{shareWords(rate, (billing.totals.failed_permanent ?? 0) + (billing.totals.failed_transient ?? 0) > 0)}</p></div>
              <div><p className="ad-fig-label">Refused: signature did not match</p><p className="ad-fig-value">{billing.signature_rejections}</p></div>
            </div>
          </Panel>

          <Panel title="Accounts by stage">
            <StackBar label="Accounts by stage" parts={[
              { label: 'paying', n: buckets.paying.length, colour: 'var(--mm-accent)' },
              { label: 'on trial', n: buckets.trials.length, colour: 'color-mix(in srgb, var(--mm-accent) 45%, transparent)' },
              { label: 'trial ended', n: buckets.trialEnded.length, colour: 'var(--mm-warn)' },
              { label: 'cancelled or ended', n: buckets.ended.length, colour: 'var(--ad-line-strong)' },
            ]} />
          </Panel>

          <Panel title="How the platform is set">
            <dl className="grid gap-3 text-[13.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="ad-muted">Self-serve billing</dt>
                <dd><Pill tone={selfServe ? 'good' : 'neutral'}>{selfServe ? 'On' : 'Off'}</Pill></dd>
                <dd className="ad-small ad-muted basis-full">
                  {selfServe
                    ? 'Paying owners change plan, pay after a failed payment and cancel by themselves.'
                    : 'Paying owners are told to message you to change plan or cancel. A first payment from a trial still works.'}
                </dd>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <dt className="ad-muted">Founding places</dt>
                  <dd className="tabular-nums font-semibold">{slots.free} of {slots.total} left</dd>
                </div>
                <Meter value={slots.total - slots.free} max={slots.total} label="Founding places taken" />
              </div>
              {site && (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="ad-muted">Website set up</dt>
                    <dd className="tabular-nums font-semibold">{checklist.length - open.length} of {checklist.length}</dd>
                  </div>
                  <Meter value={checklist.length - open.length} max={checklist.length} label="Website set up" />
                </div>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </AdminPage>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
// This page has no action of its own.
export default function AdminOverview() {
  return <Suspense fallback={<Loading />}><AdminOverviewBody /></Suspense>
}
