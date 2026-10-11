import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requiredAmount } from '@/lib/money-input'
import { createClient } from '@/lib/supabase/server'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, inputClass, inputStyle,
  DataList, Notice, SectionHeading, BackLink, Empty, Disclosure,
} from '@/components/ui'
import Link from 'next/link'
import { money, quantity, NOT_ENTERED } from '@/lib/format'
import { localToday, formatDay } from '@/lib/dates'

export const dynamic = 'force-dynamic'

type Unit = { id: string; code: string; name: string; kind: string; factor_to_base: number | null; is_base: boolean }
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
      'Menu Master does not know how much one of those holds yet — and it ' +
      'will not guess, because a paint of rice and a paint of garri are ' +
      'different weights. Add the measure below, then record this purchase ' +
      'again.'))
  }

  // THROUGH THE LEDGER, NOT AROUND IT.
  //
  // Writing ingredient_prices directly produced a row with no purchase_line_id,
  // which fn_reverse_purchase cannot reverse -- a price the owner could never
  // undo. fn_post_purchase is the only path that sets source='purchase' and
  // links the line, and it carries the checks this screen must not duplicate:
  // role enforcement, draft-only posting (so a double submit cannot post
  // twice), zero-value refusal, and conversion blockers.
  const date = effective || localToday()

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
      ? 'We still need to know how much one of those holds. Add the measure below, then record this purchase again.'
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
    redirect(withNotice(here, 'Enter how much one of these holds. It must be greater than zero.'))
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

/**
 * A measure typed wrong -- "1 paint = 400 g" for 4,000 -- used to be
 * permanent: the unit left the dropdown once it had a conversion. Editing it
 * in place fires the 0008 recompute trigger, so every dish that uses the
 * measure is re-costed from the corrected figure.
 */
async function updateConversion(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const here = `/ingredients/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const qtyInBase = Number(formData.get('qty_in_base'))
  if (!Number.isFinite(qtyInBase) || qtyInBase <= 0) {
    redirect(withNotice(here, 'Enter how much one of these holds. It must be greater than zero.'))
  }
  const { error } = await supabase.from('ingredient_unit_conversions')
    .update({ qty_in_base: qtyInBase }).eq('id', String(formData.get('conversion_id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Measure updated. Dishes using it have been re-costed.'))
}

async function removeConversion(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const here = `/ingredients/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('ingredient_unit_conversions')
    .delete().eq('id', String(formData.get('conversion_id') ?? ''))
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error)
    ?? 'Measure removed. Anything recorded in it is costed again once you add a new one.'))
}

/**
 * The item itself. The base unit is locked by the database (0060) once a
 * purchase or recipe line is measured in it; the form only offers the change
 * while it is still free.
 */
async function updateIngredient(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const here = `/ingredients/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'Give the item a name.'))
  const yieldRaw = String(formData.get('purchase_yield_pct') ?? '').trim()
  const yieldPct = yieldRaw === '' ? 100 : Number(yieldRaw)
  if (!Number.isFinite(yieldPct) || yieldPct <= 0 || yieldPct > 100) {
    redirect(withNotice(here, 'Usable after cleaning is a percentage between 1 and 100.'))
  }
  const patch: Record<string, unknown> = {
    name,
    kind: formData.get('kind') === 'packaging' ? 'packaging' : 'ingredient',
    purchase_yield_pct: yieldPct,
  }
  const baseUnit = String(formData.get('base_unit_id') ?? '')
  if (baseUnit) patch.base_unit_id = baseUnit

  const { error } = await supabase.from('ingredients').update(patch).eq('id', id)
  revalidatePath(here)
  revalidatePath('/ingredients')
  redirect(withNotice(here, error
    ? (error.code === '23505'
        ? `You already have an item called “${name}”.`
        : error.code === '23514' && /measure/i.test(error.message)
          ? 'Its measure cannot change: purchases or recipes are already recorded in it.'
          : describeWriteError(error))
    : 'Item updated.'))
}

/** Put away, never deleted: purchases and recipe lines keep pointing at it. */
async function archiveIngredient(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('ingredients')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id)
    .select('name').maybeSingle<{ name: string }>()
  if (error) redirect(withNotice(`/ingredients/${id}`, describeWriteError(error)))
  revalidatePath('/ingredients')
  redirect(withNotice('/ingredients', `${data?.name ?? 'The item'} has been put away. Find it under “Put away” to bring it back.`))
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
      supabase.from('units').select('id,code,name,kind,factor_to_base,is_base').order('kind').order('code')
        .returns<Unit[]>(),
      supabase.from('ingredient_prices')
        .select('id,qty_base,amount,unit_cost,effective_date,source,supplier_id')
        .eq('ingredient_id', id)
        // A cancelled purchase keeps its price row with reversed_at set. The
        // ingredients list already skipped those; this page did not, so a
        // cancelled receipt could stand as "Latest price".
        .is('reversed_at', null)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false })
        .returns<Price[]>(),
      supabase.from('ingredient_unit_conversions').select('id,unit_id,qty_in_base')
        .eq('ingredient_id', id).returns<Conversion[]>(),
      supabase.from('v_missing_unit_conversions')
        // Only measures something actually uses. 'suggested' rows are the starter
        // list's ideas (a crate of eggs), not a blocker, and must not read as one.
        .select('ingredient_id,unit_code,reason').eq('ingredient_id', id).neq('reason', 'suggested')
        .returns<{ ingredient_id: string; unit_code: string; reason: string }[]>(),
    ])

  // The base unit is free to change only while nothing is measured in it
  // (the 0060 trigger refuses otherwise). Counted here so the form can say so
  // instead of offering a change the database will refuse.
  const [{ count: priceRows }, { count: lineRows }] = await Promise.all([
    supabase.from('ingredient_prices').select('id', { count: 'exact', head: true }).eq('ingredient_id', id),
    supabase.from('recipe_lines').select('id', { count: 'exact', head: true }).eq('ingredient_id', id),
  ])
  const measureLocked = (priceRows ?? 0) > 0 || (lineRows ?? 0) > 0

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
      <BackLink href="/ingredients">All ingredients</BackLink>

      <PageHeader
        title={ingredient.name}
        sub={`${ingredient.kind === 'packaging' ? 'Packaging' : 'Ingredient'}, measured in ${base?.name.toLowerCase() ?? baseCode}.` +
          (ingredient.purchase_yield_pct !== null ? ` Usable after cleaning: ${ingredient.purchase_yield_pct}%.` : '')}
      />

      {notice && <Notice tone={/could not|not know|cannot|already|give the|between/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Disclosure summary="Edit this item">
        <form action={updateIngredient} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <input type="hidden" name="ingredient_id" value={ingredient.id} />
          <div className="sm:col-span-2">
            <Field label="Name">
              <input name="name" required maxLength={120} defaultValue={ingredient.name}
                className={inputClass} style={inputStyle} />
            </Field>
          </div>
          <Field label="What is it?">
            <select name="kind" defaultValue={ingredient.kind} className={inputClass} style={inputStyle}>
              <option value="ingredient">Something you cook with</option>
              <option value="packaging">Packaging</option>
            </select>
          </Field>
          <Field label="Usable after cleaning (%)">
            <input name="purchase_yield_pct" type="number" step="any" min="1" max="100" inputMode="decimal"
              defaultValue={ingredient.purchase_yield_pct ?? 100} className={inputClass} style={inputStyle} />
          </Field>
          {measureLocked ? (
            <p className="sm:col-span-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
              Measured in <strong>{base?.name.toLowerCase() ?? baseCode}</strong>. That cannot change now:
              purchases or recipes are already recorded in it. Put this item away and add a new one if it was wrong.
            </p>
          ) : (
            <div className="sm:col-span-3">
              <Field label="Measured in">
                <select name="base_unit_id" defaultValue={ingredient.base_unit_id} className={inputClass} style={inputStyle}>
                  {(units ?? []).filter((u) => u.is_base || u.id === ingredient.base_unit_id).map((u) => (
                    <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="flex items-end"><Submit>Save changes</Submit></div>
          <p className="sm:col-span-4 text-xs" style={{ color: 'var(--mm-muted)' }}>
            “Usable after cleaning” is what is left after peeling, boning or trimming:
            a yam that loses 30% to the peel is 70%. Leave it at 100 if nothing is thrown away.
          </p>
        </form>
      </Disclosure>

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
        <p className="text-sm">
          <Link href={`/purchases/new?ingredient=${ingredient.id}`} className="mm-tap underline">
            Bought several things on one trip? Record them together →
          </Link>
        </p>

        {latest && (
          <Card>
            <div className="text-sm">
              Latest price:{' '}
              <span className="font-medium tabular-nums">
                {baseCode === 'g' ? `${money(Number(latest.unit_cost) * 1000)} per kg`
                  : baseCode === 'ml' ? `${money(Number(latest.unit_cost) * 1000)} per litre`
                  : baseCode === 'unit' ? `${money(Number(latest.unit_cost))} each`
                  : `${money(Number(latest.unit_cost))} per ${baseCode}`}
              </span>
            </div>
          </Card>
        )}

        <DataList
          rows={prices ?? []}
          keyOf={(p) => p.id}
          empty="No purchase recorded yet. Until one is, recipes using this item cannot be costed."
          render={(p) => [
            { label: 'Date', value: formatDay(p.effective_date) },
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

        <Disclosure summary="Add a local measure (paint, derica, bag…)" open={(conversions ?? []).length === 0}>
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
        </Disclosure>

        {conversions && conversions.length > 0 ? (
          <ul className="space-y-2">
            {conversions.map((c) => (
              <li key={c.id}>
                <Card>
                  <p className="text-sm">
                    1 {unitById.get(c.unit_id)?.code ?? '?'} ={' '}
                    <span className="tabular-nums">{Number(c.qty_in_base)}</span> {baseCode}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <Disclosure summary="Edit">
                      <form action={updateConversion} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="ingredient_id" value={ingredient.id} />
                        <input type="hidden" name="conversion_id" value={c.id} />
                        <label className="block">
                          <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>1 {unitById.get(c.unit_id)?.code ?? '?'} holds this much {baseCode}</span>
                          <input name="qty_in_base" type="number" step="any" min="0" inputMode="decimal"
                            defaultValue={Number(c.qty_in_base)}
                            className="mt-1 w-32 rounded border px-2 py-2 text-base" />
                        </label>
                        <InlineSubmit>Update</InlineSubmit>
                      </form>
                    </Disclosure>
                    <form action={removeConversion}>
                      <input type="hidden" name="ingredient_id" value={ingredient.id} />
                      <input type="hidden" name="conversion_id" value={c.id} />
                      <InlineSubmit>Remove</InlineSubmit>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No local measurements yet. If you buy this in paints, dericas, bags or baskets, tell us how much one holds — it is different for every ingredient.</Empty>
        )}
      </section>

      <Disclosure summary="Put this item away">
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          It leaves your ingredient list and the purchase screen. Dishes and purchases
          that already use it keep it, and you can bring it back from the Ingredients page.
        </p>
        <form action={archiveIngredient} className="mt-2">
          <input type="hidden" name="ingredient_id" value={ingredient.id} />
          <InlineSubmit>Put this item away</InlineSubmit>
        </form>
      </Disclosure>
    </div>
  )
}
