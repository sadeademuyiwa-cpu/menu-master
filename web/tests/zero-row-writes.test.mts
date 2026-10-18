/**
 * Every edit and remove asks for its rows back.
 *
 * Row-level security refuses an UPDATE or DELETE with no error and zero
 * rows; after a trial ends it does that to every role. An action that does
 * not ask for the changed rows (.select(...)) cannot tell a refusal from a
 * save, and says "Saved." for nothing -- about twenty did, and some then
 * re-costed every dish. This reads the app's own source: every
 * supabase.from(...).update(...) or .delete() chain must carry .select(...),
 * except the few listed below, which are best-effort clean-ups of rows the
 * same action has just written, or follow a checked write of the same dish.
 *
 * A new action that skips the check fails here, by file and table, rather
 * than in front of an owner whose trial has ended.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const WEB = join(import.meta.dirname, '..')
const APP = join(WEB, 'src', 'app')

/** Other people's screens, scanned by their own tests. */
const SKIP = ['(app)/account', '(app)/subscribe', 'api/checkout', 'api/billing', 'terms', 'refunds']

/**
 * The deliberate exceptions: "<file> <table>.<op>" -> how many.
 *   undo / discard: removing what this same action inserted a moment ago,
 *     after a later step failed; the user is told about that failure.
 *   scaleRecipe's lines and work: written after the dish's own batch update
 *     came back with its row, which is the check (recipes/[id]/actions.ts).
 */
const ALLOWED: Record<string, number> = {
  '(app)/purchases/new/actions.ts purchases.delete': 1,
  '(app)/recipes/new/actions.ts recipes.delete': 1,
  '(app)/sales/new/actions.ts orders.delete': 1,
  '(app)/sales/new/actions.ts customers.delete': 1,
  '(setup)/start/page.tsx purchases.delete': 1,
  '(setup)/start/page.tsx recipes.delete': 1,
  '(app)/recipes/[id]/actions.ts recipe_lines.update': 1,
  '(app)/recipes/[id]/actions.ts recipe_labour.update': 1,
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(APP, full).split(sep).join('/')
    if (SKIP.some((s) => rel === s || rel.startsWith(s + '/'))) continue
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** From an opening bracket, the index just past its match. */
function closeOf(src: string, open: number): number {
  const pair: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack = [pair[src[open]]]
  let i = open + 1
  let quote: string | null = null
  for (; i < src.length && stack.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (pair[c]) stack.push(pair[c])
    else if (c === stack[stack.length - 1]) stack.pop()
  }
  return i
}

type Chain = { table: string; text: string }

/** Every supabase.from('<table>') call chain: .from(...) and each .method(...) after it. */
function chains(src: string): Chain[] {
  const out: Chain[] = []
  const re = /\.from\((['"])([a-z_]+)\1\)/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let i = m.index + m[0].length
    for (;;) {
      const rest = /^\s*\.\s*([A-Za-z_]+)\s*(?:<[^>()]*>)?\s*\(/.exec(src.slice(i))
      if (!rest) break
      i = closeOf(src, i + rest[0].length - 1)
    }
    out.push({ table: m[2], text: src.slice(m.index, i) })
  }
  return out
}

test('the scan finds the writes it is meant to (it is not passing on nothing)', () => {
  const all = sources(APP).flatMap((f) => chains(readFileSync(f, 'utf8')))
  const writes = all.filter((c) => /\.(update|delete)\(/.test(c.text))
  assert.ok(writes.length >= 40, `only ${writes.length} update/delete chains found`)
  assert.ok(writes.some((c) => c.table === 'business_settings'), 'Settings writes not seen')
  assert.ok(writes.some((c) => c.table === 'serving_format_packaging'), 'packaging writes not seen')
  // The parser follows a chain across lines and through an object argument.
  const [one] = chains(`await supabase.from('recipes').update({\n  name: f('x'),\n}).eq('id', id)\n  .select('id')\nnext()`)
  assert.equal(one.table, 'recipes')
  assert.match(one.text, /\.select\('id'\)$/)
})

test('every edit and remove asks for its rows back', () => {
  const missing: string[] = []
  const seen: Record<string, number> = {}
  for (const file of sources(APP)) {
    const rel = relative(APP, file).split(sep).join('/')
    for (const c of chains(readFileSync(file, 'utf8'))) {
      const op = /\.update\(/.test(c.text) ? 'update' : /\.delete\(/.test(c.text) ? 'delete' : null
      if (!op || /\.select\(/.test(c.text)) continue
      const key = `${rel} ${c.table}.${op}`
      seen[key] = (seen[key] ?? 0) + 1
      if (seen[key] > (ALLOWED[key] ?? 0)) missing.push(`${key}: ${c.text.replace(/\s+/g, ' ').slice(0, 140)}`)
    }
  }
  assert.deepEqual(missing, [], 'an update or delete with no .select() cannot tell a refusal from a save')
})
