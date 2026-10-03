'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError } from '@/lib/data/context'
import { localToday } from '@/lib/dates'

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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') ? p.date! : localToday()

  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) return { error: 'Your session has ended. Sign in again, then record the purchase.' }

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
      return { error: `We do not know how much one of those is yet: ${names}. Choose another unit, or add the measurement on the ingredient's page.` }
    }
    return { error: `That purchase could not be recorded: ${String(posted.reason).replace(/_/g, ' ')}.` }
  }

  revalidatePath('/purchases')
  revalidatePath('/dashboard')
  revalidatePath('/recipes')
  const n = Number(posted?.price_rows_written ?? lines.length)
  redirect(`/purchases/${purchase.id}?notice=${encodeURIComponent(`Purchase recorded. ${n} price${n === 1 ? '' : 's'} updated.`)}`)
}
