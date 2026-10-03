/**
 * Where to send someone after an email link, kept on this site.
 *
 * Kept free of React and Next so it is tested directly. A `next` taken from a
 * URL is attacker-controlled: "//evil.example" or "https://evil.example"
 * would turn a confirmation link into an open redirect. Only a plain path on
 * this site is accepted; anything else falls back.
 *
 * Browsers delete tabs and newlines inside a URL before reading it, so
 * "/<tab>/evil.example" arrives as "//evil.example". Whitespace, control
 * characters and backslashes are therefore refused anywhere in the path.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  if (/[\x00-\x20\x7f\\]/.test(next)) return fallback
  return next
}

/**
 * A redirect to a path on whatever host the browser is already using.
 *
 * Route handlers used to redirect to `${origin}${next}`, with origin read
 * from request.url. Under `next start` that is the server's own name
 * (localhost), not the address the browser used, so the session cookie just
 * set for one host was missing on the other and the person landed on /login.
 * A relative Location is resolved by the browser against its own address.
 * Only ever pass a path that came through safeNext or is a literal.
 */
export function redirectToPath(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } })
}
