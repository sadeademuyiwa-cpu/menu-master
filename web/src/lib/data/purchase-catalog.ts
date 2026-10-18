import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type CatalogUnit = { id: string; label: string }
export type CatalogItem = {
  id: string
  name: string
  /** Where it appears in the picker: its category, or "Packaging". */
  group: string
  /**
   * The units this item can be bought in WITHOUT a guess: its own base unit,
   * any unit of the same kind with a fixed factor (kg for g, litres for ml),
   * and any local measure the owner has told us the size of for this item.
   * The default (most likely) unit comes first.
   */
  units: CatalogUnit[]
  /**
   * Buying only: local measures (paint, derica, bag...) this item has no size
   * for yet. Offered so the owner can pick the unit she actually bought in and
   * say, once, how much one holds. Never costed until she does.
   */
  unsized?: CatalogUnit[]
  /** Buying only: the units a size can be given in (kg or grams for rice). */
  sizeUnits?: CatalogUnit[]
}

/** A purchase line from history: what was bought last time, in her own unit. */
export type LastBought = {
  qty: number
  /** The unit it was bought in, to offer first again. */
  unitId: string
  /** "bag", "kg", "paint". */
  unit: string
  /** What was paid. Only present for a role that may see costs. */
  amount?: number
  day: string
}

/** The words owners use for the units, where they differ from the database name. */
const UNIT_LABEL: Record<string, string> = {
  kg: 'kg', g: 'grams', mg: 'mg', l: 'litres', ml: 'ml', cl: 'cl',
  cup_m: 'cups (250 ml)', tbsp: 'tablespoons', tsp: 'teaspoons',
  unit: 'pieces', pair: 'pairs', dozen: 'dozen',
}
/** The order units are offered in: the everyday ones first. */
const ORDER = ['kg', 'g', 'mg', 'l', 'ml', 'cup_m', 'tbsp', 'tsp', 'cl', 'unit', 'dozen', 'pair']
/** The unit most purchases of each kind are made in, offered first. */
const PREFERRED: Record<string, string> = { mass: 'kg', volume: 'l', count: 'unit' }
/** Units things are actually bought in. Nobody buys rice by the milligram or teaspoon. */
const BUYING_UNITS = new Set(['kg', 'g', 'l', 'ml', 'cl', 'unit', 'pair', 'dozen'])
/**
 * Local measures in the order a market buyer reaches for them. Any not named
 * here follow in alphabetical order. A portion is a serving, not something
 * bought, so it is not offered for buying.
 */
const LOCAL_ORDER = ['paint', 'derica', 'bag', 'basket', 'mudu', 'congo', 'kongo', 'tin', 'crate', 'carton',
  'bunch', 'heap', 'tuber', 'sachet', 'pack', 'bottle', 'gallon', 'jerrican', 'keg', 'drum', 'sack']
const NOT_BOUGHT_IN = new Set(['portion'])
/** The units a size is given in: "one paint is 3 kg". */
const SIZE_UNITS = new Set(['kg', 'g', 'l', 'ml', 'unit'])

/** "paint" for "Paint (rubber)", "cup" for "Cup (local tin)": the word said at the market. */
export function localWord(u: { code: string; name: string }): string {
  return UNIT_LABEL[u.code] ?? (u.name.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase() || u.code)
}

/** Where an item is listed in a picker: its category, "Packaging", or her own. */
function groupOf(kind: string, category: string | undefined): string {
  return kind === 'packaging' ? 'Packaging' : (category ?? 'Your own items')
}

/**
 * Every active item with its group, for an item picker (components/item-picker.tsx)
 * on a page that needs names only: a dish's "Add an ingredient", a draft or
 * corrected purchase.
 */
export async function loadItemList(supabase: Supabase): Promise<{ id: string; name: string; group: string }[]> {
  const [{ data: ingredients }, { data: categories }] = await Promise.all([
    supabase.from('ingredients').select('id,name,kind,category_id')
      .is('deleted_at', null).eq('is_active', true).order('name')
      .returns<{ id: string; name: string; kind: string; category_id: string | null }[]>(),
    supabase.from('ingredient_categories').select('id,name').returns<{ id: string; name: string }[]>(),
  ])
  const category = new Map((categories ?? []).map((c) => [c.id, c.name]))
  return (ingredients ?? []).map((i) => ({ id: i.id, name: i.name, group: groupOf(i.kind, category.get(i.category_id ?? '')) }))
}

/** Units a recipe measures in: the buying units plus the kitchen spoons and cups. */
const COOKING_UNITS = new Set([...BUYING_UNITS, 'mg', 'tsp', 'tbsp', 'cup_m'])

export async function loadPurchaseCatalog(supabase: Supabase, purpose: 'buy' | 'cook' = 'buy'): Promise<{
  items: CatalogItem[]
  /** Items this business has bought before, most recent first. These are the priced ones. */
  recent: string[]
}> {
  const allowed = purpose === 'buy' ? BUYING_UNITS : COOKING_UNITS
  const [{ data: ingredients }, { data: categories }, { data: units }, { data: conversions }, { data: prices }] =
    await Promise.all([
      supabase.from('ingredients').select('id,name,kind,category_id,base_unit_id')
        .is('deleted_at', null).eq('is_active', true).order('name')
        .returns<{ id: string; name: string; kind: string; category_id: string | null; base_unit_id: string }[]>(),
      supabase.from('ingredient_categories').select('id,name')
        .returns<{ id: string; name: string }[]>(),
      supabase.from('units').select('id,code,name,kind,factor_to_base')
        .returns<{ id: string; code: string; name: string; kind: string; factor_to_base: string | null }[]>(),
      supabase.from('ingredient_unit_conversions').select('ingredient_id,unit_id,qty_in_base')
        .returns<{ ingredient_id: string; unit_id: string; qty_in_base: string }[]>(),
      supabase.from('ingredient_prices').select('ingredient_id').is('reversed_at', null)
        .order('created_at', { ascending: false }).limit(300)
        .returns<{ ingredient_id: string }[]>(),
    ])

  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const convOf = new Map<string, { unit_id: string; qty_in_base: string }[]>()
  for (const c of conversions ?? []) convOf.set(c.ingredient_id, [...(convOf.get(c.ingredient_id) ?? []), c])

  const label = localWord
  const localRank = (code: string) => { const i = LOCAL_ORDER.indexOf(code); return i < 0 ? LOCAL_ORDER.length : i }
  const measures = purpose === 'buy'
    ? (units ?? []).filter((u) => u.factor_to_base === null && !NOT_BOUGHT_IN.has(u.code))
        .sort((a, b) => localRank(a.code) - localRank(b.code) || label(a).localeCompare(label(b)))
    : []

  const items: CatalogItem[] = (ingredients ?? []).map((i) => {
    const base = unitById.get(i.base_unit_id)
    const sameKind = base
      ? (units ?? []).filter((u) => u.kind === base.kind && u.factor_to_base !== null &&
          (allowed.has(u.code) || u.id === base.id))
      : []
    const preferred = base ? PREFERRED[base.kind] : undefined
    const rank = (code: string) => { const i = ORDER.indexOf(code); return i < 0 ? ORDER.length : i }
    sameKind.sort((a, b) => Number(b.code === preferred) - Number(a.code === preferred) || rank(a.code) - rank(b.code))
    const local = (convOf.get(i.id) ?? []).flatMap((c) => {
      const u = unitById.get(c.unit_id)
      return u && base ? [{ id: u.id, label: `${label(u)} (yours: ${Number(c.qty_in_base).toLocaleString('en-NG')} ${base.code})` }] : []
    })
    const ownUnits = base && !sameKind.some((u) => u.id === base.id) ? [base] : []
    const item: CatalogItem = {
      id: i.id,
      name: i.name,
      group: groupOf(i.kind, categoryName.get(i.category_id ?? '')),
      units: [...sameKind, ...ownUnits].map((u) => ({ id: u.id, label: label(u) })).concat(local),
    }
    if (purpose === 'buy' && base) {
      const sized = new Set((convOf.get(i.id) ?? []).map((c) => c.unit_id))
      item.unsized = measures.filter((u) => !sized.has(u.id) && u.id !== base.id)
        .map((u) => ({ id: u.id, label: label(u) }))
      item.sizeUnits = [...sameKind, ...ownUnits].filter((u) => SIZE_UNITS.has(u.code) || u.id === base.id)
        .map((u) => ({ id: u.id, label: label(u) }))
    }
    return item
  }).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))

  const recent = [...new Set((prices ?? []).map((p) => p.ingredient_id))].slice(0, purpose === 'buy' ? 12 : 60)
  return { items, recent }
}

/** How an item's price came about: a purchase, or an estimate typed before purchases were the only way. */
export type PriceKind = 'purchase' | 'estimate'

/**
 * Which items have a price, and whether it came from a purchase: one row per
 * item, read from v_ingredient_price_status (0042), the rule the Ingredients
 * list uses. Not a page of price rows, which leaves out anything priced long
 * ago and counts estimates as purchases. An estimate still costs dishes
 * (fn_ingredient_cost_basis), so it is a price, said as what it is.
 *
 * For a role that may see costs (canSeeCosts): to anyone else the view shows
 * every item as never priced, which would read "no price yet" everywhere.
 */
export async function loadPricedItems(supabase: Supabase, businessId: string): Promise<Record<string, PriceKind>> {
  const { data } = await supabase.from('v_ingredient_price_status').select('ingredient_id,price_state')
    .eq('business_id', businessId).neq('price_state', 'never_priced')
    .returns<{ ingredient_id: string; price_state: string }[]>()
  const out: Record<string, PriceKind> = {}
  for (const r of data ?? []) out[r.ingredient_id] = r.price_state === 'estimate_only' ? 'estimate' : 'purchase'
  return out
}

/**
 * What this business has bought before, from its own recorded purchases:
 * the items it buys most often (for the "Bought before" chips), the items and
 * units of its last purchase ("Same as last market run"), and the last line
 * of each item ("last time: 1 bag for ₦85,000").
 *
 * Quantities and amounts are hints only. They are never copied into a new
 * purchase: unit cost is what she paid divided by how much she bought, so a
 * stale quantity would silently give every dish a wrong cost.
 *
 * withAmounts: pass canSeeCosts(role). Without it no amount is selected at
 * all, so what was paid never reaches a phone that may not see costs.
 */
export async function loadBuyingHistory(supabase: Supabase, { withAmounts }: { withAmounts: boolean }): Promise<{
  /** Ingredient ids, most often bought first. */
  often: string[]
  /** The last recorded purchase's items, each with the unit it was bought in. */
  lastRun: { ingredientId: string; unitId: string }[]
  lastRunDay: string | null
  lastBought: Record<string, LastBought>
}> {
  // Recorded purchases only: a draft has not happened yet, a cancelled one was
  // undone, and a cancellation's own record (reverses set) holds no items.
  const { data: purchases } = await supabase.from('purchases').select('id,purchase_date')
    .eq('status', 'posted').is('reverses', null)
    .order('purchase_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(40).returns<{ id: string; purchase_date: string }[]>()
  const list = purchases ?? []
  if (list.length === 0) return { often: [], lastRun: [], lastRunDay: null, lastBought: {} }

  const [{ data: lines }, { data: units }] = await Promise.all([
    supabase.from('purchase_lines')
      .select(withAmounts ? 'purchase_id,ingredient_id,qty,unit_id,amount' : 'purchase_id,ingredient_id,qty,unit_id')
      .in('purchase_id', list.map((p) => p.id))
      .returns<{ purchase_id: string; ingredient_id: string; qty: string; unit_id: string; amount?: string }[]>(),
    supabase.from('units').select('id,code,name').returns<{ id: string; code: string; name: string }[]>(),
  ])
  const unitWord = new Map((units ?? []).map((u) => [u.id, localWord(u)]))
  const rank = new Map(list.map((p, i) => [p.id, i]))
  const dayOf = new Map(list.map((p) => [p.id, p.purchase_date]))
  // Newest purchase first, so the first line seen for an item is its last.
  const ordered = [...(lines ?? [])].sort((a, b) => (rank.get(a.purchase_id) ?? 0) - (rank.get(b.purchase_id) ?? 0))

  const count = new Map<string, number>()
  const lastBought: Record<string, LastBought> = {}
  for (const l of ordered) {
    count.set(l.ingredient_id, (count.get(l.ingredient_id) ?? 0) + 1)
    if (lastBought[l.ingredient_id]) continue
    const amount = withAmounts && l.amount !== undefined ? Number(l.amount) : undefined
    lastBought[l.ingredient_id] = {
      qty: Number(l.qty),
      unitId: l.unit_id,
      unit: unitWord.get(l.unit_id) ?? '',
      ...(amount !== undefined && Number.isFinite(amount) ? { amount } : {}),
      day: dayOf.get(l.purchase_id) ?? '',
    }
  }
  // Most often first; between equals, the one bought most recently.
  const firstSeen = new Map<string, number>()
  ordered.forEach((l, i) => { if (!firstSeen.has(l.ingredient_id)) firstSeen.set(l.ingredient_id, i) })
  const often = [...count.keys()].sort((a, b) =>
    (count.get(b) ?? 0) - (count.get(a) ?? 0) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0))

  const last = list[0]
  const seen = new Set<string>()
  const lastRun: { ingredientId: string; unitId: string }[] = []
  for (const l of ordered) {
    if (l.purchase_id !== last.id || seen.has(l.ingredient_id)) continue
    seen.add(l.ingredient_id)
    lastRun.push({ ingredientId: l.ingredient_id, unitId: l.unit_id })
  }
  return { often, lastRun, lastRunDay: last.purchase_date, lastBought }
}
