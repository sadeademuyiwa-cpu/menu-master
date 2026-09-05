import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // The tier is the ONLY thing the browser gets to choose. Amount, price tier,
  // founding eligibility and plan code are all resolved by fn_checkout_quote.
  const body = await request.json().catch(() => ({}))
  const tier = body?.tier
  if (tier !== 'costing' && tier !== 'trading') {
    return NextResponse.json({ error: 'choose_costing_or_trading' }, { status: 400 })
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
      body: JSON.stringify({ tier }),
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
