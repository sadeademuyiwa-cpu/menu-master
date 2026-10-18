/**
 * A dish's picture: where its photo lives, and what it shows before there is
 * one (the tile's initials and colour).
 *
 * Kept free of React and Next imports so every rule is tested directly
 * (tests/dish-photo.test.mts), and so a server component, a client component
 * and the root layout's inline script can all use it.
 *
 * THE CONTRACT WITH THE DATABASE (migration 0063)
 *   - recipes.photo_path, nullable: the FULL photo's object name.
 *   - Storage bucket 'dish', public by link, 512 KB per file, JPEG and WebP only.
 *   - Object name "<business_id>/<recipe_id>/<random>.<webp|jpg>", and its
 *     thumbnail "<business_id>/<recipe_id>/<random>-320.<webp|jpg>" beside it.
 *     The first folder is the business, which is what the upload policy checks.
 *
 * PUBLIC BY LINK is the owner's decision: a photo costs her customers less
 * data that way and is ready for a shared menu later. What keeps it private
 * in practice is the random part of the name, 128 bits from the browser's
 * crypto, which nobody can guess or list. A dish photo is food, never a
 * receipt and never a person (the picker says so).
 */

export const DISH_BUCKET = 'dish'
/** The bucket's own limit (0063). The phone shrinks well under it. */
export const DISH_PHOTO_MAX_BYTES = 512 * 1024
/** The only kinds the bucket accepts, and the extension each is stored under. */
export const DISH_PHOTO_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg' } as const
export type DishPhotoType = keyof typeof DISH_PHOTO_TYPES
export type DishPhotoExt = (typeof DISH_PHOTO_TYPES)[DishPhotoType]
/** The full copy's longest side, in pixels: the dish page header (about 120 KB). */
export const DISH_FULL_PX = 1080
/** The thumbnail's SHORTER side, in pixels (about 15-20 KB). Shorter, not
 *  longer: lists crop it to a square and Home to 4:3, so a landscape photo
 *  320 px long would be blurred to fill a 160 px card on a 2x phone. */
export const DISH_THUMB_PX = 320
/** ...and its longest side, so a panorama does not make a heavy thumbnail. */
export const DISH_THUMB_MAX_PX = 640
export type DishPhotoSize = 'thumb' | 'full'

/**
 * The pixel size the phone shrinks a photo to before upload, keeping its
 * shape and never enlarging it. Null for a picture with no usable size, so
 * the caller says so instead of uploading nothing.
 */
export function dishPhotoDimensions(
  width: number,
  height: number,
  size: DishPhotoSize,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const scale = size === 'full'
    ? Math.min(1, DISH_FULL_PX / long)
    : Math.min(1, DISH_THUMB_PX / short, DISH_THUMB_MAX_PX / long)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Who may add, change or remove a dish photo: owner, manager and kitchen,
 * the people who edit dishes (0063's storage policies, after 0015/0028 for
 * recipes). A COURTESY for showing the button, never an authorization: the
 * storage policies refuse anyone else, on a lapsed subscription too.
 */
export const DISH_PHOTO_ROLES = ['owner', 'manager', 'kitchen'] as const

export function canAddDishPhotos(role: string | null | undefined): boolean {
  return (DISH_PHOTO_ROLES as readonly string[]).includes(role ?? '')
}

/** The account's state, as fn_my_entitlement_status() gives it; null when not known. */
export type PhotoAccess = { entitled: boolean; reason: string } | null | undefined

/**
 * What the photo button says when storage refuses the upload (403), worked
 * out on the server from the person's role and the account's state, and
 * handed to DishPhotoUpload. It used to tell everyone, the owner included,
 * "Ask the owner." after a trial ended.
 *
 *   wrong role                   the role, and ask the owner
 *   paused, owner                why, and choose a plan (or update the card)
 *   paused, manager or kitchen   why, and ask the owner to
 *   live or not known            no reason is claimed
 */
export function photoRefusal(role: string | null | undefined, access: PhotoAccess): string {
  if (!canAddDishPhotos(role)) return 'Your role does not allow adding photos. Ask the owner.'
  const owner = role === 'owner'
  if (access && access.entitled === false) {
    const card = access.reason === 'payment_failed'
    const why = access.reason === 'trial_ended' ? 'Your free trial has ended'
      : card ? 'We could not take your last payment'
        : access.reason === 'subscription_ended' ? 'Your subscription has ended'
          : 'This account has no plan at the moment'
    const fix = owner
      ? (card ? 'Update your card on Plans & billing to add them again.' : 'Choose a plan on Plans & billing to add them again.')
      : (card ? 'Ask the owner to update the card on Plans & billing.' : 'Ask the owner to choose a plan.')
    return `${why}, so photos can’t be added. ${fix}`
  }
  return owner
    ? 'That photo could not be added just now. Reload the page and try again.'
    : 'That photo could not be added just now. Reload the page and try again, or ask the owner.'
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RANDOM = '[0-9a-f]{32}'
/** A full photo's name. The thumbnail's "-320" cannot match RANDOM, so a
 *  thumbnail's name is never mistaken for the photo itself. */
const PHOTO_PATH = new RegExp(`^(${UUID})/(${UUID})/${RANDOM}\\.(webp|jpg)$`, 'i')

/**
 * Is this a photo name that belongs to this business (and, when given, this
 * dish)? A server action saving recipes.photo_path checks this before it
 * writes, so a form cannot point one business's dish at another's file. The
 * database's own check (0063) is still the authority.
 */
export function isDishPhotoPath(
  path: string | null | undefined,
  businessId: string | null | undefined,
  recipeId?: string | null,
): boolean {
  if (!path || !businessId) return false
  const m = PHOTO_PATH.exec(path)
  if (!m) return false
  if (m[1].toLowerCase() !== businessId.toLowerCase()) return false
  return recipeId ? m[2].toLowerCase() === recipeId.toLowerCase() : true
}

/** The thumbnail's name beside a full photo: "<...>/<random>-320.<ext>". */
export function dishThumbPath(path: string): string {
  return path.replace(/\.(webp|jpg)$/i, (ext) => `-${DISH_THUMB_PX}${ext}`)
}

/**
 * The public address of a dish photo, or null when there is none to show.
 *
 * `path` is recipes.photo_path (the full photo). 'thumb' is what every list,
 * grid and sale tile shows (about 15 KB); 'full' is for the dish page header
 * only (about 120 KB). Null when the name is not a dish photo's name or the
 * Supabase address is not configured, so the caller shows the tile instead
 * of a broken picture.
 */
export function dishPhotoUrl(path: string | null | undefined, size: DishPhotoSize = 'thumb'): string | null {
  if (!path || !PHOTO_PATH.test(path)) return null
  // Written out in full: Next.js inlines NEXT_PUBLIC_ values into the browser
  // bundle only where they appear literally.
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  if (!base) return null
  const name = size === 'thumb' ? dishThumbPath(path) : path
  return `${base}/storage/v1/object/public/${DISH_BUCKET}/${name.split('/').map(encodeURIComponent).join('/')}`
}

/** 32 random hex characters (128 bits). randomUUID needs a secure page;
 *  getRandomValues works everywhere, including a phone on a LAN address. */
function randomPart(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') {
    try { return c.randomUUID().replace(/-/g, '') } catch { /* not a secure context */ }
  }
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The names a new photo and its thumbnail are uploaded under. A fresh random
 *  part each time, so a changed photo is a new address and no phone keeps
 *  showing the old one from its year-long cache. */
export function newDishPhotoPaths(
  businessId: string,
  recipeId: string,
  ext: DishPhotoExt,
): { full: string; thumb: string } {
  const full = `${businessId.toLowerCase()}/${recipeId.toLowerCase()}/${randomPart()}.${ext}`
  return { full, thumb: dishThumbPath(full) }
}

// ---------------------------------------------------------------------------
// THE TILE: what a dish shows before its photo is taken (components/dish-tile.tsx)
// ---------------------------------------------------------------------------

/**
 * The tile's letters: the first letter of each of the first two words.
 * "Jollof rice" -> "JR", "Puff-puff" -> "P", "(Party) jollof" -> "PJ". A
 * name with no letters or digits gets no letters; the tile shows its bowl.
 */
export function dishInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/)
  let out = ''
  for (const w of words) {
    const first = /[\p{L}\p{N}]/u.exec(w)
    if (!first) continue
    out += first[0].toLocaleUpperCase('en-NG')
    if (out.length === 2) break
  }
  return out
}

/**
 * The tile's colour, chosen from the name so a dish keeps its colour
 * everywhere and on every visit. Brand greens only (branding/04-colour/
 * palette.md): Forest with white letters, Kitchen Green with white,
 * Surface 2 with Forest letters, and white with a Kitchen Green border.
 * Never gold (one gold thing per screen), amber or red (they are warnings)
 * or mint (the badge fill), so a grid of tiles never reads as a grid of alerts.
 */
export const DISH_TILE_TONES = ['forest', 'kitchen', 'soft', 'outline'] as const
export type DishTileTone = (typeof DISH_TILE_TONES)[number]

export function dishTileTone(name: string | null | undefined): DishTileTone {
  // FNV-1a over the name as the owner would recognise it: case and extra
  // spaces do not change a dish's colour.
  const key = (name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-NG')
  let h = 0x811c9dc5
  for (const ch of key) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return DISH_TILE_TONES[h % DISH_TILE_TONES.length]
}

// ---------------------------------------------------------------------------
// "HIDE PHOTOS TO SAVE DATA" (components/photo-preference.tsx)
// ---------------------------------------------------------------------------

/** This phone's choice, in localStorage: 'off' hides photos, 'on' shows them. */
export const PHOTO_PREFERENCE_KEY = 'mm_photos'
/** Set on <html> as data-photos; globals.css hides .mm-dish-photo when 'off'. */
export type PhotoPreference = 'on' | 'off'

/**
 * Runs in <head> before the first paint (app/layout.tsx), so a phone that
 * chose "hide photos" never flashes them. With no choice saved, the phone's
 * own data saver decides. Each read is guarded on its own: a browser that
 * refuses localStorage still has its data saver respected, and nothing here
 * can stop the page from loading.
 *
 * The root layout must stay static (the landing and sign-in pages are), so
 * the choice cannot come from a cookie read on the server. It lives on the
 * phone, which is also where the data is spent.
 */
export const PHOTO_PREFERENCE_SCRIPT =
  '(function(){try{var p=null;' +
  `try{p=localStorage.getItem('${PHOTO_PREFERENCE_KEY}')}catch(e){}` +
  'var c=navigator.connection;' +
  "document.documentElement.setAttribute('data-photos'," +
  "p==='off'||p==='on'?p:(c&&c.saveData?'off':'on'))}catch(e){}})()"
