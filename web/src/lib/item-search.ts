/**
 * Finding an item by what the owner types: its name, or a name the market
 * uses for it ("okro" for Okra, "iru" for Locust bean, "maggi" for Seasoning
 * cube), with one wrong letter forgiven. Used by every item picker
 * (components/item-picker.tsx). Plain code, no model: the same words always
 * find the same items.
 *
 * Also a dish the owner types, for "Suggest what goes in" on New dish
 * (findDishes, suggestFor, at the end), against the dish list passed in
 * (lib/dish-library-data.ts), so this file imports nothing and tests can
 * load it directly.
 */
import type { LibraryDish, NewItem } from './dish-library-data'

export type PickItem = {
  id: string
  name: string
  /** Where it is listed before anything is typed: its category, "Packaging" or "Your own items". */
  group?: string
}

/**
 * Other names for the starter catalogue's items, by item name (lower case).
 * The catalogue's own aliases (migrations/0003_seed.sql) are repeated here
 * because an account's copy of an item does not carry them (0066 copies the
 * name, kind, category and base unit only), and the rest are the market
 * words owners type. Matching is by name, so an item the owner renamed keeps
 * its own name and loses these. Add a word only when it means this item and
 * nothing else on the list.
 */
const ALIASES: Record<string, string[]> = {
  'rice (local)': ['ofada', 'local rice'],
  'garri (white)': ['gari'],
  'garri (yellow)': ['gari'],
  'semovita': ['semolina'],
  'plain flour': ['all purpose flour'],
  'yam flour (elubo)': ['amala'],
  'plantain flour': ['elubo ogede'],
  'maize (corn)': ['agbado', 'masara'],
  'pap (ogi)': ['akamu'],
  'millet': ['gero'],
  'guinea corn': ['sorghum'],
  'acha': ['fonio'],
  'brown beans': ['oloyin', 'honey beans', 'ewa'],
  'white beans': ['ewa'],
  'black eyed beans': ['cowpea', 'ewa'],
  'bambara nut': ['okpa'],
  'groundnut (raw)': ['peanut'],
  'tiger nut': ['ofio', 'aya'],
  'water yam': ['ewura'],
  'plantain (ripe)': ['dodo'],
  'tomato': ['tomatoes'],
  'fresh pepper (rodo)': ['atarodo', 'ata rodo', 'scotch bonnet'],
  'tatashe': ['tatase', 'red bell pepper'],
  'shombo': ['cayenne'],
  'onion': ['alubosa', 'albasa'],
  'spring onion': ['green onion'],
  'ugu leaf': ['pumpkin leaf', 'ugwu', 'fluted pumpkin'],
  'waterleaf': ['gbure'],
  'bitterleaf': ['onugbu', 'ewuro', 'shuwaka'],
  'efo tete': ['green amaranth'],
  'scent leaf': ['efirin', 'efinrin', 'nchanwu', 'daidoya'],
  'okra': ['okro', 'ila', 'okwuru', 'kubewa'],
  'dried okra': ['dried okro'],
  'date': ['dabino'],
  'cow skin (ponmo)': ['kanda', 'kpomo', 'pomo'],
  'shaki (tripe)': ['towel'],
  'cow leg': ['bokoto', 'cow foot'],
  'assorted meat': ['orisirisi'],
  'titus fish': ['mackerel'],
  'panla (hake)': ['hake'],
  'stockfish': ['okporoko'],
  'periwinkle': ['isam'],
  'snail': ['igbin'],
  'evaporated milk': ['peak', 'carnation'],
  'milk powder': ['powdered milk', 'dano'],
  'cheese': ['wara', 'wagashi'],
  'palm oil': ['red oil', 'epo pupa'],
  'groundnut oil': ['peanut oil'],
  'shea butter': ['ori'],
  'seasoning cube': ['maggi', 'knorr', 'stock cube', 'bouillon'],
  'locust bean': ['iru', 'dawadawa'],
  'suya spice': ['yaji'],
  'ehu seed': ['ehuru', 'calabash nutmeg'],
  'uda': ['grains of selim', 'kimba'],
  'egusi (ground)': ['melon', 'melon seed'],
  'ogbono (ground)': ['apon', 'bush mango'],
  'ukazi leaf': ['afang', 'okazi'],
  'oha leaf': ['ora'],
  'tomato paste': ['tin tomato', 'tomato puree'],
  'groundnut paste': ['peanut butter'],
  'zobo leaf': ['hibiscus', 'zobo', 'sobo'],
  'soft drink': ['minerals', 'coke'],
  // Not on the starter list yet: items Recipe by LunchLoft's dishes use, added
  // by an owner from a dish suggestion (lib/dish-library-data.ts NEW_ITEMS,
  // which tests keep in step with these).
  'utazi leaf': ['utasi'],
  'palm nut (banga)': ['banga', 'akwu', 'palm fruit'],
  'potash (kaun)': ['kaun', 'akanwu', 'kanwa'],
  'ewedu leaf': ['jute leaf', 'lalo'],
  'ugba (oil bean)': ['ukpaka', 'oil bean'],
  'garden egg': ['anara', 'gauta', 'igba'],
  'kuka (baobab leaf powder)': ['kuka powder'],
  'cassava starch (usi)': ['usi', 'starch'],
  'aridan (uyayak)': ['uyayak'],
  'ram meat (lamb)': ['rago', 'lamb'],
  'kuli-kuli': ['kulikuli', 'groundnut cake'],
  'esa beans': ['esha beans', 'ẹ̀ṣà'],
  'african breadfruit (ukwa)': ['afon', 'ukwa'],
  'pigeon pea (fio fio)': ['fio fio'],
  'moringa leaf': ['zogale'],
  'pumpkin': ['kabewa'],
  'yakuwa (sorrel leaf)': ['roselle leaf'],
  'tamarind': ['tsamiya'],
  'wrapping leaves': ['banana leaf', 'corn leaf', 'moin moin leaf'],
}

/**
 * The catalogue's own order (catalog_categories.sort_order, 0003): staples
 * first. An account's categories carry no order, so it is kept here.
 * Packaging gathers both packaging categories (lib/data/purchase-catalog.ts).
 */
const GROUP_ORDER = [
  'Grains and Staples', 'Legumes and Nuts', 'Tubers and Plantain', 'Vegetables', 'Fruits',
  'Meat and Poultry', 'Fish and Seafood', 'Dairy and Eggs', 'Oils and Fats', 'Spices and Seasonings',
  'Soup Thickeners and Leaves', 'Condiments and Sauces', 'Baking', 'Drinks and Beverages',
  'Packaging', 'Disposables and Service',
]
/** The owner's own items come before the catalogue: she added them for a reason. */
export const OWN_GROUP = 'Your own items'

/**
 * Lower case, no accents (Ẹ̀ to e), anything but letters and digits made a
 * single space. Yoruba ṣ is said "sh", so ṣaki is shaki, not saki.
 */
export function normal(s: string): string {
  return s.normalize('NFD').replace(/ṣ/gi, 'sh').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** The item names other names are kept for (tests check each is a real catalogue item). */
export const NAMES_WITH_ALIASES: readonly string[] = Object.keys(ALIASES)

/** The other names an item goes by. */
export function aliasesOf(name: string): string[] {
  return ALIASES[name.toLowerCase().trim()] ?? []
}

/** a and b differ by at most one letter added, dropped, changed, or two swapped. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  if (la === lb) {
    let i = 0
    while (i < la && a[i] === b[i]) i++
    if (i === la) return true
    // One changed letter, or two neighbours swapped.
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  const [short, long] = la < lb ? [a, b] : [b, a]
  let i = 0
  while (i < short.length && short[i] === long[i]) i++
  return short.slice(i) === long.slice(i + 1)
}

/**
 * Real foods that are not on the starter list but are one letter from
 * something that is. Typed, they are never read as a slip: utazi is not
 * ukazi, atare (alligator pepper) is not atarodo, kanwa (potash) is not
 * kanda (ponmo). They still match an item of their own name exactly.
 */
const NEVER_A_SLIP = new Set([
  'utazi', 'atare', 'kanwa', 'akanwu', 'kaun', 'ewedu', 'ugba', 'ukpaka', 'kuka', 'banga',
  'atama', 'abacha', 'shawa', 'bonga', 'penne', 'basmati', 'potash',
])

/**
 * The forms of a typed word worth trying: "tomatoes" also tries "tomato",
 * "beans" "bean", "leaves" "leaf", and the market's "dry" the list's "dried".
 */
function stems(word: string): string[] {
  const out = [word]
  if (word === 'dry') out.push('dried')
  if (word.length > 4 && word.endsWith('ves')) out.push(`${word.slice(0, -3)}f`)
  if (word.length > 4 && word.endsWith('es')) out.push(word.slice(0, -2))
  if (word.length > 3 && word.endsWith('s')) out.push(word.slice(0, -1))
  return out
}

/**
 * How well one typed word matches one word of a name: 0 for not at all.
 * `slips`: whether one wrong letter is forgiven.
 */
function wordScore(typed: string, word: string, slips: boolean): number {
  let best = 0
  for (const t of stems(typed)) {
    if (word === t) return 3
    if (word.startsWith(t)) best = Math.max(best, 2)
    // One wrong letter, once enough is typed for that to mean anything, and
    // never the first: "okro" finds okra and "tatase" tatashe, but "ata" is
    // not fuzzed, and "dates" does not find water.
    else if (slips && t.length >= 4 && t[0] === word[0] && !NEVER_A_SLIP.has(typed) &&
             (withinOneEdit(t, word) || withinOneEdit(t, word.slice(0, t.length)))) {
      best = Math.max(best, 1)
    }
  }
  return best
}

/**
 * Every typed word must find a word among `words`: "beef soup" is not beef.
 * 0 if one does not; otherwise 40 to 75, all exact or prefix words above any
 * with a wrong letter.
 */
function wordsScore(typedWords: string[], words: string[], slips: boolean): number {
  let total = 0
  for (const t of typedWords) {
    const best = Math.max(0, ...words.map((w) => wordScore(t, w, slips)))
    if (best === 0) return 0
    total += best
  }
  return 40 + Math.round((total / (typedWords.length * 3)) * 35)
}

/**
 * How well what was typed matches one text (a name or one of its other
 * names), both already normal(). 0 is no match; higher is better.
 */
export function textScore(typed: string, text: string, slips = true): number {
  if (!typed || !text) return 0
  if (text === typed) return 100
  const glued = (s: string) => s.replace(/ /g, '')
  // "bitter leaves" against bitterleaf: glued, with the last word's other forms.
  const typedWords = typed.split(' ')
  const last = typedWords[typedWords.length - 1]
  const gluedTyped = stems(last).map((s) => [...typedWords.slice(0, -1), s].join(''))
  if (gluedTyped.includes(glued(text))) return 95
  if (text.startsWith(typed)) return 90
  if (gluedTyped.some((g) => glued(text).startsWith(g))) return 85
  const score = wordsScore(typedWords, text.split(' '), slips)
  if (score > 0) return score
  return typed.length >= 3 && text.includes(typed) ? 50 : 0
}

/**
 * The items that match what was typed, best first. Nothing typed: all of
 * them, as given. A wrong letter is forgiven only when nothing matches as
 * typed: "crayfsh" finds Crayfish, but "rice" does not bring in Plantain (ripe).
 */
export function searchItems<T extends PickItem>(items: T[], typed: string): T[] {
  const q = normal(typed)
  if (!q) return items
  const typedWords = q.split(' ')
  const named = items.map((item) => {
    const name = normal(item.name)
    const others = aliasesOf(item.name).map(normal)
    // Words may come from the name and its other names together: "ofada rice", "maggi cube".
    const together = [...new Set([name, ...others].flatMap((t) => t.split(' ')))]
    return { item, name, others, together }
  })
  const scoreAll = (slips: boolean) => {
    const scored: { item: T; score: number }[] = []
    for (const { item, name, others, together } of named) {
      // A name beats another name for it, so "melon" lists Egusi after any item called melon.
      const score = Math.max(
        textScore(q, name, slips),
        ...others.map((a) => textScore(q, a, slips) - 5),
        typedWords.length > 1 ? wordsScore(typedWords, together, slips) - 8 : 0,
      )
      if (score > 0) scored.push({ item, score })
    }
    return scored
  }
  const exact = scoreAll(false)
  const scored = exact.length > 0 ? exact : scoreAll(true)
  return scored
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map((s) => s.item)
}

function groupRank(group: string): number {
  if (group === OWN_GROUP) return -1
  const i = GROUP_ORDER.indexOf(group)
  return i < 0 ? GROUP_ORDER.length : i
}

// ---------------------------------------------------------------------------
// DISHES: "Suggest what goes in". Names only, never an amount: the owner types
// how much of each goes into one batch, and createDish refuses a row without
// one (recipes/new/actions.ts).
// ---------------------------------------------------------------------------

/** Words that say what kind of dish, not which: "Miyan Kuka" is kuka, "rice and stew" is rice, stew. */
const DISH_FILLER = new Set(['and', 'with', 'n', 'soup', 'miyan', 'miyar', 'ofe'])
/**
 * Plain staples a menu lists on their own ("Rice", "Stew", "Chicken"). Typed
 * alone or together they name a dish only exactly ("pepper soup", "stew"),
 * never by sharing a word with one: "pepper chicken" is not pepper soup.
 */
const DISH_GENERIC = new Set(['rice', 'white', 'stew', 'beans', 'bean', 'yam', 'plantain', 'chicken', 'beef', 'fish',
  'meat', 'goat', 'turkey', 'pepper', 'egg', 'eggs', 'bread', 'fried', 'boiled', 'cake', 'noodles', 'pasta', 'cow', 'leg', 'assorted'])

/**
 * How well what was typed names a dish: 0 for not at all. Stricter than for
 * items, so a plain "rice", "beef" or "bread" on a menu is not taken for
 * Masa (Rice Cakes), Suya ("beef suya") or Ukwa ("breadfruit"):
 * - the exact name, or another exact name for it, always counts;
 * - otherwise at least one typed word must be more than a plain staple, and
 *   each word must stand for a whole word of the name: that word, most of it
 *   while still typing ("egus"), or one slip. A staple that finds nothing is
 *   let go ("jollof rice and chicken" is still jollof rice);
 * - and the words must cover most of the name, leaving out "soup", "miyan",
 *   "ofe": a dish's own name by its first half ("efo" for Efo riro), any
 *   other name by more than half.
 */
function dishTextScore(q: string, text: string, slips: boolean, otherName: boolean): number {
  const exact = textScore(q, text, slips)
  if (exact >= 95) return exact
  const typed = q.split(' ').filter((t) => !DISH_FILLER.has(t))
  if (typed.length === 0 || typed.every((t) => DISH_GENERIC.has(t))) return 0
  const words = text.split(' ')
  const coversWord = (t: string, w: string) =>
    stems(t).some((s) => w === s || (w.startsWith(s) && s.length >= 0.6 * w.length)) ||
    (slips && t.length >= 4 && t[0] === w[0] && !NEVER_A_SLIP.has(t) && withinOneEdit(t, w))
  const kept = typed.filter((t) => words.some((w) => coversWord(t, w)))
  if (kept.length === 0 || typed.some((t) => !kept.includes(t) && !DISH_GENERIC.has(t))) return 0
  const score = textScore(kept.join(' '), text, slips)
  if (score === 0) return 0
  const core = words.filter((w) => !DISH_FILLER.has(w))
  const named = core.length ? core : words
  const covered = named.filter((w) => kept.some((t) => coversWord(t, w))).length
  const half = !otherName && kept.some((t) => coversWord(t, named[0]))
  return covered * 2 >= named.length + (half ? 0 : 1) ? score : 0
}

/** Find her own item for an ingredient name: by its name, the name without brackets, or a market name. */
export function ownItemFinder<T extends { id: string; name: string }>(items: T[]): (name: string) => T | undefined {
  const mine = new Map<string, T>()
  // Her exact names first, so another item's market name never shadows a real one.
  for (const i of items) { const k = normal(i.name); if (!mine.has(k)) mine.set(k, i) }
  for (const i of items) for (const k of itemKeys(i.name)) if (!mine.has(k)) mine.set(k, i)
  return (name: string) => itemKeys(name).map((k) => mine.get(k)).find(Boolean)
}

/** The dishes that match what was typed, best first (at most `max`). Fewer than 3 letters: none. */
export function findDishes(dishes: LibraryDish[], typed: string, max = 3): LibraryDish[] {
  const q = normal(typed)
  if (q.length < 3) return []
  const score = (d: LibraryDish, slips: boolean) => Math.max(
    dishTextScore(q, normal(d.name), slips, false),
    // "Masa (Rice Cakes)" is Masa.
    dishTextScore(q, normal(d.name.replace(/\(.*?\)/g, ' ')), slips, false),
    ...d.aliases.map((a) => dishTextScore(q, normal(a), slips, true) - 3),
  )
  // A slip only when nothing matches as typed, as for items.
  const rank = (slips: boolean) => dishes
    .map((d) => ({ d, s: score(d, slips) }))
    .filter((x) => x.s >= 60)
    // A full list before a partial one at the same score.
    .sort((a, b) => b.s - a.s || Number(!!a.d.partial) - Number(!!b.d.partial) || a.d.name.localeCompare(b.d.name))
  const exact = rank(false)
  return (exact.length ? exact : rank(true)).slice(0, max).map((x) => x.d)
}

export type Suggestion<T extends { id: string; name: string }> = {
  /** Her items for the dish, in recipe order, the required ones first. */
  rows: { item: T; optional: boolean }[]
  /** Ingredients she has no item for yet; `item` says how to add it when it is one of the new items. */
  notInList: { name: string; item?: NewItem; optional: boolean }[]
}

/** What an item can be found by: its name, the name without its brackets, and its other names. */
function itemKeys(name: string): string[] {
  return [normal(name), normal(name.replace(/\(.*?\)/g, ' ')), ...aliasesOf(name).map(normal)]
}

/**
 * The dish's ingredients as the business's own items. Where the recipe allows
 * more than one way ("iru or ogiri", "catfish or goat meat"), the choice her
 * dish name points at wins ("goat meat pepper soup"), then the first she has
 * every item for that the dish does not already have; if she has none, the
 * first choice's missing items are listed so she can add them.
 */
export function suggestFor<T extends { id: string; name: string }>(
  dish: LibraryDish, items: T[], newItems: NewItem[], typed = '',
): Suggestion<T> {
  const said = ` ${normal(typed)} `
  const named = (option: string[]) => option.some((n) => {
    const first = normal(n).split(' ')[0]
    return first.length >= 3 && said.includes(` ${first} `)
  })
  const find = ownItemFinder(items)

  const rows: Suggestion<T>['rows'] = []
  const notInList: Suggestion<T>['notInList'] = []
  const used = new Set<string>()
  const ordered = [...dish.lines.filter((l) => !l.optional), ...dish.lines.filter((l) => l.optional)]
  for (const line of ordered) {
    const optional = !!line.optional
    const have = (o: string[]) => o.every((n) => find(n))
    const fresh = (o: string[]) => o.some((n) => !used.has(find(n)!.id))
    const choice = line.options.find((o) => named(o) && have(o))
      ?? line.options.find((o) => have(o) && fresh(o))
      ?? line.options.find(have)
      ?? line.options[0]
    for (const name of choice) {
      const item = find(name)
      if (item) {
        if (used.has(item.id)) continue
        used.add(item.id)
        rows.push({ item, optional })
      } else if (!notInList.some((n) => n.name === name)) {
        notInList.push({ name, item: newItems.find((x) => x.name === name), optional })
      }
    }
  }
  return { rows, notInList }
}

/** Items in their groups: her own items, then the catalogue's order, then anything else A to Z. */
export function groupItems<T extends PickItem>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const g = item.group || OWN_GROUP
    groups.set(g, [...(groups.get(g) ?? []), item])
  }
  return [...groups.entries()]
    .map(([g, list]): [string, T[]] => [g, [...list].sort((a, b) => a.name.localeCompare(b.name))])
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
}
