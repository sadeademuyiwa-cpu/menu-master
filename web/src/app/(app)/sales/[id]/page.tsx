import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty,
  SectionHeading, BackLink, Stat, StatRow, Badge, Disclosure,
} from '@/components/ui'
import { money, percent } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Order = {
  id: string; order_no: string | null; order_date: string; status: string
  payment_status: string; amount_paid: string; order_discount: string
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
type Customer = { id: string; name: string }

/* ---------------------------------------------------------------- actions */

async function addLine(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect(withNotice(here, 'No account found for your login.'))

  const qty = Number(formData.get('qty'))
  const price = Number(formData.get('unit_price'))
  const discount = Number(formData.get('discount_amount') || 0)
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how many you sold. It must be more than zero.'))
  }
  if (!Number.isFinite(price) || price < 0) {
    redirect(withNotice(here, 'Enter what you charged for one.'))
  }
  if (!Number.isFinite(discount) || discount < 0) {
    redirect(withNotice(here, 'A discount is an amount in naira, and cannot be negative.'))
  }

  // "recipe:variant" so one control chooses the product and the size together.
  const [recipeId, variantId] = String(formData.get('product') ?? '').split(':')

  const { error } = await supabase.from('order_lines').insert({
    account_id: accountId,
    order_id: id,
    recipe_id: recipeId || null,
    variant_id: variantId || null,
    description: String(formData.get('description') ?? '').trim() || null,
    qty,
    unit_price: price,
    discount_amount: discount,
  })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Added.'))
}

async function removeLine(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const { supabase } = await currentContext()
  const { error } = await supabase.from('order_lines')
    .delete().eq('id', String(formData.get('line_id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Removed.'))
}

async function setOrderDiscount(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const amount = Number(formData.get('order_discount') || 0)
  if (!Number.isFinite(amount) || amount < 0) {
    redirect(withNotice(here, 'A discount is an amount in naira, and cannot be negative.'))
  }
  const { supabase } = await currentContext()
  const { error } = await supabase.from('orders')
    .update({ order_discount: amount }).eq('id', id)
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Discount saved.'))
}

/**
 * CONFIRMATION. fn_confirm_order owns every rule -- role, draft-only, no empty
 * order, a discount that exceeds the order -- and it freezes every line's cost
 * from one instant in a single statement. It reports what it froze, so the
 * result is read rather than assumed.
 */
async function confirm(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const { supabase } = await currentContext()

  const { data, error } = await supabase.rpc('fn_confirm_order', { p_order_id: id })
  if (error) redirect(withNotice(here, describeWriteError(error) ?? 'Could not confirm that sale.'))

  const without = Number(data?.lines_without_cost ?? 0)
  revalidatePath(here)
  redirect(withNotice(here, without > 0
    ? `Confirmed. ${without} item${without === 1 ? ' does' : 's do'} not have a known cost, ` +
      `so ${without === 1 ? 'it is' : 'they are'} counted as money taken but left out of your profit.`
    : 'Confirmed. What this sale cost you is now locked in.'))
}

async function markPaid(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const paid = Number(formData.get('amount_paid') || 0)
  const { supabase } = await currentContext()
  const { error } = await supabase.from('orders')
    .update({
      amount_paid: paid,
      payment_status: String(formData.get('payment_status') ?? 'unpaid'),
    }).eq('id', id)
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Payment updated.'))
}

/** Void, never edit. The original stays as evidence, with its frozen cost. */
async function voidSale(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const here = `/sales/${id}`
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) redirect(withNotice(here, 'Tell us why you are cancelling this sale.'))
  const { supabase } = await currentContext()
  const { error } = await supabase.rpc('fn_void_order', { p_order_id: id, p_reason: reason })
  if (error) redirect(withNotice(here, describeWriteError(error) ?? 'Could not cancel that sale.'))
  revalidatePath(here)
  redirect(withNotice(here, 'Cancelled. It no longer counts in your figures, but the record stays.'))
}

async function reissue(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const { supabase } = await currentContext()
  const { data, error } = await supabase.rpc('fn_reissue_order', { p_voided_order_id: id })
  if (error || !data?.new_order_id) {
    redirect(withNotice(`/sales/${id}`, describeWriteError(error) ?? 'Could not start a replacement.'))
  }
  redirect(withNotice(`/sales/${data.new_order_id}`,
    'A replacement sale has been started. Put the corrected items on it, then confirm.'))
}

async function deleteDraft(formData: FormData) {
  'use server'
  const id = String(formData.get('order_id') ?? '')
  const { supabase } = await currentContext()
  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) redirect(withNotice(`/sales/${id}`, describeWriteError(error) ?? 'Could not discard that draft.'))
  revalidatePath('/sales')
  redirect(withNotice('/sales', 'Draft discarded.'))
}

/* ------------------------------------------------------------------- page */

function costWords(status: string): { label: string; tone: 'good' | 'warn' | 'muted' } {
  switch (status) {
    case 'costed':            return { label: 'Cost known',       tone: 'good' }
    case 'not_costed_yet':    return { label: 'Not locked in yet', tone: 'muted' }
    case 'sold_without_cost': return { label: 'Cost not known',   tone: 'warn' }
    default:                  return { label: 'No product',        tone: 'muted' }
  }
}

export default async function SaleDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await params
  const { notice } = await searchParams
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect('/onboarding')

  const { data: order } = await supabase.from('orders')
    .select('id,order_no,order_date,status,payment_status,amount_paid,order_discount,' +
            'customer_id,finalised_at,voided_at,void_reason,replaces')
    .eq('id', id).maybeSingle<Order>()
  if (!order) notFound()

  const [{ data: lines }, { data: recipes }, { data: variants }, { data: customers }] =
    await Promise.all([
      supabase.from('v_sale_lines').select('*').eq('order_id', id).returns<SaleLine[]>(),
      supabase.from('recipes').select('id,name').is('deleted_at', null)
        .eq('status', 'active').order('name').returns<Recipe[]>(),
      // recipe_variants has a single foreign key to serving_formats, so this
      // embed needs no constraint hint.
      supabase.from('recipe_variants')
        .select('id,recipe_id,format:serving_formats(name)')
        .eq('is_active', true).returns<Variant[]>(),
      supabase.from('customers').select('id,name').order('name').returns<Customer[]>(),
    ])

  const rows = lines ?? []
  const confirmed = order.finalised_at !== null
  const voided = order.voided_at !== null
  const customerName = (customers ?? []).find((c) => c.id === order.customer_id)?.name ?? null

  // Totals are summed from the view, which is the same arithmetic the reports
  // use. Nothing is recomputed differently here.
  const sum = (pick: (r: SaleLine) => string | null) =>
    rows.reduce((t, r) => { const v = pick(r); return v === null ? t : t + Number(v) }, 0)
  const gross = sum((r) => r.gross_revenue)
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

  const byRecipe = new Map<string, Variant[]>()
  for (const v of variants ?? []) {
    const list = byRecipe.get(v.recipe_id) ?? []
    list.push(v)
    byRecipe.set(v.recipe_id, list)
  }

  return (
    <div className="space-y-6">
      <BackLink href="/sales">← All sales</BackLink>
      <PageHeader
        title={order.order_no ?? `Sale of ${order.order_date}`}
        sub={[
          order.order_date,
          customerName,
          voided ? 'Cancelled' : confirmed ? 'Confirmed' : 'Draft — not confirmed yet',
        ].filter(Boolean).join(' · ')}
      />
      {notice && <Notice tone={/could not|cannot|do not/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {voided && (
        <Notice>
          This sale was cancelled: {order.void_reason ?? 'no reason recorded'}. It no longer
          counts in your figures. The record and the cost frozen onto it are kept, so nothing
          disappears without a trace.
        </Notice>
      )}
      {!confirmed && !voided && (
        <Notice tone="info">
          This is still a draft. Nothing here counts as a sale yet, and the cost of each item
          will be worked out from your prices at the moment you confirm — not from when you
          typed it.
        </Notice>
      )}
      {confirmed && !voided && uncosted.length > 0 && (
        <Notice>
          {uncosted.length} item{uncosted.length === 1 ? '' : 's'} on this sale
          {uncosted.length === 1 ? ' has' : ' have'} no known cost, so
          {uncosted.length === 1 ? ' it is' : ' they are'} counted as money taken and left out
          of the profit below. Finish costing {uncosted.length === 1 ? 'that dish' : 'those dishes'}
          {' '}and future sales will be complete.
        </Notice>
      )}

      <StatRow>
        <Stat label="Charged" value={money(gross)}
              sub={discounts > 0 ? `less ${money(discounts)} in discounts` : undefined} />
        <Stat label={confirmed ? 'You were paid' : 'It would come to'} value={money(net)} />
        <Stat
          label="You kept"
          value={profit === null ? money(null, 'not known yet') : money(profit)}
          sub={margin === null
            ? (confirmed ? 'No item on this sale has a known cost.' : 'Confirm the sale to lock in the cost.')
            : `${percent(margin)} of ${money(costedRevenue)}${
                costedRows.length < rows.length ? ' — the part with a known cost' : ''}`}
        />
      </StatRow>

      <section className="space-y-3">
        <SectionHeading sub={confirmed
          ? 'These cannot be changed. Cancel and re-issue the sale if something is wrong.'
          : 'Add what the customer bought.'}>
          What was sold
        </SectionHeading>

        {rows.length === 0 ? (
          <Empty>Nothing on this sale yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.line_id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">
                      {r.product_name ?? r.description ?? 'Item'}
                      {r.format_name ? ` · ${r.format_name}` : ''}
                    </span>
                    <span className="mm-num font-medium">{money(r.net_revenue)}</span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                    {Number(r.qty).toLocaleString('en-NG')} × {money(r.unit_price)}
                    {Number(r.line_discount) > 0 ? ` · less ${money(r.line_discount)} off` : ''}
                    {Number(r.allocated_order_discount) > 0
                      ? ` · less ${money(r.allocated_order_discount)} share of the order discount`
                      : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={costWords(r.cost_status).tone}>{costWords(r.cost_status).label}</Badge>
                    {r.cogs !== null && (
                      <span style={{ color: 'var(--mm-muted)' }}>
                        cost {money(r.cogs)} · kept {money(r.gross_profit)} ({percent(r.gross_margin_pct)})
                      </span>
                    )}
                    {r.cost_status === 'sold_without_cost' && (
                      <span className="mm-absent">
                        we do not know what this cost you, so it is left out of the profit
                      </span>
                    )}
                    {!confirmed && !voided && (
                      <form action={removeLine} className="ml-auto">
                        <input type="hidden" name="order_id" value={id} />
                        <input type="hidden" name="line_id" value={r.line_id} />
                        <InlineSubmit>Remove</InlineSubmit>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!confirmed && !voided && (
        <>
          <Card>
            <SectionHeading sub="Choose the dish and, where you sell it in sizes, the size.">
              Add an item
            </SectionHeading>
            <form action={addLine} className="mt-3 grid gap-3 sm:grid-cols-5">
              <input type="hidden" name="order_id" value={id} />
              <div className="sm:col-span-2">
                <Field label="What was sold">
                  <select name="product" className="mm-input mt-1">
                    <option value="">Something not on your menu</option>
                    {(recipes ?? []).map((rec) => {
                      const vs = byRecipe.get(rec.id) ?? []
                      if (vs.length === 0) {
                        return <option key={rec.id} value={`${rec.id}:`}>{rec.name}</option>
                      }
                      return vs.map((v) => (
                        <option key={v.id} value={`${rec.id}:${v.id}`}>
                          {rec.name} — {v.format?.name ?? 'one size'}
                        </option>
                      ))
                    })}
                  </select>
                </Field>
              </div>
              <Field label="How many">
                <input name="qty" type="number" step="0.001" min="0.001"
                       inputMode="decimal" className="mm-input mt-1" />
              </Field>
              <Field label="Price for one">
                <input name="unit_price" type="number" step="0.01" min="0"
                       inputMode="decimal" className="mm-input mt-1" />
              </Field>
              <Field label="Discount (₦, optional)">
                <input name="discount_amount" type="number" step="0.01" min="0"
                       inputMode="decimal" defaultValue="0" className="mm-input mt-1" />
              </Field>
              <div className="sm:col-span-4">
                <Field label="Note (only if it is not on your menu)">
                  <input name="description" placeholder="e.g. Delivery, Extra small chops"
                         className="mm-input mt-1" />
                </Field>
              </div>
              <div className="flex items-end"><Submit>Add</Submit></div>
            </form>
          </Card>

          <Card>
            <SectionHeading sub="Taken off the whole sale and shared across the items, so each dish still shows a true margin.">
              Discount on the whole sale
            </SectionHeading>
            <form action={setOrderDiscount} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Amount (₦)">
                <input name="order_discount" type="number" step="0.01" min="0"
                       inputMode="decimal" defaultValue={order.order_discount}
                       className="mm-input mt-1" />
              </Field>
              <Submit>Save discount</Submit>
            </form>
          </Card>

          <Card>
            <SectionHeading sub="Confirming locks in what this sale cost you, using today's prices. After that it cannot be edited — only cancelled and re-issued.">
              Confirm this sale
            </SectionHeading>
            <form action={confirm} className="mt-3">
              <input type="hidden" name="order_id" value={id} />
              <Submit>Confirm sale</Submit>
            </form>
            <Disclosure summary="Discard this draft instead">
              <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
                A draft has never counted as a sale, so discarding one changes none of your
                figures.
              </p>
              <form action={deleteDraft} className="mt-2">
                <input type="hidden" name="order_id" value={id} />
                <InlineSubmit>Discard this draft</InlineSubmit>
              </form>
            </Disclosure>
          </Card>
        </>
      )}

      {confirmed && !voided && (
        <>
          <Card>
            <SectionHeading sub="Money can still come in after the sale. Recording it changes nothing about what was sold.">
              Payment
            </SectionHeading>
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
          </Card>

          <Disclosure summary="Something is wrong with this sale">
            <p className="text-sm">
              A confirmed sale is never edited. Cancel it — with the reason — and Menu Master
              will start a replacement you can correct. Both records are kept and linked, so
              your history stays honest.
            </p>
            <form action={voidSale} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Why">
                <input name="reason" placeholder="e.g. customer cancelled" className="mm-input mt-1" />
              </Field>
              <Submit>Cancel this sale</Submit>
            </form>
          </Disclosure>
        </>
      )}

      {voided && (
        <Card>
          <SectionHeading sub="The cancelled sale stays exactly as it was. The replacement is a new record that points back at it.">
            Put through a corrected sale
          </SectionHeading>
          <form action={reissue} className="mt-3">
            <input type="hidden" name="order_id" value={id} />
            <Submit>Start the replacement</Submit>
          </form>
        </Card>
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
