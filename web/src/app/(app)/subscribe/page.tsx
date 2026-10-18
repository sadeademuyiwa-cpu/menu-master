import { Suspense } from 'react'
import Link from 'next/link'
import { currentContext, entitlementStatus } from '@/lib/data/context'
import { loadPlanOffers } from '@/lib/data/plans'
import { PageHeader, Card, Badge, Disclosure, SectionHeading, BackLink } from '@/components/ui'
import { money } from '@/lib/format'
import { parentTab } from '@/lib/nav'
import { daysLeft, planStatusLabel } from '@/lib/trial'
import { PlanChooser, type PlanRow } from '@/components/plan-chooser'
import { COSTING_FEATURES, TRADING_FEATURES, PLAN_FAQ as FAQ } from '@/lib/site/plan-features'
import { SupportContact } from '@/components/legal-page'
import { MESSAGE_US, billingSelfServe } from '@/lib/site/billing-words'
import {
  accountBilling, changeCaution, changeLabel, endingText, isLive, lagosLongDate,
  planAction, subscribeHeader,
} from './billing-choices'
import Loading from './skeleton'

export const dynamic = 'force-dynamic'

type Sub = {
  plan_id: string; status: string
  current_period_end: string | null; cancel_at_period_end: boolean | null
}

async function SubscribePageBody() {
  const { supabase, accountId, role } = await currentContext()
  // The account the app shows (the oldest membership), the same one
  // paystack-checkout bills, so the buttons here match its refusals.
  const subQuery = supabase.from('subscriptions').select('plan_id,status,current_period_end,cancel_at_period_end')
  const [{ offers, slotsLeft }, { data: sub }, entitlement] = await Promise.all([
    loadPlanOffers(supabase),
    (accountId ? subQuery.eq('account_id', accountId) : subQuery).maybeSingle<Sub>(),
    entitlementStatus(),
  ])

  const { data: currentPlan } = sub
    ? await supabase.from('plans').select('name,tier').eq('id', sub.plan_id).maybeSingle<{ name: string; tier: string }>()
    : { data: null }

  // What each card and the status line offer: decided here, on the server,
  // from the row, the caller's role and the web's safety switch
  // (billing-choices.ts, billing-words.ts). /api/checkout and
  // paystack-checkout make the same refusals themselves, so this is never the
  // only guard.
  const selfServe = billingSelfServe()
  const billingSub = sub ? { ...sub, tier: currentPlan?.tier ?? null } : null
  const { ending, cancel } = accountBilling(billingSub, role, selfServe)
  const owner = role === 'owner'
  const days = entitlement?.reason === 'trial_active' ? daysLeft(entitlement.boundary) : null
  const renews = lagosLongDate(sub?.current_period_end ?? null)

  const statusLine = !sub ? null
    : ending
      ? endingText(renews)
      : sub.status === 'trialing'
        ? (entitlement?.entitled
            ? `You are on the free trial${days !== null ? `: ${days === 0 ? 'it ends today' : `${days} day${days === 1 ? '' : 's'} left`}` : ''}.`
            : 'Your free trial has ended. Choose a plan to record new work again.')
        : sub.status === 'active'
          ? `You are on ${currentPlan?.name ?? 'a paid plan'}${renews ? `, renewing on ${renews}` : ''}.`
          : sub.status === 'past_due'
            ? (!owner
                ? 'We could not take your last payment. The account owner can put it right.'
                : selfServe
                  ? 'We could not take your last payment. Use Pay now or Update your card below to carry on.'
                  : 'We could not take your last payment. Message us and we help you pay again.')
            : sub.status === 'cancelled'
              ? 'Your plan has ended. Choose a plan to record new work again.'
              : `Your plan: ${planStatusLabel(sub.status)}.`

  // One name per thing: More calls this page "Plans & billing", so it does too.
  const tab = parentTab('/subscribe')

  const rows: PlanRow[] = offers.map((o) => ({
    tier: o.tier,
    name: o.name,
    price: money(o.monthly),
    monthly: o.monthly,
    was: o.isFounding && o.standard !== null ? money(o.standard) : null,
    isFounding: o.isFounding,
    available: o.monthly !== null && o.available,
    blurb: o.tier === 'costing'
      ? 'Know what your food costs and what to charge.'
      : 'Costing, plus everything you sell and who you sell to.',
    features: o.tier === 'costing' ? COSTING_FEATURES : TRADING_FEATURES,
    action: planAction(billingSub, o.tier, role, selfServe),
    changeLabel: changeLabel(billingSub, o.tier),
    caution: changeCaution(billingSub, o.tier, renews),
  }))

  return (
    // data-self-serve tells the account journey which state the server is in.
    <div className="space-y-5" data-self-serve={selfServe ? 'on' : 'off'}>
      {tab && <BackLink href={tab.href}>{tab.label}</BackLink>}
      <PageHeader title="Plans & billing" sub={subscribeHeader(billingSub, role, selfServe, MESSAGE_US)} />

      {statusLine && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{statusLine}</span>
            {sub && (
              <Badge tone={ending ? 'warn' : sub.status === 'active' ? 'good' : sub.status === 'trialing' ? 'plain' : 'warn'}>
                {ending ? 'Not renewing' : planStatusLabel(sub.status)}
              </Badge>
            )}
          </div>
          {cancel && (
            <p className="mt-2 text-sm" style={{ color: 'var(--mm-muted)' }}>
              To stop your plan, <Link href="/account" className="underline">cancel from your Account page</Link>.
            </p>
          )}
        </Card>
      )}

      {slotsLeft > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Founding offer</div>
            <Badge tone="good">{slotsLeft} of 100 left</Badge>
          </div>
          <p className="mt-2 text-sm" style={{ color: 'var(--mm-muted)' }}>
            Keep the founding price for as long as your subscription stays active.
          </p>
        </Card>
      )}

      <PlanChooser support={<SupportContact />} rows={rows} />

      {isLive(billingSub) && rows.some((r) => r.action === 'change') && (
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          Switching plan: your new plan starts the day you pay and your old plan
          stops, so you are never charged for both. Unused days on the old plan
          are not refunded.
        </p>
      )}

      <section className="space-y-2">
        <SectionHeading>Questions</SectionHeading>
        {FAQ.map(([q, a]) => (
          <Disclosure key={q} summary={q}>
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>{a}</p>
          </Disclosure>
        ))}
      </section>

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        Secure checkout by Paystack. Menu Master NG does not store your card details.{' '}
        <Link href="/refunds" className="underline">Refunds and cancellation</Link> ·{' '}
        <Link href="/terms" className="underline">Terms</Link>
      </p>
    </div>
  )
}

export default function SubscribePage() {
  return <Suspense fallback={<Loading />}><SubscribePageBody /></Suspense>
}
