import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { currentContext, entitlementStatus } from '@/lib/data/context'
import { PageHeader, Card, SectionHeading, Notice, Empty, BackLink } from '@/components/ui'
import { NOT_ENTERED, money } from '@/lib/format'
import { planStatusLabel } from '@/lib/trial'
import { signOut } from '@/lib/auth-actions'
import { Button } from '@/components/button'
import { PhotoPreference } from '@/components/photo-preference'
import { CancelPlan } from '@/components/cancel-plan'
import { PayNowButton, UpdateCardButton } from '@/components/plan-chooser'
import { SupportContact } from '@/components/legal-page'
import { MESSAGE_US, billingSelfServe } from '@/lib/site/billing-words'
import {
  accountBilling, endingText, isPaying, lagosLongDate, OWNER_ONLY_NOTE, PAY_NOW_TEXT,
} from '../subscribe/billing-choices'

import Loading from './skeleton'

export const dynamic = 'force-dynamic'

type Sub = {
  plan_id: string; status: string
  trial_ends_at: string | null; current_period_end: string | null
  price_kobo: number | null; founding_price_active: boolean | null
  cancel_at_period_end: boolean | null
}

/** A date on the Lagos calendar, in words; a missing one says so. */
function fmtDate(iso: string | null): string {
  return lagosLongDate(iso) ?? NOT_ENTERED
}

async function AccountPageBody() {
  const supabase = await createClient()
  const { accountId, role, businessName } = await currentContext()

  const { data: { user } } = await supabase.auth.getUser()

  // The account the app shows (the oldest membership), so a login on two
  // accounts never reads the other one's plan here.
  const subQuery = supabase.from('subscriptions')
    .select('plan_id,status,trial_ends_at,current_period_end,price_kobo,founding_price_active,cancel_at_period_end')
  const [{ data: sub }, { data: plans }, entitlement] = await Promise.all([
    (accountId ? subQuery.eq('account_id', accountId) : subQuery).maybeSingle<Sub>(),
    supabase.from('plans').select('id,name,tier').returns<{ id: string; name: string; tier: string }[]>(),
    entitlementStatus(),
  ])

  const plan = plans?.find((p) => p.id === sub?.plan_id)
  const planName = plan?.name ?? sub?.plan_id ?? NOT_ENTERED

  // Entitlement is the DATABASE's verdict, read through
  // fn_my_entitlement_status(). This page never interprets a date to decide
  // whether someone may work -- it only displays the dates as facts.
  const boundary = entitlement?.boundary ?? sub?.current_period_end ?? null

  // Which billing buttons this person sees. The owner rule is a courtesy:
  // /api/billing and paystack-manage refuse anyone else on the server. While
  // the web's safety switch is off (lib/site/billing-words.ts) no self-serve
  // button shows for a paying account, and the owner is told to message us.
  const selfServe = billingSelfServe()
  const billingSub = sub ? { ...sub, tier: plan?.tier ?? null } : null
  const billing = accountBilling(billingSub, role, selfServe)
  const fixes = [billing.payNow && 'Pay now', billing.updateCard && 'Update your card'].filter(Boolean).join(' or ')
  const owner = role === 'owner'
  const paying = isPaying(billingSub)
  const endsOn = lagosLongDate(sub?.current_period_end ?? null)

  return (
    <div className="space-y-8">
      {/* Account sits under More (lib/nav.ts), which is the tab that lights. */}
      <BackLink href="/more">More</BackLink>

      <PageHeader title="Account" sub="Your business, your plan and your access." />

      {billing.ending ? (
        // Renewal is off and the paid month is still running. Said once, here.
        <Notice tone="info">{endingText(endsOn)}</Notice>
      ) : entitlement && (
        entitlement.entitled ? (
          <Notice tone="info">
            {entitlement.reason === 'trial_active'
              ? `You are on the free trial${boundary ? ` until ${fmtDate(boundary)}` : ''}.`
              : entitlement.reason === 'payment_failed_in_grace'
                ? (billing.payNow ? PAY_NOW_TEXT
                  : `We could not take your last payment. Your access continues while you sort it out.${fixes ? ` Use ${fixes} below.` : ''}`)
                : 'Your subscription is active.'}
          </Notice>
        ) : (
          <Notice>
            {billing.payNow
              ? PAY_NOW_TEXT
              : entitlement.reason === 'trial_ended'
                ? `Your free trial ended${boundary ? ` on ${fmtDate(boundary)}` : ''}.`
                : 'Your subscription has ended.'}{' '}
            Everything you entered is still here, and you can open and read every
            recipe and price.{billing.payNow ? '' : ' To record new work again, choose a plan.'}
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
              <dd>{billing.ending ? 'Not renewing' : planStatusLabel(sub.status)}</dd>

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
                  <dt style={{ color: 'var(--mm-muted)' }}>{billing.ending ? 'You paid' : 'You pay'}</dt>
                  <dd>{money(sub.price_kobo / 100)} a month</dd>
                </>
              )}

              {/* "Renews on", "Ends on" and "Access runs to" are the same date
                  meaning three different things, and the difference matters:
                  one is a promise to charge again, one says no charge is
                  coming, the last is a deadline. */}
              <dt style={{ color: 'var(--mm-muted)' }}>
                {billing.ending ? 'Ends on' : sub.status === 'active' ? 'Renews on' : 'Access runs to'}
              </dt>
              <dd>{fmtDate(sub.current_period_end)}</dd>
            </dl>
          </Card>
        )}

        <div className="flex flex-wrap gap-3">
          {billing.payNow && <PayNowButton tier={billing.payNow} className="w-full sm:w-auto" />}
          {billing.updateCard && <UpdateCardButton className="w-full sm:w-auto" variant={billing.payNow ? 'secondary' : undefined} />}
          <Link href="/subscribe" className={`mm-btn ${billing.payNow || billing.updateCard ? 'mm-btn-secondary' : 'mm-btn-primary'} w-full sm:w-auto`}>
            {paying ? (owner && selfServe ? 'Change your plan' : 'Plans & billing') : 'Choose a plan'}
          </Link>
        </div>

        {/* Owner only, while the plan renews or a payment is overdue (X1),
            and only while the switch is on. Staff see neither button; the
            server refuses them anyway. */}
        {billing.cancel && (
          <CancelPlan
            endsOn={endsOn}
            overdue={billing.overdue}
            founder={sub?.founding_price_active === true}
            support={<SupportContact />}
          />
        )}
        {billing.messageUs && (
          <p className="text-sm" data-billing="message-us">
            {MESSAGE_US} Write to <SupportContact />.
          </p>
        )}
        {paying && !owner && (
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            {OWNER_ONLY_NOTE} So are cancelling and changing the card.
          </p>
        )}

        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          Payments are handled by Paystack. Menu Master NG never sees or stores
          your card details.{' '}
          <Link href="/terms" className="underline">Terms</Link> ·{' '}
          <Link href="/refunds" className="underline">Refunds and cancellation</Link>
        </p>
      </section>

      {/* There is no download yet, so the promise is a person: the owner asks
          and we send the spreadsheet. The copy carries costs, so it is offered
          to the owner only. */}
      {owner && (
        <section className="space-y-3">
          <SectionHeading>Your records</SectionHeading>
          <Card>
            <p className="text-sm">
              Want a copy of your records? Message us and we send you a copy of
              your records as a spreadsheet, within one working day. Write
              to <SupportContact />.
            </p>
          </Card>
        </section>
      )}

      {/* A choice about this phone's data, not the account's, so it is
          kept on the phone (components/photo-preference.tsx). */}
      <section className="space-y-3">
        <SectionHeading>Photos</SectionHeading>
        <Card><PhotoPreference /></Card>
      </section>

      <section className="space-y-3">
        <SectionHeading>Sign-in</SectionHeading>
        <div className="flex flex-wrap gap-3">
          <Link href="/reset-password" className="mm-btn mm-btn-secondary">Change password</Link>
          <form action={signOut}>
            <Button variant="secondary" busyLabel="Signing out…">Sign out</Button>
          </form>
        </div>
      </section>
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default function AccountPage() {
  return <Suspense fallback={<Loading />}><AccountPageBody /></Suspense>
}
