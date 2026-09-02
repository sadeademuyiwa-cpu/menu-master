import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requiredAmount } from '@/lib/money-input'
import { createClient } from '@/lib/supabase/server'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, inputClass, inputStyle,
  DataList, Notice, SectionHeading, BackLink, Empty,
} from '@/components/ui'
import { money, quantity, NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Unit = { id: string; code: string; name: string; kind: string; factor_to_base: number | null }
type Price = {
  id: string; qty_base: string; amount: string; unit_cost: string
  effective_date: string; source: string; supplier_id: string | null
}
type Conversion = { id: string; unit_id: string; qty_in_base: string }

// ---------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------

/**
 * A purchase, recorded the way it was actually made: "2 paint for 9,000".
 *
 * ingredient_prices.qty_base is stored in the ingredient's BASE unit, so the
 * purchase quantity must be resolved first. That resolution is
 * fn_resolve_qty_to_base -- a database function. It is deliberately NOT done
 * here: a conversion computed in the browser would be a second, competing
 * costing engine, and a wrong one the moment the two drifted.
 *
 * If the resolver returns NULL the conversion does not exist. That is a
 * blocker to show, never a number to guess.
 */
async function addPrice(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const here = `/ingredients/${id}`
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))
  if (!businessId) redirect(contextRedirect(ctx, here))

  const qty = Number(formData.get('qty'))
  const unitId = String(formData.get('unit_id') ?? '')
  // A purchase recorded at zero naira would drag the weighted-average cost of
  // this ingredient down for every recipe that uses it.
  const amount = requiredAmount(formData, 'amount')
  const effective = String(formData.get('effective_date') ?? '')

  if (!Number.isFinite(qty) || qty <= 0 || amount === null) {
    redirect(withNotice(here, 'Enter a quantity greater than zero and the amount you paid, using digits only.'))
  }

  const { data: qtyBase, error: resolveError } = await supabase.rpc('fn_resolve_qty_to_base', {
    p_ingredient_id: id, p_qty: qty, p_unit_id: unitId,
  })

  if (resolveError) redirect(withNotice(here, describeWriteError(resolveError) ?? 'Could not resolve that unit.'))

  if (qtyBase === null || qtyBase === undefined) {
    redirect(withNotice(here,
      'Menu Master does not know how much of the base unit is in one of those ' +
      'yet — and it will not guess, because a paint of rice and a paint of ' +
      'garri are different weights. Add the conversion below, then record this ' +
      'purchase again.'))
  }

  // THROUGH THE LEDGER, NOT AROUND IT.
  //
  // Writing ingredient_prices directly produced a row with no purchase_line_id,
  // which fn_reverse_purchase cannot reverse -- a price the owner could never
  // undo. fn_post_purchase is the only path that sets source='purchase' and
  // links the line, and it carries the checks this screen must not duplicate:
  // role enforcement, draft-only posting (so a double submit cannot post
  // twice), zero-value refusal, and conversion blockers.
  const date = effective || new Date().toISOString().slice(0, 10)

  const { data: purchase, error: pErr } = await supabase.from('purchases')
    .insert({ account_id: accountId, business_id: businessId, purchase_date: date })
    .select('id').single()
  if (pErr || !purchase) {
    redirect(withNotice(here, describeWriteError(pErr) ?? 'Could not start the purchase.'))
  }

  const { error: lErr } = await supabase.from('purchase_lines').insert({
    account_id: accountId, purchase_id: purchase.id,
    ingredient_id: id, qty, unit_id: unitId, amount,
  })
  if (lErr) {
    redirect(withNotice(here, describeWriteError(lErr) ?? 'Could not record the purchase.'))
  }

  const { data: posted, error: postErr } = await supabase
    .rpc('fn_post_purchase', { p_purchase_id: purchase.id })
  if (postErr) {
    redirect(withNotice(here, describeWriteError(postErr) ?? 'Could not post the purchase.'))
  }
  // The function reports refusals as data, not errors, so they must be read.
  if (posted && posted.posted === false) {
    redirect(withNotice(here, posted.reason === 'unresolved_conversions'
      ? 'We still need to know how much of the base unit one of those is. Add the measurement below, then record this purchase again.'
      : 'That purchase could not be posted: ' + String(posted.reason).replace(/_/g, ' ') + '.'))
  }

  revalidatePath(here)
  redirect(withNotice(here, 'Purchase recorded.'))
}

/** "1 paint of THIS rice is 4,000 g." Private measurement data, per ingredient. */
async function addConversion(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const here = `/ingredients/${id}`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const qtyInBase = Number(formData.get('qty_in_base'))
  if (!Number.isFinite(qtyInBase) || qtyInBase <= 0) {
    redirect(withNotice(here, 'Enter how much of the base unit one of these holds. It must be greater than zero.'))
  }

  const { error } = await supabase.from('ingredient_unit_conversions').insert({
    account_id: accountId,
    ingredient_id: id,
    unit_id: String(formData.get('unit_id') ?? ''),
    qty_in_base: qtyInBase,
  })

  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Conversion saved.'))
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------

export default async function IngredientDetail(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await props.params
  const { notice } = await props.searchParams
  const supabase = await createClient()

  const { data: ingredient } = await supabase
    .from('ingredients')
    .select('id,name,kind,base_unit_id,purchase_yield_pct,is_active')
    .eq('id', id).is('deleted_at', null).maybeSingle()

  if (!ingredient) notFound()

  const [{ data: units }, { data: prices }, { data: conversions }, { data: missing }] =
    await Promise.all([
      supabase.from('units').select('id,code,name,kind,factor_to_base').order('kind').order('code')
        .returns<Unit[]>(),
      supabase.from('ingredient_prices')
        .select('id,qty_base,amount,unit_cost,effective_date,source,supplier_id')
        .eq('ingredient_id', id)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false })
        .returns<Price[]>(),
      supabase.from('ingredient_unit_conversions').select('id,unit_id,qty_in_base')
        .eq('ingredient_id', id).returns<Conversion[]>(),
      supabase.from('v_missing_unit_conversions')
        .select('ingredient_id,unit_code,reason').eq('ingredient_id', id)
        .returns<{ ingredient_id: string; unit_code: string; reason: string }[]>(),
    ])

  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const base = unitById.get(ingredient.base_unit_id)
  const baseCode = base?.code ?? NOT_ENTERED

  // Units this ingredient can already be purchased in: its own base unit, any
  // unit with a universal factor of the same kind, and any unit the owner has
  // given this ingredient a conversion for.
  const converted = new Set((conversions ?? []).map((c) => c.unit_id))
  const usable = (units ?? []).filter(
    (u) => u.id === ingredient.base_unit_id ||
           converted.has(u.id) ||
           (base ? u.kind === base.kind && u.factor_to_base !== null : false),
  )
  // Units that would need a conversion first: everything else.
  const needsConversion = (units ?? []).filter((u) => !usable.some((x) => x.id === u.id))

  const latest = prices?.[0]

  return (
    <div className="space-y-8">
      <BackLink href="/ingredients">← All ingredients</BackLink>

      <PageHeader
        title={ingredient.name}
        sub={`${ingredient.kind} · base unit ${baseCode} · purchase yield ${ingredient.purchase_yield_pct}%`}
      />

      {notice && <Notice tone={notice.includes('could not') || notice.includes('not know') ? 'warn' : 'info'}>{notice}</Notice>}

      {missing && missing.length > 0 && (
        <Notice>
          A recipe or purchase already uses{' '}
          {missing.map((m) => m.unit_code).join(', ')} for this item and cannot be
          costed until you say how much {baseCode} one holds.
        </Notice>
      )}

      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionHeading sub="What you actually paid. Menu Master never supplies a price.">
          Record a purchase
        </SectionHeading>

        <form action={addPrice} className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <input type="hidden" name="ingredient_id" value={ingredient.id} />
          <Field label="Quantity bought">
            <input name="qty" type="number" step="any" min="0" required
              className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Unit">
            <select name="unit_id" required className={inputClass} style={inputStyle}
              defaultValue={ingredient.base_unit_id}>
              {usable.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
              {needsConversion.length > 0 && (
                <optgroup label="Needs a conversion first">
                  {needsConversion.map((u) => (
                    <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Amount paid (₦)">
            <input name="amount" type="number" step="0.01" min="0" required
              className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Date">
            <input name="effective_date" type="date" className={inputClass} style={inputStyle} />
          </Field>
          <Submit>Record</Submit>
        </form>

        {latest && (
          <Card>
            <div className="text-sm">
              Latest unit cost:{' '}
              <span className="font-medium tabular-nums">
                {money(Number(latest.unit_cost))} per {baseCode}
              </span>
            </div>
          </Card>
        )}

        <DataList
          rows={prices ?? []}
          keyOf={(p) => p.id}
          empty="No purchase recorded yet. Until one is, recipes using this item cannot be costed."
          render={(p) => [
            { label: 'Date', value: p.effective_date },
            { label: 'Quantity', value: quantity(Number(p.qty_base), baseCode) },
            { label: 'Paid', value: money(Number(p.amount)) },
            { label: 'Unit cost', value: `${money(Number(p.unit_cost))} / ${baseCode}` },
          ]}
        />
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionHeading sub={`How much ${baseCode} one of these holds — for this item only.`}>
          Local measurements
        </SectionHeading>

        <form action={addConversion} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <input type="hidden" name="ingredient_id" value={ingredient.id} />
          <Field label="One of this unit…">
            <select name="unit_id" required className={inputClass} style={inputStyle}>
              {(units ?? [])
                .filter((u) => u.id !== ingredient.base_unit_id && !converted.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                ))}
            </select>
          </Field>
          <Field label={`…holds this much ${baseCode}`}>
            <input name="qty_in_base" type="number" step="any" min="0" required
              className={inputClass} style={inputStyle} />
          </Field>
          <Submit>Save conversion</Submit>
        </form>

        {conversions && conversions.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {conversions.map((c) => (
              <li key={c.id}>
                1 {unitById.get(c.unit_id)?.code ?? '?'} ={' '}
                <span className="tabular-nums">{Number(c.qty_in_base)}</span> {baseCode}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No local measurements yet. If you buy this in paints, dericas, bags or baskets, tell us how much one holds — it is different for every ingredient.</Empty>
        )}
      </section>
    </div>
  )
}
