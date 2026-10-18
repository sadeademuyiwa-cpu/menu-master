import { NextResponse, type NextRequest } from 'next/server'
import { currentContext } from '@/lib/data/context'
import { checkoutRefusal } from '@/app/(app)/subscribe/billing-choices'

/**
 * Checkout initialization, proxied.
 *
 * WHAT THIS DELIBERATELY DOES NOT HOLD
 *   No Paystack key, no service-role key, no price, no plan mapping. The
 *   secret lives in exactly one place -- the Supabase Edge Function secret
 *   store, next to the webhook that already uses it -- so Vercel holds no
 *   billing credential and a preview deployment cannot leak one.
 *
 * WHAT IT IS FOR
 *   Proving the caller is signed in before anything reaches Paystack, and
 *   keeping the request on our own origin. It forwards the user's own access
 *   token and the tier they chose. Nothing else crosses.
 *
 * THE TWO REFUSALS (contract K4), ANSWERED HERE FIRST
 *   already_on_plan (409): this tier is already paid for (active or past_due).
 *   owner_only (403): the account is already paying and the caller is not its
 *   owner. paystack-checkout makes both refusals itself, before any quote or
 *   founder hold, and is the authority. They are repeated here from the
 *   caller's own reads (the same rules, billing-choices.ts) so a refusal never
 *   depends on the edge function having been redeployed. This route only
 *   refuses; when its reads fail it says nothing and the edge function decides.
 */
export async function POST(request: NextRequest) {
  const { supabase, status, accountId, role } = await currentContext()
  const { data: { session } } = await supabase.auth.getSession()
  if (status === 'unauthenticated' || !session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // The tier is the ONLY thing the browser gets to choose. Amount, price tier,
  // founding eligibility and plan code are all resolved by fn_checkout_quote.
  const body = await request.json().catch(() => ({}))
  const tier = body?.tier
  if (tier !== 'costing' && tier !== 'trading') {
    return NextResponse.json({ error: 'choose_costing_or_trading' }, { status: 400 })
  }

  if (accountId) {
    const { data: sub } = await supabase.from('subscriptions')
      .select('plan_id,status,current_period_end,cancel_at_period_end')
      .eq('account_id', accountId)
      .maybeSingle<{
        plan_id: string; status: string
        current_period_end: string | null; cancel_at_period_end: boolean | null
      }>()
    if (sub) {
      const { data: plan } = await supabase.from('plans').select('tier')
        .eq('id', sub.plan_id).maybeSingle<{ tier: string }>()
      const refusal = checkoutRefusal({ ...sub, tier: plan?.tier ?? null }, tier, role)
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    }
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) {
    console.error('checkout: NEXT_PUBLIC_SUPABASE_URL is not set')
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 })
  }

  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/paystack-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      // Propose where to come back to. The edge function validates this
      // against an allowlist -- a preview must return to itself, because
      // production has no /checkout/callback until the cutover.
      body: JSON.stringify({ tier, origin: request.nextUrl.origin }),
    })
  } catch (e) {
    console.error('checkout: could not reach the checkout function', String(e))
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 })
  }

  // The edge function returns fixed error codes, never a provider message, so
  // this can be passed straight through without leaking anything.
  const payload = await res.json().catch(() => ({ error: 'provider_unavailable' }))
  return NextResponse.json(payload, { status: res.status })
}
