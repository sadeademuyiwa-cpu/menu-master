'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, closedRefusal, describeWriteError } from '@/lib/data/context'
import { paidDay } from '@/lib/dates'
import { writeMeasure } from '../../ingredients/measure'

export type PurchaseResult = { error: string } | null

type Payload = {
  lines: { ingredientId: string; qty: number; unitId: string; amount: number | null }[]
  supplierId?: string | null
  date?: string
  reference?: string
}

/**
 * Record a whole purchase from the purchase screen in one go: the draft, its
 * lines, then fn_post_purchase -- the same ledger path Purchases always used,
 * which owns every rule (role, zero-value refusal, unit conversions) and is
 * what re-costs every dish using these ingredients. If posting is refused,
 * everything written is removed again and the owner keeps their rows on
 * screen with the reason. "Save for later" stops before posting.
 */
export async function recordPurchase(_prev: PurchaseResult, formData: FormData): Promise<PurchaseResult> {
  let p: Payload
  try {
    p = JSON.parse(String(formData.get('payload') ?? '')) as Payload
  } catch {
    return { error: 'We could not read that purchase. Please try again.' }
  }
  const asDraft = String(formData.get('mode') ?? 'post') === 'draft'

  const lines = Array.isArray(p.lines) ? p.lines : []
  if (lines.length === 0) return { error: 'Add at least one item you bought and what you paid for it.' }
  for (const [i, l] of lines.entries()) {
    if (!l.ingredientId) return { error: `Item ${i + 1}: choose what you bought.` }
    if (!(typeof l.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0) || !l.unitId) {
      return { error: `Item ${i + 1}: enter how much you bought. It must be more than zero.` }
    }
    // A purchase at zero naira would drag the cost of every dish using it down.
    if (!(typeof l.amount === 'number' && Number.isFinite(l.amount) && l.amount > 0)) {
      return { error: `Item ${i + 1}: enter what you paid, in naira. It must be more than zero.` }
    }
  }
  // A real day, not after today: costing works as of today, so a purchase
  // dated next week would be recorded and then left out of every dish.
  const date = paidDay(p.date)
  if (!date) return { error: 'Choose the day you bought these. It cannot be after today.' }

  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) return { error: 'Your session has ended. Sign in again, then record the purchase.' }
  // Closed after a trial (D3): said plainly before anything is written.
  const closed = await closedRefusal(ctx.role)
  if (closed) return { error: closed }

  const { data: purchase, error: pErr } = await supabase.from('purchases').insert({
    account_id: accountId, business_id: businessId, purchase_date: date,
    supplier_id: p.supplierId || null, reference: (p.reference ?? '').trim() || null,
  }).select('id').single()
  if (pErr || !purchase) return { error: describeWriteError(pErr) ?? 'We could not start that purchase.' }
  const undo = async () => { await supabase.from('purchases').delete().eq('id', purchase.id) }

  const { error: lErr } = await supabase.from('purchase_lines').insert(lines.map((l) => ({
    account_id: accountId, purchase_id: purchase.id,
    ingredient_id: l.ingredientId, qty: l.qty, unit_id: l.unitId, amount: l.amount,
  })))
  if (lErr) {
    await undo()
    return { error: describeWriteError(lErr) ?? 'We could not save those items.' }
  }

  if (asDraft) {
    revalidatePath('/purchases')
    redirect(`/purchases/${purchase.id}?notice=${encodeURIComponent('Saved for later. Prices change only when you record it.')}`)
  }

  const { data: posted, error: postErr } = await supabase.rpc('fn_post_purchase', { p_purchase_id: purchase.id })
  if (postErr) {
    await undo()
    return { error: describeWriteError(postErr) ?? 'We could not record that purchase.' }
  }
  if (posted && posted.posted === false) {
    await undo()
    if (posted.reason === 'unresolved_conversions') {
      const names = (posted.blockers ?? [])
        .map((b: { ingredient_name?: string; unit_code?: string }) => `${b.ingredient_name ?? 'an item'} (${b.unit_code ?? 'that unit'})`)
        .join(', ')
      return { error: `We do not know how much one of those holds yet: ${names}. Say how much one holds on its line, or save this purchase for later.` }
    }
    return { error: `That purchase could not be recorded: ${String(posted.reason).replace(/_/g, ' ')}.` }
  }

  revalidatePath('/purchases')
  revalidatePath('/dashboard')
  revalidatePath('/recipes')
  const n = Number(posted?.price_rows_written ?? lines.length)
  redirect(`/purchases/${purchase.id}?notice=${encodeURIComponent(`Purchase recorded. ${n} price${n === 1 ? '' : 's'} updated.`)}`)
}

export type MeasureResult = { error: string } | { saved: true } | null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "How much is one paint of rice?", answered on the purchase screen without
 * leaving it, so the rows already typed stay where they are.
 *
 * The size is said the way she knows it ("3 kg") and turned into the item's
 * base unit by fn_resolve_qty_to_base, the database's own resolver, never by
 * arithmetic here. It is then saved through writeMeasure, the same write the
 * ingredient page makes. Owner, manager and kitchen may save one (0015);
 * anyone else is refused by the database and told so in plain words.
 */
export async function saveMeasure(input: {
  ingredientId: string
  unitId: string
  size: number | null
  sizeUnitId: string
}): Promise<MeasureResult> {
  const { ingredientId, unitId, size, sizeUnitId } = input ?? {}
  if (![ingredientId, unitId, sizeUnitId].every((v) => typeof v === 'string' && UUID.test(v))) {
    return { error: 'Choose the item and the unit again, then say how much one holds.' }
  }
  if (!(typeof size === 'number' && Number.isFinite(size) && size > 0)) {
    return { error: 'Say how much one holds. It must be more than zero.' }
  }

  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) return { error: 'Your session has ended. Sign in again, then add the size.' }

  const { data: qtyBase, error: resolveError } = await supabase.rpc('fn_resolve_qty_to_base', {
    p_ingredient_id: ingredientId, p_qty: size, p_unit_id: sizeUnitId,
  })
  if (resolveError) return { error: describeWriteError(resolveError) ?? 'We could not read that size. Try again.' }
  const inBase = qtyBase === null || qtyBase === undefined ? NaN : Number(qtyBase)
  if (!Number.isFinite(inBase) || inBase <= 0) {
    return { error: 'We could not read that size. Give it in the units offered.' }
  }

  const { error } = await writeMeasure(supabase, { accountId, ingredientId, unitId, qtyInBase: inBase })
  if (error) {
    return {
      error: error.code === '23505'
        ? 'That measure already has a size for this item. Choose it from the list.'
        : describeWriteError(error) ?? 'We could not save that size. Try again.',
    }
  }
  revalidatePath(`/ingredients/${ingredientId}`)
  revalidatePath('/ingredients')
  return { saved: true }
}
