'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError } from '@/lib/data/context'
import { localToday } from '@/lib/dates'
import { queueEvent } from '@/lib/analytics/queue'

export type OrderResult = { error: string } | null

type PayloadLine = {
  product?: string | null; description?: string | null
  qty: number; price: number | null
  /** Taken off this item only. */
  discount?: number
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
}

const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/**
 * Record a whole sale from the order screen in one go.
 *
 * It takes the SAME path the sale page always has -- a draft order, its
 * lines, the whole-sale discount, then fn_confirm_order, which owns every
 * rule and freezes each line's cost -- just without a page load in between.
 * If any step is refused, everything written so far is removed again and the
 * owner keeps their basket on screen with the reason.
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
  }
  // "Save for later" keeps it as a draft: an order taken now, served and
  // confirmed another day. Nothing counts as a sale until it is confirmed.
  const asDraft = String(formData.get('mode') ?? 'confirm') === 'draft'
  const discount = p.discount ?? 0
  if (!isAmount(discount)) return { error: 'A discount is an amount in naira, and cannot be negative.' }
  const subtotal = lines.reduce((t, l) => t + l.qty * (l.price ?? 0) - (l.discount ?? 0), 0)
  if (discount > subtotal) return { error: 'The discount is bigger than the sale itself.' }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') ? p.date! : localToday()

  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) return { error: 'Your session has ended. Sign in again, then record the sale.' }

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

  const { error: lErr } = await supabase.from('order_lines').insert(lines.map((l) => {
    const [recipeId, variantId] = String(l.product ?? '').split(':')
    return {
      account_id: accountId, order_id: order.id,
      recipe_id: recipeId || null, variant_id: variantId || null,
      description: (l.description ?? '').trim() || null,
      qty: l.qty, unit_price: l.price, discount_amount: l.discount ?? 0,
    }
  }))
  if (lErr) {
    await undo(order.id)
    return { error: describeWriteError(lErr) ?? 'We could not save the items on that sale.' }
  }

  if (discount > 0) {
    const { error } = await supabase.from('orders').update({ order_discount: discount }).eq('id', order.id)
    if (error) {
      await undo(order.id)
      return { error: describeWriteError(error) ?? 'We could not save that discount.' }
    }
  }

  if (asDraft) {
    revalidatePath('/sales')
    redirect(`/sales/${order.id}?notice=${encodeURIComponent('Saved for later. It does not count as a sale until you confirm it.')}`)
  }

  const { data: confirmed, error: cErr } = await supabase.rpc('fn_confirm_order', { p_order_id: order.id })
  if (cErr) {
    await undo(order.id)
    return { error: describeWriteError(cErr) ?? 'We could not confirm that sale.' }
  }

  // Paid on the spot: record the confirmed total as paid. The amount is read
  // back from the database, not taken from the screen. The sale itself is
  // already confirmed, so a failure here is reported, never undone.
  let paymentNote = ''
  if (p.paid) {
    const { data: lineRows } = await supabase.from('v_sale_lines').select('net_revenue')
      .eq('order_id', order.id).returns<{ net_revenue: string }[]>()
    const paidTotal = (lineRows ?? []).reduce((t, r) => t + Number(r.net_revenue), 0)
    const { error } = await supabase.from('orders')
      .update({ amount_paid: Math.round(paidTotal * 100) / 100, payment_status: 'paid' }).eq('id', order.id)
    if (error) paymentNote = ' We could not mark it as paid; record the payment below.'
  }

  await queueEvent('sale_recorded')
  const without = Number(confirmed?.lines_without_cost ?? 0)
  revalidatePath('/sales')
  revalidatePath('/dashboard')
  const notice = (without > 0
    ? `Sale recorded. ${without} item${without === 1 ? ' has' : 's have'} no known cost, so ${without === 1 ? 'it is' : 'they are'} left out of your profit.`
    : 'Sale recorded.') + paymentNote
  redirect(`/sales/${order.id}?notice=${encodeURIComponent(notice)}`)
}
