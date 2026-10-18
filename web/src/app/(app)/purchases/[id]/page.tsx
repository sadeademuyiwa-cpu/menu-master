import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  currentContext, contextRedirect, describeWriteError, withNotice,
  closedLine, closedRefusal, recordingOpen, refusalNotice, writeNotice,
} from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty,
  SectionHeading, BackLink, Disclosure,
} from '@/components/ui'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { DishTile } from '@/components/dish-tile'
import { money, quantity, purchaseReference } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { canSeeCosts } from '@/lib/pricing'
import { ConfirmSubmit } from '@/components/confirm-submit'
import { stateDot } from '../../recipes/_list/dish-figures'
import { canRecordPurchases } from '../buy-roles'
import { inSentence } from '../buy-figures'
import '../buy.css'
// .mm-dot, the dish state dot, as /recipes and /pricing draw it.
import '../../recipes/_list/lists.css'
import { noticeTone } from '@/lib/ui/notice-tone'

export const dynamic = 'force-dynamic'

type Purchase = {
  id: string; purchase_date: string; status: string; reference: string | null
  note: string | null; supplier_id: string | null; reverses: string | null
  reversal_reason: string | null
}
type Line = {
  id: string; qty: string
  /** Selected only for a role that may see costs. */
  amount?: string
  qty_base: string | null
  ingredient: { id: string; name: string } | null
  unit: { code: string; name: string } | null
}
type Ingredient = { id: string; name: string }
type Affected = {
  recipe_id: string; variant_id: string | null
  product_name: string; format_name: string | null
  true_cost: string | null; state: string
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
  // .select: a refused delete is not an error, only zero rows (writeNotice).
  const { data, error } = await supabase.from('purchase_lines')
    .delete().eq('id', String(formData.get('line_id') ?? '')).select('id')
  revalidatePath(here)
  redirect(withNotice(here, await writeNotice(error, data, 'Item removed.', ctx.role)))
}

/**
 * POSTING. fn_post_purchase owns every rule here -- role, draft-only (so a
 * double submit cannot post twice), zero-value refusal and conversion
 * blockers. It reports refusals as DATA, not errors, so the result must be
 * read rather than assumed successful.
 *
 * After a trial ends the button is gone, and a form posted anyway is refused
 * here first (closedRefusal): recording sets ingredient prices and re-costs
 * every dish, which a closed account must not do. 0066 refuses it in the
 * database too (fn_require_entitled); this check is the courtesy, that one
 * the boundary.
 */
async function post(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const closed = await closedRefusal(ctx.role)
  if (closed) redirect(withNotice(here, closed))

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
  const { data, error } = await supabase.from('purchase_lines')
    .update({ qty, unit_id: String(formData.get('unit_id') ?? ''), amount })
    .eq('id', String(formData.get('line_id') ?? '')).select('id')
  revalidatePath(here)
  redirect(withNotice(here, await writeNotice(error, data, 'Item updated.', ctx.role)))
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
  const { data, error } = await supabase.from('purchases').update({
    purchase_date: date,
    supplier_id: String(formData.get('supplier_id') ?? '') || null,
    reference: String(formData.get('reference') ?? '').trim() || null,
    note: String(formData.get('note') ?? '').trim() || null,
  }).eq('id', id).select('id')
  revalidatePath(here)
  redirect(withNotice(here, await writeNotice(error, data, 'Saved.', ctx.role)))
}

/** A draft never set a price, so discarding one changes nothing. */
async function discardDraft(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('purchases').delete().eq('id', id).eq('status', 'draft').select('id')
  if (error) redirect(withNotice(`/purchases/${id}`, describeWriteError(error) ?? 'Could not discard that draft.'))
  // Zero rows: refused, or recorded in the meantime. Either way it is still there.
  if (!data?.length) redirect(withNotice(`/purchases/${id}`, await refusalNotice(ctx.role)))
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
  // Cancelling undoes prices and re-costs dishes: closed after a trial (D3).
  const closed = await closedRefusal(ctx.role)
  if (closed) redirect(withNotice(here, closed))
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

  // What was paid is a cost: amount / quantity is the ingredient's price,
  // which fn_can_see_costs (0004) keeps from sales and kitchen. Every member
  // may read purchase lines, so the gate is here: without it no amount, total
  // or dish cost is selected at all. Changing a purchase is for the roles the
  // database lets write one (0015); the forms are not drawn for anyone else.
  const costs = canSeeCosts(ctx.role)
  // After a trial ends nothing here can be recorded, cancelled or corrected
  // (D3), so none of it is offered. Only an explicit false closes: when the
  // account's state cannot be read the page is as it always was.
  const open = await recordingOpen()
  const buyer = canRecordPurchases(ctx.role)
  const canWrite = buyer && open !== false

  const { data: purchase } = await supabase.from('purchases')
    .select('id,purchase_date,status,reference,note,supplier_id,reverses,reversal_reason')
    .eq('id', id).maybeSingle<Purchase>()
  if (!purchase) notFound()

  // Set by 0060: which corrected purchase replaced this one. Read on its own so
  // a database that does not have the column yet still renders the page.
  const { data: link } = await supabase.from('purchases').select('replaced_by')
    .eq('id', id).maybeSingle<{ replaced_by: string | null }>()
  const replacedBy = link?.replaced_by ?? null

  const draft = purchase.status === 'draft'
  const posted = purchase.status === 'posted'
  // Said once, where the buttons were, to the people who would have had them.
  const paused = buyer && !canWrite && (draft || (posted && !replacedBy))
    ? await closedLine(ctx.role, draft
        ? 'this draft can’t be changed or recorded'
        : 'this purchase can’t be cancelled or corrected')
    : null

  const [{ data: lines }, { data: ingredients }, { data: units }, { data: suppliers }, { data: supplier }] = await Promise.all([
    // The !constraint hints are required, not cosmetic: purchase_lines has two
    // foreign keys to ingredients (a composite tenant-scoped one and a simple
    // one), so an unhinted embed fails with PGRST201 and the page renders no
    // items at all. The composite key is chosen because it also enforces that
    // the ingredient belongs to the same account.
    supabase.from('purchase_lines')
      .select((costs ? 'id,qty,amount,qty_base,' : 'id,qty,qty_base,') +
              'ingredient:ingredients!fk_purchase_lines_ingredient_id_account(id,name),' +
              'unit:units!purchase_lines_unit_id_fkey(code,name)')
      .eq('purchase_id', id).returns<Line[]>(),
    // The pickers are only for a draft someone here may change.
    draft && canWrite
      ? supabase.from('ingredients').select('id,name').is('deleted_at', null)
          .eq('is_active', true).order('name').returns<Ingredient[]>()
      : Promise.resolve({ data: null }),
    draft && canWrite
      ? supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>()
      : Promise.resolve({ data: null }),
    draft && canWrite
      ? supabase.from('suppliers').select('id,name').eq('is_active', true).order('name')
          .returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: null }),
    purchase.supplier_id
      ? supabase.from('suppliers').select('name').eq('id', purchase.supplier_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
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
    .select(costs ? 'total_amount,line_count' : 'line_count').eq('purchase_id', id)
    .maybeSingle<{ total_amount?: string | null; line_count: number }>()
  const total = costs && summary?.total_amount !== null && summary?.total_amount !== undefined
    ? Number(summary.total_amount) : null
  const itemCount = summary?.line_count ?? rows.length

  // What this purchase changed: every dish using one of its items, with the
  // cost the database now holds for it. Costs only, so not asked otherwise.
  const boughtIds = [...new Set(rows.map((l) => l.ingredient?.id).filter((x): x is string => !!x))]
  let affected: Affected[] = []
  const photoOf = new Map<string, string | null>()
  if (costs && posted && boughtIds.length) {
    const { data: uses } = await supabase.from('recipe_lines').select('recipe_id')
      .in('ingredient_id', boughtIds).returns<{ recipe_id: string }[]>()
    const recipeIds = [...new Set((uses ?? []).map((u) => u.recipe_id))]
    if (recipeIds.length) {
      const [{ data }, { data: photos }] = await Promise.all([
        supabase.from('v_product_attention')
          .select('recipe_id,variant_id,product_name,format_name,true_cost,state')
          .in('recipe_id', recipeIds).order('product_name').returns<Affected[]>(),
        // recipes.photo_path arrives with 0063. Before it, this read fails and
        // every dish keeps its tile.
        supabase.from('recipes').select('id,photo_path').in('id', recipeIds)
          .returns<{ id: string; photo_path: string | null }[]>(),
      ])
      affected = data ?? []
      for (const p of photos ?? []) photoOf.set(p.id, p.photo_path)
    }
  }
  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined
  const statusWord = draft ? 'Not recorded yet' : posted ? 'Recorded' : 'Cancelled'

  return (
    <div className="space-y-6">
      <BackLink href="/purchases">Purchases</BackLink>
      <PageHeader
        title={`Purchase of ${inSentence(formatDay(purchase.purchase_date))}`}
        sub={[
          supplier?.name ? `From ${supplier.name}` : null,
          purchaseReference(purchase.reference) ? `Receipt ${purchaseReference(purchase.reference)}` : null,
          purchase.note,
        ].filter(Boolean).join(' · ') || undefined}
      />
      {notice && (
        <Notice tone={noticeTone(notice, /cancelling/i)}>
          {notice}
        </Notice>
      )}
      {paused && !notice && <Notice tone="warn">{paused}</Notice>}

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

      {/* One figure: what the trip came to. */}
      {rows.length > 0 && (
        <section className="mm-card" aria-label="This purchase">
          {costs && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
                You paid
              </div>
              <div className={`mm-num mm-buy-hero mt-1 ${posted || draft ? '' : 'line-through'}`}>
                {money(total, 'not known yet')}
              </div>
            </>
          )}
          <div className={costs ? 'mt-1 text-sm' : 'text-sm'} style={{ color: 'var(--mm-muted)' }}>
            {supplier?.name ? `${supplier.name} · ` : ''}
            {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
            <span style={draft || !posted ? { color: 'var(--mm-warn)' } : undefined}>{statusWord}</span>
          </div>
        </section>
      )}

      {/* A draft's next step comes first. */}
      {draft && canWrite && rows.length > 0 && (
        <Card>
          <SectionHeading sub="Recording it updates the cost of every dish using these items. Until then, none of these prices are used.">
            Ready? Record this purchase
          </SectionHeading>
          <form action={post} className="mt-3">
            <input type="hidden" name="purchase_id" value={id} />
            <Button className="w-full sm:w-auto" busyLabel="Recording…">
              Record purchase{total !== null ? ` · ${money(total)}` : ''}
            </Button>
          </form>
        </Card>
      )}

      {costs && posted && (
        <section className="space-y-3">
          <SectionHeading sub="Dishes that use what you bought, costed with the prices you just paid.">
            What this changed
          </SectionHeading>
          {affected.length === 0 ? (
            <Empty>None of your dishes use these items yet.</Empty>
          ) : (
            <ul className="mm-buy-rows">
              {affected.map((p) => {
                // The Dishes list's dot and words, so a dish is called the same
                // thing on both screens. A badge beside the name left about six
                // letters of it at 360px; the dot sits by the cost instead and
                // the name keeps the row's full width.
                const dot = stateDot(p.state)
                const known = p.true_cost !== null && p.true_cost !== ''
                return (
                  <li key={`${p.recipe_id}-${p.variant_id ?? 'base'}`}>
                    <Link href={`/recipes/${p.recipe_id}`} className="mm-buy-row">
                      <DishTile name={p.product_name} photoPath={photoOf.get(p.recipe_id) ?? null} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {p.product_name}{p.format_name ? <span style={{ color: 'var(--mm-muted)' }}> · {p.format_name}</span> : null}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-sm" style={{ color: 'var(--mm-muted)' }}>
                          {/* With no cost the words beside it say the same; read them once. */}
                          <span className="mm-dot" data-tone={dot.tone} title={dot.label}
                            {...(known ? { role: 'img', 'aria-label': dot.label } : { 'aria-hidden': true })} />
                          {known
                            ? <span className="min-w-0">Costs you <span className="mm-num">{money(p.true_cost)}</span></span>
                            : <span className="min-w-0">{dot.label}</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {canWrite && (
              <Link href="/purchases/new" className="mm-btn mm-btn-primary w-full">
                <AppIcon name="plus" size={18} /> New purchase
              </Link>
            )}
            <Link href="/recipes" className="mm-btn mm-btn-secondary w-full">See your dishes</Link>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading>Items</SectionHeading>
        {!rows.length ? (
          <Empty>Nothing on this purchase yet.{draft && canWrite ? ' Add what you bought and what you paid for it.' : ''}</Empty>
        ) : (
          <ul className="mm-buy-rows">
            {rows.map((l) => (
              <li key={l.id}>
                <div className="mm-buy-row">
                  <span className="min-w-0 flex-1">
                    {l.ingredient
                      ? <Link href={`/ingredients/${l.ingredient.id}`} className="block truncate font-medium">{l.ingredient.name}</Link>
                      : <span className="block truncate font-medium">Unknown item</span>}
                    <span className="block text-sm" style={{ color: 'var(--mm-muted)' }}>
                      {quantity(Number(l.qty), l.unit?.code ?? null)}
                    </span>
                  </span>
                  {costs && l.amount !== undefined && (
                    <span className="mm-num shrink-0 font-medium">{money(l.amount)}</span>
                  )}
                </div>
                {draft && canWrite && (
                  <div className="flex flex-wrap items-end gap-4 px-[.9rem] pb-3">
                    <form action={updateLine} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="purchase_id" value={id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Quantity</span>
                        <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                          defaultValue={Number(l.qty)} className="mm-input mt-1" style={{ width: '6rem' }} />
                      </label>
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Unit</span>
                        <select name="unit_id" className="mm-input mt-1" style={{ width: 'auto' }}
                          defaultValue={(units ?? []).find((u) => u.code === l.unit?.code)?.id ?? ''}>
                          {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Paid (₦)</span>
                        <input name="amount" type="number" step="0.01" min="0" inputMode="decimal"
                          defaultValue={l.amount !== undefined ? Number(l.amount) : undefined} className="mm-input mt-1" style={{ width: '8rem' }} />
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
              </li>
            ))}
          </ul>
        )}

        {draft && canWrite && (
          <Disclosure summary={rows.length === 0 ? 'Add what you bought' : 'Add another item'} open={rows.length === 0}>
            <form action={addLine} className="grid gap-3 sm:grid-cols-5">
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

      {draft && canWrite && (
        <Disclosure summary={`Date, supplier and reference · ${formatDay(purchase.purchase_date)}`}>
          <form action={updateHeader} className="grid gap-3 sm:grid-cols-4 sm:items-end">
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

      {draft && canWrite && (
        <Disclosure summary="Discard this draft">
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            A draft has never changed a price, so discarding it changes nothing.
          </p>
          <form action={discardDraft} className="mt-2">
            <input type="hidden" name="purchase_id" value={id} />
            <ConfirmSubmit message="Discard this draft? Nothing on it has been recorded.">Discard this draft</ConfirmSubmit>
          </form>
        </Disclosure>
      )}

      {posted && canWrite && (
        <Card>
          <SectionHeading sub="Wrong amount, wrong quantity, wrong item? Correct it in one step: the corrected purchase is recorded and this one is cancelled, and they stay linked.">
            Something wrong?
          </SectionHeading>
          <p className="mt-3">
            <Link href={`/purchases/${id}/correct`} className="mm-btn mm-btn-primary w-full sm:w-auto">
              Correct this purchase <AppIcon name="arrow-right" size={16} />
            </Link>
          </p>
        </Card>
      )}

      {posted && canWrite && (
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
            <ConfirmSubmit variant="secondary" message="Cancel this purchase? The prices it set are undone. The record is kept.">Cancel this purchase</ConfirmSubmit>
          </form>
        </Disclosure>
      )}
    </div>
  )
}
