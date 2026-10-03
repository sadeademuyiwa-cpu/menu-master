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
}

/**
 * The menu for taking an order. A dish sold in sizes appears once per size;
 * one sold by the portion appears once. The price comes from the same view
 * the dashboard and the sale page read, so it is the price shown everywhere.
 */
export async function loadMenu(supabase: Supabase): Promise<MenuItem[]> {
  const [{ data: recipes }, { data: variants }, { data: prices }] = await Promise.all([
    supabase.from('recipes').select('id,name,category').is('deleted_at', null)
      .eq('status', 'active').order('name')
      .returns<{ id: string; name: string; category: string | null }[]>(),
    supabase.from('recipe_variants').select('id,recipe_id,format:serving_formats(name)')
      .eq('is_active', true)
      .returns<{ id: string; recipe_id: string; format: { name: string } | null }[]>(),
    supabase.from('v_product_attention').select('recipe_id,variant_id,selling_price')
      .returns<{ recipe_id: string; variant_id: string | null; selling_price: string | null }[]>(),
  ])

  const priceOf = new Map<string, number | null>()
  for (const p of prices ?? []) {
    priceOf.set(`${p.recipe_id}:${p.variant_id ?? ''}`, p.selling_price === null ? null : Number(p.selling_price))
  }
  const sizesOf = new Map<string, { id: string; name: string | null }[]>()
  for (const v of variants ?? []) {
    sizesOf.set(v.recipe_id, [...(sizesOf.get(v.recipe_id) ?? []), { id: v.id, name: v.format?.name ?? null }])
  }

  return (recipes ?? []).flatMap((r): MenuItem[] => {
    const sizes = sizesOf.get(r.id) ?? []
    if (sizes.length === 0) {
      const value = `${r.id}:`
      return [{ value, name: r.name, size: null, category: r.category, price: priceOf.get(value) ?? null }]
    }
    return sizes.map((s) => {
      const value = `${r.id}:${s.id}`
      return { value, name: r.name, size: s.name ?? 'one size', category: r.category, price: priceOf.get(value) ?? null }
    })
  })
}
