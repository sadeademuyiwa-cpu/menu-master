/**
 * Which screen a person is on, said safely (0069). The app records a route
 * PATTERN -- /recipes/:id, never the id, the query string or anything typed --
 * plus the help-video screen key when the screen has one, and a device class.
 *
 * Pure, no imports: node --test runs it as it is. The database checks the
 * same shapes again (usage_views constraints) and drops anything else.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** "/recipes/3f2…-…/edit?x=1" -> "/recipes/:id/edit". Lower case, at most 100 characters. */
export function routePattern(pathname: string | null | undefined): string {
  const bare = (pathname ?? '/').split(/[?#]/)[0]
  const parts = bare.split('/').filter(Boolean).map((seg) => {
    const s = seg.toLowerCase()
    if (UUID.test(s) || /^\d+$/.test(s)) return ':id'
    return s.replace(/[^a-z0-9_-]/g, '').slice(0, 40)
  }).filter(Boolean)
  return ('/' + parts.join('/')).slice(0, 100)
}

/** The setup step is not in the URL when there is no ?step=; the page says it. */
export function withSetupStep(pattern: string, step: string | null | undefined): string {
  if (pattern !== '/start' || !step || !/^[a-z]{1,20}$/.test(step)) return pattern
  return `/start/${step}`
}

export type Device = 'phone' | 'tablet' | 'desktop'

/**
 * A touch screen is a phone or a tablet, told apart by its SHORTER side, so a
 * phone held sideways is still a phone; a mouse or trackpad is a computer,
 * however narrow its window.
 */
export function deviceFor(width: number, height: number, coarsePointer: boolean): Device {
  if (!coarsePointer) return 'desktop'
  return Math.min(width, height) < 600 ? 'phone' : 'tablet'
}

/** A beat a minute while the screen is showing; idle after 5 minutes without a touch or key. */
export const BEAT_MS = 60_000
export const IDLE_MS = 5 * 60_000
/** Untouched this long, a showing screen stops beating: open, not in use. */
export const LONG_IDLE_MS = 30 * 60_000
/** One visit runs at most this long; then a fresh one starts on the same screen. */
export const VISIT_MAX_MS = 12 * 60 * 60_000

/** "Live" means a beat in the last 150 seconds from a showing screen; "recent" within 30 minutes. */
export function presence(lastSeenAt: string, state: string, now = new Date()): 'live' | 'recent' | 'away' {
  const age = now.getTime() - new Date(lastSeenAt).getTime()
  if (age <= 150_000 && (state === 'active' || state === 'idle')) return 'live'
  if (age <= 30 * 60_000) return 'recent'
  return 'away'
}

/** "4 min", "1 h 5 min", "35 s" -- how long on a screen. */
export function durationWords(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** A route pattern as words, for a screen with no help-video key: "/recipes/:id" -> "Recipes › one item". */
export function pathWords(pattern: string | null | undefined): string {
  if (!pattern || pattern === '/') return 'Home page'
  return pattern.split('/').filter(Boolean)
    .map((s) => (s === ':id' ? 'one item' : s.replace(/[-_]/g, ' ')))
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' › ')
}

/** "just now", "4 min ago", "2 h ago", "3 days ago": how long since a beat. */
export function agoWords(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** What a person's latest visit says about them, for the admin's Live now. */
export function stateWords(lastSeenAt: string, state: string, now = new Date()): { word: string; tone: 'good' | 'neutral' | 'warn' } {
  const p = presence(lastSeenAt, state, now)
  if (p === 'live') return state === 'idle' ? { word: 'Open, not in use', tone: 'neutral' } : { word: 'Using it now', tone: 'good' }
  if (state === 'hidden') return { word: 'Switched away', tone: 'neutral' }
  if (state === 'left') return { word: 'Left', tone: 'neutral' }
  return { word: 'Went quiet', tone: 'neutral' }       // closed, or lost the connection
}
