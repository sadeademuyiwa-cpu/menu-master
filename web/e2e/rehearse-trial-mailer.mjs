/**
 * THE TRIAL REMINDER MAILER, REHEARSED END TO END ON THIS MACHINE.
 *
 * Runs the real edge function (supabase/functions/trial-reminder-mailer) in
 * Deno against the local database through the local gateway, with a
 * stand-in for Resend that records what would have been sent. Needs a
 * database with 0058 (setup_db.ps1 -WithProposed) and `deno` on PATH:
 *
 *   pwsh -File scripts/dev_local.ps1 -Database mmp ... -Run web/e2e/rehearse-trial-mailer.mjs
 *
 * Nothing leaves this machine: no Resend, no Supabase.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const GATEWAY = 'http://127.0.0.1:54321'
const FN_PORT = 8000   // Deno.serve's default
const FAKE_PORT = 8787
const TOKEN = 'rehearsal-token-0123456789abcdef'
const SECRET = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

const results = []
const mark = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// A service_role token, signed with the LOCAL secret, as the platform hands
// the function in production.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const head = b64({ alg: 'HS256', typ: 'JWT' })
const body = b64({ role: 'service_role', iss: 'local', exp: Math.floor(Date.now() / 1000) + 3600 })
const serviceKey = `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`

// The stand-in for Resend.
const sent = []
const fake = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    sent.push({ headers: req.headers, body: JSON.parse(raw || '{}') })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: randomUUID() }))
  })
}).listen(FAKE_PORT)

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const stamp = Date.now()
const email = `trial-${stamp}@test.ng`
const fnFile = fileURLToPath(new URL('../../supabase/functions/trial-reminder-mailer/index.ts', import.meta.url))

let deno
try {
  // An owner whose trial ends in two and a half days.
  const uid = randomUUID()
  await db.query('insert into auth.users (id, email) values ($1, $2)', [uid, email])
  const { rows: [acc] } = await db.query(
    `select (fn_create_account_and_business('Rehearsal Foods', 'Rehearsal Kitchen', 'other', $1::uuid,
             p_idempotency_key => $2)->>'account_id')::uuid as id`, [uid, `rehearse-${stamp}`])
  await db.query(`update subscriptions set current_period_end = now() + interval '2 days 12 hours'
                   where account_id = $1`, [acc.id])

  deno = spawn('deno', ['run', '--allow-net', '--allow-env', fnFile], {
    env: {
      ...process.env,
      SUPABASE_URL: GATEWAY, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      RESEND_API_KEY: 're_rehearsal', RESEND_API_URL: `http://127.0.0.1:${FAKE_PORT}/emails`,
      MAILER_TOKEN: TOKEN, TRIAL_EMAIL_FROM: 'Menu Master NG <hello@menumasterng.com>',
      SITE_URL: 'https://menumasterng.com', SUPPORT_EMAIL: 'help@menumasterng.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
  let log = ''
  deno.stdout.on('data', (d) => (log += d))
  deno.stderr.on('data', (d) => (log += d))

  const fn = `http://127.0.0.1:${FN_PORT}/`
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(fn, { method: 'GET' }).then(() => true, () => false)
  }
  mark('the edge function starts in Deno', up, up ? '' : log.slice(-400))

  const anon = await fetch(fn, { method: 'POST' })
  mark('a call without the token is refused (401)', anon.status === 401, String(anon.status))

  const run1 = await fetch(fn, { method: 'POST', headers: { 'x-mailer-token': TOKEN } })
  const out1 = await run1.json().catch(() => ({}))
  const mine = sent.filter((s) => s.body.to?.[0] === email)
  mark('the first run sends the reminder that is owed', run1.ok && mine.length === 1, JSON.stringify(out1))
  const m = mine[0]?.body ?? {}
  mark('to the owner, from the configured sender, with replies to support',
    m.from === 'Menu Master NG <hello@menumasterng.com>' && m.reply_to === 'help@menumasterng.com')
  mark('saying the trial ends in 3 days, linking to the plans',
    m.subject === 'Your Menu Master free trial ends in 3 days' && (m.text ?? '').includes('https://menumasterng.com/subscribe'),
    m.subject ?? 'no subject')
  mark('naming the business and quoting a price', (m.text ?? '').includes('Rehearsal Kitchen') && /₦[\d,]+ a month/.test(m.text ?? ''))
  mark('with one idempotency key per account and kind',
    mine[0]?.headers['idempotency-key'] === `trial-${acc.id}-ends_in_3_days`, mine[0]?.headers['idempotency-key'] ?? '')
  const { rows: rec } = await db.query('select kind, sent_to from trial_reminders where account_id = $1', [acc.id])
  mark('and records it as sent', rec.length === 1 && rec[0].kind === 'ends_in_3_days' && rec[0].sent_to === email)

  const run2 = await fetch(fn, { method: 'POST', headers: { 'x-mailer-token': TOKEN } })
  const out2 = await run2.json().catch(() => ({}))
  mark('a second run sends nothing to that owner again',
    run2.ok && sent.filter((s) => s.body.to?.[0] === email).length === 1, JSON.stringify(out2))

  // The trial is now in its last day: the next reminder is owed, once.
  await db.query(`update subscriptions set current_period_end = now() + interval '6 hours' where account_id = $1`, [acc.id])
  await fetch(fn, { method: 'POST', headers: { 'x-mailer-token': TOKEN } })
  const last = sent.filter((s) => s.body.to?.[0] === email)
  mark('on the last day, "ends tomorrow" follows', last.length === 2 && last[1].body.subject === 'Your Menu Master free trial ends tomorrow',
    last[1]?.body.subject ?? 'none')

  // Paid: nothing more.
  await db.query(`update subscriptions set status = 'active', current_period_end = now() + interval '30 days' where account_id = $1`, [acc.id])
  await fetch(fn, { method: 'POST', headers: { 'x-mailer-token': TOKEN } })
  mark('once they pay, no more reminders', sent.filter((s) => s.body.to?.[0] === email).length === 2)
} catch (e) {
  mark('the rehearsal ran to the end', false, String(e?.stack ?? e))
} finally {
  if (deno) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(deno.pid), '/T', '/F'])
    else deno.kill()
  }
  fake.close()
  await db.end()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
