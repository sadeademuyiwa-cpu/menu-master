import { createClient } from '@/lib/supabase/server'
import { currentContext, entitlementStatus } from '@/lib/data/context'
import { PageHeader, Card, SectionHeading, Notice, Empty, BackLink } from '@/components/ui'
import { NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Sub = {
  plan_id: string; status: string
  trial_ends_at: string | null; current_period_end: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return NOT_ENTERED
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? NOT_ENTERED
    : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function AccountPage() {
  const supabase = await createClient()
  const { accountId, role, businessName } = await currentContext()

  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: sub }, { data: plans }, entitlement] = await Promise.all([
    supabase.from('subscriptions')
      .select('plan_id,status,trial_ends_at,current_period_end').maybeSingle<Sub>(),
    supabase.from('plans').select('id,name').returns<{ id: string; name: string }[]>(),
    entitlementStatus(),
  ])

  const planName = plans?.find((p) => p.id === sub?.plan_id)?.name ?? sub?.plan_id ?? NOT_ENTERED

  // Entitlement is the DATABASE's verdict, read through
  // fn_my_entitlement_status(). This page never interprets a date to decide
  // whether someone may work -- it only displays the dates as facts.
  const boundary = entitlement?.boundary ?? sub?.current_period_end ?? null

  return (
    <div className="space-y-8">
      <BackLink href="/dashboard">← Dashboard</BackLink>

      <PageHeader title="Account" sub="Your business, your plan and your access." />

      {entitlement && (
        entitlement.entitled ? (
          <Notice tone="info">
            {entitlement.reason === 'trial_active'
              ? `You are on the free trial${boundary ? ` until ${fmtDate(boundary)}` : ''}.`
              : entitlement.reason === 'payment_failed_in_grace'
                ? 'We could not take your last payment. Your access continues while you sort it out.'
                : 'Your subscription is active.'}
          </Notice>
        ) : (
          <Notice>
            {entitlement.reason === 'trial_ended'
              ? `Your free trial ended${boundary ? ` on ${fmtDate(boundary)}` : ''}.`
              : 'Your subscription has ended.'}{' '}
            Everything you entered is still here — you can open and export every
            recipe and price. To record new work again, you will need to subscribe.
          </Notice>
        )
      )}

      <section className="space-y-3">
        <SectionHeading>Business</SectionHeading>
        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt style={{ color: 'var(--mm-muted)' }}>Business</dt>
            <dd>{businessName ?? NOT_ENTERED}</dd>
            <dt style={{ color: 'var(--mm-muted)' }}>Signed in as</dt>
            <dd className="truncate">{user?.email ?? NOT_ENTERED}</dd>
            <dt style={{ color: 'var(--mm-muted)' }}>Your role</dt>
            <dd>{role ?? NOT_ENTERED}</dd>
            <dt style={{ color: 'var(--mm-muted)' }}>Account</dt>
            <dd className="truncate text-xs">{accountId ?? NOT_ENTERED}</dd>
          </dl>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeading>Plan</SectionHeading>
        {!sub ? (
          <Empty>No subscription found for this account yet.</Empty>
        ) : (
          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <dt style={{ color: 'var(--mm-muted)' }}>Plan</dt>
              <dd>{planName}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>Status</dt>
              <dd>{sub.status}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>Trial ends</dt>
              <dd>{fmtDate(sub.trial_ends_at)}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>Access runs to</dt>
              <dd>{fmtDate(sub.current_period_end)}</dd>
            </dl>
          </Card>
        )}
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          Paid plans are not open yet. Nothing on this page charges you and no
          payment details are held.
        </p>
      </section>
    </div>
  )
}
