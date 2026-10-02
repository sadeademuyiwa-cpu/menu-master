/**
 * ERROR MONITORING, IN A REAL BROWSER.
 *
 *   EXPECT_SENTRY=1  the app was built with NEXT_PUBLIC_SENTRY_DSN pointing at
 *                    this machine (e.g. http://publickey@127.0.0.1:9/1).
 *                    A browser error is reported, with the email blanked and
 *                    no cookie in the report.
 *   otherwise        built without a DSN: Sentry is never downloaded and
 *                    nothing is reported.
 *
 * Reports are intercepted in the browser; nothing leaves this machine.
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3100'
const expect = process.env.EXPECT_SENTRY === '1'
const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const reports = []
await ctx.route(/\/api\/\d+\/envelope\//, (route) => {
  reports.push(route.request().postData() ?? '')
  route.fulfill({ status: 200, body: '{}' })
})
// Script file names are hashed, so look inside them: the SDK always carries
// its global's name, which nothing of ours contains.
const sdkIn = []
const page = await ctx.newPage()
page.on('response', async (r) => {
  if (r.request().resourceType() !== 'script') return
  const body = await r.text().catch(() => '')
  if (body.includes('__SENTRY__')) sdkIn.push(r.url())
})

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const loaded = await page.evaluate(() => Boolean(window.__SENTRY__))
  await page.evaluate(() => setTimeout(() => { throw new Error('boom while saving for ada@kitchen.ng') }, 0))
  await page.waitForTimeout(4000)
  const all = reports.join('\n')

  if (expect) {
    mark('with a DSN, monitoring starts in the browser', loaded, `SDK in ${sdkIn.length} file(s)`)
    mark('a browser error is reported', all.includes('boom while saving'), `${reports.length} report(s)`)
    mark('the email address in it is blanked', all.includes('[email]') && !all.includes('ada@kitchen.ng'))
    mark('the report carries no cookie', !/"cookies"|"cookie"/i.test(all))
  } else {
    mark('without a DSN, monitoring never starts', !loaded)
    mark('and nothing is reported', reports.length === 0, `${reports.length} report(s)`)
    mark('and no Sentry code is downloaded for the landing page', sdkIn.length === 0, sdkIn.join(', '))
  }
} catch (e) {
  mark('the check ran to the end', false, String(e?.stack ?? e))
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
