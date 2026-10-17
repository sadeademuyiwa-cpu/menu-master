/**
 * Where a dish photo lives, what a dish shows before it has one, and the
 * "hide photos" choice. The photo names are a contract with migration 0063
 * (bucket 'dish', "<business_id>/<recipe_id>/<random>.<webp|jpg>", the
 * thumbnail "-320" beside it); a drift here is a photo that never shows.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {
  dishPhotoUrl, dishThumbPath, newDishPhotoPaths, isDishPhotoPath,
  dishInitials, dishTileTone, DISH_TILE_TONES,
  PHOTO_PREFERENCE_KEY, PHOTO_PREFERENCE_SCRIPT,
  DISH_BUCKET, DISH_PHOTO_MAX_BYTES, DISH_PHOTO_TYPES,
  dishPhotoDimensions, canAddDishPhotos, DISH_PHOTO_ROLES,
} from '../src/lib/dish-photo.ts'

const BIZ = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const DISH = '1f164655-cff3-48ad-87a9-0a38c7cd48a3'
const RAND = '9c2b7e1f0a4d4c8e9b6a3f2e1d0c9b8a'
const PATH = `${BIZ}/${DISH}/${RAND}.webp`

function withSupabaseUrl<T>(url: string | undefined, fn: () => T): T {
  const before = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url
  try { return fn() } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = before
  }
}

test('the contract with 0063: bucket, size limit, kinds', () => {
  assert.equal(DISH_BUCKET, 'dish')
  assert.equal(DISH_PHOTO_MAX_BYTES, 512 * 1024)
  assert.deepEqual(DISH_PHOTO_TYPES, { 'image/webp': 'webp', 'image/jpeg': 'jpg' })
})

test('a photo and its thumbnail have public addresses in the dish bucket', () => {
  withSupabaseUrl('https://abc.supabase.co/', () => {
    assert.equal(dishPhotoUrl(PATH, 'full'),
      `https://abc.supabase.co/storage/v1/object/public/dish/${BIZ}/${DISH}/${RAND}.webp`)
    assert.equal(dishPhotoUrl(PATH, 'thumb'),
      `https://abc.supabase.co/storage/v1/object/public/dish/${BIZ}/${DISH}/${RAND}-320.webp`)
    // Lists show the thumbnail unless told otherwise.
    assert.equal(dishPhotoUrl(PATH), dishPhotoUrl(PATH, 'thumb'))
    assert.match(dishPhotoUrl(`${BIZ}/${DISH}/${RAND}.jpg`, 'thumb') ?? '', /-320\.jpg$/)
  })
})

test('no address means the tile shows, never a broken picture', () => {
  withSupabaseUrl('https://abc.supabase.co', () => {
    for (const bad of [null, undefined, '', 'photo.webp', `${BIZ}/${DISH}/${RAND}.png`,
                       `${BIZ}/${DISH}/${RAND}-320.webp`, `../${BIZ}/${DISH}/${RAND}.webp`,
                       `${BIZ}/${DISH}/${RAND}.webp?x=1`, `https://evil.example/${RAND}.webp`]) {
      assert.equal(dishPhotoUrl(bad as never), null, String(bad))
    }
  })
  withSupabaseUrl(undefined, () => assert.equal(dishPhotoUrl(PATH), null))
})

test('the thumbnail sits beside the photo with -320 before the extension', () => {
  assert.equal(dishThumbPath(`${BIZ}/${DISH}/${RAND}.webp`), `${BIZ}/${DISH}/${RAND}-320.webp`)
  assert.equal(dishThumbPath(`${BIZ}/${DISH}/${RAND}.jpg`), `${BIZ}/${DISH}/${RAND}-320.jpg`)
})

test('a new photo gets a fresh, unguessable name in its business and dish folder', () => {
  const a = newDishPhotoPaths(BIZ, DISH, 'webp')
  const b = newDishPhotoPaths(BIZ, DISH, 'webp')
  assert.match(a.full, new RegExp(`^${BIZ}/${DISH}/[0-9a-f]{32}\\.webp$`))
  assert.equal(a.thumb, dishThumbPath(a.full))
  assert.notEqual(a.full, b.full)
  assert.ok(isDishPhotoPath(a.full, BIZ, DISH))
  assert.match(newDishPhotoPaths(BIZ, DISH, 'jpg').full, /\.jpg$/)
  // Folder names are lower case whatever the caller passes, as PostgreSQL prints uuids.
  assert.ok(newDishPhotoPaths(BIZ.toUpperCase(), DISH, 'jpg').full.startsWith(`${BIZ}/`))
})

test('the phone sends a 1080 px photo, never the camera original', () => {
  // A 12 MP phone photo, either way up.
  assert.deepEqual(dishPhotoDimensions(4032, 3024, 'full'), { width: 1080, height: 810 })
  assert.deepEqual(dishPhotoDimensions(3024, 4032, 'full'), { width: 810, height: 1080 })
  // A picture already small is never enlarged.
  assert.deepEqual(dishPhotoDimensions(800, 600, 'full'), { width: 800, height: 600 })
})

test('the thumbnail is 320 px on its short side, so a cropped card stays sharp', () => {
  assert.deepEqual(dishPhotoDimensions(4032, 3024, 'thumb'), { width: 427, height: 320 })
  assert.deepEqual(dishPhotoDimensions(3024, 4032, 'thumb'), { width: 320, height: 427 })
  assert.deepEqual(dishPhotoDimensions(1000, 1000, 'thumb'), { width: 320, height: 320 })
  // A panorama is capped on its long side instead, so it is not a heavy "thumbnail".
  assert.deepEqual(dishPhotoDimensions(4000, 1000, 'thumb'), { width: 640, height: 160 })
  assert.deepEqual(dishPhotoDimensions(200, 150, 'thumb'), { width: 200, height: 150 })
})

test('a picture with no usable size gives no size, not a 0 x 0 upload', () => {
  for (const [w, h] of [[0, 100], [100, 0], [-5, 100], [NaN, 100], [100, Infinity]]) {
    assert.equal(dishPhotoDimensions(w, h, 'full'), null, `${w} x ${h}`)
    assert.equal(dishPhotoDimensions(w, h, 'thumb'), null, `${w} x ${h}`)
  }
})

test('owner, manager and kitchen may add photos, as 0063 lets them', () => {
  assert.deepEqual([...DISH_PHOTO_ROLES], ['owner', 'manager', 'kitchen'])
  for (const role of ['owner', 'manager', 'kitchen']) assert.equal(canAddDishPhotos(role), true, role)
  for (const role of ['sales', 'accountant', '', null, undefined]) {
    assert.equal(canAddDishPhotos(role), false, String(role))
  }
})

test('a photo name is accepted only for its own business and dish', () => {
  assert.equal(isDishPhotoPath(PATH, BIZ), true)
  assert.equal(isDishPhotoPath(PATH, BIZ, DISH), true)
  assert.equal(isDishPhotoPath(PATH, BIZ.toUpperCase(), DISH.toUpperCase()), true)
  const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  assert.equal(isDishPhotoPath(PATH, other), false)
  assert.equal(isDishPhotoPath(PATH, BIZ, other), false)
  assert.equal(isDishPhotoPath(`${BIZ}/${DISH}/${RAND}-320.webp`, BIZ), false)
  assert.equal(isDishPhotoPath(`${BIZ}/${DISH}/${RAND}.png`, BIZ), false)
  assert.equal(isDishPhotoPath(`${BIZ}/${RAND}.webp`, BIZ), false)
  assert.equal(isDishPhotoPath(null, BIZ), false)
  assert.equal(isDishPhotoPath(PATH, null), false)
})

test('a tile shows the first letters of the first two words', () => {
  assert.equal(dishInitials('Jollof rice'), 'JR')
  assert.equal(dishInitials('jollof rice and chicken'), 'JR')
  assert.equal(dishInitials('Puff-puff'), 'P')
  assert.equal(dishInitials('  Small   chops '), 'SC')
  assert.equal(dishInitials('(Party) jollof'), 'PJ')
  assert.equal(dishInitials('2 litre zobo'), '2L')
  assert.equal(dishInitials('Ẹ̀fọ́ riro'), 'ẸR')
  assert.equal(dishInitials(''), '')
  assert.equal(dishInitials('—'), '')
  assert.equal(dishInitials(null), '')
})

test('a dish keeps its colour, and only brand greens are ever used', () => {
  assert.deepEqual([...DISH_TILE_TONES], ['forest', 'kitchen', 'soft', 'outline'])
  assert.equal(dishTileTone('Jollof rice'), dishTileTone('Jollof rice'))
  // Case and spacing are not a different dish.
  assert.equal(dishTileTone('Jollof  Rice '), dishTileTone('jollof rice'))
  const seen = new Set<string>()
  for (const name of ['Jollof rice', 'Fried rice', 'Egusi soup', 'Moi moi', 'Puff-puff',
                      'Small chops', 'Pepper soup', 'Amala', 'Ofada stew', 'Zobo', 'Chapman',
                      'Asun', 'Suya', 'Ewa agoyin', 'Boli', 'Akara']) {
    const tone = dishTileTone(name)
    assert.ok((DISH_TILE_TONES as readonly string[]).includes(tone), `${name}: ${tone}`)
    seen.add(tone)
  }
  // A real menu spreads across the colours instead of painting every tile alike.
  assert.ok(seen.size >= 3, `only ${[...seen].join(', ')}`)
})

/** Run the <head> script against a stand-in browser and report what it set. */
function runPreferenceScript(opts: { stored?: string | null; saveData?: boolean; storageThrows?: boolean; noConnection?: boolean }) {
  const attrs: Record<string, string> = {}
  const context = {
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } } },
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error('SecurityError')
        return k === PHOTO_PREFERENCE_KEY ? opts.stored ?? null : null
      },
    },
    navigator: opts.noConnection ? {} : { connection: { saveData: !!opts.saveData } },
  }
  vm.runInNewContext(PHOTO_PREFERENCE_SCRIPT, context)
  return attrs['data-photos']
}

test('before paint, the saved choice wins; otherwise the phone data saver decides', () => {
  assert.equal(PHOTO_PREFERENCE_KEY, 'mm_photos')
  assert.equal(runPreferenceScript({ stored: 'off' }), 'off')
  assert.equal(runPreferenceScript({ stored: 'on', saveData: true }), 'on')
  assert.equal(runPreferenceScript({ stored: 'off', saveData: false }), 'off')
  assert.equal(runPreferenceScript({ saveData: true }), 'off')
  assert.equal(runPreferenceScript({ saveData: false }), 'on')
  assert.equal(runPreferenceScript({ noConnection: true }), 'on')
  assert.equal(runPreferenceScript({ stored: 'nonsense', saveData: true }), 'off')
})

test('a browser that refuses storage still gets an answer, and never an error', () => {
  assert.equal(runPreferenceScript({ storageThrows: true, saveData: true }), 'off')
  assert.equal(runPreferenceScript({ storageThrows: true }), 'on')
  // No document, no navigator: the script swallows it rather than break the page.
  assert.doesNotThrow(() => vm.runInNewContext(PHOTO_PREFERENCE_SCRIPT, {}))
})
