import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requiredAmount } from '@/lib/money-input'
import { ProductAndPriceFields } from '@/components/product-price-field'
import {
  currentContext, contextRedirect, describeWriteError, withNotice, hasSalesEntitlement,
  closedLine, closedRefusal, recordingOpen, refusalNotice, paymentAnswer, paymentProblem,
} from '@/lib/data/context'
import { noticeTone } from '@/lib/ui/notice-tone'
import { loadMenuPrices } from '@/lib/data/menu'
import { canRecordPayments, canRecordSales, SALE_ROLES } from '@/app/(app)/dashboard/roles'
import {
  Card, Field, Submit, InlineSubmit, Notice, Empty,
  SectionHeading, BackLink, Stat, StatRow, Badge, Disclosure,
} from '@/components/ui'
import { money, percent, saleLabel } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { canSeeCosts, canSeeSellingPrices } from '@/lib/pricing'
import { buildReceipt, buildQuote, whatsappLink, whatsappNumber, receiptDate, receiptMoney } from '@/lib/receipt'
import { ConfirmSubmit } from '@/components/confirm-submit'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { ReceiptCard } from './receipt-card'

export const dynamic = 'force-dynamic'

type Order = {
  id: string; order_no: string | null; order_date: string; status: string
  /** Not selected for kitchen, which sees no money. */
  payment_status: string; amount_paid?: string; order_discount?: string
  customer_id: string | null; finalised_at: string | null
  voided_at: string | null; void_reason: string | null; replaces: string | null
}
type SaleLine = {
  line_id: string; recipe_id: string | null; product_name: string | null
  variant_id: string | null; format_name: string | null; description: string | null
  qty: string; unit_price: string
  gross_revenue: string; line_discount: string; allocated_order_discount: string
  net_revenue: string
  unit_cost_at_sale: string | null; cogs: string | null
  gross_profit: string | null; gross_margin_pct: string | null
  cost_status: string
}
type Recipe = { id: string; name: string }
type Variant = { id: string; recipe_id: string; format: { name: string } | null }
type Customer = { id: string; name: string; phone: string | null }

/** What a sale line says without its cost: everything the receipt needs and
 *  nothing more. A sales or kitchen phone is sent only these columns. */
const LINE_COLS_NO_COST =
  'line_id,recipe_id,product_name,variant_id,format_name,description,qty,unit_price,' +
  'gross_revenue,line_discount,allocated_order_discount,net_revenue'
/** Kitchen sees no money at all (no cost, no selling price, no takings):
 *  what was sold and how many, and not one column more. */
const LINE_COLS_NO_MONEY = 'line_id,recipe_id,product_name,variant_id,format_name,description,qty'

/** A line of a CANCELLED sale, read straight from order_lines.
 *  v_sale_lines deliberately excludes voided and cancelled orders -- that is
 *  its documented contract and the reason live totals are correct -- so the
 *  historical record has to be read from the table it was never deleted from. */
type HistoryLine = {
  /** unit_price and discount_amount are not selected for kitchen. */
  id: string; qty: string; unit_price?: string; discount_amount?: string
  unit_cost_at_sale?: string | null; description: string | null
  recipe: { name: string } | null
}
/** One row of fn_allocate_order_discount(order_id) -- the SAME function
 *  v_sale_lines joins, so a cancelled sale's figures are computed by the same
 *  code as a live one and cannot drift from it. */
type Allocation = {
  order_line_id: string; gross_revenue: string; line_discount: string
  allocated_order_discount: string; net_revenue: string
}

/* ---------------------------------------------------------------- actions */

/**
 * An update or delete that RLS refuses comes back with no error and no rows,
 * so "Item updated." would be a lie. Each write below asks for the changed
 * rows (.select('id')) and, when there are none, says so in words: who may
 * make the change (0015), or for a role that may, the real reason -- the
 * trial ended, a payment failed, the plan has no Sales (refusalNotice).
 */
async function notChanged(
  role: string | null | undefined, allowed: readonly string[], action: string, askWho: string,
): Promise<string> {
  return allowed.includes(role ?? '')
    ? await refusalNotice(role, { sales: true })
    : `Your role cannot ${action}. Ask ${askWho}.`
}
const SALE_WRITERS = 'the owner, a manager or sales staff'
/** orders DELETE and fn_void_order: owner and manager only (0015). */
const SALE_REMOVERS = ['owner', 'manager'] as const
const editRefused = (role: string | null | undefined) => notChanged(role, SALE_ROLES, 'change a sale', SALE_WRITERS)

/** A day from formatDay inside a sentence: "Sale of today", "Sale of 12 Oct
 *  2026". Only Today and Yesterday are lowered; a month keeps its capital.
 *  The same rule as inSentence in purchases/buy-figures.ts. */
const inSentence = (formatted: string) =>
  formatted === 'Today' || formatted === 'Yesterday' ? formatted.toLowerCase() : formatted

async function addLine(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const qty = Number(formData.get('qty'))
  // requiredAmount, not Number(): Number('') is 0, and a blank price used to
  // pass the `price < 0` guard and be stored as a free item.
  const price = requiredAmount(formData, 'unit_price')
  const discount = Number(formData.get('discount_amount') || 0)
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how many you sold. It must be more than zero.'))
  }
  if (price === null) {
    redirect(withNotice(here, 'Enter what you charged for one, using digits only.'))
  }
  if (!Number.isFinite(discount) || discount < 0) {
    redirect(withNotice(here, 'A discount is an amount in naira, and cannot be negative.'))
  }

  // "recipe:variant" so one control chooses the product and the size together.
  const [recipeId, variantId] = String(formData.get('product') ?? '').split(':')

  // What one of a NON-DISH item cost the owner (0061). A dish's cost is its
  // snapshot, so the figure is dropped for a dish even if typed.
  const costRaw = String(formData.get('extra_unit_cost') ?? '').trim()
  const cost = costRaw === '' || recipeId ? null : Number(costRaw)
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    redirect(withNotice(here, 'What an item costs you is an amount in naira, and cannot be negative.'))
  }

  const row: Record<string, string | number | null> = {
    account_id: accountId,
    order_id: id,
    recipe_id: recipeId || null,
    variant_id: variantId || null,
    description: String(formData.get('description') ?? '').trim() || null,
    qty,
    unit_price: price,
    discount_amount: discount,
  }
  let { error } = await supabase.from('order_lines').insert(cost !== null ? { ...row, extra_unit_cost: cost } : row)
  let note = ''
  if (error && cost !== null && /extra_unit_cost/.test(error.message)) {
    // Before 0061: record the item as before, without its cost.
    ;({ error } = await supabase.from('order_lines').insert(row))
    note = ' What it costs you could not be saved on this account yet.'
  }
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? `Added.${note}`))
}

async function removeLine(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('order_lines')
    .delete().eq('id', String(formData.get('line_id') ?? '')).select('id')
  revalidatePath(here)
  if (!error && (data ?? []).length === 0) redirect(withNotice(here, await editRefused(ctx.role)))
  redirect(withNotice(here, describeWriteError(error) ?? 'Removed.'))
}

/** A draft line's quantity, price and discount. The 0044 guard refuses this
 *  once the sale is confirmed, so the form is only offered on a draft. */
async function updateLine(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const qty = Number(formData.get('qty'))
  const price = requiredAmount(formData, 'unit_price')
  const discount = Number(formData.get('discount_amount') || 0)
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how many you sold. It must be more than zero.'))
  }
  if (price === null) {
    redirect(withNotice(here, 'Enter what you charged for one, using digits only.'))
  }
  if (!Number.isFinite(discount) || discount < 0) {
    redirect(withNotice(here, 'A discount is an amount in naira, and cannot be negative.'))
  }
  const patch: Record<string, number | null> = { qty, unit_price: price, discount_amount: discount }
  // Only a non-dish line carries a typed cost; the field is only shown there.
  if (formData.has('extra_unit_cost')) {
    const raw = String(formData.get('extra_unit_cost') ?? '').trim()
    const cost = raw === '' ? null : Number(raw)
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      redirect(withNotice(here, 'What an item costs you is an amount in naira, and cannot be negative.'))
    }
    patch.extra_unit_cost = cost
  }
  const { data, error } = await supabase.from('order_lines')
    .update(patch).eq('id', String(formData.get('line_id') ?? '')).select('id')
  revalidatePath(here)
  if (!error && (data ?? []).length === 0) redirect(withNotice(here, await editRefused(ctx.role)))
  redirect(withNotice(here, error
    ? (/extra_unit_cost/.test(error.message)
        ? 'What it costs you cannot be saved on this account yet; the rest was not changed.'
        : describeWriteError(error))
    : 'Item updated.'))
}

/** The draft's date and customer. */
async function updateHeader(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const date = String(formData.get('order_date') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(withNotice(here, 'Choose the date of the sale.'))
  const { data, error } = await supabase.from('orders').update({
    order_date: date,
    customer_id: String(formData.get('customer_id') ?? '') || null,
  }).eq('id', id).select('id')
  revalidatePath(here)
  if (!error && (data ?? []).length === 0) redirect(withNotice(here, await editRefused(ctx.role)))
  redirect(withNotice(here, describeWriteError(error) ?? 'Saved.'))
}

async function setOrderDiscount(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const amount = Number(formData.get('order_discount') || 0)
  if (!Number.isFinite(amount) || amount < 0) {
    redirect(withNotice(here, 'A discount is an amount in naira, and cannot be negative.'))
  }
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('orders')
    .update({ order_discount: amount }).eq('id', id).select('id')
  revalidatePath(here)
  if (!error && (data ?? []).length === 0) redirect(withNotice(here, await editRefused(ctx.role)))
  redirect(withNotice(here, describeWriteError(error) ?? 'Discount saved.'))
}

/**
 * CONFIRMATION. fn_confirm_order owns every rule -- role, draft-only, no empty
 * order, a discount that exceeds the order -- and it freezes every line's cost
 * from one instant in a single statement. It reports what it froze, so the
 * result is read rather than assumed.
 *
 * Confirming, cancelling and re-issuing are closed after a trial and on a
 * plan without Sales (D3): the buttons are gone, and a form posted anyway is
 * refused here (closedRefusal) before the database refuses it too (0066).
 */
async function confirm(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const closed = await closedRefusal(ctx.role, { sales: true })
  if (closed) redirect(withNotice(here, closed))

  const { data, error } = await supabase.rpc('fn_confirm_order', { p_order_id: id })
  if (error) redirect(withNotice(here, describeWriteError(error) ?? 'Could not confirm that sale.'))

  const without = Number(data?.lines_without_cost ?? 0)
  revalidatePath(here)
  redirect(withNotice(here, without > 0
    ? `Confirmed. ${without} item${without === 1 ? ' does' : 's do'} not have a known cost, ` +
      `so ${without === 1 ? 'it is' : 'they are'} counted as money taken but left out of your profit.`
    : 'Confirmed. What this sale cost you is now locked in.'))
}

/**
 * Money received on a sale. Through fn_record_order_payment (0066), which
 * changes ONLY amount_paid and payment_status, and only on a confirmed sale
 * that was not cancelled -- and does so whatever the plan or the trial: a
 * caterer's balance paid after the trial ended is money for work already
 * done, and the receipt must stop saying it is owed (D2). It refuses kitchen
 * and accountant (42501), and a draft, a cancelled sale or a negative amount
 * (MMPAY) itself; what each refusal says is paymentAnswer's (write-notice.ts,
 * tested): MMPAY's sentence as it is, and for 42501 the role sentence, never
 * the subscription one.
 *
 * Deliberately NOT behind closedRefusal. Before 0066 the function does not
 * exist (PGRST202 / 42883), and the payment is written as it always was --
 * which row-level security refuses on an ended trial or a Costing plan, so
 * the web goes out after 0066, or with it (DEPLOY_0066.md).
 */
async function markPaid(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  // Blank is deliberately "nothing paid yet" (tests/money-input.test.mts).
  const paid = Number(formData.get('amount_paid') || 0)
  const status = String(formData.get('payment_status') ?? 'unpaid')
  const problem = paymentProblem(paid, status)
  if (problem) redirect(withNotice(here, problem))
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.rpc('fn_record_order_payment', {
    p_order_id: id, p_amount_paid: paid, p_payment_status: status,
  })
  revalidatePath(here)
  const answer = paymentAnswer(error)
  if (answer.kind === 'not_there') {
    const { data, error: uErr } = await supabase.from('orders')
      .update({ amount_paid: paid, payment_status: status }).eq('id', id).select('id')
    if (!uErr && (data ?? []).length === 0) {
      redirect(withNotice(here, await notChanged(ctx.role, SALE_ROLES, 'record a payment', SALE_WRITERS)))
    }
    redirect(withNotice(here, describeWriteError(uErr) ?? 'Payment updated.'))
  }
  redirect(withNotice(here, answer.kind === 'refused' ? answer.notice : 'Payment updated.'))
}

/** Void, never edit. The original stays as evidence, with its frozen cost. */
async function voidSale(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) redirect(withNotice(here, 'Tell us why you are cancelling this sale.'))
  const ctx = await currentContext()
  const { supabase } = ctx
  const closed = await closedRefusal(ctx.role, { sales: true })
  if (closed) redirect(withNotice(here, closed))
  const { error } = await supabase.rpc('fn_void_order', { p_order_id: id, p_reason: reason })
  if (error) redirect(withNotice(here, describeWriteError(error) ?? 'Could not cancel that sale.'))
  revalidatePath(here)
  redirect(withNotice(here, 'Cancelled. It no longer counts in your figures, but the record stays.'))
}

async function reissue(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const closed = await closedRefusal(ctx.role, { sales: true })
  if (closed) redirect(withNotice(`/sales/${id}`, closed))
  const { data, error } = await supabase.rpc('fn_reissue_order', { p_voided_order_id: id })
  if (error || !data?.new_order_id) {
    redirect(withNotice(`/sales/${id}`, describeWriteError(error) ?? 'Could not start a replacement.'))
  }
  const copied = Number(data?.lines_copied ?? 0)
  redirect(withNotice(`/sales/${data.new_order_id}`, copied > 0
    ? `A replacement sale has been started with the same ${copied} item${copied === 1 ? '' : 's'}. Change what was wrong, then confirm.`
    : 'A replacement sale has been started. Put the corrected items on it, then confirm.'))
}

async function deleteDraft(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('orders').delete().eq('id', id).select('id')
  if (error) redirect(withNotice(`/sales/${id}`, describeWriteError(error) ?? 'Could not discard that draft.'))
  // RLS lets only the owner or a manager delete an order; for anyone else the
  // delete quietly removes nothing, and "Draft discarded." would be untrue.
  if ((data ?? []).length === 0) {
    redirect(withNotice(`/sales/${id}`, await notChanged(ctx.role, SALE_REMOVERS, 'discard a draft', 'the owner or a manager')))
  }
  revalidatePath('/sales')
  redirect(withNotice('/sales', 'Draft discarded.'))
}

/* ------------------------------------------------------------------- page */

function costWords(status: string): { label: string; tone: 'good' | 'warn' | 'muted' } {
  switch (status) {
    case 'costed':            return { label: 'Cost known',       tone: 'good' }
    case 'not_costed_yet':    return { label: 'Not locked in yet', tone: 'muted' }
    case 'sold_without_cost': return { label: 'Cost not known',   tone: 'warn' }
    case 'no_product':        return { label: 'Not a dish',        tone: 'muted' }
    default:                  return { label: 'No product',        tone: 'muted' }
  }
}

/** How the payment reads, in the owner's words, from orders.payment_status
 *  and amount_paid as recorded; nothing here decides a payment. `fmt` is
 *  receiptMoney on the receipt card, so it reads to the kobo like the text
 *  the customer is sent; money() for the owner's own summary. */
function paymentWords(status: string, paid: number, total: number, fmt: (n: number) => string = money): string {
  if (status === 'paid') return 'Paid in full'
  if (status === 'part_paid' && paid > 0) {
    return `Paid ${fmt(paid)} so far · ${fmt(Math.max(0, total - paid))} still to pay`
  }
  return 'Not paid yet'
}

const MUTED = { color: 'var(--mm-muted)' } as const

export default async function SaleDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string; send?: string }>
}) {
  const { id } = await params
  const { notice, send } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/sales'))
  // What a sale cost and what it kept reach this page only for the roles
  // that may see costs. For sales and kitchen the cost columns are not even
  // read, so no figure travels to their phones to be hidden there.
  const showCosts = canSeeCosts(ctx.role)
  // Selling prices and takings follow 0064's rule, as on Home and Reports:
  // everyone but kitchen. Kitchen is sent what was sold and how many, and no
  // money column at all, not even to be hidden.
  const takings = canSeeSellingPrices(ctx.role)

  const [{ data: order }, salesPlan, open] = await Promise.all([
    supabase.from('orders')
      .select('id,order_no,order_date,status,payment_status,' + (takings ? 'amount_paid,order_discount,' : '') +
              'customer_id,finalised_at,voided_at,void_reason,replaces')
      .eq('id', id).maybeSingle<Order>(),
    hasSalesEntitlement(),
    recordingOpen(),
  ])
  if (!order) notFound()
  // Every form here is offered only to the roles the database lets use it
  // (0015, fn_void_order): changing a sale for owner, manager and sales;
  // discarding a draft and cancelling a sale for owner and manager. After a
  // trial ends (or on a plan without Sales) none of that is offered (D3) --
  // only an explicit false closes it.
  const records = canRecordSales(ctx.role, salesPlan) && open !== false
  const removerRole = (SALE_REMOVERS as readonly string[]).includes(ctx.role ?? '')
  const removes = records && removerRole
  // Money received on a confirmed sale is recorded whatever the plan or the
  // trial (D2, fn_record_order_payment): owner, manager and sales.
  const paysIn = canRecordPayments(ctx.role)

  const [{ data: lines }, { data: recipes }, { data: variants }, { data: customers }, priceOf] =
    await Promise.all([
      supabase.from('v_sale_lines')
        .select(showCosts ? '*' : takings ? LINE_COLS_NO_COST : LINE_COLS_NO_MONEY).eq('order_id', id)
        .returns<SaleLine[]>(),
      // The dishes and their prices only feed "Add what they bought", which
      // only a role that may change the sale is shown.
      records
        ? supabase.from('recipes').select('id,name').is('deleted_at', null)
            .eq('status', 'active').order('name').returns<Recipe[]>()
        : Promise.resolve({ data: [] as Recipe[] }),
      // recipe_variants has a single foreign key to serving_formats, so this
      // embed needs no constraint hint.
      records
        ? supabase.from('recipe_variants')
            .select('id,recipe_id,format:serving_formats(name)')
            .eq('is_active', true).returns<Variant[]>()
        : Promise.resolve({ data: [] as Variant[] }),
      supabase.from('customers').select('id,name,phone').order('name').returns<Customer[]>(),
      // The same prices New sale and the dashboard read (fn_menu_prices), so
      // the price offered here is the price shown there -- not a second
      // opinion -- and a sales member is offered it too.
      records ? loadMenuPrices(supabase, businessId) : Promise.resolve(new Map<string, string | null>()),
    ])

  // Without the cost columns a line simply has no cost here; it is never
  // read as a zero.
  const rows: SaleLine[] = (lines ?? []).map((r) => showCosts ? r : {
    ...r, unit_cost_at_sale: null, cogs: null, gross_profit: null, gross_margin_pct: null, cost_status: 'hidden',
  })
  const confirmed = order.finalised_at !== null
  const voided = order.voided_at !== null

  // The typed cost of each non-dish line (0061), for the draft's edit form.
  // Before the column exists the query errors and every line simply has none.
  const { data: extraCosts } = showCosts
    ? await supabase.from('order_lines').select('id,extra_unit_cost')
        .eq('order_id', id).returns<{ id: string; extra_unit_cost: string | null }[]>()
    : { data: null }
  const extraCostOf = new Map((extraCosts ?? []).map((l) => [l.id, l.extra_unit_cost]))

  // A cancelled sale keeps everything: fn_void_order writes only voided_at,
  // voided_by and void_reason, and trg_order_lines_revenue refuses any edit or
  // delete on a finalised sale's lines. Only v_sale_lines hides it, by design.
  // So read the preserved record directly, and let the database do the money.
  const [{ data: histLines }, { data: allocations }, { data: replacement }] = voided
    ? await Promise.all([
        supabase.from('order_lines')
          // The constraint hint is REQUIRED. order_lines has TWO foreign keys
          // to recipes -- order_lines_recipe_id_fkey (recipe_id) and
          // fk_order_lines_recipe_id_account (recipe_id, account_id) -- and an
          // unhinted embed makes PostgREST answer PGRST201 / HTTP 300 rather
          // than rows. That shipped once: every cancelled sale then rendered
          // 0.00 with no items, because the error left histLines null.
          // e2e/postgrest-embeds.mjs now proves every embed against real
          // PostgREST so this cannot return silently.
          .select(`id,qty,${takings ? 'unit_price,discount_amount,' : ''}${showCosts ? 'unit_cost_at_sale,' : ''}description,` +
                  'recipe:recipes!order_lines_recipe_id_fkey(name)')
          .eq('order_id', id).returns<HistoryLine[]>(),
        // The rpc's generated return type is not array-shaped, so it is cast
        // where it is consumed rather than through .returns<>(). Kitchen is
        // not sent the money, so it is not asked for.
        takings ? supabase.rpc('fn_allocate_order_discount', { p_order_id: id }) : Promise.resolve({ data: null }),
        supabase.from('orders').select('id,order_no').eq('replaces', id)
          .maybeSingle<{ id: string; order_no: string | null }>(),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  // Why the sale's own buttons are gone, said once to the people who would
  // have had them. A sale already replaced needs nothing more.
  const paused = (SALE_ROLES as readonly string[]).includes(ctx.role ?? '') && open === false &&
    !(voided && replacement)
    ? await closedLine(ctx.role, !confirmed && !voided
        ? 'this draft can’t be changed or confirmed'
        : !voided
          ? 'this sale can’t be cancelled, though money you receive for it can still be recorded below'
          : 'a corrected sale can’t be put through')
    : null

  // Array.isArray, not `?? []`: the page must still show the preserved lines
  // even if the allocation call answers with something unexpected. Losing the
  // money figures is bad; losing the whole record on a page whose purpose is to
  // prove the record survived would be worse.
  const allocRows: Allocation[] = Array.isArray(allocations) ? allocations as Allocation[] : []
  const allocOf = new Map(allocRows.map((a) => [a.order_line_id, a]))
  const history = (histLines ?? []).map((l) => ({
    line: { ...l, unit_cost_at_sale: showCosts ? (l.unit_cost_at_sale ?? null) : null },
    alloc: allocOf.get(l.id) ?? null,
  }))

  // The same arithmetic the live page uses, over the preserved rows. These
  // figures are displayed as history and are NOT added to any live total --
  // revenue, COGS and profit reporting still exclude cancelled sales entirely,
  // because those come from v_sales_unified, which is untouched.
  const histNet = history.reduce((t, h) => t + Number(h.alloc?.net_revenue ?? 0), 0)
  const histGross = history.reduce((t, h) => t + Number(h.alloc?.gross_revenue ?? 0), 0)
  const histCosted = history.filter((h) => h.line.unit_cost_at_sale !== null)
  const histCogs = histCosted.reduce(
    (t, h) => t + Number(h.line.qty) * Number(h.line.unit_cost_at_sale), 0)
  const histCostedRevenue = histCosted.reduce(
    (t, h) => t + Number(h.alloc?.net_revenue ?? 0), 0)
  const histProfit = histCosted.length ? histCostedRevenue - histCogs : null
  const histMargin = histProfit !== null && histCostedRevenue !== 0
    ? (100 * histProfit) / histCostedRevenue : null
  const customer = (customers ?? []).find((c) => c.id === order.customer_id) ?? null
  const customerName = customer?.name ?? null

  // Totals are summed from the view, which is the same arithmetic the reports
  // use. Nothing is recomputed differently here.
  const sum = (pick: (r: SaleLine) => string | null) =>
    rows.reduce((t, r) => { const v = pick(r); return v === null ? t : t + Number(v) }, 0)
  const discounts = sum((r) => r.line_discount) + sum((r) => r.allocated_order_discount)
  const net = sum((r) => r.net_revenue)
  const costedRows = rows.filter((r) => r.cogs !== null)
  const cogs = costedRows.reduce((t, r) => t + Number(r.cogs), 0)
  const costedRevenue = costedRows.reduce((t, r) => t + Number(r.net_revenue), 0)
  // Profit only over the lines whose cost is known. Counting the rest as pure
  // profit would flatter the figure exactly where the least is known.
  const profit = costedRows.length ? costedRevenue - cogs : null
  const margin = profit !== null && costedRevenue !== 0
    ? (100 * profit) / costedRevenue : null
  const uncosted = rows.filter((r) => r.cost_status === 'sold_without_cost')

  const lineName = (r: SaleLine) => r.product_name
    ? `${r.product_name}${r.format_name ? ` (${r.format_name})` : ''}`
    : (r.description ?? 'Item')
  const receiptLines = rows.map((r) => ({
    name: lineName(r), qty: Number(r.qty), unitPrice: Number(r.unit_price), gross: Number(r.gross_revenue),
  }))
  const businessName = ctx.businessName ?? 'Menu Master NG'
  const amountPaid = Number(order.amount_paid)

  // The receipt, from the confirmed figures in v_sale_lines. A part-paid sale
  // says what was paid and what is left, so a deposit receipt is complete.
  // Neither is built for kitchen: a receipt is prices and a total.
  const receipt = takings && confirmed && !voided && rows.length > 0
    ? buildReceipt({
        businessName,
        date: receiptDate(order.order_date),
        reference: order.order_no,
        customerName,
        lines: receiptLines,
        discount: discounts,
        total: net,
        paid: order.payment_status === 'part_paid' ? amountPaid : null,
      })
    : null

  // A draft is a quote until it is confirmed: the same lines, said before the
  // sale, for a caterer or baker pricing an event.
  const quote = takings && !confirmed && !voided && rows.length > 0
    ? buildQuote({
        businessName,
        date: receiptDate(order.order_date),
        customerName,
        lines: receiptLines,
        discount: discounts,
        total: net,
        validDays: 7,
      })
    : null

  const byRecipe = new Map<string, Variant[]>()
  for (const v of variants ?? []) {
    const list = byRecipe.get(v.recipe_id) ?? []
    list.push(v)
    byRecipe.set(v.recipe_id, list)
  }

  // "recipe:variant" values, identical to the options this replaces, each
  // carrying the price already recorded for that product so the form can offer
  // it. A product with no recorded price simply offers nothing.
  const productOptions = (recipes ?? []).flatMap((rec) => {
    const vs = byRecipe.get(rec.id) ?? []
    if (vs.length === 0) {
      const value = `${rec.id}:`
      return [{ value, label: rec.name, price: priceOf.get(value) ?? null }]
    }
    return vs.map((v) => {
      const value = `${rec.id}:${v.id}`
      return {
        value,
        label: `${rec.name} — ${v.format?.name ?? 'one size'}`,
        price: priceOf.get(value) ?? null,
      }
    })
  })

  const cardLines = receiptLines.map((l) => ({ name: l.name, qty: l.qty, gross: l.gross }))
  const whatsappTo = whatsappNumber(customer?.phone) ? customerName : null

  return (
    <div className="space-y-5">
      <BackLink href="/sales">Sales</BackLink>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {saleLabel(order.order_no) ?? `Sale of ${inSentence(formatDay(order.order_date))}`}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={MUTED}>
          <span>{[formatDay(order.order_date), customerName].filter(Boolean).join(' · ')}</span>
          <Badge tone={confirmed && !voided ? 'good' : 'muted'}>
            {voided ? 'Cancelled' : confirmed ? 'Confirmed' : 'Draft'}
          </Badge>
        </div>
      </header>
      {notice && <Notice tone={noticeTone(notice)}>{notice}</Notice>}
      {paused && !notice && <Notice tone="warn">{paused}</Notice>}

      {voided && (
        <Notice>
          This sale was cancelled: {order.void_reason ?? 'no reason recorded'}. It no longer
          counts in your figures. The record{showCosts ? ' and the cost frozen onto it are' : ' is'} kept,
          so nothing disappears without a trace.
          {replacement && (
            <> It was replaced by{' '}
              <Link href={`/sales/${replacement.id}`} className="mm-inline-tap">
                {saleLabel(replacement.order_no) ?? 'a later sale'}
              </Link>.</>
          )}
        </Notice>
      )}
      {!confirmed && !voided && (
        <Notice tone="info">
          {showCosts
            ? 'Still a draft. It counts as a sale when you confirm it, and the cost of each item is worked out from your prices at that moment, not from when you typed it.'
            : 'Still a draft. It counts as a sale when you confirm it.'}
        </Notice>
      )}

      {quote && (
        <ReceiptCard
          kind="quote" businessName={businessName} dateText={receiptDate(order.order_date)}
          reference={null} customerName={customerName} lines={cardLines}
          discount={discounts} total={net}
          text={quote} whatsappHref={whatsappLink(customer?.phone, quote)} toName={whatsappTo}
        />
      )}
      {receipt && (
        <>
          <ReceiptCard
            kind="receipt" businessName={businessName} dateText={receiptDate(order.order_date)}
            reference={order.order_no} customerName={customerName} lines={cardLines}
            discount={discounts} total={net}
            paymentText={paymentWords(order.payment_status, amountPaid, net, receiptMoney)}
            text={receipt} whatsappHref={whatsappLink(customer?.phone, receipt)} toName={whatsappTo}
            focusSend={send === '1'}
          />
          {records && (
            <Link href="/sales/new" className="mm-btn mm-btn-secondary w-full">
              <AppIcon name="plus" size={18} /> New sale
            </Link>
          )}
        </>
      )}

      {voided ? (
        <>
          {/* HISTORY, not live figures. Labelled as such, and summed only over
              the preserved rows: nothing here reaches revenue, COGS or profit
              reporting, which read v_sales_unified and exclude cancelled sales
              at the database. */}
          <SectionHeading>
            The original cancelled sale
          </SectionHeading>
          {/* Visible, not behind the (i): without it these figures read as
              takings. The one line on this page that must never be hidden. */}
          <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>
            Kept for your records. NOT counted in your revenue, cost or profit.
          </p>
          {takings && (
          <StatRow>
            <Stat label="Was charged" value={money(histGross)} />
            <Stat label="Came to" value={money(histNet)} />
            {showCosts && (
              <>
                <Stat
                  label="Cost frozen at the time"
                  value={histCosted.length ? money(histCogs) : money(null, 'never known')}
                />
                <Stat
                  label="Would have kept"
                  value={histProfit === null ? money(null, 'not known') : money(histProfit)}
                  sub={histMargin === null
                    ? 'No item on this sale had a known cost.'
                    : `${percent(histMargin)} of ${money(histCostedRevenue)}`}
                />
              </>
            )}
          </StatRow>
          )}

          <section className="space-y-3">
            <SectionHeading sub="Read from the original record, which cancellation never altered.">
              What was on it
            </SectionHeading>
            {history.length === 0 ? (
              <Empty>This sale had no items on it when it was cancelled.</Empty>
            ) : (
              <ul className="mm-card divide-y" style={{ borderColor: 'var(--mm-line)' }}>
                {history.map(({ line, alloc }) => {
                  const lineCogs = line.unit_cost_at_sale === null ? null
                    : Number(line.qty) * Number(line.unit_cost_at_sale)
                  const lineNet = Number(alloc?.net_revenue ?? 0)
                  return (
                    <li key={line.id} className="py-2.5 first:pt-0 last:pb-0" style={{ borderColor: 'var(--mm-line)' }}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 font-medium">{line.recipe?.name ?? line.description ?? 'Item'}</span>
                        <span className="mm-num shrink-0 font-medium">
                          {takings ? money(lineNet) : `× ${Number(line.qty).toLocaleString('en-NG')}`}
                        </span>
                      </div>
                      {takings && (
                      <div className="mt-0.5 text-sm" style={MUTED}>
                        {Number(line.qty).toLocaleString('en-NG')} × {money(line.unit_price)}
                        {Number(line.discount_amount) > 0
                          ? ` · less ${money(line.discount_amount)} off` : ''}
                        {showCosts && (lineCogs === null
                          ? ' · cost was never known'
                          : ` · cost frozen at ${money(lineCogs)}, kept ${money(lineNet - lineCogs)}`)}
                      </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      ) : confirmed ? (
        !takings ? (
          // Kitchen has no receipt card, so the items are listed here: what
          // was sold and how many, which is what the kitchen needs to know.
          rows.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>What was sold</SectionHeading>
              <ul className="mm-card divide-y" style={{ borderColor: 'var(--mm-line)' }}>
                {rows.map((r) => (
                  <li key={r.line_id} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      style={{ borderColor: 'var(--mm-line)' }}>
                    <span className="min-w-0 font-medium">{lineName(r)}</span>
                    <span className="mm-num shrink-0">× {Number(r.qty).toLocaleString('en-NG')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        ) : showCosts && rows.length > 0 && (
          <section className="space-y-3">
            {uncosted.length > 0 && (
              <Notice>
                {uncosted.length} item{uncosted.length === 1 ? '' : 's'} on this sale
                {uncosted.length === 1 ? ' has' : ' have'} no known cost, so
                {uncosted.length === 1 ? ' it is' : ' they are'} counted as money taken and left out
                of the profit below. Finish costing {uncosted.length === 1 ? 'that dish' : 'those dishes'}
                {' '}and future sales will be complete.
              </Notice>
            )}
            {/* For the owner only: one card, the two figures that matter, then
                each item's cost so a missing one can be found. */}
            <div className="mm-card space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span style={MUTED}>Cost at the time of sale</span>
                <span className="mm-num shrink-0 font-semibold">
                  {costedRows.length ? money(cogs) : money(null, 'not known yet')}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold" style={{ color: 'var(--mm-accent)' }}>You kept</span>
                <span className="text-right">
                  <span className="mm-num block text-xl font-semibold" style={{ color: profit !== null && profit < 0 ? 'var(--mm-bad)' : 'var(--mm-accent)' }}>
                    {profit === null ? money(null, 'not known yet') : money(profit)}
                  </span>
                  <span className="block text-xs" style={MUTED}>
                    {margin === null
                      ? 'No item on this sale has a known cost.'
                      : `${percent(margin)}${costedRows.length < rows.length ? ` of ${money(costedRevenue)}, the part with a known cost` : ''}`}
                  </span>
                </span>
              </div>
              <ul className="divide-y border-t pt-1" style={{ borderColor: 'var(--mm-line)' }}>
                {rows.map((r) => (
                  <li key={r.line_id} className="py-2.5 text-sm" style={{ borderColor: 'var(--mm-line)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 font-medium">{lineName(r)}</span>
                      <Badge tone={costWords(r.cost_status).tone}>{costWords(r.cost_status).label}</Badge>
                    </div>
                    {r.cogs !== null ? (
                      <div className="mt-0.5" style={MUTED}>
                        cost {money(r.cogs)} · kept {money(r.gross_profit)} ({percent(r.gross_margin_pct)})
                      </div>
                    ) : r.cost_status === 'sold_without_cost' ? (
                      <div className="mm-absent mt-0.5">we do not know what this cost you, so it is left out of the profit</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )
      ) : (
        <section className="space-y-3">
          <SectionHeading sub={records ? 'Add what the customer bought. Change an item until you confirm.' : undefined}>
            What was sold
          </SectionHeading>
          {rows.length === 0 ? (
            <Empty>Nothing on this sale yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.line_id}>
                  <Card>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-medium">
                        {r.product_name ?? r.description ?? 'Item'}
                        {r.format_name ? ` · ${r.format_name}` : ''}
                      </span>
                      <span className="mm-num shrink-0 font-medium">
                        {takings ? money(r.net_revenue) : `× ${Number(r.qty).toLocaleString('en-NG')}`}
                      </span>
                    </div>
                    {takings && (
                      <div className="mt-1 text-sm" style={MUTED}>
                        {Number(r.qty).toLocaleString('en-NG')} × {money(r.unit_price)}
                        {Number(r.line_discount) > 0 ? ` · less ${money(r.line_discount)} off` : ''}
                        {Number(r.allocated_order_discount) > 0
                          ? ` · less ${money(r.allocated_order_discount)} share of the order discount`
                          : ''}
                      </div>
                    )}
                    {showCosts && (
                      <div className="mt-2">
                        <Badge tone={costWords(r.cost_status).tone}>{costWords(r.cost_status).label}</Badge>
                      </div>
                    )}
                    {records && (
                    <details className="mt-2">
                      <summary className="mm-tap cursor-pointer list-none text-sm font-semibold underline [&::-webkit-details-marker]:hidden"
                               style={{ color: 'var(--mm-accent)' }}>
                        Change or remove
                      </summary>
                      <div className="mt-2 flex flex-wrap items-end gap-4">
                        <form action={updateLine} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="order_id" value={id} />
                          <input type="hidden" name="line_id" value={r.line_id} />
                          <label className="block">
                            <span className="text-xs" style={MUTED}>How many</span>
                            <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                              defaultValue={Number(r.qty)} className="mt-1 w-24 min-h-[44px] rounded border px-2 py-2 text-base" />
                          </label>
                          <label className="block">
                            <span className="text-xs" style={MUTED}>Price for one (₦)</span>
                            <input name="unit_price" type="number" step="0.01" min="0" inputMode="decimal"
                              defaultValue={Number(r.unit_price)} className="mt-1 w-32 min-h-[44px] rounded border px-2 py-2 text-base" />
                          </label>
                          <label className="block">
                            <span className="text-xs" style={MUTED}>Off (₦)</span>
                            <input name="discount_amount" type="number" step="0.01" min="0" inputMode="decimal"
                              defaultValue={Number(r.line_discount)} className="mt-1 w-24 min-h-[44px] rounded border px-2 py-2 text-base" />
                          </label>
                          {/* What an extra cost: shown, and so sent, only to the roles that may see costs. */}
                          {showCosts && r.recipe_id === null && (
                            <label className="block">
                              <span className="text-xs" style={MUTED}>Costs you (₦)</span>
                              <input name="extra_unit_cost" type="number" step="0.01" min="0" inputMode="decimal"
                                defaultValue={extraCostOf.get(r.line_id) ?? ''} placeholder="optional"
                                className="mt-1 w-28 min-h-[44px] rounded border px-2 py-2 text-base" />
                            </label>
                          )}
                          <InlineSubmit>Update</InlineSubmit>
                        </form>
                        <form action={removeLine}>
                          <input type="hidden" name="order_id" value={id} />
                          <input type="hidden" name="line_id" value={r.line_id} />
                          <InlineSubmit>Remove</InlineSubmit>
                        </form>
                      </div>
                    </details>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!confirmed && !voided && records && (
        <>
          {/* The next step comes first. Adding to the order and a discount
              are there when needed, folded away when they are not. */}
          {rows.length > 0 && (
            <Card>
              <SectionHeading sub="Confirming locks in what this sale cost you, using today's prices. After that it cannot be edited, only cancelled and re-issued.">
                Ready? Confirm the sale
              </SectionHeading>
              <p className="mt-1 text-sm" style={MUTED}>
                Confirm when the order is served or paid for.
              </p>
              <form action={confirm} className="mt-3">
                <input type="hidden" name="order_id" value={id} />
                <Button className="w-full sm:w-auto" busyLabel="Confirming…">Confirm sale · {money(net)}</Button>
              </form>
            </Card>
          )}

          <Disclosure summary={rows.length === 0 ? 'Add what they bought' : 'Add another item'} open={rows.length === 0}>
            <form action={addLine} className="grid gap-3 sm:grid-cols-5">
              <input type="hidden" name="order_id" value={id} />
              <ProductAndPriceFields products={productOptions} />
              <Field label="Discount (₦, optional)">
                <input name="discount_amount" type="number" step="0.01" min="0"
                       inputMode="decimal" defaultValue="0" className="mm-input mt-1" />
              </Field>
              <div className="sm:col-span-3">
                <Field label="Note (only if it is not on your menu)">
                  <input name="description" placeholder="e.g. Delivery, Extra small chops"
                         className="mm-input mt-1" />
                </Field>
              </div>
              <Field label="What one costs you (₦, not for dishes)">
                <input name="extra_unit_cost" type="number" step="0.01" min="0" inputMode="decimal"
                       placeholder="e.g. 300" className="mm-input mt-1" />
              </Field>
              <div className="flex items-end"><Submit>Add</Submit></div>
            </form>
          </Disclosure>

          {rows.length > 0 && (
            <Disclosure summary={Number(order.order_discount) > 0
              ? `Discount on the whole sale · ${money(order.order_discount)}`
              : 'Discount on the whole sale'}>
              <p className="text-sm" style={MUTED}>
                Taken off the whole sale and shared across the items, so each dish still shows a true margin.
              </p>
              <form action={setOrderDiscount} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="order_id" value={id} />
                <Field label="Amount (₦)">
                  <input name="order_discount" type="number" step="0.01" min="0"
                         inputMode="decimal" defaultValue={order.order_discount}
                         className="mm-input mt-1" />
                </Field>
                <Submit>Save discount</Submit>
              </form>
            </Disclosure>
          )}

          <Disclosure summary={`Date and customer · ${formatDay(order.order_date)}${customerName ? ` · ${customerName}` : ''}`}>
            <form action={updateHeader} className="mt-2 grid gap-3 sm:grid-cols-3 sm:items-end">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Date">
                <input name="order_date" type="date" required defaultValue={order.order_date} className="mm-input mt-1" />
              </Field>
              <Field label="Customer">
                <select name="customer_id" defaultValue={order.customer_id ?? ''} className="mm-input mt-1">
                  <option value="">— no customer —</option>
                  {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <div className="flex items-end"><Submit>Save</Submit></div>
            </form>
          </Disclosure>

          {removes && (
            <Disclosure summary="Discard this draft">
              <p className="text-sm" style={MUTED}>
                A draft has never counted as a sale, so discarding one changes none of your
                figures.
              </p>
              <form action={deleteDraft} className="mt-2">
                <input type="hidden" name="order_id" value={id} />
                <ConfirmSubmit message="Discard this draft? It has never counted as a sale.">Discard this draft</ConfirmSubmit>
              </form>
            </Disclosure>
          )}
        </>
      )}

      {confirmed && !voided && takings && (
        <>
          <Card>
            <SectionHeading sub={paysIn ? 'Money can still come in after the sale. Recording it changes nothing about what was sold.' : undefined}>
              Payment
            </SectionHeading>
            <p className="mt-1 text-sm">
              <span className="font-semibold">{paymentWords(order.payment_status, amountPaid, net)}</span>
            </p>
            {/* A sale paid in full needs no form, only the fact. Shown to the
                roles that take money whatever the plan or the trial (D2). */}
            {!paysIn ? null : order.payment_status === 'paid' ? (
              <div className="mt-3">
                <Disclosure summary="Change the payment">
                  <PaymentForm id={id} order={order} />
                </Disclosure>
              </div>
            ) : (
              <PaymentForm id={id} order={order} />
            )}
          </Card>

          {!removes ? (
            // fn_void_order admits only the owner and a manager; the form
            // would only ever be refused, so say who to ask instead -- while
            // they could cancel it. After a trial or on a plan without Sales
            // nobody can, and the paused line above already says why.
            !removerRole && open !== false && salesPlan !== false && (
              <p className="text-sm" style={MUTED}>If something is wrong with this sale, ask the owner or a manager to cancel it.</p>
            )
          ) : (
          <Disclosure summary="Something is wrong with this sale">
            <p className="text-sm">
              A confirmed sale is never edited. Cancel it, with the reason, and Menu Master
              will start a replacement you can correct. Both records are kept and linked, so
              your history stays honest.
            </p>
            <form action={voidSale} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Why">
                <input name="reason" placeholder="e.g. customer cancelled" className="mm-input mt-1" />
              </Field>
              <ConfirmSubmit variant="secondary" message="Cancel this sale? It stops counting in your figures. The record is kept and you can put through a corrected one.">Cancel this sale</ConfirmSubmit>
            </form>
          </Disclosure>
          )}
        </>
      )}

      {voided && (
        replacement ? (
          <Card>
            <SectionHeading sub="This sale already has a replacement. Open it to finish or change it.">
              Corrected sale
            </SectionHeading>
            <p className="mt-3">
              <Link href={`/sales/${replacement.id}`} className="mm-btn mm-btn-primary">
                Open {saleLabel(replacement.order_no) ?? 'the replacement'} <AppIcon name="arrow-right" size={16} />
              </Link>
            </p>
          </Card>
        ) : records && (
        // fn_reissue_order admits owner, manager and sales, as New sale does.
        <Card>
          <SectionHeading sub="The cancelled sale stays exactly as it was. The replacement starts with the same items; change the one that was wrong and confirm.">
            Put through a corrected sale
          </SectionHeading>
          <form action={reissue} className="mt-3">
            <input type="hidden" name="order_id" value={id} />
            <Submit>Start the replacement</Submit>
          </form>
        </Card>
        )
      )}

      {order.replaces && (
        <p className="text-sm">
          <Link href={`/sales/${order.replaces}`} className="mm-tap underline">
            This replaces an earlier sale →
          </Link>
        </p>
      )}
    </div>
  )
}

/** What has been paid, in the same two fields as ever (markPaid). */
function PaymentForm({ id, order }: { id: string; order: Order }) {
  return (
    <form action={markPaid} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="order_id" value={id} />
      <Field label="Paid so far (₦)">
        <input name="amount_paid" type="number" step="0.01" min="0" inputMode="decimal"
               defaultValue={order.amount_paid} className="mm-input mt-1" />
      </Field>
      <Field label="Status">
        <select name="payment_status" defaultValue={order.payment_status} className="mm-input mt-1">
          <option value="unpaid">Not paid</option>
          <option value="part_paid">Part paid</option>
          <option value="paid">Paid in full</option>
        </select>
      </Field>
      <Submit>Save payment</Submit>
    </form>
  )
}
