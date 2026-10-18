/**
 * The admin pastes a YouTube link per screen; the app plays it from that
 * screen's Help button. Only a real YouTube video may reach the player, and
 * every address must find the right screen's video.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HELP_SCREENS, helpScreenFor, parseYouTube, parseHelpVideos, checkHelpInput, embedUrl,
} from '../src/lib/site/help-videos.ts'

const ID = 'dQw4w9WgXcQ'

test('every shape of YouTube link gives the video', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abcdef`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `  ${ID}  `,
  ]) {
    assert.deepEqual(parseYouTube(link), { id: ID, vertical: false, url: `https://www.youtube.com/watch?v=${ID}` }, link)
  }
})

test('a Short is played upright', () => {
  assert.deepEqual(parseYouTube(`https://youtube.com/shorts/${ID}?feature=share`),
    { id: ID, vertical: true, url: `https://www.youtube.com/shorts/${ID}` })
})

test('anything that is not a YouTube video is refused', () => {
  for (const bad of [
    '', 'hello', 'https://vimeo.com/123456', `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`, `javascript:alert(1)//youtu.be/${ID}`,
    'https://www.youtube.com/watch?v=short', `https://www.youtube.com/watch?v=${ID}"><script>`,
    'https://www.youtube.com/channel/UC1234567890', 42, null,
  ]) {
    assert.equal(parseYouTube(bad), null, String(bad))
  }
})

test('the player is the privacy-enhanced one', () => {
  assert.match(embedUrl(parseYouTube(ID)!), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
})

test('each address finds its own screen', () => {
  const cases: [string, string | null][] = [
    ['/login', 'login'], ['/forgot-password', 'login'], ['/signup', 'signup'],
    ['/onboarding', 'onboarding'], ['/start', 'start'], ['/dashboard', 'dashboard'],
    ['/sales', 'sales'], ['/sales/new', 'sale-new'], ['/sales/9b2e-41aa', 'sale'],
    ['/recipes', 'recipes'], ['/recipes/new', 'recipe-new'], ['/recipes/abc123', 'recipe'],
    ['/purchases/new', 'purchase-new'], ['/purchases/abc', 'purchase'], ['/purchases/abc/correct', 'purchase'],
    ['/ingredients/abc', 'ingredient'], ['/formats/abc', 'formats'], ['/customers/abc', 'customers'],
    ['/settings', 'settings'], ['/settings/people', 'people'], ['/settings/', 'settings'],
    ['/admin/site', null], ['/', null], ['/privacy', null], ['/salesforce', null], [null as unknown as string, null],
  ]
  for (const [path, key] of cases) assert.equal(helpScreenFor(path), key, path)
})

test('no two screens claim the same address', () => {
  const seen = new Map<string, string>()
  for (const s of HELP_SCREENS) for (const p of s.paths) {
    assert.ok(!seen.has(p), `${p} is claimed by ${seen.get(p)} and ${s.key}`)
    seen.set(p, s.key)
  }
})

test('the stored setting keeps known screens with real videos only', () => {
  const v = parseHelpVideos({ 'sale-new': `https://youtu.be/${ID}`, dashboard: 'not a link', unknown: `https://youtu.be/${ID}` })
  assert.deepEqual(Object.keys(v), ['sale-new'])
  assert.equal(v['sale-new']?.id, ID)
  assert.deepEqual(parseHelpVideos(null), {})
  assert.deepEqual(parseHelpVideos([`https://youtu.be/${ID}`]), {})
})

test('the admin form stores each link one way, and names the box that is wrong', () => {
  const ok = checkHelpInput({ 'sale-new': ` https://youtu.be/${ID}?si=x `, dashboard: '', recipes: `https://youtube.com/shorts/${ID}` })
  assert.deepEqual(ok, { ok: true, value: {
    recipes: `https://www.youtube.com/shorts/${ID}`, 'sale-new': `https://www.youtube.com/watch?v=${ID}`,
  } })
  const bad = checkHelpInput({ recipes: 'https://vimeo.com/1' })
  assert.equal(bad.ok, false)
  assert.match(!bad.ok ? bad.error : '', /"Dishes"/)
})
