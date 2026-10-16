// Renders every PNG in this folder from its SVG/HTML source.
//   node branding/render.mjs            -> everything
//   node branding/render.mjs logos      -> only 03-logo/png
//   node branding/render.mjs templates  -> only 07-templates/png
//   node branding/render.mjs screens    -> only 09-uiux/renders
// Uses the Playwright + Chromium already installed under web/.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(join(root, 'web', 'package.json'))
const { chromium } = require('playwright')

const what = process.argv[2] ?? 'all'
const browser = await chromium.launch()

async function logos() {
  const src = join(here, '03-logo', 'svg'), out = join(here, '03-logo', 'png')
  mkdirSync(out, { recursive: true })
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const sizes = { 'app-icon': [1024, 512, 192, 180], 'app-icon-light': [1024, 512], 'app-icon-maskable': [512, 192], 'app-icon-square': [180], favicon: [64, 48, 32, 16] }
  for (const f of readdirSync(src).filter((f) => f.endsWith('.svg'))) {
    const name = basename(f, '.svg')
    const svg = readFileSync(join(src, f), 'utf8')
    const vb = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg)
    const [w, h] = [Number(vb[1]), Number(vb[2])]
    const widths = sizes[name] ?? (name.startsWith('mark') ? [1240, 620] : name.startsWith('lockup-stacked') ? [1200, 600] : [1600, 800])
    for (const W of widths) {
      const H = Math.round((W * h) / w)
      await page.setViewportSize({ width: W, height: H })
      const bg = /reversed|white/.test(name) ? (/mono|white/.test(name) && !/reversed-mono/.test(name) && name !== 'mark-reversed-mono' ? '#171b18' : '#0f5e3c') : 'transparent'
      await page.setContent(`<html><body style="margin:0;background:${bg}"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${W}" height="${H}" style="display:block"></body></html>`)
      await page.screenshot({ path: join(out, `${name}-${W}.png`), omitBackground: bg === 'transparent' })
    }
    console.log('logo', name, widths.join('/'))
  }
  await page.close()
}

async function templates() {
  const src = join(here, '07-templates', 'src'), out = join(here, '07-templates', 'png')
  mkdirSync(out, { recursive: true })
  for (const f of readdirSync(src).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(src, f), 'utf8')
    const m = /<meta name="render" content="(\d+)x(\d+)(?:@(\d))?"/.exec(html)
    const [W, H, scale] = m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)] : [1080, 1080, 1]
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
    await page.goto(pathToFileURL(join(src, f)).href, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(out, basename(f, '.html') + '.png') })
    await page.close()
    console.log('template', f, `${W}x${H}@${scale}`)
  }
}

async function screens() {
  const src = join(here, '09-uiux', 'screens'), out = join(here, '09-uiux', 'renders')
  mkdirSync(out, { recursive: true })
  const index = []
  for (const f of readdirSync(src).filter((f) => f.endsWith('.html')).sort()) {
    const name = basename(f, '.html')
    const html = readFileSync(join(src, f), 'utf8')
    const widths = (/<meta name="widths" content="([\d,]+)"/.exec(html)?.[1] ?? '390').split(',').map(Number)
    for (const W of widths) {
      const page = await browser.newPage({ viewport: { width: W, height: W < 600 ? 844 : 900 }, deviceScaleFactor: 2 })
      await page.goto(pathToFileURL(join(src, f)).href, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      const file = `${name}-${W}.png`
      // grow the viewport to the page so fixed bars sit at the real bottom
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      await page.setViewportSize({ width: W, height: Math.max(W < 600 ? 844 : 900, h) })
      await page.screenshot({ path: join(out, file) })
      await page.close()
      index.push({ name, W, file })
    }
    console.log('screen', name, widths.join('/'))
  }
  const title = (s) => s.replace(/^\d+-/, '').replace(/-/g, ' ')
  const items = index.map((i) => `<figure><img src="${i.file}" loading="lazy"><figcaption>${title(i.name)} · ${i.W}px</figcaption></figure>`).join('\n')
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Menu Master NG screens</title>
<style>body{margin:0;padding:24px;background:#f0f3f0;font:14px Inter,system-ui,sans-serif;color:#171b18}h1{font-size:20px}
.g{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}figure{margin:0;max-width:100%}img{display:block;max-width:min(100%,900px);border:1px solid #dde3de;border-radius:12px;background:#fff}
figure img[src*="-390"]{width:300px}figcaption{margin-top:6px;color:#66706a;text-transform:capitalize}</style>
<h1>Menu Master NG — every screen</h1><p>Rendered from <code>09-uiux/screens/*.html</code>. Phone frames are 390 px wide, desktop 1280 px.</p>
<div class="g">${items}</div>`)
}

if (what === 'all' || what === 'logos') await logos()
if (what === 'all' || what === 'templates') await templates()
if (what === 'all' || what === 'screens') await screens()
await browser.close()
