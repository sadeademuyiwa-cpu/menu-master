import { dishInitials, dishPhotoUrl, dishTileTone } from '@/lib/dish-photo'

export type DishTileSize = 'xs' | 'sm' | 'md' | 'lg' | 'card'

/**
 * A dish's picture: her own photo when she has taken one, and until then a
 * tile with the dish's first letters and a faint Rising Bowl.
 *
 * The tile is plainly a placeholder and never pretends to be her food: no
 * stock photo, no drawing of a plate, ever. Its colour comes from the dish
 * name (lib/dish-photo.ts), brand greens only, so the same dish looks the same
 * on Home, the dish list, the sale screen and the dish page.
 *
 * The photo sits ON the tile, not instead of it, so a slow connection or a
 * failed photo still shows the tile underneath, and the name, price and "+"
 * beside it work before the photo arrives. Every photo is loading="lazy": it
 * is fetched only as it scrolls into view, and a photo hidden by "Hide photos
 * to save data" (html[data-photos=off], globals.css) is never fetched at all,
 * because a lazy image that is not displayed never comes into view. Keep it
 * lazy even on the dish page header, or the switch stops saving data there.
 *
 * Decorative (aria-hidden): the dish name is always printed beside it, so
 * reading out "JR" or "photo of" would only repeat it.
 *
 * Server-safe: no hooks and no 'use client', so a server page and a client
 * component (the sale screen) can both render it.
 *
 * Sizes: xs 32px, sm 40px, md 56px (squares, for rows and lists); card fills
 * its box at 4:3 (the Home grid); lg fills the width at 16:9, up to 240px
 * tall (the dish page header, and the only size that loads the full photo).
 */
export function DishTile({
  name, photoPath, size = 'md', className = '',
}: {
  /** The dish's own name. Chooses the letters and the colour. */
  name: string
  /** recipes.photo_path, when the dish has a photo. */
  photoPath?: string | null
  size?: DishTileSize
  className?: string
}) {
  const initials = dishInitials(name)
  const src = photoPath ? dishPhotoUrl(photoPath, size === 'lg' ? 'full' : 'thumb') : null
  return (
    <span
      className={`mm-dish-tile ${className}`.trim()}
      data-size={size}
      data-tone={dishTileTone(name)}
      data-blank={initials ? undefined : true}
      aria-hidden="true"
    >
      {/* The Rising Bowl in one colour (the tile's own), never its gold:
          paths from components/brand-mark.tsx. */}
      <svg className="mm-dish-tile-mark" viewBox="230 218 620 520" focusable="false">
        <path d="M400 330a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v80h-80z" />
        <path d="M500 282a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v98l-40 75l-40-75z" />
        <path d="M600 232a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v178h-80z" />
        <path
          fillRule="evenodd"
          d="M230 405h620a310 290 0 0 1-620 0z M292 432h128v191a250 232 0 0 1-128-191z M788 432h-128v191a250 232 0 0 0 128-191z M495 405l45 80l45-80v245h-90z"
        />
        <path d="M420 690V405h75l45 80l45-80h75v285h-75V540l-45 70l-45-70v150z" />
        <rect x="395" y="700" width="290" height="38" rx="14" />
      </svg>
      {initials && <span className="mm-dish-tile-initials">{initials}</span>}
      {src && (
        // A plain <img>: the photo is already sized on the phone (320 / 1080 px)
        // and served from Supabase with a year's cache; next/image would only
        // fetch it again through this server. data-initials: a photo that
        // fails repaints the tile's letters over the browser's broken-image
        // icon (.mm-dish-photo::before in globals.css).
        // eslint-disable-next-line @next/next/no-img-element
        <img className="mm-dish-photo" src={src} alt="" loading="lazy" decoding="async" data-initials={initials} />
      )}
    </span>
  )
}
