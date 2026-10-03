/**
 * A LOCAL SUPABASE-EQUIVALENT GATEWAY for launch verification.
 *
 * /rest/v1/*  -> a real PostgREST 12.2.3 on :3000, against a real PostgreSQL
 *                17.6 carrying migrations 0001-0030 with RLS enabled. Nothing
 *                about the data plane is simulated: policies, triggers,
 *                generated columns and the costing engine are the real ones.
 *
 * /auth/v1/*  -> a minimal GoTrue stand-in that writes real rows into
 *                auth.users and issues real HS256 JWTs signed with the same
 *                secret PostgREST verifies. The tokens are genuine; only the
 *                issuer is local.
 *
 * This is NOT production and never touches it.
 */
import { createServer } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Pool } from 'pg'

// All three are configurable so the same gateway serves a launch-verification
// database on one machine and a day-to-day dev database on another. The
// defaults are the values the launch-readiness run used.
const SECRET = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
const PGRST = process.env.PGRST_URL ?? 'http://127.0.0.1:3000'
const PORT = Number(process.env.GATEWAY_PORT ?? 54321)

// A POOL, not a single Client. Once the journey opens a second browser
// context, two sessions issue auth calls at the same time and a single pg
// Client cannot serve overlapping queries -- it warns and then fails the
// request, which surfaced as a signup that never settled.
const db = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/mmlaunch', max: 10 })
await db.query('select 1')

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function sign(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
function verify(token) {
  if (!token) return null
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return null
  const expect = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')
  if (expect !== s) return null
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  if (claims.exp && claims.exp * 1000 < Date.now()) return null
  return claims
}

const session = (user) => ({
  access_token: sign({
    sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `refresh-${user.id}`, user,
})

const shape = (row) => ({
  id: row.id, email: row.email, aud: 'authenticated', role: 'authenticated',
  email_confirmed_at: row.email_confirmed_at ?? new Date().toISOString(),
  confirmed_at: row.email_confirmed_at ?? new Date().toISOString(),
  created_at: row.created_at ?? new Date().toISOString(),
  app_metadata: { provider: 'email' }, user_metadata: {},
})

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range,content-location',
}

/** LOCAL ONLY: the last email the stand-in would have sent. */
let lastMail = null

const body = (req) => new Promise((res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => res(b))
})

/** The request body as bytes: an uploaded picture is not text. */
const bytes = (req) => new Promise((res) => {
  const parts = []
  req.on('data', (c) => parts.push(c))
  req.on('end', () => res(Buffer.concat(parts)))
})

// ---------------------------------------------------------------------------
// LOCAL ONLY: a stand-in for Supabase Storage's upload and public-file API.
// Files are kept on disk here; the row in storage.objects is written AS the
// calling user (role authenticated, their sub), so the real policies from
// 0059 decide who may upload -- exactly as they would on Supabase.
// ---------------------------------------------------------------------------
const STORE = join(tmpdir(), 'mm-local-storage')

function storagePath(bucket, name) {
  if (!/^[a-z0-9-]+$/.test(bucket) || !name || name.split('/').some((s) => !s || s === '..' || s === '.')) return null
  return join(STORE, bucket, ...name.split('/'))
}

async function storageUpload(req, res, bucket, name, send) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const claims = verify(bearer)
  if (!claims?.sub) return send({ statusCode: '403', error: 'Unauthorized', message: 'Invalid JWT' }, 403)
  const file = storagePath(bucket, name)
  if (!file) return send({ statusCode: '400', error: 'InvalidKey', message: 'Invalid key' }, 400)
  const { rows: [b] } = await db.query('select * from storage.buckets where id = $1', [bucket])
  if (!b) return send({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }, 404)
  const data = await bytes(req)
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim()
  if (b.allowed_mime_types && !b.allowed_mime_types.includes(type)) {
    return send({ statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` }, 415)
  }
  if (b.file_size_limit && data.length > Number(b.file_size_limit)) {
    return send({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }, 413)
  }
  const client = await db.connect()
  let id
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims.sub])
    await client.query('set local role authenticated')
    const { rows } = await client.query(
      `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id`,
      [bucket, name, claims.sub, { mimetype: type, size: data.length }])
    id = rows[0].id
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    if (e.code === '42501') return send({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403)
    if (e.code === '23505') return send({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 409)
    throw e
  } finally {
    client.release()
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, data)
  return send({ Key: `${bucket}/${name}`, Id: id })
}

async function storagePublic(res, bucket, name) {
  const file = storagePath(bucket, name)
  const { rows: [o] } = await db.query(
    `select o.metadata from storage.objects o join storage.buckets b on b.id = o.bucket_id
      where o.bucket_id = $1 and o.name = $2 and b.public`, [bucket, name])
  if (!file || !o) { res.writeHead(404, CORS); return res.end() }
  const data = await readFile(file).catch(() => null)
  if (!data) { res.writeHead(404, CORS); return res.end() }
  res.writeHead(200, { 'content-type': o.metadata?.mimetype ?? 'application/octet-stream', 'cache-control': 'public, max-age=60', ...CORS })
  return res.end(data)
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS })
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  if (url.pathname === '/__local/last-mail') return send(lastMail ?? {})

  try {
    const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (pub && req.method === 'GET') return await storagePublic(res, pub[1], decodeURIComponent(pub[2]))
    const up = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)
    if (up && (req.method === 'POST' || req.method === 'PUT')) {
      return await storageUpload(req, res, up[1], decodeURIComponent(up[2]), send)
    }

    if (url.pathname.startsWith('/auth/v1/')) {
      const raw = await body(req)
      const payload = raw ? JSON.parse(raw) : {}
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')

      if (url.pathname === '/auth/v1/signup') {
        const id = randomUUID()
        // Email confirmation is required (D-7). The harness confirms
        // immediately because there is no mailbox here; the application still
        // enforces the confirmed check on every request.
        // email_confirmed_at is a GoTrue field, not a column in the local
        // auth.users shim, so it is synthesised in the response only.
        await db.query(
          `insert into auth.users (id, email) values ($1, $2)
           on conflict (email) do nothing`, [id, payload.email])
        const { rows } = await db.query('select * from auth.users where email = $1', [payload.email])
        return send(session(shape(rows[0])))
      }
      if (url.pathname === '/auth/v1/token') {
        const { rows } = await db.query('select * from auth.users where email = $1', [payload.email])
        if (!rows[0]) return send({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400)
        return send(session(shape(rows[0])))
      }
      // LOCAL ONLY: email links. There is no mailbox here, so the "email" is
      // printed in this window and kept for the tests at /__local/last-mail.
      // The token is the user's id -- guessable, which is fine for a stand-in
      // that never leaves this machine and would be a hole anywhere else.
      if (url.pathname === '/auth/v1/recover') {
        const { rows } = await db.query('select * from auth.users where email = $1', [payload.email])
        // Like GoTrue: the same answer whether or not the address exists.
        if (rows[0]) {
          const to = new URL(url.searchParams.get('redirect_to') ?? 'http://127.0.0.1:3100/auth/confirm?next=/reset-password')
          const link = `${to.origin}/auth/confirm?token_hash=local-${rows[0].id}&type=recovery`
            + `&next=${encodeURIComponent(to.searchParams.get('next') ?? '/reset-password')}`
          lastMail = { to: payload.email, kind: 'recovery', link }
          console.log(`[local mail] password reset for ${payload.email}: ${link}`)
        }
        return send({})
      }
      if (url.pathname === '/auth/v1/verify') {
        const id = String(payload.token_hash ?? '').replace(/^local-/, '')
        const { rows } = await db.query('select * from auth.users where id::text = $1', [id])
        if (!rows[0]) return send({ code: 'otp_expired', message: 'Email link is invalid or has expired' }, 403)
        return send(session(shape(rows[0])))
      }
      // LOCAL ONLY: the auth server's public settings, as Supabase serves them.
      // Google counts as switched on only when the gateway is started with
      // LOCAL_GOOGLE=on, so both answers can be tested.
      if (url.pathname === '/auth/v1/settings') {
        return send({
          external: { email: true, google: process.env.LOCAL_GOOGLE === 'on' },
          disable_signup: false, mailer_autoconfirm: true,
        })
      }
      if (url.pathname === '/auth/v1/resend') {
        console.log(`[local mail] confirmation resent to ${payload.email} (local accounts are confirmed already)`)
        return send({})
      }
      // GET reads the user; PUT (a new password) answers the same, since the
      // stand-in keeps no passwords.
      if (url.pathname === '/auth/v1/user') {
        const claims = verify(bearer)
        if (!claims) return send({ message: 'invalid claim' }, 401)
        const { rows } = await db.query('select * from auth.users where id = $1', [claims.sub])
        if (!rows[0]) return send({ message: 'user not found' }, 404)
        return send(shape(rows[0]))
      }
      if (url.pathname === '/auth/v1/logout') { res.writeHead(204, CORS); return res.end() }
      return send({}, 404)
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const target = PGRST + url.pathname.replace('/rest/v1', '') + url.search
      const headers = { ...req.headers }
      delete headers.host
      delete headers['content-length']
      delete headers.apikey
      const init = { method: req.method, headers }
      if (!['GET', 'HEAD'].includes(req.method)) init.body = await body(req)
      const upstream = await fetch(target, init)
      const text = await upstream.text()
      // Content-Range carries the row count supabase-js reads for
      // { count: 'exact' }; dropping it made every count null locally, unlike
      // the hosted platform.
      const passOn = {}
      for (const h of ['content-range', 'content-location']) {
        const v = upstream.headers.get(h)
        if (v) passOn[h] = v
      }
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        ...passOn,
        ...CORS,
      })
      return res.end(text)
    }

    send({}, 404)
  } catch (e) {
    send({ message: String(e) }, 500)
  }
}).listen(PORT, () => console.log(`supabase-local gateway on ${PORT} -> PostgREST ${PGRST}`))
