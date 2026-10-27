import { createClient } from '@/lib/supabase/client'
import { mayRecord } from '@/lib/usage-notice'

/**
 * Sends a screen beat or a friction event (0069) so that it survives the page
 * going away. supabase-js cannot ask for that: a beat sent as the page hides
 * or moves on was cut off with it, so the visit never said it had left. A
 * keepalive request outlives the page; the browser finishes it.
 *
 * The session is kept from the app's one Supabase client (a second client
 * would refresh the same session alongside it and can sign people out).
 * Until it is known, a send waits for it; with no session nothing is sent.
 * When the screen shows again after a long lock the token may have run out
 * before the client renews it, so a send made then asks the client first.
 * Nothing is sent before this person has seen the notice that this happens
 * (lib/usage-notice.ts). Errors are ignored: this must never get in anyone's way.
 */
type Held = { token: string; uid: string; expiresAt: number | null }
let held: Held | null = null
let ready: Promise<void> | null = null

type SessionLike = { access_token: string; expires_at?: number; user: { id: string } } | null
const keep = (s: SessionLike) => {
  held = s ? { token: s.access_token, uid: s.user.id, expiresAt: s.expires_at ?? null } : null
}

function watch(): Promise<void> {
  if (ready) return ready
  const supabase = createClient()
  supabase.auth.onAuthStateChange((_event, s) => keep(s))
  ready = supabase.auth.getSession()
    .then(({ data }) => { if (data.session) keep(data.session) })
    .catch(() => undefined)
  return ready
}

/** The session to send with: renewed first when it is about to run out and the page is showing. */
async function session(): Promise<Held | null> {
  await watch()
  const soon = held && (held.expiresAt === null || held.expiresAt * 1000 - Date.now() < 60_000)
  if (soon && document.visibilityState === 'visible') {
    const { data } = await createClient().auth.getSession().catch(() => ({ data: { session: null } }))
    keep(data.session)
  }
  return held
}

export function sendUsage(fn: 'fn_usage_beat' | 'fn_usage_event', args: Record<string, unknown>): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return
  void session().then((s) => {
    if (!s || !mayRecord(s.uid)) return
    return fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }).then(() => undefined)
  }).catch(() => undefined)
}
