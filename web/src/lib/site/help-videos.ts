/**
 * Help videos: one YouTube video per screen, chosen by a platform admin
 * (site setting "help", 0065), played from a "Help" button at the top of
 * that screen.
 *
 * Kept free of React and Next imports so the rules can be tested directly.
 */

export type HelpScreen = {
  key: string
  /** What the admin sees beside the box, and the video's title in the app. */
  label: string
  group: 'Getting started' | 'Every day' | 'Dishes and prices' | 'Buying' | 'Selling' | 'Your business'
  /** Addresses this video belongs to; ":id" is any one path segment. */
  paths: string[]
}

export const HELP_SCREENS = [
  { key: 'login', label: 'Log in', group: 'Getting started', paths: ['/login', '/forgot-password', '/reset-password'] },
  { key: 'signup', label: 'Create your account', group: 'Getting started', paths: ['/signup', '/verify-email'] },
  { key: 'onboarding', label: 'Tell us about your business', group: 'Getting started', paths: ['/onboarding'] },
  { key: 'start', label: 'Set up your first dish', group: 'Getting started', paths: ['/start'] },

  { key: 'dashboard', label: 'Home', group: 'Every day', paths: ['/dashboard'] },
  { key: 'more', label: 'More', group: 'Every day', paths: ['/more'] },

  { key: 'recipes', label: 'Dishes', group: 'Dishes and prices', paths: ['/recipes'] },
  { key: 'recipe-new', label: 'Add a dish', group: 'Dishes and prices', paths: ['/recipes/new'] },
  { key: 'recipe', label: 'A dish: its cost and price', group: 'Dishes and prices', paths: ['/recipes/:id'] },
  { key: 'pricing', label: 'Prices', group: 'Dishes and prices', paths: ['/pricing'] },
  { key: 'formats', label: 'Sizes', group: 'Dishes and prices', paths: ['/formats', '/formats/:id'] },

  { key: 'purchases', label: 'Purchases', group: 'Buying', paths: ['/purchases'] },
  { key: 'purchase-new', label: 'Record a purchase', group: 'Buying', paths: ['/purchases/new'] },
  { key: 'purchase', label: 'A purchase, and correcting one', group: 'Buying', paths: ['/purchases/:id', '/purchases/:id/correct'] },
  { key: 'ingredients', label: 'Ingredients', group: 'Buying', paths: ['/ingredients'] },
  { key: 'ingredient', label: 'An ingredient and its measures', group: 'Buying', paths: ['/ingredients/:id'] },
  { key: 'suppliers', label: 'Suppliers and markets', group: 'Buying', paths: ['/suppliers'] },

  { key: 'sales', label: 'Sales', group: 'Selling', paths: ['/sales'] },
  { key: 'sale-new', label: 'Record a sale', group: 'Selling', paths: ['/sales/new'] },
  { key: 'sale', label: 'A sale and its receipt', group: 'Selling', paths: ['/sales/:id'] },
  { key: 'customers', label: 'Customers', group: 'Selling', paths: ['/customers', '/customers/:id'] },
  { key: 'quote', label: 'Price per head', group: 'Selling', paths: ['/quote'] },

  { key: 'reports', label: 'Reports', group: 'Your business', paths: ['/reports'] },
  { key: 'settings', label: 'Settings', group: 'Your business', paths: ['/settings'] },
  { key: 'people', label: 'People', group: 'Your business', paths: ['/settings/people'] },
  { key: 'account', label: 'Account', group: 'Your business', paths: ['/account'] },
  { key: 'subscribe', label: 'Plans and billing', group: 'Your business', paths: ['/subscribe'] },
] as const satisfies readonly HelpScreen[]

export type HelpScreenKey = (typeof HELP_SCREENS)[number]['key']

export const HELP_GROUPS = ['Getting started', 'Every day', 'Dishes and prices', 'Buying', 'Selling', 'Your business'] as const

/** A video as the app plays it. */
export type HelpVideo = { id: string; vertical: boolean; url: string }
export type HelpVideos = Partial<Record<HelpScreenKey, HelpVideo>>

const KEYS = new Set<string>(HELP_SCREENS.map((s) => s.key))
const ID = /^[A-Za-z0-9_-]{11}$/

function matches(pattern: string, pathname: string): boolean {
  const a = pattern.split('/')
  const b = pathname.split('/')
  // "/recipes/new" is its own screen, never a dish called "new".
  return a.length === b.length && a.every((seg, i) => (seg === ':id' ? b[i] !== '' && b[i] !== 'new' : seg === b[i]))
}

/** The screen an address belongs to, or null (admin pages, the website). */
export function helpScreenFor(pathname: string | null | undefined): HelpScreenKey | null {
  if (!pathname) return null
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return HELP_SCREENS.find((s) => s.paths.some((p) => matches(p, path)))?.key ?? null
}

/**
 * The video in a YouTube link, from any of the shapes YouTube hands out:
 * watch?v=, youtu.be/, /shorts/, /embed/, /live/, the music and mobile hosts,
 * or the bare 11-character id. Anything else is not a YouTube video: null.
 */
export function parseYouTube(input: unknown): HelpVideo | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (ID.test(raw)) return video(raw, false)
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  let id: string | undefined
  let vertical = false
  if (host === 'youtu.be') id = parts[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') id = u.searchParams.get('v') ?? undefined
    else if (['embed', 'live', 'v', 'shorts'].includes(parts[0] ?? '')) {
      id = parts[1]
      vertical = parts[0] === 'shorts'
    }
  }
  return id && ID.test(id) ? video(id, vertical) : null
}

function video(id: string, vertical: boolean): HelpVideo {
  return { id, vertical, url: vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` }
}

/** The privacy-enhanced player: no YouTube cookie until the viewer presses play. */
export function embedUrl(v: HelpVideo): string {
  return `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1&playsinline=1&autoplay=1`
}

/** The stored setting -> what the app plays. Unknown screens and bad links are dropped. */
export function parseHelpVideos(raw: unknown): HelpVideos {
  const out: HelpVideos = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEYS.has(k)) continue
    const parsed = parseYouTube(v)
    if (parsed) out[k as HelpScreenKey] = parsed
  }
  return out
}

/**
 * The admin's form -> the value to store: each screen's link written the one
 * way YouTube shows it. An empty box removes that screen's video; a box that
 * holds something other than a YouTube video stops the save and says which.
 */
export function checkHelpInput(input: Record<string, string | null | undefined>):
  { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const value: Record<string, string> = {}
  for (const s of HELP_SCREENS) {
    const text = (input[s.key] ?? '').trim()
    if (!text) continue
    const v = parseYouTube(text)
    if (!v) return { ok: false, error: `"${s.label}" needs a YouTube link, like https://youtu.be/… or https://www.youtube.com/watch?v=…` }
    value[s.key] = v.url
  }
  return { ok: true, value }
}

export function helpLabel(key: HelpScreenKey): string {
  return HELP_SCREENS.find((s) => s.key === key)?.label ?? 'This screen'
}
