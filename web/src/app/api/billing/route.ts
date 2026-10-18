import { NextResponse, type NextRequest } from 'next/server'
import { currentContext } from '@/lib/data/context'

/**
 * Stop renewing, or get Paystack's update-card link, proxied.
 *
 * The same shape as /api/checkout, and for the same reasons: Vercel holds no
 * Paystack key and no service-role key. The secret lives only in the Supabase
 * Edge Function store, next to the webhook. This route proves the caller is
 * signed in, keeps the request on our own origin, and forwards the user's own
 * access token with the one thing the browser may choose: which action.
 *
 * THE OWNER RULE IS DECIDED ON THE SERVER, TWICE
 *   Here, from the caller's own membership (the oldest one, the account the
 *   app shows), so a staff member is refused before anything leaves Vercel.
 *   And again in paystack-manage, from memberships read with the service role,
 *   which is the authority. If the two ever disagree the edge function wins:
 *   this route only refuses, it never grants.
 *
 * WHAT IT NEVER DOES
 *   Write the subscription row. paystack-manage does not either: the webhook
 *   records the change when Paystack's subscription.not_renew arrives.
 *
 * Contract (K3): POST {"action":"cancel"} -> {"ok":true,"action":"cancel",
 * "ends_on":"<date or null>"}; POST {"action":"card_link"} -> {"ok":true,
 * "action":"card_link","link":"<url>"}. Errors are {"error":"<code>"}.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = body?.action
  if (action !== 'cancel' && action !== 'card_link') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const { supabase, status, role } = await currentContext()
  if (status === 'unauthenticated') {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }
  // A known role that is not owner is refused here. An unknown one (a failed
  // lookup) goes on to the edge function, which reads memberships itself.
  if (role && role !== 'owner') {
    return NextResponse.json({ error: 'owner_only' }, { status: 403 })
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) {
    console.error('billing: NEXT_PUBLIC_SUPABASE_URL is not set')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/paystack-manage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ action }),
    })
  } catch (e) {
    console.error('billing: could not reach the manage function', String(e))
    return NextResponse.json({ error: 'paystack_error' }, { status: 502 })
  }

  // The edge function returns fixed error codes, never a provider message, so
  // its answer is passed straight through. Anything else -- no JSON, or a
  // gateway's own error because the function is not deployed yet -- becomes
  // a fixed code, so no platform message reaches the screen.
  const payload = await res.json().catch(() => null) as Record<string, unknown> | null
  if (res.ok && payload?.ok === true) {
    return NextResponse.json(payload, { status: res.status })
  }
  if (!res.ok && typeof payload?.error === 'string') {
    return NextResponse.json({ error: payload.error }, { status: res.status })
  }
  console.error(`billing: manage function answered ${res.status} outside the contract`)
  return res.status === 404
    ? NextResponse.json({ error: 'not_configured' }, { status: 500 })
    : NextResponse.json({ error: 'paystack_error' }, { status: 502 })
}
