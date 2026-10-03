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
  const groupOf = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const convOf = new Map<string, { unit_id: string; qty_in_base: string }[]>()
  for (const c of conversions ?? []) convOf.set(c.ingredient_id, [...(convOf.get(c.ingredient_id) ?? []), c])

  const label = (u: { code: string; name: string }) => UNIT_LABEL[u.code] ?? u.name.toLowerCase()

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
    return {
      id: i.id,
      name: i.name,
      group: i.kind === 'packaging' ? 'Packaging' : (groupOf.get(i.category_id ?? '') ?? 'Your own items'),
      units: [...sameKind, ...ownUnits].map((u) => ({ id: u.id, label: label(u) })).concat(local),
    }
  }).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))

  const recent = [...new Set((prices ?? []).map((p) => p.ingredient_id))].slice(0, purpose === 'buy' ? 12 : 60)
  return { items, recent }
}
