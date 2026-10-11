import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty,
  SectionHeading, BackLink, Stat, StatRow, Disclosure, Badge,
} from '@/components/ui'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { money, quantity, productState, purchaseReference } from '@/lib/format'
import { formatDay } from '@/lib/dates'

export const dynamic = 'force-dynamic'

type Purchase = {
  id: string; purchase_date: string; status: string; reference: string | null
  note: string | null; supplier_id: string | null; reverses: string | null
  reversal_reason: string | null
}
type Line = {
  id: string; qty: string; amount: string; qty_base: string | null
  ingredient: { id: string; name: string } | null
  unit: { code: string; name: string } | null
}
type Ingredient = { id: string; name: string }
type Affected = {
  recipe_id: string; variant_id: string | null
  product_name: string; format_name: string | null
  true_cost: string | null; selling_price: string | null; state: string
}
type Unit = { id: string; code: string; name: string; kind: string }

/* ---------------------------------------------------------------- actions */

async function addLine(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const qty = Number(formData.get('qty'))
  const amount = Number(formData.get('amount'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how much you bought. It must be greater than zero.'))
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(withNotice(here, 'Enter what you paid. It must be greater than zero.'))
  }

  const { error } = await supabase.from('purchase_lines').insert({
    account_id: accountId, purchase_id: id,
    ingredient_id: String(formData.get('ingredient_id') ?? ''),
    qty, unit_id: String(formData.get('unit_id') ?? ''), amount,
  })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Item added.'))
}

async function removeLine(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('purchase_lines')
    .delete().eq('id', String(formData.get('line_id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Item removed.'))
}

/**
 * POSTING. fn_post_purchase owns every rule here -- role, draft-only (so a
 * double submit cannot post twice), zero-value refusal and conversion
 * blockers. It reports refusals as DATA, not errors, so the result must be
 * read rather than assumed successful.
 */
async function post(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx

  const { data, error } = await supabase.rpc('fn_post_purchase', { p_purchase_id: id })
  if (error) redirect(withNotice(here, describeWriteError(error) ?? 'Could not record that purchase.'))

  if (data && data.posted === false) {
    if (data.reason === 'unresolved_conversions') {
      const names = (data.blockers ?? [])
        .map((b: { ingredient_name?: string; unit_code?: string }) =>
          `${b.ingredient_name ?? 'an item'} (${b.unit_code ?? 'that unit'})`)
        .join(', ')
      redirect(withNotice(here,
        `We do not yet know how much one of those is for: ${names}. ` +
        `Open the ingredient and add the measurement, then record this purchase again.`))
    }
    redirect(withNotice(here,
      `That purchase could not be recorded: ${String(data.reason).replace(/_/g, ' ')}.`))
  }

  revalidatePath(here)
  redirect(withNotice(here,
    `Recorded. ${data?.price_rows_written ?? 0} ingredient price${data?.price_rows_written === 1 ? '' : 's'} updated.`))
}

/** A draft line's quantity, unit and amount. The 0006 guard refuses this once
 *  the purchase is posted, so the form is only offered on a draft. */
async function updateLine(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const qty = Number(formData.get('qty'))
  const amount = Number(formData.get('amount'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how much you bought. It must be greater than zero.'))
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(withNotice(here, 'Enter what you paid. It must be greater than zero.'))
  }
  const { error } = await supabase.from('purchase_lines')
    .update({ qty, unit_id: String(formData.get('unit_id') ?? ''), amount })
    .eq('id', String(formData.get('line_id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Item updated.'))
}

/** The draft's date, supplier and reference. */
async function updateHeader(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const date = String(formData.get('purchase_date') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(withNotice(here, 'Choose the date of the purchase.'))
  const { error } = await supabase.from('purchases').update({
    purchase_date: date,
    supplier_id: String(formData.get('supplier_id') ?? '') || null,
    reference: String(formData.get('reference') ?? '').trim() || null,
    note: String(formData.get('note') ?? '').trim() || null,
  }).eq('id', id)
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Saved.'))
}

/** A draft never set a price, so discarding one changes nothing. */
async function discardDraft(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('purchases').delete().eq('id', id).eq('status', 'draft')
  if (error) redirect(withNotice(`/purchases/${id}`, describeWriteError(error) ?? 'Could not discard that draft.'))
  revalidatePath('/purchases')
  redirect(withNotice('/purchases', 'Draft discarded.'))
}

/** Reversal, never deletion. The original stays as evidence. */
async function reverse(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) redirect(withNotice(here, 'Tell us why you are cancelling this purchase.'))

  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.rpc('fn_reverse_purchase',
    { p_purchase_id: id, p_reason: reason })
  if (error) redirect(withNotice(here, describeWriteError(error) ?? 'Could not cancel that purchase.'))
  revalidatePath(here)
  redirect(withNotice(here, 'Purchase cancelled. The prices it set have been undone.'))
}

/* ------------------------------------------------------------------- page */

export default async function PurchaseDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await params
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/purchases'))

  const { data: purchase } = await supabase.from('purchases')
    .select('id,purchase_date,status,reference,note,supplier_id,reverses,reversal_reason')
    .eq('id', id).maybeSingle<Purchase>()
  if (!purchase) notFound()

  // Set by 0060: which corrected purchase replaced this one. Read on its own so
  // a database that does not have the column yet still renders the page.
  const { data: link } = await supabase.from('purchases').select('replaced_by')
    .eq('id', id).maybeSingle<{ replaced_by: string | null }>()
  const replacedBy = link?.replaced_by ?? null

  const [{ data: lines }, { data: ingredients }, { data: units }, { data: suppliers }] = await Promise.all([
    // The !constraint hints are required, not cosmetic: purchase_lines has two
    // foreign keys to ingredients (a composite tenant-scoped one and a simple
    // one), so an unhinted embed fails with PGRST201 and the page renders no
    // items at all. The composite key is chosen because it also enforces that
    // the ingredient belongs to the same account.
    supabase.from('purchase_lines')
      .select('id,qty,amount,qty_base,' +
              'ingredient:ingredients!fk_purchase_lines_ingredient_id_account(id,name),' +
              'unit:units!purchase_lines_unit_id_fkey(code,name)')
      .eq('purchase_id', id).returns<Line[]>(),
    supabase.from('ingredients').select('id,name').is('deleted_at', null)
      .eq('is_active', true).order('name').returns<Ingredient[]>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
    supabase.from('suppliers').select('id,name').eq('is_active', true).order('name')
      .returns<{ id: string; name: string }[]>(),
  ])

  const rows = lines ?? []
  // A reversal is a separate purchase pointing back at this one.
  const { data: reversal } = await supabase.from('purchases')
    .select('reversal_reason').eq('reverses', id)
    .maybeSingle<{ reversal_reason: string | null }>()
  const reversalReason = reversal?.reversal_reason ?? null
  // The total is summed in PostgreSQL by v_purchase_summary (0035). Adding the
  // lines up here would be money arithmetic in the browser.
  const { data: summary } = await supabase.from('v_purchase_summary')
    .select('total_amount,line_count').eq('purchase_id', id)
    .maybeSingle<{ total_amount: string | null; line_count: number }>()
  const total = summary?.total_amount !== null && summary?.total_amount !== undefined
    ? Number(summary.total_amount) : null
  // What this purchase changed: every dish using one of its items, with the
  // cost the database now holds for it.
  const boughtIds = [...new Set(rows.map((l) => l.ingredient?.id).filter((x): x is string => !!x))]
  let affected: Affected[] = []
  if (purchase.status === 'posted' && boughtIds.length) {
    const { data: uses } = await supabase.from('recipe_lines').select('recipe_id')
      .in('ingredient_id', boughtIds).returns<{ recipe_id: string }[]>()
    const recipeIds = [...new Set((uses ?? []).map((u) => u.recipe_id))]
    if (recipeIds.length) {
      const { data } = await supabase.from('v_product_attention')
        .select('recipe_id,variant_id,product_name,format_name,true_cost,selling_price,state')
        .in('recipe_id', recipeIds).order('product_name').returns<Affected[]>()
      affected = data ?? []
    }
  }
  const draft = purchase.status === 'draft'
  const posted = purchase.status === 'posted'
  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined

  return (
    <div className="space-y-6">
      <BackLink href="/purchases">All purchases</BackLink>
      <PageHeader
        title={`Purchase of ${formatDay(purchase.purchase_date).toLowerCase()}`}
        sub={[
          draft ? 'Not recorded yet' : posted ? 'Recorded' : 'Cancelled',
          purchaseReference(purchase.reference),
        ].filter(Boolean).join(' · ')}
      />
      {notice && (
        <Notice tone={/could not|do not yet|cancelling|must be/i.test(notice) ? 'warn' : 'info'}>
          {notice}
        </Notice>
      )}

      {/*
        fn_reverse_purchase records the reason on the REVERSING purchase it
        creates, not on the original, so reading purchase.reversal_reason here
        always found NULL and the customer was never told why their purchase
        was cancelled. The reason is fetched from the reversal itself.
      */}
      {replacedBy && (
        <Notice tone="info">
          This purchase was corrected.{' '}
          <Link href={`/purchases/${replacedBy}`} className="mm-inline-tap">See the corrected purchase →</Link>
        </Notice>
      )}
      {purchase.reverses && (
        <Notice tone="info">
          This is the cancellation record of{' '}
          <Link href={`/purchases/${purchase.reverses}`} className="mm-inline-tap">an earlier purchase</Link>.
          It holds no items of its own.
        </Notice>
      )}
      {!replacedBy && (purchase.reversal_reason ?? reversalReason) && (
        <Notice tone="warn">
          This purchase was cancelled. Reason given:{' '}
          {purchase.reversal_reason ?? reversalReason}
        </Notice>
      )}

      {rows.length > 0 && (
        <StatRow>
          <Stat label="Items" value={String(summary?.line_count ?? rows.length)} />
          <Stat label="Total paid" value={total !== null ? money(total) : undefined} />
          <Stat label="Status"
            value={draft ? 'Not recorded' : posted ? 'Recorded' : 'Cancelled'} />
        </StatRow>
      )}

      {/* A draft's next step comes first. */}
      {draft && rows.length > 0 && (
        <Card>
          <SectionHeading sub="This updates the cost of every recipe using these ingredients.">
            Ready? Record this purchase
          </SectionHeading>
          <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
            Until you record it, none of these prices are used.
          </p>
          <form action={post} className="mt-3">
            <input type="hidden" name="purchase_id" value={id} />
            <Button className="w-full sm:w-auto" busyLabel="Recording…">
              Record purchase{total !== null ? ` · ${money(total)}` : ''}
            </Button>
          </form>
        </Card>
      )}

      {posted && (
        <section className="space-y-3">
          <SectionHeading sub="Dishes that use what you bought, costed with the prices you just paid.">
            What this changed
          </SectionHeading>
          {affected.length === 0 ? (
            <Empty>None of your dishes use these items yet. Add them to a dish and its cost will come from what you paid here.</Empty>
          ) : (
            <ul className="space-y-2">
              {affected.map((p) => {
                const st = productState(p.state)
                return (
                  <li key={`${p.recipe_id}-${p.variant_id ?? 'base'}`}>
                    <Link href={`/recipes/${p.recipe_id}`} className="block">
                      <Card>
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-semibold">
                            {p.product_name}{p.format_name ? <span style={{ color: 'var(--mm-muted)' }}> · {p.format_name}</span> : null}
                          </span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </div>
                        <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                          Costs you {money(p.true_cost, 'not known yet')}
                          {p.selling_price !== null ? ` · you sell it for ${money(p.selling_price)}` : ' · no selling price yet'}
                        </div>
                      </Card>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/purchases/new" className="mm-btn mm-btn-primary w-full">
              <AppIcon name="plus" size={18} /> New purchase
            </Link>
            <Link href="/recipes" className="mm-btn mm-btn-secondary w-full">See your dishes</Link>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading sub="What you bought, and what you paid for it.">Items</SectionHeading>
        {!rows.length ? (
          <Empty>Nothing on this purchase yet. Add what you bought and what you paid for it.</Empty>
        ) : (
          <ul className="space-y-2">
            {rows.map((l) => (
              <li key={l.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">{l.ingredient?.name ?? 'Unknown item'}</span>
                    <span className="tabular-nums font-medium">{money(Number(l.amount))}</span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                    {quantity(Number(l.qty), l.unit?.code ?? null)}
                  </div>
                  {draft && (
                    <div className="mt-3 flex flex-wrap items-end gap-4">
                      <form action={updateLine} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="purchase_id" value={id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <label className="block">
                          <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Quantity</span>
                          <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                            defaultValue={Number(l.qty)} className="mt-1 w-24 rounded border px-2 py-2 text-base" />
                        </label>
                        <label className="block">
                          <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Unit</span>
                          <select name="unit_id" className="mt-1 rounded border px-2 py-2 text-base"
                            defaultValue={(units ?? []).find((u) => u.code === l.unit?.code)?.id ?? ''}>
                            {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Paid (₦)</span>
                          <input name="amount" type="number" step="0.01" min="0" inputMode="decimal"
                            defaultValue={Number(l.amount)} className="mt-1 w-32 rounded border px-2 py-2 text-base" />
                        </label>
                        <InlineSubmit>Update</InlineSubmit>
                      </form>
                      <form action={removeLine}>
                        <input type="hidden" name="purchase_id" value={id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <InlineSubmit>Remove</InlineSubmit>
                      </form>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}

        {draft && (
          <Disclosure summary={rows.length === 0 ? 'Add what you bought' : 'Add another item'} open={rows.length === 0}>
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
              Buy in bags, paint, derica or kilograms — whatever you actually bought in.
            </p>
            <form action={addLine} className="mt-3 grid gap-3 sm:grid-cols-5">
              <input type="hidden" name="purchase_id" value={id} />
              <div className="sm:col-span-2">
                <Field label="Ingredient">
                  <select name="ingredient_id" required className={inputClass} style={inputStyle}>
                    {(ingredients ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Quantity bought">
                <input name="qty" type="number" step="any" min="0" required
                  className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Unit">
                <select name="unit_id" required className={inputClass} style={inputStyle}>
                  {(units ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Amount paid (₦)">
                <input name="amount" type="number" step="0.01" min="0" required
                  className={inputClass} style={inputStyle} />
              </Field>
              <div className="sm:col-span-5"><Submit>Add item</Submit></div>
            </form>
          </Disclosure>
        )}
      </section>

      {draft && (
        <Disclosure summary={`Date, supplier and reference · ${formatDay(purchase.purchase_date)}`}>
          <form action={updateHeader} className="mt-2 grid gap-3 sm:grid-cols-4 sm:items-end">
            <input type="hidden" name="purchase_id" value={id} />
            <Field label="Date">
              <input name="purchase_date" type="date" required defaultValue={purchase.purchase_date}
                className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Supplier or market">
              <select name="supplier_id" defaultValue={purchase.supplier_id ?? ''} className={inputClass} style={inputStyle}>
                <option value="">Not recorded</option>
                {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Reference">
              <input name="reference" defaultValue={purchase.reference ?? ''} placeholder="receipt no."
                className={inputClass} style={inputStyle} />
            </Field>
            <div className="flex items-end"><Submit>Save</Submit></div>
            <div className="sm:col-span-4">
              <Field label="Note (optional)">
                <input name="note" defaultValue={purchase.note ?? ''} className={inputClass} style={inputStyle} />
              </Field>
            </div>
          </form>
        </Disclosure>
      )}

      {draft && (
        <Disclosure summary="Discard this draft">
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            A draft has never changed a price, so discarding it changes nothing.
          </p>
          <form action={discardDraft} className="mt-2">
            <input type="hidden" name="purchase_id" value={id} />
            <InlineSubmit>Discard this draft</InlineSubmit>
          </form>
        </Disclosure>
      )}

      {posted && (
        <Card>
          <SectionHeading sub="Wrong amount, wrong quantity, wrong item? Correct it in one step: the corrected purchase is recorded and this one is cancelled, and they stay linked.">
            Something is wrong with this purchase
          </SectionHeading>
          <p className="mt-3">
            <Link href={`/purchases/${id}/correct`} className="mm-btn mm-btn-primary">
              Correct this purchase <AppIcon name="arrow-right" size={16} />
            </Link>
          </p>
        </Card>
      )}

      {posted && (
        <Disclosure summary="Cancel it without a replacement">
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            For goods you returned or a purchase recorded by mistake. Cancelling undoes
            the prices this purchase set. The record itself is kept.
          </p>
          <form action={reverse} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="purchase_id" value={id} />
            <div className="min-w-56 flex-1">
              <Field label="Why are you cancelling it?">
                <input name="reason" required placeholder="wrong amount, returned goods…"
                  className={inputClass} style={inputStyle} />
              </Field>
            </div>
            <Submit>Cancel this purchase</Submit>
          </form>
        </Disclosure>
      )}

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        Menu Master works out the unit cost from what you paid.{' '}
        <Link href="/ingredients" className="underline">See your ingredients</Link>.
      </p>
    </div>
  )
}
