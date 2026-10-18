import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DISHES, NEW_ITEMS } from '../src/lib/dish-library-data.ts'
import { findDishes, suggestFor, aliasesOf, NAMES_WITH_ALIASES } from '../src/lib/item-search.ts'

/** The starter catalogue, as an account receives it at signup. */
const SEED = readFileSync(new URL('../../migrations/0003_seed.sql', import.meta.url), 'utf8')
const CATALOGUE = [...SEED.matchAll(/\('([^']+)','([^']+)','[a-z_]+','\{[^}]*\}','\{([^}]*)\}'\)/g)]
  .map((m, i) => ({ id: `c${i}`, name: m[2] }))
const KNOWN = new Set([...CATALOGUE.map((c) => c.name), ...NEW_ITEMS.map((x) => x.name)])
const dish = (name: string) => {
  const d = DISHES.find((x) => x.name === name)
  assert.ok(d, `no dish ${name}`)
  return d
}
const top = (typed: string) => findDishes(DISHES, typed)[0]?.name

test('the library holds names only: no amounts and no prices', () => {
  const text = JSON.stringify(DISHES) + JSON.stringify(NEW_ITEMS)
  assert.equal(/\d/.test(text), false, 'a digit would be an amount, a price or a size')
  assert.equal(/₦|naira/i.test(text), false)
})

test('every suggested item is a starter item or an approved new item', () => {
  for (const d of DISHES) for (const l of d.lines) for (const o of l.options) for (const n of o) {
    assert.ok(KNOWN.has(n), `${d.name}: "${n}" is neither a starter item nor a new item`)
  }
})

test('no new item is already on the starter list', () => {
  const starter = new Set(CATALOGUE.map((c) => c.name.toLowerCase()))
  for (const x of NEW_ITEMS) assert.ok(!starter.has(x.name.toLowerCase()), `${x.name} is already a starter item`)
})

test('the picker knows every new item\'s market names', () => {
  for (const x of NEW_ITEMS) for (const o of x.otherNames) {
    if (x.name.toLowerCase().includes(o.toLowerCase())) continue
    assert.ok(aliasesOf(x.name).some((a) => a.toLowerCase() === o.toLowerCase()), `${x.name} lacks "${o}" in item-search ALIASES`)
  }
  // And every name ALIASES holds others for is a real item, starter or new.
  const lower = new Set([...KNOWN].map((n) => n.toLowerCase()))
  for (const k of NAMES_WITH_ALIASES) assert.ok(lower.has(k), `"${k}" in ALIASES is not an item`)
})

test('typing a dish finds it, by its name or another name for it', () => {
  assert.equal(top('efo riro'), 'Efo Riro')
  assert.equal(top('Egusi'), 'Egusi Soup')
  assert.equal(top('jollof'), 'Nigerian Party Jollof Rice')
  assert.equal(top('moi moi'), 'Moin Moin')
  assert.equal(top('bitterleaf soup'), 'Ofe Onugbu')
  assert.equal(top('african salad'), 'Abacha')
  assert.equal(top('ofada'), 'Ofada Rice and Stew')
})

test("the owner's own example, okro soup, finds an okra soup", () => {
  const found = findDishes(DISHES, 'okro soup').map((d) => d.name)
  assert.ok(found.some((n) => /ila|kubewa|okra/i.test(n)), `found ${found.join(', ')}`)
})

test('a full recipe comes before a partial list at the same match', () => {
  for (const d of findDishes(DISHES, 'egusi', 3)) if (d.partial) assert.notEqual(d.name, top('egusi'))
})

test('too little typed, or nothing like a dish, suggests nothing', () => {
  assert.deepEqual(findDishes(DISHES, 'ef'), [])
  assert.deepEqual(findDishes(DISHES, 'zzzz'), [])
})

test('a plain menu word is not taken for some other dish', () => {
  // "rice" is not Masa (Rice Cakes), "beef" not Suya ("beef suya"), "bread"
  // not Ukwa ("breadfruit"), "white rice" not a catfish white soup.
  for (const q of ['rice', 'white rice', 'beans', 'beef', 'chicken', 'plantain', 'yam', 'bread', 'cake', 'fufu', 'noodles', 'zobo', 'soup']) {
    assert.deepEqual(findDishes(DISHES, q).map((d) => d.name), [], `"${q}" should suggest nothing`)
  }
})

test('everyday spellings find their dish', () => {
  assert.equal(top('okro'), 'Ila Alasepo')
  assert.equal(top('okra'), 'Ila Alasepo')
  assert.equal(top('edikaikong'), 'Edikang Ikong Soup')
  assert.equal(top('fried rice'), 'Fried Rice Nigerian Style')
  assert.equal(top('masa'), 'Masa (Rice Cakes)')
  assert.equal(top('stew'), 'Obe Ata')
  // Still typing: most of the word is enough.
  assert.equal(top('egu'), 'Egusi Soup')
})

test('the dish name picks between choices: goat meat pepper soup gets goat', () => {
  assert.equal(top('goat meat pepper soup'), 'Pepper Soup')
  const goat = suggestFor(dish('Pepper Soup'), CATALOGUE, NEW_ITEMS, 'goat meat pepper soup').rows.map((r) => r.item.name)
  assert.ok(goat.includes('Goat meat') && !goat.includes('Catfish'), JSON.stringify(goat))
  const chicken = suggestFor(dish('Pepper Soup'), CATALOGUE, NEW_ITEMS, 'chicken pepper soup').rows.map((r) => r.item.name)
  assert.ok(chicken.includes('Chicken (whole)') && !chicken.includes('Catfish'), JSON.stringify(chicken))
})

test('"black-eyed or brown beans" is one choice, not two rows', () => {
  const akara = suggestFor(dish('Akara'), CATALOGUE, NEW_ITEMS).rows.map((r) => r.item.name)
  assert.equal(akara.filter((n) => /beans/i.test(n)).length, 1, JSON.stringify(akara))
  const soup = suggestFor(dish('Pepper Soup'), CATALOGUE, NEW_ITEMS).rows.map((r) => r.item.name)
  assert.equal(soup.filter((n) => ['Catfish', 'Goat meat', 'Chicken (whole)', 'Assorted meat'].includes(n)).length, 1, JSON.stringify(soup))
})

test("an optional choice the dish already has gives way to the next: Owo Esha's meat", () => {
  const s = suggestFor(dish('Owo Esha'), CATALOGUE, NEW_ITEMS)
  assert.ok(s.rows.some((r) => r.optional && r.item.name === 'Assorted meat'), JSON.stringify(s.rows.filter((r) => r.optional)))
  // And without that item on her list, it is still named for her to add.
  const without = suggestFor(dish('Owo Esha'), CATALOGUE.filter((c) => c.name !== 'Assorted meat'), NEW_ITEMS)
  assert.ok(without.notInList.some((n) => n.optional && n.name === 'Assorted meat'), JSON.stringify(without.notInList))
})

test('no line offers the same choice twice', () => {
  for (const d of DISHES) for (const l of d.lines) {
    const keys = l.options.map((o) => o.join('+'))
    assert.equal(new Set(keys).size, keys.length, `${d.name}: ${keys.join(' / ')}`)
  }
})

test('the word that names the dish is enough: "Miyan", "Ofe" and "soup" are left out', () => {
  assert.equal(top('kuka'), 'Miyan Kuka')
  assert.equal(top('onugbu'), 'Ofe Onugbu')
  assert.equal(top('taushe'), 'Miyan Taushe')
  assert.equal(top('masara'), 'Tuwo Masara')
  assert.equal(top('agoyin'), 'Ewa Agoyin')
  assert.equal(top('vegetable soup'), 'Edikang Ikong Soup')
  assert.equal(top('banga and starch'), 'Banga Soup with Starch')
  assert.equal(top('tuwo and miyan kuka'), 'Tuwo Shinkafa with Miyan Kuka')
  assert.equal(top('jollof rice and chicken'), 'Nigerian Party Jollof Rice')
})

test('plain staples together are not some other dish', () => {
  // "rice and stew" is not Ofada rice and stew; "rice stew" is not Efo riro by
  // a slip (rice ~ rich); peppered chicken is not pepper soup.
  for (const q of ['rice and stew', 'rice stew', 'stew rice', 'pepper chicken', 'chicken pepper', 'goat soup', 'chicken soup', 'catfish soup']) {
    assert.deepEqual(findDishes(DISHES, q).map((d) => d.name), [], `"${q}" should suggest nothing`)
  }
})

test('every pepper soup on a menu finds pepper soup, with that protein', () => {
  for (const [q, protein] of [['beef pepper soup', 'Beef'], ['turkey pepper soup', 'Turkey'], ['cow leg pepper soup', 'Cow leg'], ['fish pepper soup', 'Catfish']]) {
    assert.equal(top(q), 'Pepper Soup', q)
    const names = suggestFor(dish('Pepper Soup'), CATALOGUE, NEW_ITEMS, q).rows.map((r) => r.item.name)
    assert.ok(names.includes(protein), `${q}: ${JSON.stringify(names)}`)
  }
})

test('suggestions are her own items, required lines first, each item once', () => {
  const s = suggestFor(dish('Efo Riro'), CATALOGUE, NEW_ITEMS)
  const names = s.rows.map((r) => r.item.name)
  for (const n of ['Efo tete', 'Tatashe', 'Fresh pepper (rodo)', 'Onion', 'Palm oil', 'Locust bean', 'Crayfish (ground)']) {
    assert.ok(names.includes(n), `Efo Riro should suggest ${n}`)
  }
  assert.equal(new Set(names).size, names.length)
  const firstOptional = s.rows.findIndex((r) => r.optional)
  if (firstOptional >= 0) assert.ok(s.rows.slice(firstOptional).every((r) => r.optional))
})

test('"iru or ogiri": the next choice when she has no iru', () => {
  const withoutIru = CATALOGUE.filter((c) => c.name !== 'Locust bean')
  const egusi = suggestFor(dish('Egusi Soup'), withoutIru, NEW_ITEMS).rows.map((r) => r.item.name)
  assert.ok(egusi.includes('Ogiri'), 'Egusi offers ogiri where iru is not on her list')
  assert.ok(!egusi.includes('Locust bean'))
})

test('a renamed item is still found by its market name', () => {
  const renamed = CATALOGUE.map((c) => (c.name === 'Locust bean' ? { ...c, name: 'Iru' } : c))
  const names = suggestFor(dish('Efo Riro'), renamed, NEW_ITEMS).rows.map((r) => r.item.name)
  assert.ok(names.includes('Iru'))
})

test('what she lacks is listed with how to add it', () => {
  const s = suggestFor(dish('Abacha'), CATALOGUE, NEW_ITEMS)
  const missing = s.notInList.map((n) => n.name)
  for (const n of ['Utazi leaf', 'Ugba (oil bean)', 'Potash (kaun)', 'Garden egg']) assert.ok(missing.includes(n), `Abacha lacks ${n}`)
  for (const n of s.notInList) assert.ok(n.item, `${n.name} should come with how to add it`)
  // Once she has added it, it is suggested like any other item.
  const later = suggestFor(dish('Abacha'), [...CATALOGUE, { id: 'own', name: 'Utazi leaf' }], NEW_ITEMS)
  assert.ok(later.rows.some((r) => r.item.name === 'Utazi leaf'))
  assert.ok(!later.notInList.some((n) => n.name === 'Utazi leaf'))
})
