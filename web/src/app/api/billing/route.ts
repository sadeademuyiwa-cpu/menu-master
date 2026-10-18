import { NextResponse, type NextRequest } from 'next/server'
import { currentContext } from '@/lib/data/context'
import { billingSelfServe } from '@/lib/site/billing-words'
import { billingCaller, billingRequest, manageAnswer, type Answer } from '@/app/(app)/subscribe/billing-api'

/**
 * Stop renewing, or get Paystack's update-card link, proxied.
 *
 * The same shape as /api/checkout, and for the same reasons: Vercel holds no
 * Paystack key and no service-role key. The secret lives only in the Supabase
 * Edge Function store, next to the webhook. This route checks the request
 * comes from our own pages (Origin, Sec-Fetch-Site, a JSON body), proves the
 * caller is signed in, and forwards the user's own access token with the one
 * thing the browser may choose: which action.
 *
 * Every decision is in subscribe/billing-api.ts, as pure functions with a
 * test for each branch; this file only gathers the facts.
 *
 * THE SAFETY SWITCH (X4)
 *   Unless BILLING_SELF_SERVE is exactly "on" on this server, every request
 *   is answered not_configured and nothing is sent: Cancel plan and Update
 *   your card are not offered then (lib/site/billing-words.ts).
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
 * "action":"card_link","link":"<https url>"}. Errors are {"error":"<code>"}.
 */
const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status })

export async function POST(request: NextRequest) {
  const asked = billingRequest({
    origin: request.headers.get('origin'),
    ownHosts: [request.nextUrl.host, request.headers.get('host')],
    fetchSite: request.headers.get('sec-fetch-site'),
    contentType: request.headers.get('content-type'),
    rawBody: await request.text().catch(() => ''),
    selfServe: billingSelfServe(),
  })
  if ('refuse' in asked) return reply(asked.refuse)
  const { action } = asked

  const { supabase, status, role } = await currentContext()
  const { data: { session } } = await supabase.auth.getSession()
  const refused = billingCaller({ contextStatus: status, role, hasSession: Boolean(session) })
  if (refused || !session) return reply(refused ?? { status: 401, body: { error: 'unauthorised' } })

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) {
    console.error('billing: NEXT_PUBLIC_SUPABASE_URL is not set')
    return reply({ status: 500, body: { error: 'not_configured' } })
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
    return reply({ status: 502, body: { error: 'paystack_error' } })
  }

  const payload = await res.json().catch(() => null)
  const answer = manageAnswer(action, res.status, payload)
  if (answer.outside) {
    console.error(`billing: manage function answered ${res.status} outside the contract; passed on as ${String(answer.body.error)}`)
  }
  return reply(answer)
}
