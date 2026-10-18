/**
 * Every answer /api/billing gives, as pure functions (tests/billing-api.test.mts).
 *
 * The route (app/api/billing/route.ts) only gathers facts -- headers, the
 * body, the caller's context, the edge function's reply -- and returns what
 * these decide. Three steps, in order:
 *
 *   1. billingRequest: is this a request we accept at all? Our own origin,
 *      a JSON body, one of the two actions, and the web's safety switch on.
 *      Decided before anything is read or sent.
 *   2. billingCaller: is the caller signed in, and not a known non-owner?
 *      A non-owner is refused here, before anything leaves Vercel.
 *   3. manageAnswer: what paystack-manage replied, reduced to the contract
 *      (K3). A contract answer passes through; anything else -- a gateway's
 *      own error, a missing function, a reply of the wrong shape -- becomes a
 *      fixed code, so no platform message reaches the screen.
 *
 * Kept free of imports, like billing-choices.ts beside it.
 */

export type BillingAction = 'cancel' | 'card_link'

/**
 * A status and a JSON body, for NextResponse.json. outside is set when the
 * edge function's reply was not a contract reply, so the route logs it.
 */
export type Answer = { status: number; body: Record<string, unknown>; outside?: true }

const refuse = (status: number, error: string): Answer => ({ status, body: { error } })

/**
 * The Origin header, when the browser sent one, must be one of ours. No
 * Origin (an older browser, a same-origin GET-style client) is allowed: the
 * session cookies are SameSite=Lax, so a cross-site form post carries no
 * session anyway; this is the second lock on a button that cannot be undone.
 */
export function originAllowed(origin: string | null | undefined, ownHosts: (string | null | undefined)[]): boolean {
  if (origin === null || origin === undefined || origin === '') return true
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return false // "null" (a sandboxed frame) and anything unparsable
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const host = u.host.toLowerCase()
  return ownHosts.some((h) => typeof h === 'string' && h.length > 0 && h.toLowerCase() === host)
}

/** application/json, with or without a charset. */
export function isJson(contentType: string | null | undefined): boolean {
  return (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/json'
}

/** Step 1: the request itself. */
export function billingRequest(f: {
  origin: string | null | undefined
  /** request.nextUrl.host and the Host header: the hosts this app answers on. */
  ownHosts: (string | null | undefined)[]
  /** The Sec-Fetch-Site header, when sent. */
  fetchSite: string | null | undefined
  contentType: string | null | undefined
  /** The raw request body. */
  rawBody: string
  /** The web's safety switch (billing-words.ts billingSelfServe). */
  selfServe: boolean
}): { action: BillingAction } | { refuse: Answer } {
  if (f.fetchSite === 'cross-site' || !originAllowed(f.origin, f.ownHosts)) {
    return { refuse: refuse(403, 'bad_origin') }
  }
  if (!isJson(f.contentType)) return { refuse: refuse(415, 'bad_request') }
  let body: unknown
  try {
    body = JSON.parse(f.rawBody)
  } catch {
    return { refuse: refuse(400, 'bad_request') }
  }
  const action = (body as Record<string, unknown> | null)?.action
  if (action !== 'cancel' && action !== 'card_link') return { refuse: refuse(400, 'bad_request') }
  // Switch off: Cancel plan and Update your card are not offered, and a
  // request made anyway is answered as if the service were not there.
  if (!f.selfServe) return { refuse: refuse(500, 'not_configured') }
  return { action }
}

/** Step 2: the caller. Null means go on to the edge function. */
export function billingCaller(f: {
  /** currentContext's status. */
  contextStatus: string
  /** The caller's role on the account the app shows; unknown after a failed lookup. */
  role: string | null | undefined
  /** A session (access token) to forward. */
  hasSession: boolean
}): Answer | null {
  if (f.contextStatus === 'unauthenticated') return refuse(401, 'unauthorised')
  // A known role that is not owner is refused here. An unknown one (a failed
  // lookup) goes on to the edge function, which reads memberships itself.
  if (f.role && f.role !== 'owner') return refuse(403, 'owner_only')
  if (!f.hasSession) return refuse(401, 'unauthorised')
  return null
}

/** A contract error code: lower case words, never a sentence from a platform. */
function isCode(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z][a-z_]{1,39}$/.test(v)
}

/** ends_on as the contract allows it: a date or timestamp string, else null. */
function readEndsOn(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][0-9:.+\-Z]*)?$/.test(v) ? v : null
}

/**
 * Step 3: paystack-manage's reply, as the browser will see it.
 *   2xx {ok:true} for this action      the contract body, rebuilt field by
 *                                      field; a card link must be https
 *   non-2xx {error:"<code>"}           passed through, same status
 *   401 with no contract code          unauthorised (the gateway refused the token)
 *   404 with no contract code          not_configured 500 (not deployed)
 *   anything else                      paystack_error 502
 */
export function manageAnswer(action: BillingAction, status: number, payload: unknown): Answer {
  const p = (payload && typeof payload === 'object' ? payload : null) as Record<string, unknown> | null
  const ok = status >= 200 && status < 300
  if (ok && p?.ok === true && (p.action === undefined || p.action === action)) {
    if (action === 'cancel') {
      return { status: 200, body: { ok: true, action: 'cancel', ends_on: readEndsOn(p.ends_on) } }
    }
    if (typeof p.link === 'string' && /^https:\/\//i.test(p.link)) {
      return { status: 200, body: { ok: true, action: 'card_link', link: p.link } }
    }
    return { ...refuse(502, 'paystack_error'), outside: true }
  }
  if (!ok && isCode(p?.error)) return refuse(status, p.error as string)
  if (status === 401) return { ...refuse(401, 'unauthorised'), outside: true }
  if (status === 404) return { ...refuse(500, 'not_configured'), outside: true }
  return { ...refuse(502, 'paystack_error'), outside: true }
}
