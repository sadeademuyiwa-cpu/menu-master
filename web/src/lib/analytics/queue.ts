import 'server-only'
import { cookies } from 'next/headers'
import { EVENT_COOKIE, decodeQueue, encodeQueue, type AppEvent, type EventProps } from './events'

/**
 * Note that something worth measuring just happened, from a server action or
 * route handler. The browser reports it on the next page, and only if the
 * visitor accepted cookies; otherwise it is dropped there. Never throws: a
 * measurement must not be able to fail the work it measures.
 */
export async function queueEvent(e: AppEvent, p: EventProps = {}): Promise<void> {
  try {
    const jar = await cookies()
    const q = decodeQueue(jar.get(EVENT_COOKIE)?.value)
    q.push({ e, p })
    jar.set(EVENT_COOKIE, encodeQueue(q), { path: '/', maxAge: 300, sameSite: 'lax', httpOnly: false })
  } catch {
    // called somewhere cookies cannot be set (a server component): skip
  }
}
