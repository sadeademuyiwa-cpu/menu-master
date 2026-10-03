import { Suspense } from 'react'
import { adminSubscriptions } from '@/lib/data/admin'
import { Card, SectionHeading, Notice, Empty, Badge, StatRow, Stat } from '@/components/ui'
import { money } from '@/lib/format'
import { fmtDate, kobo, slotWords, daysUntil } from '@/lib/admin/format'
import Loading from '../skeleton'

export const dynamic = 'force-dynamic'

async function AdminSubscriptionsBody() {
  const s = await adminSubscriptions()
  if (!s) return <Notice>The subscription functions are not available on this database yet (0054).</Notice>

  const paying = s.rows.filter((r) => r.price_tier !== 'trial')
  const trials = s.rows.filter((r) => r.price_tier === 'trial')

  return (
    <div className="space-y-8">
      <SectionHeading sub="Every subscription, with the database's own entitlement verdict beside it.">
        Subscriptions
      </SectionHeading>

      <StatRow>
        <Stat label="Paying" value={paying.filter((r) => r.status === 'active').length}
              sub={`${paying.filter((r) => r.status === 'past_due').length} past due · ${paying.filter((r) => r.status === 'cancelled').length} cancelled`} />
        <Stat label="On trial" value={trials.filter((r) => r.status === 'trialing').length}
              sub={`${trials.filter((r) => r.status !== 'trialing').length} trials ended`} />
        <Stat label="Founding slots free" value={s.founder_slots.free} sub={slotWords(s.founder_slots)} />
      </StatRow>

      {s.rows.length === 0 ? <Empty>No subscriptions.</Empty> : (
        <ul className="space-y-3">
          {s.rows.map((r) => {
            const left = daysUntil(r.current_period_end)
            return (
              <li key={r.account_id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {r.account_name}
                      <Badge tone={r.entitled ? 'good' : 'bad'}>{r.entitled ? 'entitled' : 'not entitled'}</Badge>
                      <Badge tone={r.status === 'active' ? 'good' : r.status === 'past_due' ? 'warn' : 'muted'}>{r.status}</Badge>
                      {r.founder_seq !== null && <Badge tone="plain">founder #{r.founder_seq}</Badge>}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>{r.owner_email ?? 'no owner email'}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    <dt style={{ color: 'var(--mm-muted)' }}>Plan</dt>
                    <dd>{r.plan_name}{r.founding_price_active ? ' (founding price)' : ''}</dd>
                    <dt style={{ color: 'var(--mm-muted)' }}>Pays</dt>
                    <dd className="tabular-nums">{r.price_kobo !== null && r.price_kobo > 0 ? `${money(kobo(r.price_kobo))} a month` : '—'}</dd>
                    <dt style={{ color: 'var(--mm-muted)' }}>{r.status === 'trialing' ? 'Trial ends' : r.status === 'active' ? 'Renews' : 'Period ends'}</dt>
                    <dd className="tabular-nums">
                      {fmtDate(r.status === 'trialing' ? r.trial_ends_at : r.current_period_end)}
                      {left !== null && r.status !== 'trialing' && (
                        <span style={{ color: 'var(--mm-muted)' }}> · {left >= 0 ? `in ${left} d` : `${-left} d ago`}</span>
                      )}
                    </dd>
                    <dt style={{ color: 'var(--mm-muted)' }}>Since</dt>
                    <dd>{fmtDate(r.created_at)}{r.cancel_at_period_end ? ' · cancels at period end' : ''}</dd>
                  </dl>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default function AdminSubscriptions() {
  return <Suspense fallback={<Loading />}><AdminSubscriptionsBody /></Suspense>
}
