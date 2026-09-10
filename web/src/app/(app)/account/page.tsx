import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { currentContext, entitlementStatus } from '@/lib/data/context'
import { PageHeader, Card, SectionHeading, Notice, Empty, BackLink } from '@/components/ui'
import { NOT_ENTERED, money } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Sub = {
  plan_id: string; status: string
  trial_ends_at: string | null; current_period_end: string | null
  price_kobo: number | null; founding_price_active: boolean | null
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
      .select('plan_id,status,trial_ends_at,current_period_end,price_kobo,founding_price_active')
      .maybeSingle<Sub>(),
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
              <dd>
                {planName}
                {sub.founding_price_active ? ' (founding price)' : ''}
              </dd>
              <dt style={{ color: 'var(--mm-muted)' }}>Status</dt>
              <dd>{sub.status}</dd>

              {/* The trial date is shown only while there IS a trial. A paid
                  subscriber was being shown "Trial ends" beside a live
                  subscription, which reads as though the payment changed
                  nothing. */}
              {sub.status === 'trialing' && (
                <>
                  <dt style={{ color: 'var(--mm-muted)' }}>Trial ends</dt>
                  <dd>{fmtDate(sub.trial_ends_at)}</dd>
                </>
              )}

              {sub.price_kobo !== null && sub.price_kobo > 0 && (
                <>
                  <dt style={{ color: 'var(--mm-muted)' }}>You pay</dt>
                  <dd>{money(sub.price_kobo / 100)} a month</dd>
                </>
              )}

              {/* "Renews on" and "Access runs to" are the same date meaning
                  two different things, and the difference matters: one is a
                  promise to charge again, the other is a deadline. */}
              <dt style={{ color: 'var(--mm-muted)' }}>
                {sub.status === 'active' ? 'Renews on' : 'Access runs to'}
              </dt>
              <dd>{fmtDate(sub.current_period_end)}</dd>
            </dl>
          </Card>
        )}
        <p className="text-sm">
          <Link href="/subscribe" className="mm-tap underline">
            {sub && sub.status === 'active' ? 'Change your plan' : 'Choose a plan'}
          </Link>
        </p>
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          Payments are handled by Paystack. Menu Master NG never sees or stores
          your card details.{' '}
          <Link href="/terms" className="underline">Terms</Link> ·{' '}
          <Link href="/refunds" className="underline">Refunds and cancellation</Link>
        </p>
      </section>
    </div>
  )
}
