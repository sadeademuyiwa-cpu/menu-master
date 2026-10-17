import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** One thing a customer can buy: a dish, or a dish in one of its sizes. */
export type MenuItem = {
  /** "recipeId:variantId" -- the same value the sale page has always used. */
  value: string
  name: string
  size: string | null
  category: string | null
  /** The owner's own selling price for it, or null if none is recorded. */
  price: number | null
  /** recipes.photo_path (0063): the dish's own photo, or null and the tile shows. */
  photo_path: string | null
}

type PriceRow = { recipe_id: string; variant_id: string | null; selling_price: string | number | null }

/**
 * What each dish sells for, keyed "recipeId:variantId", as the database
 * hands it over (a numeric string, or null when no price is recorded).
 *
 * fn_menu_prices (0064) is the one source, for every role: owner, manager
 * and accountant get exactly v_price_check's selling price, sales get the
 * same prices (the owner's ruling: staff may see what a dish sells for,
 * never what it costs), and kitchen gets nothing, so its tiles keep saying
 * "No price yet". It returns no cost, profit, margin or suggested price.
 *
 * Before 0064 the function is missing (PGRST202 / 42883) and the call errors.
 * Then the price comes from v_product_attention as it always did, which gives
 * owner, manager and accountant their prices and sales and kitchen nothing:
 * exactly the app before 0064, never a price someone was not allowed to see.
 * Several channels repeat a row per channel; the last one read wins, as
 * before.
 */
export async function loadMenuPrices(
  supabase: Supabase, businessId?: string | null,
): Promise<Map<string, string | null>> {
  const asText = (v: string | number | null) => (v === null || v === undefined ? null : String(v))
  const priceOf = new Map<string, string | null>()

  let call = supabase.rpc('fn_menu_prices').select('business_id,recipe_id,variant_id,selling_price')
  if (businessId) call = call.eq('business_id', businessId)
  const { data, error } = await call.returns<PriceRow[]>()
  if (!error && Array.isArray(data)) {
    for (const p of data) priceOf.set(`${p.recipe_id}:${p.variant_id ?? ''}`, asText(p.selling_price))
    return priceOf
  }

  const { data: legacy } = await supabase.from('v_product_attention')
    .select('recipe_id,variant_id,selling_price').returns<PriceRow[]>()
  for (const p of Array.isArray(legacy) ? legacy : []) {
    priceOf.set(`${p.recipe_id}:${p.variant_id ?? ''}`, asText(p.selling_price))
  }
  return priceOf
}

type RecipeRow = { id: string; name: string; category: string | null; photo_path?: string | null }

/**
 * The menu for taking an order. A dish sold in sizes appears once per size;
 * one sold by the portion appears once. The price is the one the dashboard
 * and the sale page read (loadMenuPrices), so it is the price shown
 * everywhere.
 */
export async function loadMenu(supabase: Supabase, businessId?: string | null): Promise<MenuItem[]> {
  const recipeQuery = (cols: string) => supabase.from('recipes').select(cols).is('deleted_at', null)
    .eq('status', 'active').order('name').returns<RecipeRow[]>()

  const [first, { data: variants }, priceOf] = await Promise.all([
    recipeQuery('id,name,category,photo_path'),
    supabase.from('recipe_variants').select('id,recipe_id,format:serving_formats(name)')
      .eq('is_active', true)
      .returns<{ id: string; recipe_id: string; format: { name: string } | null }[]>(),
    loadMenuPrices(supabase, businessId),
  ])
  // A database without 0063 has no photo_path; read the menu without photos
  // rather than show an empty sale screen.
  let recipes = first.data
  if (first.error && /photo_path/.test(first.error.message ?? '')) {
    ({ data: recipes } = await recipeQuery('id,name,category'))
  }

  const sizesOf = new Map<string, { id: string; name: string | null }[]>()
  for (const v of variants ?? []) {
    sizesOf.set(v.recipe_id, [...(sizesOf.get(v.recipe_id) ?? []), { id: v.id, name: v.format?.name ?? null }])
  }
  const price = (value: string) => {
    const p = priceOf.get(value)
    return p === null || p === undefined ? null : Number(p)
  }

  return (recipes ?? []).flatMap((r): MenuItem[] => {
    const photo = r.photo_path ?? null
    const sizes = sizesOf.get(r.id) ?? []
    if (sizes.length === 0) {
      const value = `${r.id}:`
      return [{ value, name: r.name, size: null, category: r.category, price: price(value), photo_path: photo }]
    }
    return sizes.map((s) => {
      const value = `${r.id}:${s.id}`
      return { value, name: r.name, size: s.name ?? 'one size', category: r.category, price: price(value), photo_path: photo }
    })
  })
}
