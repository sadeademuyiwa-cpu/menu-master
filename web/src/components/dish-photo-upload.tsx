'use client'

import { useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { InfoHint } from '@/components/ui'
import {
  DISH_BUCKET, DISH_PHOTO_MAX_BYTES, dishPhotoDimensions, newDishPhotoPaths,
  type DishPhotoExt, type DishPhotoSize,
} from '@/lib/dish-photo'

type Shrunk = { blob: Blob; type: 'image/webp' | 'image/jpeg'; ext: DishPhotoExt }

/** The picture she chose, ready to draw, the right way up. */
async function open(file: File): Promise<{ draw: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    // from-image: a phone photo taken sideways is stored sideways with a note
    // saying so; this turns it upright before it is drawn.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { draw: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() }
  } catch {
    // Older Safari: an <img> applies the same note by itself.
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      URL.revokeObjectURL(url)
      throw new Error('unreadable')
    }
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * One copy of the photo, redrawn at its new size. Redrawing on a canvas is
 * also what removes the camera's notes from the file, the kitchen's GPS
 * location among them: only the pixels are kept.
 *
 * WebP where the browser can write it, JPEG otherwise (a browser that cannot
 * write WebP hands back a PNG, which the bucket refuses). Quality steps down
 * until the copy fits the bucket's 512 KB. `only` makes the thumbnail the
 * same kind as the photo, so its name is the photo's name with -320.
 */
async function shrink(
  src: { draw: CanvasImageSource; width: number; height: number },
  size: DishPhotoSize,
  only?: Shrunk['type'],
): Promise<Shrunk | null> {
  const dim = dishPhotoDimensions(src.width, src.height, size)
  if (!dim) return null
  const canvas = document.createElement('canvas')
  canvas.width = dim.width
  canvas.height = dim.height
  const g = canvas.getContext('2d')
  if (!g) return null
  g.imageSmoothingQuality = 'high'
  g.drawImage(src.draw, 0, 0, dim.width, dim.height)
  const kinds: Shrunk['type'][] = only ? [only] : ['image/webp', 'image/jpeg']
  for (const type of kinds) {
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await encode(canvas, type, quality)
      if (!blob || blob.type !== type) break // this browser cannot write this kind
      if (blob.size <= DISH_PHOTO_MAX_BYTES) return { blob, type, ext: type === 'image/webp' ? 'webp' : 'jpg' }
    }
  }
  return null
}

/**
 * Storage's own words never reach the page. A refusal (403) says `refusal`,
 * which the page worked out from the person's role and the account's state
 * (photoRefusal in lib/dish-photo.ts), so an owner whose trial ended is told
 * to choose a plan, not to "ask the owner".
 */
function uploadProblem(
  err: { message?: string; statusCode?: string | number; status?: number } | null,
  refusal?: string,
): string {
  const code = String(err?.statusCode ?? err?.status ?? '')
  const msg = (err?.message ?? '').toLowerCase()
  if (code === '404' || msg.includes('bucket not found')) return 'Dish photos are not switched on for this business yet.'
  if (code === '403' || msg.includes('row-level security') || msg.includes('unauthorized')) {
    return refusal ?? 'Your role or your plan does not allow adding photos at the moment.'
  }
  if (code === '413' || msg.includes('exceeded') || msg.includes('too large')) return 'That photo is still too large after shrinking. Try another.'
  return 'The photo did not finish sending. Check your connection and try again.'
}

/**
 * "Add a photo" for a dish: her own picture of her own food.
 *
 * The phone offers its camera or its gallery (photos she already sent on
 * WhatsApp included). Before anything is sent, the phone shrinks it to a
 * 1080 px copy for the dish page (about 120 KB) and a 320 px thumbnail for
 * lists (about 15 KB) -- never the 3-6 MB camera original -- and in doing so
 * drops the camera's location. Both go to the public 'dish' bucket under a
 * fresh unguessable name (lib/dish-photo.ts); then `action` saves the name on
 * the dish.
 *
 * Show it only to owner, manager and kitchen: canAddDishPhotos(ctx.role) in
 * lib/dish-photo.ts. Storage refuses everyone else anyway.
 *
 * REFUSAL: pass photoRefusal(ctx.role, await entitlementStatus()) so a refused
 * upload names the real reason for this person.
 *
 * THE ACTION you pass (a server action, written beside the dish page) gets
 *   recipe_id   the dish
 *   photo_path  the new photo's name, or '' to remove the photo
 *   return_to   the page to come back to
 * and must check isDishPhotoPath(photo_path, businessId, recipe_id) before it
 * writes recipes.photo_path (null for ''), then revalidate and redirect with
 * ?notice=, like every other action. The old files stay in the bucket; a
 * changed photo is a new name, so no phone keeps showing the old one.
 */
export function DishPhotoUpload({
  businessId, recipeId, photoPath, action, returnTo, refusal,
}: {
  businessId: string
  recipeId: string
  /** recipes.photo_path now, so the button can say "Change photo" and offer Remove. */
  photoPath?: string | null
  /** The server action that saves recipes.photo_path. See above. */
  action: (formData: FormData) => Promise<void>
  /** Where to land afterwards. Default: the page this is on. */
  returnTo?: string
  /** What a refused upload says, for this person (photoRefusal). */
  refusal?: string
}) {
  const pathname = usePathname() ?? ''
  const picker = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const back = returnTo ?? pathname

  /** Sends the chosen photo, then saves its name. Runs as the form's action,
   *  so the button shows it is busy until the page comes back. */
  async function send(formData: FormData) {
    setProblem(null)
    const file = formData.get('photo')
    if (!(file instanceof File) || file.size === 0) return
    if (!file.type.startsWith('image/')) return setProblem('Choose a photo.')

    let shrunk: { full: Shrunk; thumb: Shrunk } | null = null
    try {
      const src = await open(file)
      try {
        const full = await shrink(src, 'full')
        const thumb = full && await shrink(src, 'thumb', full.type)
        shrunk = full && thumb ? { full, thumb } : null
      } finally {
        src.done()
      }
    } catch {
      return setProblem('This phone could not open that picture. Try another, or take one with the camera.')
    }
    if (!shrunk) return setProblem('That picture could not be made small enough to send. Try another.')
    const { full, thumb } = shrunk

    const names = newDishPhotoPaths(businessId, recipeId, full.ext)
    const supabase = createClient()
    const bucket = supabase.storage.from(DISH_BUCKET)
    // A year's cache: a name is never reused, so a phone never needs to ask again.
    const opts = (type: string) => ({ contentType: type, cacheControl: '31536000', upsert: false })
    // Raw bytes with their type, as the admin's website upload sends them
    // (components/image-field.tsx). Handed a Blob, storage-js wraps it in a
    // multipart form instead, which the local gateway refuses (415) and which
    // would leave the stored type to the server's guess.
    const sentThumb = await bucket.upload(names.thumb, await thumb.blob.arrayBuffer(), opts(thumb.type))
    if (sentThumb.error) return setProblem(uploadProblem(sentThumb.error as never, refusal))
    const sentFull = await bucket.upload(names.full, await full.blob.arrayBuffer(), opts(full.type))
    if (sentFull.error) {
      // Leave no thumbnail without its photo.
      await bucket.remove([names.thumb]).catch(() => undefined)
      return setProblem(uploadProblem(sentFull.error as never, refusal))
    }

    const save = new FormData()
    save.set('recipe_id', recipeId)
    save.set('photo_path', names.full)
    save.set('return_to', back)
    await action(save)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form ref={form} action={send}>
          <input
            ref={picker}
            type="file"
            name="photo"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={() => form.current?.requestSubmit()}
          />
          <Button type="submit" variant="secondary" busyLabel="Sending the photo…"
                  onClick={(e) => { e.preventDefault(); picker.current?.click() }}>
            {photoPath ? 'Change photo' : 'Add a photo'}
          </Button>
        </form>
        {photoPath && (
          <form action={action}>
            <input type="hidden" name="recipe_id" value={recipeId} />
            <input type="hidden" name="photo_path" value="" />
            <input type="hidden" name="return_to" value={back} />
            <Button variant="secondary" busyLabel="Removing…">Remove photo</Button>
          </form>
        )}
        {/* The tips sit behind an (i), not as two lines on every dish page,
            and go once she has a photo. At the row's right end, because the
            popover opens leftwards from its button. */}
        {!photoPath && (
          <div className="ml-auto">
            <InfoHint label="Tips for a good photo">
              Daylight from a window, shoot from above, right after dishing. Photograph the food, not people.
            </InfoHint>
          </div>
        )}
      </div>
      {problem && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{problem}</p>}
    </div>
  )
}
