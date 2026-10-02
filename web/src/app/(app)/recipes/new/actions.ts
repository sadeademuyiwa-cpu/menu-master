'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError } from '@/lib/data/context'

export type DishResult = { error: string } | null

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
