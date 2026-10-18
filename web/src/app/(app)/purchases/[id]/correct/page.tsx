import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  currentContext, contextRedirect, describeWriteError, withNotice, closedLine, closedRefusal,
} from '@/lib/data/context'
import {
  PageHeader, Card, Field, Notice, SectionHeading, BackLink, inputClass, inputStyle,
} from '@/components/ui'
import { Button } from '@/components/button'
import { money, quantity, purchaseReference } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { canRecordPurchases } from '../../buy-roles'
import { inSentence, sumMoney } from '../../buy-figures'
import { noticeTone } from '@/lib/ui/notice-tone'

export const dynamic = 'force-dynamic'

/**
 * Correcting a recorded purchase.
 *
 * A posted purchase is never edited: its prices are already in every dish
 * that uses them. The owner used to cancel it and retype every line. Now the
 * form opens pre-filled; what is sent is one call to fn_correct_purchase
 * (0060), which records the corrected purchase, cancels this one through
 * the unchanged fn_reverse_purchase, and links the two -- or writes nothing
 * and names the line it cannot measure.
 */

type Purchase = {
  id: string; purchase_date: string; status: string; reference: string | null
  note: string | null; supplier_id: string | null
}
type Line = {
  id: string; qty: string; amount: string
  ingredient: { id: string; name: string } | null
  unit: { id: string; code: string } | null
}
type Named = { id: string; name: string }
type Unit = { id: string; code: string; name: string; kind: string }

const BLANK_ROWS = 2

async function correct(formData: FormData) {
  'use server'
  const id = String(formData.get('purchase_id') ?? '')
  const here = `/purchases/${id}/correct`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const date = String(formData.get('purchase_date') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(withNotice(here, 'Choose the date of the purchase.'))

  // Rows travel as parallel lists; a row with no ingredient is a blank one.
  const ingredientIds = formData.getAll('ingredient_id').map(String)
  const qtys = formData.getAll('qty').map(String)
  const unitIds = formData.getAll('unit_id').map(String)
  const amounts = formData.getAll('amount').map(String)
  const lines: { ingredient_id: string; qty: number; unit_id: string; amount: number }[] = []
  // A correction records a purchase and cancels one: closed after a trial (D3).
  const closed = await closedRefusal(ctx.role)
  if (closed) redirect(withNotice(`/purchases/${id}`, closed))
  for (let i = 0; i < ingredientIds.length; i++) {
    if (!ingredientIds[i]) continue
    const qty = Number(qtys[i])
    const amount = Number(amounts[i])
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(amount) || amount <= 0 || !unitIds[i]) {
      redirect(withNotice(here, `Line ${i + 1}: enter a quantity, a unit and an amount paid, each above zero.`))
    }
    lines.push({ ingredient_id: ingredientIds[i], qty, unit_id: unitIds[i], amount })
  }
  if (lines.length === 0) redirect(withNotice(here, 'A purchase needs at least one item.'))

  const { data, error } = await supabase.rpc('fn_correct_purchase', {
    p_original_id: id,
    p_purchase_date: date,
    p_supplier_id: String(formData.get('supplier_id') ?? '') || null,
    p_reference: String(formData.get('reference') ?? '').trim() || null,
    p_note: String(formData.get('note') ?? '').trim() || null,
    p_lines: lines,
  })
  if (error) {
    redirect(withNotice(here, error.code === '42883'
      ? 'Correcting a purchase is not available on this account yet. Cancel it and record a new one for now.'
      : describeWriteError(error) ?? error.message))
  }
  if (data && data.corrected === false) {
    const names = (data.blockers ?? [])
      .map((b: { ingredient_name?: string; unit_code?: string }) =>
        `${b.ingredient_name ?? 'an item'} (${b.unit_code ?? 'that unit'})`)
      .join(', ')
    redirect(withNotice(here,
      `Nothing was changed. We do not yet know how much one of those is for: ${names}. ` +
      `Open the ingredient and add the measure, then correct this purchase again.`))
  }
  revalidatePath('/purchases')
  revalidatePath(`/purchases/${id}`)
  redirect(withNotice(`/purchases/${data?.new_purchase_id ?? id}`,
    'Corrected. The earlier purchase is cancelled and linked to this one; every dish using these items is costed from the corrected prices.'))
}

export default async function CorrectPurchase({
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
    .select('id,purchase_date,status,reference,note,supplier_id')
    .eq('id', id).maybeSingle<Purchase>()
  if (!purchase) notFound()
  if (purchase.status !== 'posted') redirect(`/purchases/${id}`)
  // Correcting is recording a purchase (owner, manager, accountant; 0015), and
  // this form shows every amount paid. Anyone else goes back to the purchase.
  if (!canRecordPurchases(ctx.role)) redirect(`/purchases/${id}`)
  // After a trial ends a correction cannot be saved, so the form is not
  // offered: back to the purchase, which says why.
  const paused = await closedLine(ctx.role, 'this purchase can’t be cancelled or corrected')
  if (paused) redirect(withNotice(`/purchases/${id}`, paused))

  const [{ data: lines }, { data: ingredients }, { data: units }, { data: suppliers }] = await Promise.all([
    supabase.from('purchase_lines')
      .select('id,qty,amount,' +
              'ingredient:ingredients!fk_purchase_lines_ingredient_id_account(id,name),' +
              'unit:units!purchase_lines_unit_id_fkey(id,code)')
      .eq('purchase_id', id).returns<Line[]>(),
    supabase.from('ingredients').select('id,name').is('deleted_at', null)
      .eq('is_active', true).order('name').returns<Named[]>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
    supabase.from('suppliers').select('id,name').eq('is_active', true).order('name').returns<Named[]>(),
  ])
  const rows = lines ?? []
  // Added in whole kobo, so the figure in the title is exact.
  const total = sumMoney(rows.map((l) => l.amount))

  return (
    <div className="space-y-6">
      <BackLink href={`/purchases/${id}`}>Back to the purchase</BackLink>
      <PageHeader
        title="Correct this purchase"
        sub={`Bought ${inSentence(formatDay(purchase.purchase_date))}${purchaseReference(purchase.reference) ? ` · ${purchaseReference(purchase.reference)}` : ''} · ${money(total)}`}
      />
      {notice && <Notice tone={noticeTone(notice, /not available|choose|enter/i)}>{notice}</Notice>}

      <Notice tone="info">
        Change what was wrong and save. The corrected purchase is recorded, the earlier one is
        cancelled, and both are kept and linked. Nothing changes until you save.
      </Notice>

      <form action={correct} className="space-y-5">
        <input type="hidden" name="purchase_id" value={id} />

        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
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
              <input name="reference" defaultValue={purchaseReference(purchase.reference) ?? ''}
                placeholder="receipt no." className={inputClass} style={inputStyle} />
            </Field>
            <div className="sm:col-span-3">
              <Field label="Note (optional)">
                <input name="note" defaultValue={purchase.note ?? ''} className={inputClass} style={inputStyle} />
              </Field>
            </div>
          </div>
        </Card>

        <section className="space-y-3">
          <SectionHeading sub="Each item as it should have been. Clear the item to drop a line; use the empty rows to add one.">
            Items
          </SectionHeading>
          <ul className="space-y-2">
            {[...rows.map((l) => ({
                key: l.id, ingredientId: l.ingredient?.id ?? '', qty: Number(l.qty),
                unitId: l.unit?.id ?? '', amount: Number(l.amount),
                was: `${quantity(Number(l.qty), l.unit?.code ?? null)} for ${money(Number(l.amount))}`,
              })),
              ...Array.from({ length: BLANK_ROWS }, (_, i) => ({
                key: `blank-${i}`, ingredientId: '', qty: NaN, unitId: '', amount: NaN, was: '',
              })),
            ].map((r, i) => (
              <li key={r.key}>
                <Card>
                  <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
                    <div className="sm:col-span-2">
                      <Field label={r.was ? `Item · was ${r.was}` : `Item ${i + 1} (optional)`}>
                        <select name="ingredient_id" defaultValue={r.ingredientId} className={inputClass} style={inputStyle}>
                          <option value="">— none —</option>
                          {(ingredients ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Quantity">
                      <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                        defaultValue={Number.isFinite(r.qty) ? r.qty : ''} className={inputClass} style={inputStyle} />
                    </Field>
                    <Field label="Unit">
                      <select name="unit_id" defaultValue={r.unitId} className={inputClass} style={inputStyle}>
                        <option value="">—</option>
                        {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Paid (₦)">
                      <input name="amount" type="number" step="0.01" min="0" inputMode="decimal"
                        defaultValue={Number.isFinite(r.amount) ? r.amount : ''} className={inputClass} style={inputStyle} />
                    </Field>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <Card>
          <SectionHeading sub="The earlier record is cancelled with the reason “replaced by a corrected purchase” and stays in your history.">
            Save the correction
          </SectionHeading>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button busyLabel="Saving…">Save the corrected purchase</Button>
            <Link href={`/purchases/${id}`} className="mm-tap text-sm underline">Leave it as it is</Link>
          </div>
        </Card>
      </form>
    </div>
  )
}
