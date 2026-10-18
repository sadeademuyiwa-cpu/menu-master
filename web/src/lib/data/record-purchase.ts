import 'server-only'
import { closedRefusal, describeWriteError, type currentContext } from './context'

type Context = Awaited<ReturnType<typeof currentContext>>

export type PricePaid = { ingredientId: string; qty: number; unitId: string; amount: number }

/** A quantity the database keeps as typed: numeric(14,3), more than zero once rounded. */
export const keepsQty = (n: number) => Number.isFinite(n) && Math.round(n * 1000) > 0 && n < 1e11
/** An amount the database keeps as typed: numeric(14,2), more than zero once rounded. */
export const keepsAmount = (n: number) => Number.isFinite(n) && Math.round(n * 100) > 0 && n < 1e12

const UNRESOLVED = 'We do not know how much one of those holds yet. Say what you paid in kg, grams, litres or pieces, or add the measure on the item\'s page first.'

/**
 * Before anything is written: can what she paid be recorded at all? Not
 * after a trial ends (D3), and not in a unit nobody has said the size of for
 * that item (the same resolver addPrice asks first). Asked first so a refusal
 * leaves her form as typed, rather than a dish or line saved without it.
 * `at` is the index of the line that cannot be recorded, when it is one line.
 */
export async function priceProblem(ctx: Context, lines: PricePaid[]): Promise<{ at: number | null; message: string } | null> {
  if (lines.length === 0) return null
  const closed = await closedRefusal(ctx.role)
  if (closed) return { at: null, message: closed }
  const resolved = await Promise.all(lines.map((l) => ctx.supabase.rpc('fn_resolve_qty_to_base', {
    p_ingredient_id: l.ingredientId, p_qty: l.qty, p_unit_id: l.unitId,
  })))
  for (let i = 0; i < resolved.length; i++) {
    const { data, error } = resolved[i]
    if (error) return { at: i, message: describeWriteError(error) ?? 'We could not check that unit.' }
    if (data === null || data === undefined) return { at: i, message: UNRESOLVED }
  }
  return null
}

/**
 * What she paid, typed beside a dish's ingredients, recorded the one way a
 * price is ever recorded: as a real purchase, through fn_post_purchase (see
 * ingredients/[id] addPrice). That sets source='purchase', links each line
 * so the purchase can be corrected or cancelled, and carries the checks
 * (roles, zero values, measures not known yet). Never a typed-in estimate.
 *
 * Returns what went wrong in plain words, or null when it is recorded. A
 * refused purchase leaves nothing behind: its draft is removed. Callers ask
 * priceProblem first, and write their own rows before this, so a purchase is
 * never left recorded for a line that was then refused.
 */
export async function recordPurchase(ctx: Context, date: string, lines: PricePaid[]): Promise<string | null> {
  if (lines.length === 0) return null
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) return 'Your session has ended. Sign in again.'
  // Recording a purchase is closed after a trial (D3); say why, plainly.
  const closed = await closedRefusal(ctx.role)
  if (closed) return closed

  const { data: purchase, error: pErr } = await supabase.from('purchases')
    .insert({ account_id: accountId, business_id: businessId, purchase_date: date })
    .select('id').single<{ id: string }>()
  if (pErr || !purchase) return describeWriteError(pErr) ?? 'We could not record what you paid.'
  const undo = () => supabase.from('purchases').delete().eq('id', purchase.id)

  const { error: lErr } = await supabase.from('purchase_lines').insert(lines.map((l) => ({
    account_id: accountId, purchase_id: purchase.id, ingredient_id: l.ingredientId, qty: l.qty, unit_id: l.unitId, amount: l.amount,
  })))
  if (lErr) { await undo(); return describeWriteError(lErr) ?? 'We could not record what you paid.' }

  const { data: posted, error: postErr } = await supabase.rpc('fn_post_purchase', { p_purchase_id: purchase.id })
  if (postErr) { await undo(); return describeWriteError(postErr) ?? 'We could not record what you paid.' }
  // Refusals come back as data, not errors.
  if (posted && posted.posted === false) {
    await undo()
    return posted.reason === 'unresolved_conversions'
      ? UNRESOLVED
      : `What you paid could not be recorded: ${String(posted.reason).replace(/_/g, ' ')}.`
  }
  return null
}
