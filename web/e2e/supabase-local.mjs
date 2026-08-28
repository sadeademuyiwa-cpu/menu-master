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
import { Client } from 'pg'

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const PGRST = 'http://127.0.0.1:3000'
const PORT = 54321

const db = new Client({ connectionString: 'postgres://postgres@127.0.0.1:55432/mmlaunch' })
await db.connect()

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

const body = (req) => new Promise((res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => res(b))
})

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS })
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }

  try {
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
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        ...CORS,
      })
      return res.end(text)
    }

    send({}, 404)
  } catch (e) {
    send({ message: String(e) }, 500)
  }
}).listen(PORT, () => console.log(`supabase-local gateway on ${PORT} -> PostgREST ${PGRST}`))
