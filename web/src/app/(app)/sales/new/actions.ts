'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, closedRefusal, describeWriteError } from '@/lib/data/context'
import { localToday } from '@/lib/dates'
import { queueEvent } from '@/lib/analytics/queue'

export type OrderResult = { error: string } | null

type PayloadLine = {
  product?: string | null; description?: string | null
  qty: number; price: number | null
  /** Taken off this item only. */
  discount?: number
  /** What one of a NON-DISH item cost the owner (0061). Ignored for a dish. */
  cost?: number | null
}
type Payload = {
  lines: PayloadLine[]
  customerId?: string | null
  newCustomer?: { name: string; phone: string } | null
  date?: string
  reference?: string
  discount?: number
  /** Paid on the spot. Recorded after confirmation, from the confirmed total. */
  paid?: boolean
  /**
   * Part paid: what the customer handed over now, a deposit on a cake order
   * say. Recorded after confirmation, in the same two fields the sale page's
   * payment form writes (amount_paid, payment_status 'part_paid'), and never
   * more than the confirmed total. Null or absent when not part paid.
   */
  paidAmount?: number | null
}

const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const toKobo = (n: number) => Math.round(n * 100) / 100

/**
 * Record a whole sale from the order screen in one go.
 *
 * It takes the SAME path the sale page always has -- a draft order, its
 * lines, the whole-sale discount, then fn_confirm_order, which owns every
 * rule and freezes each line's cost -- just without a page load in between.
 * If any step is refused, everything written so far is removed again and the
 * owner keeps their basket on screen with the reason.
 *
 * mode: 'confirm' records the sale; 'send' records it exactly the same way
 * and opens the sale page ready to send the receipt (send=1); 'draft' saves
 * it for later.
 */
export async function placeOrder(_prev: OrderResult, formData: FormData): Promise<OrderResult> {
  let p: Payload
  try {
    p = JSON.parse(String(formData.get('payload') ?? '')) as Payload
  } catch {
    return { error: 'We could not read that sale. Please try again.' }
  }

  const lines = Array.isArray(p.lines) ? p.lines : []
  if (lines.length === 0) return { error: 'Add at least one item to the sale.' }
  for (const l of lines) {
    if (!(typeof l.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0)) {
      return { error: 'Every item needs a quantity of more than zero.' }
    }
    // Absence is not zero: a missing price is refused, never stored as free.
    if (!isAmount(l.price)) return { error: 'Every item needs the price you charged for it.' }
    if (!l.product && !(l.description ?? '').trim()) return { error: 'Every item needs a name.' }
    const d = l.discount ?? 0
    if (!isAmount(d)) return { error: 'A discount is an amount in naira, and cannot be negative.' }
    if (d > l.qty * l.price) return { error: 'A discount on an item cannot be more than that item comes to.' }
    if (l.cost !== undefined && l.cost !== null && !isAmount(l.cost)) {
      return { error: 'What an item costs you is an amount in naira, and cannot be negative.' }
    }
  }
  // Checked before anything is written, so a bad deposit never leaves a sale
  // recorded without its payment.
  const partPaid = p.paidAmount === undefined || p.paidAmount === null ? null : p.paidAmount
  if (partPaid !== null && !(isAmount(partPaid) && partPaid > 0)) {
    return { error: 'What they paid so far is an amount in naira, more than nothing.' }
  }
  // Before 0061 the column does not exist; sending it would refuse the whole
  // sale. Send it only when something was typed, and if that is refused for
  // being unknown, record the sale without it.
  const anyCost = lines.some((l) => !l.product && l.cost !== undefined && l.cost !== null)
  // "Save for later" keeps it as a draft: an order taken now, served and
  // confirmed another day. Nothing counts as a sale until it is confirmed.
  const mode = String(formData.get('mode') ?? 'confirm')
  const asDraft = mode === 'draft'
  const sendReceipt = mode === 'send'
  const discount = p.discount ?? 0
  if (!isAmount(discount)) return { error: 'A discount is an amount in naira, and cannot be negative.' }
  const subtotal = lines.reduce((t, l) => t + l.qty * (l.price ?? 0) - (l.discount ?? 0), 0)
  if (discount > subtotal) return { error: 'The discount is bigger than the sale itself.' }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') ? p.date! : localToday()

  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) return { error: 'Your session has ended. Sign in again, then record the sale.' }
  // Closed after a trial and on a plan without Sales (D3): said plainly
  // before anything is written, not as a refusal halfway through.
  const closed = await closedRefusal(ctx.role, { sales: true })
  if (closed) return { error: closed }

  let createdCustomer: string | null = null
  let customerId = p.customerId || null
  if (!customerId && p.newCustomer && p.newCustomer.name.trim()) {
    const { data, error } = await supabase.from('customers').insert({
      account_id: accountId, business_id: businessId,
      name: p.newCustomer.name.trim(), phone: p.newCustomer.phone.trim() || null,
    }).select('id').single()
    if (error || !data) return { error: describeWriteError(error) ?? 'We could not add that customer.' }
    customerId = createdCustomer = data.id
  }

  const undo = async (orderId: string | null) => {
    if (orderId) await supabase.from('orders').delete().eq('id', orderId)
    if (createdCustomer) await supabase.from('customers').delete().eq('id', createdCustomer)
  }

  const { data: order, error: oErr } = await supabase.from('orders').insert({
    account_id: accountId, business_id: businessId, order_date: date,
    customer_id: customerId, order_no: (p.reference ?? '').trim() || null,
  }).select('id').single()
  if (oErr || !order) {
    await undo(null)
    return { error: describeWriteError(oErr) ?? 'We could not start that sale.' }
  }

  const rowsFor = (withCost: boolean) => lines.map((l) => {
    const [recipeId, variantId] = String(l.product ?? '').split(':')
    return {
      account_id: accountId, order_id: order.id,
      recipe_id: recipeId || null, variant_id: variantId || null,
      description: (l.description ?? '').trim() || null,
      qty: l.qty, unit_price: l.price, discount_amount: l.discount ?? 0,
      ...(withCost && !recipeId && l.cost !== undefined && l.cost !== null ? { extra_unit_cost: l.cost } : {}),
    }
  })
  let { error: lErr } = await supabase.from('order_lines').insert(rowsFor(anyCost))
  let costNote = ''
  if (lErr && anyCost && /extra_unit_cost/.test(lErr.message)) {
    ;({ error: lErr } = await supabase.from('order_lines').insert(rowsFor(false)))
    costNote = ' What your extras cost you could not be saved on this account yet.'
  }
  if (lErr) {
    await undo(order.id)
    return { error: describeWriteError(lErr) ?? 'We could not save the items on that sale.' }
  }

  if (discount > 0) {
    // .select(): a refused update is no error and no rows, and the sale would
    // then be confirmed at the full price as if the discount were saved.
    const { data: discounted, error } = await supabase.from('orders')
      .update({ order_discount: discount }).eq('id', order.id).select('id')
    if (error || !discounted?.length) {
      await undo(order.id)
      return { error: describeWriteError(error) ?? 'We could not save that discount, so the sale was not recorded.' }
    }
  }

  if (asDraft) {
    revalidatePath('/sales')
    // A draft is not a sale, so no money is recorded against it: the owner
    // records the deposit when she confirms.
    const depositNote = partPaid !== null ? ' Record what they paid when you confirm it.' : ''
    redirect(`/sales/${order.id}?notice=${encodeURIComponent('Saved for later. It counts as a sale once you confirm it. You can send it as a quote from here.' + depositNote + costNote)}`)
  }

  const { data: confirmed, error: cErr } = await supabase.rpc('fn_confirm_order', { p_order_id: order.id })
  if (cErr) {
    await undo(order.id)
    return { error: describeWriteError(cErr) ?? 'We could not confirm that sale.' }
  }

  // Paid on the spot, or part paid: recorded against the confirmed total,
  // which is read back from the database, not taken from the screen. The sale
  // itself is already confirmed, so a failure here is reported, never undone.
  let paymentNote = ''
  const paymentFailed = p.paid
    ? ' We could not mark it as paid; record the payment below.'
    : ' We could not record what they paid; record the payment below.'
  if (p.paid || partPaid !== null) {
    const { data: lineRows, error: rErr } = await supabase.from('v_sale_lines').select('net_revenue')
      .eq('order_id', order.id).returns<{ net_revenue: string }[]>()
    if (rErr || !lineRows || lineRows.length === 0) {
      // Without the confirmed total we cannot say what is still owed. A
      // status worked out from 0 marked a deposit sale "paid in full" with
      // nothing paid. Rows, not a total above 0: a sale of free items has a
      // real ₦0 total and is still marked paid.
      paymentNote = paymentFailed
    } else {
      const paidTotal = toKobo(lineRows.reduce((t, r) => t + Number(r.net_revenue), 0))
      // A deposit of the whole total or more is simply paid in full.
      const amount = p.paid ? paidTotal : Math.min(toKobo(partPaid ?? 0), paidTotal)
      const status = p.paid || amount >= paidTotal ? 'paid' : 'part_paid'
      // .select(): an update RLS refuses returns no error and no rows.
      const { data: updated, error } = await supabase.from('orders')
        .update({ amount_paid: amount, payment_status: status }).eq('id', order.id).select('id')
      if (error || !updated || updated.length === 0) paymentNote = paymentFailed
    }
  }

  await queueEvent('sale_recorded')
  const without = Number(confirmed?.lines_without_cost ?? 0)
  revalidatePath('/sales')
  revalidatePath('/dashboard')
  const notice = (without > 0
    ? `Sale recorded. ${without} item${without === 1 ? ' has' : 's have'} no known cost, so ${without === 1 ? 'it is' : 'they are'} left out of your profit.`
    : 'Sale recorded.') + paymentNote + costNote
  redirect(`/sales/${order.id}?${sendReceipt ? 'send=1&' : ''}notice=${encodeURIComponent(notice)}`)
}
