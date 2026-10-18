'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError } from '@/lib/data/context'
import { keepsAmount, keepsQty, priceProblem, recordPurchase, type PricePaid } from '@/lib/data/record-purchase'
import { localToday, paidDay } from '@/lib/dates'
import { NEW_ITEMS } from '@/lib/dish-library-data'
import { createOwnItem, type CreatedItem } from '@/lib/actions/items'
import { canRecordPurchases } from '../../purchases/buy-roles'

export type DishResult = { error: string } | null
export type AddedItem = CreatedItem

/**
 * An item a dish suggestion needs that she does not have yet (Utazi leaf for
 * Abacha), added without leaving the dish. Only the items the dish list
 * names (NEW_ITEMS), measured and filed the way that list says; anything
 * else is added through the search's own "+ Add". Who may add, and never a
 * second copy of one she has or put away: createOwnItem.
 */
export async function addSuggestedItem(name: string): Promise<AddedItem> {
  const wanted = NEW_ITEMS.find((x) => x.name === name)
  if (!wanted) return { error: 'Add that item under Ingredients.' }
  return createOwnItem(wanted.name, wanted.measuredBy, 'dish', wanted.group)
}

/** "3,000" or "3000"; null when left empty, NaN when it is not a usable amount. */
function typed(raw: string | undefined): number | null {
  const t = String(raw ?? '').replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

/**
 * A new dish and what goes into one batch of it, in one go. The same rows
 * the recipe page writes -- the recipe, its lines -- followed by EXACTLY ONE
 * cost snapshot (F3; see recipes/[id]). A dish may be saved with no
 * ingredients yet: its page then asks for them first.
 *
 * Beside an ingredient she may say what she paid for it ("₦3,000 for 1
 * paint"). That is recorded as a real purchase on the day she gives
 * (recordPurchase), before the cost is worked out, so the dish is costed
 * from it at once. Never an estimate, and never a figure she did not type.
 *
 * Everything that can be checked is checked before the first write, so a
 * refusal keeps her form. Then the dish, its lines, and last what she paid:
 * a purchase cannot be taken back without a cancellation, so it is never
 * recorded for lines that were refused, and a save tried again cannot record
 * it twice. Once the dish is written it is kept (only the owner may delete a
 * dish, 0015); anything refused after that is said on its page.
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
  const paid = formData.getAll('line_paid').map(String)
  const paidQtys = formData.getAll('line_paid_qty').map(String)
  const paidUnits = formData.getAll('line_paid_unit_id').map(String)
  const lines: { ingredient_id: string; qty: number; unit_id: string }[] = []
  const prices: PricePaid[] = []
  /** The row each price was typed on, to say which one a refusal is about. */
  const priceRow: number[] = []
  for (let i = 0; i < ids.length; i++) {
    const raw = (qtys[i] ?? '').trim()
    const amount = typed(paid[i])
    if (!ids[i] && !raw && amount === null) continue
    if (!ids[i]) return { error: `Ingredient ${i + 1}: choose which ingredient it is, or clear the row.` }
    const qty = Number(raw)
    if (!raw || !keepsQty(qty) || !units[i]) {
      return { error: `Ingredient ${i + 1}: enter the quantity that goes into one batch. It must be more than zero.` }
    }
    lines.push({ ingredient_id: ids[i], qty, unit_id: units[i] })
    if (amount === null) continue
    if (Number.isNaN(amount) || !keepsAmount(amount)) return { error: `Ingredient ${i + 1}: enter what you paid in naira, digits only, more than zero.` }
    const bought = typed(paidQtys[i])
    if (bought === null || Number.isNaN(bought) || !keepsQty(bought) || !paidUnits[i]) {
      return { error: `Ingredient ${i + 1}: say how much you bought for that price, and in what (kg, paint, bag…).` }
    }
    prices.push({ ingredientId: ids[i], qty: bought, unitId: paidUnits[i], amount })
    priceRow.push(i + 1)
  }
  let date = localToday()
  if (prices.length > 0) {
    if (!canRecordPurchases(ctx.role)) {
      return { error: 'Purchases are recorded by the owner, a manager or the accountant. Clear the price boxes to save the dish.' }
    }
    const day = paidDay(String(formData.get('paid_on') ?? ''))
    if (!day) return { error: 'Choose the day you paid. It cannot be after today.' }
    date = day
    const problem = await priceProblem(ctx, prices)
    if (problem) return { error: problem.at === null ? problem.message : `Ingredient ${priceRow[problem.at]}: ${problem.message}` }
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
  // Typed in full so the compiler knows nothing runs after it (redirect throws).
  const saved: (notice: string) => never = (notice) => {
    revalidatePath('/recipes')
    revalidatePath('/dashboard')
    redirect(`/recipes/${recipe.id}?notice=${encodeURIComponent(notice)}`)
  }

  if (lines.length === 0) saved('Dish saved. Now add what goes into one batch.')
  const { error: lErr } = await supabase.from('recipe_lines')
    .insert(lines.map((l) => ({ account_id: accountId, recipe_id: recipe.id, ...l })))
  if (lErr) {
    saved(`Dish saved, but what goes into it was not: ${describeWriteError(lErr) ?? 'it was refused.'} Add the ingredients below.`
      + (prices.length ? ' What you paid was not recorded either.' : ''))
  }

  // What she paid, after the lines it belongs to; the cost worked out below uses it.
  const refused = await recordPurchase(ctx, date, prices)
  await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipe.id })
  if (prices.length && !refused) revalidatePath('/purchases')
  saved(refused ? `Dish saved, but what you paid was not recorded. ${refused}`
    : prices.length ? `Dish saved, and what you paid for ${prices.length} item${prices.length === 1 ? '' : 's'} is recorded.`
    : 'Dish saved.')
}
