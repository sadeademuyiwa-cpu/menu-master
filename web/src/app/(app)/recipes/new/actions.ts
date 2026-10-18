'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError, refusalNotice } from '@/lib/data/context'
import { loadPurchaseCatalog, type CatalogItem } from '@/lib/data/purchase-catalog'
import { NEW_ITEMS } from '@/lib/dish-library-data'
import { canEditItems } from '../../purchases/buy-roles'

export type DishResult = { error: string } | null
export type AddedItem = { item: CatalogItem } | { error: string }

const BASE_UNIT = { weight: 'g', volume: 'ml', count: 'unit' } as const

/**
 * An item a dish suggestion needs that she does not have yet (Utazi leaf for
 * Abacha), added without leaving the dish. Only the items the dish list
 * names (NEW_ITEMS), measured and filed the way that list says; anything
 * else is added under Ingredients. Row-level security still decides who may
 * add an item (owner, manager, kitchen; 0015). If she already has it, that
 * one is used: names are unique per business, whatever the case.
 */
export async function addSuggestedItem(name: string): Promise<AddedItem> {
  const wanted = NEW_ITEMS.find((x) => x.name === name)
  if (!wanted) return { error: 'Add that item under Ingredients.' }
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) return { error: 'Your session has ended. Sign in again, then add the item.' }
  if (!canEditItems(ctx.role)) return { error: `Ask the owner or a manager to add ${wanted.name} under Ingredients.` }

  // Put away earlier: bring that one back, with its prices, rather than make a
  // second one (a put-away item does not hold its name, 0001's partial index,
  // and could then never be restored).
  const { data: away } = await supabase.from('ingredients').select('id')
    .eq('account_id', accountId).ilike('name', wanted.name).not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false }).limit(1).returns<{ id: string }[]>()
  if (away?.[0]) {
    const { data: back, error: backError } = await supabase.from('ingredients').update({ deleted_at: null })
      .eq('id', away[0].id).select('id').maybeSingle<{ id: string }>()
    if (backError && backError.code !== '23505') return { error: describeWriteError(backError) ?? `We could not add ${wanted.name}.` }
    if (back) return finish(back.id)
  }

  const [{ data: unit }, { data: categories }] = await Promise.all([
    supabase.from('units').select('id').eq('code', BASE_UNIT[wanted.measuredBy]).maybeSingle<{ id: string }>(),
    // Her own business's category: someone in two businesses can read both.
    supabase.from('ingredient_categories').select('id').eq('account_id', accountId).eq('name', wanted.group)
      .limit(1).returns<{ id: string }[]>(),
  ])
  if (!unit) return { error: `We could not add ${wanted.name}. Try again.` }

  const { data: made, error } = await supabase.from('ingredients').insert({
    account_id: accountId, name: wanted.name, kind: 'ingredient',
    base_unit_id: unit.id, category_id: categories?.[0]?.id ?? null,
  }).select('id').maybeSingle<{ id: string }>()
  let id = made?.id
  if (error) {
    if (error.code !== '23505') return { error: describeWriteError(error) ?? `We could not add ${wanted.name}.` }
    const { data: existing } = await supabase.from('ingredients').select('id')
      .ilike('name', wanted.name).is('deleted_at', null).limit(1).returns<{ id: string }[]>()
    id = existing?.[0]?.id
  }
  // No row and no error: refused quietly (the role, or the trial has ended).
  if (!id) return { error: await refusalNotice(ctx.role) }
  return finish(id)

  async function finish(itemId: string): Promise<AddedItem> {
    revalidatePath('/ingredients')
    const { items } = await loadPurchaseCatalog(supabase, 'cook')
    const item = items.find((i) => i.id === itemId)
    return item ? { item } : { error: `${wanted!.name} was added. Reload the page to use it.` }
  }
}

/**
 * A new dish and what goes into one batch of it, in one go. The same rows
 * the recipe page writes -- the recipe, its lines -- followed by EXACTLY ONE
 * cost snapshot (F3; see recipes/[id]). A dish may be saved with no
 * ingredients yet: its page then asks for them first.
 */
export async function createDish(_prev: DishResult, formData: FormData): Promise<DishResult> {
  const name = String(formData.get('name') ?? '').trim()
  const batch = Number(formData.get('batch_yield_qty'))
  const yieldUnitId = String(formData.get('yield_unit_id') ?? '')
  const portionRaw = String(formData.get('portion_qty') ?? '').trim()

  if (!name) return { error: 'Give the dish a name.' }
  if (!Number.isFinite(batch) || batch <= 0) return { error: 'Say how much one batch makes. It must be more than zero.' }
  if (!yieldUnitId) return { error: 'Choose what one batch is counted in.' }

  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) return { error: 'Your session has ended. Sign in again, then save the dish.' }

  // Counted in plates or portions, one portion is one of them. Otherwise the
  // owner says how much a portion is, or leaves it out.
  const { data: yieldUnit } = await supabase.from('units').select('code').eq('id', yieldUnitId)
    .maybeSingle<{ code: string }>()
  let portion: number | null = null
  if (yieldUnit?.code === 'portion') portion = 1
  else if (portionRaw !== '') {
    portion = Number(portionRaw)
    if (!Number.isFinite(portion) || portion <= 0) return { error: 'A portion has to be more than zero, or left empty.' }
  }

  const ids = formData.getAll('line_ingredient_id').map(String)
  const qtys = formData.getAll('line_qty').map(String)
  const units = formData.getAll('line_unit_id').map(String)
  const lines: { ingredient_id: string; qty: number; unit_id: string }[] = []
  for (let i = 0; i < ids.length; i++) {
    const raw = (qtys[i] ?? '').trim()
    if (!ids[i] && !raw) continue
    if (!ids[i]) return { error: `Ingredient ${i + 1}: choose which ingredient it is, or clear the row.` }
    const qty = Number(raw)
    if (!raw || !Number.isFinite(qty) || qty <= 0 || !units[i]) {
      return { error: `Ingredient ${i + 1}: enter how much goes into one batch. It must be more than zero.` }
    }
    lines.push({ ingredient_id: ids[i], qty, unit_id: units[i] })
  }

  const { data: recipe, error: rErr } = await supabase.from('recipes').insert({
    account_id: accountId, business_id: businessId, name,
    batch_yield_qty: batch, yield_unit_id: yieldUnitId, portion_qty: portion, status: 'active',
  }).select('id').single()
  if (rErr || !recipe) {
    return { error: rErr?.code === '23505'
      ? `You already have a dish called “${name}”. Give this one a different name.`
      : describeWriteError(rErr) ?? 'We could not save that dish.' }
  }

  if (lines.length > 0) {
    const { error: lErr } = await supabase.from('recipe_lines')
      .insert(lines.map((l) => ({ account_id: accountId, recipe_id: recipe.id, ...l })))
    if (lErr) {
      await supabase.from('recipes').delete().eq('id', recipe.id)
      return { error: describeWriteError(lErr) ?? 'We could not save what goes into that dish.' }
    }
    await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipe.id })
  }

  revalidatePath('/recipes')
  revalidatePath('/dashboard')
  const notice = lines.length ? 'Dish saved.' : 'Dish saved. Now add what goes into one batch.'
  redirect(`/recipes/${recipe.id}?notice=${encodeURIComponent(notice)}`)
}
