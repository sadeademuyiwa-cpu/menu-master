/**
 * Every PostgREST embed in the application, proved against REAL PostgREST.
 *
 * WHY THIS EXISTS
 *   order_lines has TWO foreign keys to recipes:
 *     order_lines_recipe_id_fkey        (recipe_id)
 *     fk_order_lines_recipe_id_account  (recipe_id, account_id)
 *   PostgREST refuses an ambiguous embed with PGRST201 / HTTP 300. A query
 *   written as `recipe:recipes(name)` therefore returns an ERROR, not rows --
 *   and supabase-js hands that back as { data: null, error }, so a caller that
 *   only reads `data` sees an empty result and renders nothing.
 *
 *   That shipped. Every cancelled sale displayed 0.00 with no items, on the
 *   very page built to prove the record survives. The browser suite passed
 *   throughout, because e2e/mock-supabase.mjs returns pre-shaped objects and
 *   does not implement embedding at all -- a mock cannot fail a rule it does
 *   not model.
 *
 * WHAT THIS DOES
 *   Extracts every `alias:table(...)` embed from the source together with the
 *   .from() table it belongs to, issues each one against a real PostgREST
 *   bound to a real 0048 schema, and fails on any status other than 200.
 *   A new ambiguous embed cannot pass this, whatever the mock says.
 *
 * Requires: PGRST_URL and PGRST_JWT in the environment (scripts/postgrest-embed-check.sh
 * builds the replica, starts PostgREST and supplies both).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.PGRST_URL
const JWT = process.env.PGRST_JWT
if (!BASE || !JWT) {
  console.error('PGRST_URL and PGRST_JWT are required. Run scripts/postgrest-embed-check.sh.')
  process.exit(2)
}

const SRC = join(import.meta.dirname, '..', 'src')
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(p) ? [p] : [])
})

/**
 * Pull out (table, selectExpression) pairs. The select may be split across
 * lines and concatenated with +, which is how the offending query was written,
 * so string pieces are joined before parsing.
 */
function embedsIn(source) {
  // Split ON the .from() calls, so each chunk provably belongs to the table
  // immediately before it and cannot borrow a .select() from another query.
  // A regex that scanned forward for a nearby .select() paired them wrongly
  // and, worse, skipped the order_lines query entirely because a comment block
  // sat between the two calls -- which is precisely the query that broke.
  const parts = source.split(/\.from\(\s*'([a-z_]+)'\s*\)/)
  const found = []
  for (let i = 1; i < parts.length; i += 2) {
    const table = parts[i]
    const chunk = parts[i + 1] ?? ''
    const sel = chunk.match(/\.select\(([\s\S]*?)\)\s*(?:\.[a-zA-Z]|,|\n\s*\])/)
    if (!sel) continue
    // String pieces may be concatenated with +, which is how the broken query
    // was written. Join them before looking for an embed.
    const select = [...sel[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('')
    if (/[a-z_]+:[a-z_]+[!(]/.test(select)) found.push({ table, select })
  }
  return found
}

const all = []
for (const file of walk(SRC)) {
  for (const e of embedsIn(readFileSync(file, 'utf8'))) {
    all.push({ ...e, file: file.slice(file.indexOf('/src/') + 1) })
  }
}

let pass = 0, fail = 0
console.log(`checking ${all.length} embed(s) against real PostgREST at ${BASE}\n`)

for (const { table, select, file } of all) {
  const url = `${BASE}/${table}?select=${encodeURIComponent(select)}&limit=1`
  let status = 0, body = ''
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${JWT}` } })
    status = res.status
    body = await res.text()
  } catch (err) {
    body = String(err)
  }
  if (status === 200) {
    pass++
    console.log(`  ok   ${table}  (${file})`)
  } else {
    fail++
    let why = body.slice(0, 200)
    try {
      const j = JSON.parse(body)
      why = `${j.code ?? ''} ${j.message ?? ''}`.trim()
      if (j.hint) why += ` | hint: ${j.hint}`
    } catch { /* keep the raw body */ }
    console.log(`  FAIL ${table}  (${file})\n       HTTP ${status} -- ${why}\n       select: ${select}`)
  }
}

console.log(`\npostgrest-embeds: pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
