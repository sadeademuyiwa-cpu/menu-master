import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  normal, withinOneEdit, textScore, searchItems, groupItems, aliasesOf, OWN_GROUP, NAMES_WITH_ALIASES,
} from '../src/lib/item-search.ts'
import { NEW_ITEMS } from '../src/lib/dish-library-data.ts'

/** The starter catalogue, read from the seed the way an account receives it. */
const SEED = readFileSync(new URL('../../migrations/0003_seed.sql', import.meta.url), 'utf8')
const CATALOGUE = [...SEED.matchAll(/\('([^']+)','([^']+)','[a-z_]+','\{[^}]*\}','\{([^}]*)\}'\)/g)]
  .map((m, i) => ({ id: `i${i}`, group: m[1], name: m[2], seedAliases: m[3] ? m[3].split(',') : [] }))

const names = (typed: string, n = 3) => searchItems(CATALOGUE, typed).slice(0, n).map((i) => i.name)

test('the seed parses into the starter catalogue', () => {
  assert.ok(CATALOGUE.length >= 150, `only ${CATALOGUE.length} items parsed`)
  assert.ok(CATALOGUE.some((i) => i.name === 'Okra'))
})

test('every alias the seed gives an item is kept, so an account copy still finds it', () => {
  for (const item of CATALOGUE) {
    for (const a of item.seedAliases) {
      assert.ok(aliasesOf(item.name).includes(a), `${item.name} lost its seed alias "${a}"`)
    }
  }
})

test('every alias belongs to an item that exists: a starter item or an approved new one', () => {
  // A misspelt name here would silently drop that item's market words.
  const known = new Set([...CATALOGUE, ...NEW_ITEMS].map((i) => i.name.toLowerCase()))
  for (const k of NAMES_WITH_ALIASES) assert.ok(known.has(k), `"${k}" is not a starter or new item`)
  assert.ok(NAMES_WITH_ALIASES.length >= 50)
})

test('no market word points at two different items', () => {
  // "gari" for both garris and "ewa" for the three beans are the same food
  // in different forms, so those are allowed; anything else is a mistake.
  const shared = new Set(['gari', 'ewa'])
  const owner = new Map<string, string>()
  for (const name of NAMES_WITH_ALIASES) {
    for (const a of aliasesOf(name)) {
      if (shared.has(a)) continue
      assert.ok(!owner.has(a), `"${a}" is listed for both ${owner.get(a)} and ${name}`)
      owner.set(a, name)
    }
  }
})

test('normal() drops case, accents and punctuation', () => {
  assert.equal(normal('  Fresh pepper (rodo) '), 'fresh pepper rodo')
  assert.equal(normal('Ẹ̀wà'), 'ewa')
  assert.equal(normal('Cow-skin/ponmo'), 'cow skin ponmo')
})

test('withinOneEdit forgives exactly one slip', () => {
  assert.equal(withinOneEdit('okro', 'okra'), true) // changed
  assert.equal(withinOneEdit('tatase', 'tatashe'), true) // dropped
  assert.equal(withinOneEdit('crayfissh', 'crayfish'), true) // added
  assert.equal(withinOneEdit('rcie', 'rice'), true) // swapped
  assert.equal(withinOneEdit('okro', 'okay'), false)
  assert.equal(withinOneEdit('egusi', 'eg'), false)
})

test("the owner's own example: okro finds Okra first", () => {
  assert.equal(names('okro')[0], 'Okra')
  assert.equal(names('Okro')[0], 'Okra')
  assert.ok(names('okro', 5).includes('Dried okra'))
})

test('market and local names find the item', () => {
  assert.equal(names('iru')[0], 'Locust bean')
  assert.equal(names('maggi')[0], 'Seasoning cube')
  assert.equal(names('ugwu')[0], 'Ugu leaf')
  assert.equal(names('red oil')[0], 'Palm oil')
  assert.equal(names('gari')[0].startsWith('Garri'), true)
  assert.equal(names('ponmo')[0], 'Cow skin (ponmo)')
  assert.equal(names('kpomo')[0], 'Cow skin (ponmo)')
  assert.equal(names('apon')[0], 'Ogbono (ground)')
  assert.equal(names('ewuro')[0], 'Bitterleaf')
})

test('spacing and plurals do not matter', () => {
  assert.equal(names('stock fish')[0], 'Stockfish')
  assert.equal(names('ata rodo')[0], 'Fresh pepper (rodo)')
  assert.equal(names('atarodo')[0], 'Fresh pepper (rodo)')
  assert.equal(names('tomatoes')[0], 'Tomato')
  assert.equal(names('onions')[0], 'Onion')
})

test('a wrong letter is forgiven once enough is typed', () => {
  assert.equal(names('crayfsh')[0], 'Crayfish (ground)')
  assert.equal(names('tatase')[0], 'Tatashe')
  assert.equal(names('egussi')[0], 'Egusi (ground)')
})

test('a few letters list what starts with them', () => {
  assert.ok(names('cray', 1)[0] === 'Crayfish (ground)')
  assert.ok(names('pal', 5).includes('Palm oil'))
})

test('the exact name beats a near one', () => {
  assert.equal(names('rice')[0].startsWith('Rice'), true)
  assert.equal(names('salt')[0], 'Salt')
  assert.equal(names('beef')[0], 'Beef')
})

test('a different food one letter away is not offered as a slip', () => {
  // Utazi and ukazi (okazi) are different leaves; atare is alligator pepper,
  // not ata rodo; kanwa is potash, not kanda (ponmo).
  assert.deepEqual(names('utazi'), [])
  assert.deepEqual(names('atare'), [])
  assert.deepEqual(names('kanwa'), [])
  // The real ones still find their items.
  assert.equal(names('ukazi')[0], 'Ukazi leaf')
  assert.equal(names('kanda')[0], 'Cow skin (ponmo)')
  // And once an owner adds Utazi herself, typing it finds it.
  const withUtazi = [...CATALOGUE, { id: 'own', name: 'Utazi leaf', seedAliases: [] as string[] }]
  assert.deepEqual(searchItems(withUtazi, 'utazi').map((i) => i.name), ['Utazi leaf'])
})

test('a market word and a word of the real name work together', () => {
  assert.equal(names('ofada rice')[0], 'Rice (local)')
  assert.equal(names('maggi cube')[0], 'Seasoning cube')
  assert.equal(names('knorr cube')[0], 'Seasoning cube')
  assert.equal(names('red palm oil')[0], 'Palm oil')
  assert.equal(names('iru locust bean')[0], 'Locust bean')
  assert.equal(names('egusi seed')[0], 'Egusi (ground)')
  assert.equal(names('melon seed')[0], 'Egusi (ground)')
})

test('"dry" is the list\'s "dried", and leaves are leaf', () => {
  assert.equal(names('dry fish')[0], 'Dried fish')
  assert.equal(names('dry pepper')[0], 'Dried pepper (ground)')
  assert.equal(names('dry okro')[0], 'Dried okra')
  assert.equal(names('bitter leaves')[0], 'Bitterleaf')
  assert.equal(names('water leaves')[0], 'Waterleaf')
  assert.equal(names('ugu leaves')[0], 'Ugu leaf')
})

test('Yoruba ṣ is sh: ṣaki is shaki', () => {
  assert.equal(normal('Ṣàkì'), 'shaki')
  assert.equal(names('ṣaki')[0], 'Shaki (tripe)')
  assert.equal(names('saki')[0], 'Shaki (tripe)')
  assert.ok(!names('saki', 5).some((n) => n.startsWith('Baking')))
})

test('a slip is forgiven only when nothing matches as typed', () => {
  // "ripe" is one letter from "rice", and "water" from "dates" by a first letter.
  assert.ok(!names('rice', 10).includes('Plantain (ripe)'))
  assert.deepEqual(names('dates'), ['Date'])
  assert.ok(!names('limes', 5).includes('Liver'))
})

test('every typed word must match: no false friends', () => {
  assert.deepEqual(names('beef soup'), [])
  assert.deepEqual(names('zzzz'), [])
  // Three letters are never fuzzed, so "oka" does not drag in Okra by accident.
  assert.equal(textScore('oka', 'okra'), 0)
})

test('nothing typed returns every item, as given', () => {
  assert.equal(searchItems(CATALOGUE, '   ').length, CATALOGUE.length)
})

test('groups: her own items first, then the catalogue order, not A to Z', () => {
  const items = [
    { id: '1', name: 'Zobo leaf', group: 'Drinks and Beverages' },
    { id: '2', name: 'Rice (local)', group: 'Grains and Staples' },
    { id: '3', name: 'Okra', group: 'Vegetables' },
    { id: '4', name: 'Mama Put special mix' },
    { id: '5', name: 'Beef', group: 'Meat and Poultry' },
    { id: '6', name: 'Anything', group: 'A new group' },
  ]
  const order = groupItems(items).map(([g]) => g)
  assert.deepEqual(order, [OWN_GROUP, 'Grains and Staples', 'Vegetables', 'Meat and Poultry', 'Drinks and Beverages', 'A new group'])
})

test('with the real catalogue, Okra is no longer near the bottom', () => {
  const flat = groupItems(CATALOGUE).flatMap(([, list]) => list)
  const at = flat.findIndex((i) => i.name === 'Okra')
  // Vegetables are the fourth group; A to Z put them eleventh (option ~171).
  assert.ok(at < 90, `Okra is item ${at + 1}`)
})
