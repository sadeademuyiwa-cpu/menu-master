import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { requiredAmount } from '@/lib/money-input'
import {
  currentContext, contextRedirect, describeWriteError, withNotice, closedRefusal, refusalNotice, writeNotice,
} from '@/lib/data/context'
import {
  PageHeader, Field, Submit, InlineSubmit, inputClass, inputStyle,
  Notice, SectionHeading, BackLink, Empty, Disclosure,
} from '@/components/ui'
import { Sparkline } from '@/components/charts'
import { ConfirmSubmit } from '@/components/confirm-submit'
import { money, percent, quantity, NOT_ENTERED } from '@/lib/format'
import { localToday, formatDay } from '@/lib/dates'
import { canSeeCosts } from '@/lib/pricing'
import { canAddMeasures, canEditItems, canRecordPurchases, canRemoveMeasures } from '../../purchases/buy-roles'
import { dayShort, inSentence, perBuyingUnit, priceTrend, sinceWords, trendWords } from '../../purchases/buy-figures'
import { writeMeasure } from '../measure'
import { Info } from '../info'
import '../../purchases/buy.css'

export const dynamic = 'force-dynamic'

type Unit = { id: string; code: string; name: string; kind: string; factor_to_base: number | null; is_base: boolean }
type Price = {
  id: string; qty_base: string; amount: string; unit_cost: string
  effective_date: string; source: string; supplier_id: string | null; purchase_line_id: string | null
}
type Conversion = { id: string; unit_id: string; qty_in_base: string }
/** fn_ingredient_cost_basis (0026): the price every dish is costed at now, and where it came from. */
type Basis = {
  unit_cost: number | string | null; basis: string; purchase_count: number | null
  from_date: string | null; to_date: string | null
}

/** Purchases shown before "Older purchases"; and points on the price line. */
const RECENT = 6
const TREND_POINTS = 8

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
  // Recording a purchase is closed after a trial (D3); say why, plainly.
  const closed = await closedRefusal(ctx.role)
  if (closed) redirect(withNotice(here, closed))

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

  // The same write as "How much is one paint of rice?" on the purchase screen.
  const { error } = await writeMeasure(supabase, {
    accountId, ingredientId: id, unitId: String(formData.get('unit_id') ?? ''), qtyInBase,
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
  // .select: a refused update is not an error, only zero rows (writeNotice).
  const { data, error } = await supabase.from('ingredient_unit_conversions')
    .update({ qty_in_base: qtyInBase }).eq('id', String(formData.get('conversion_id') ?? '')).select('id')
  revalidatePath(here)
  redirect(withNotice(here, await writeNotice(error, data, 'Measure updated. Dishes using it have been re-costed.', ctx.role)))
}

async function removeConversion(formData: FormData) {
  'use server'
  const id = String(formData.get('ingredient_id') ?? '')
  const here = `/ingredients/${id}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('ingredient_unit_conversions')
    .delete().eq('id', String(formData.get('conversion_id') ?? '')).select('id')
  revalidatePath(here)
  redirect(withNotice(here, await writeNotice(error, data,
    'Measure removed. Anything recorded in it is costed again once you add a new one.', ctx.role)))
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

  const { data, error } = await supabase.from('ingredients').update(patch).eq('id', id).select('id')
  revalidatePath(here)
  revalidatePath('/ingredients')
  redirect(withNotice(here, error?.code === '23505'
    ? `You already have an item called “${name}”.`
    : error?.code === '23514' && /measure/i.test(error.message)
      ? 'Its measure cannot change: purchases or dishes are already recorded in it.'
      : await writeNotice(error, data, 'Item updated.', ctx.role)))
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
  // No row back: refused quietly, so it is not put away. Say so on its page.
  if (!data) redirect(withNotice(`/ingredients/${id}`, await refusalNotice(ctx.role)))
  revalidatePath('/ingredients')
  redirect(withNotice('/ingredients', `${data.name} has been put away. Find it under “Put away” to bring it back.`))
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------


/** Where the current price comes from, in one short line. */
function basisWords(b: Basis): string {
  const n = b.purchase_count ?? 0
  if (b.basis === 'purchase_window') {
    return n > 1 ? `average of your last ${n} purchases` : `from your purchase ${inSentence(formatDay(b.to_date))}`
  }
  if (b.basis === 'purchase_latest') return `from your last purchase, ${inSentence(formatDay(b.to_date))}. It may be old`
  if (b.basis === 'manual') return 'an estimate you typed, not a purchase'
  return ''
}

export default async function IngredientDetail(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await props.params
  const { notice } = await props.searchParams
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, `/ingredients/${id}`))
  const { supabase, businessId } = ctx

  // Ingredient prices are costs (fn_can_see_costs, 0004): for sales and
  // kitchen no price, purchase amount or cost is asked for at all, so none
  // can reach their phone. The forms follow what each role may write (0015).
  const costs = canSeeCosts(ctx.role)
  const canBuy = canRecordPurchases(ctx.role)
  const canEdit = canEditItems(ctx.role)
  const canMeasure = canAddMeasures(ctx.role)
  const canRemove = canRemoveMeasures(ctx.role)

  const { data: ingredient } = await supabase
    .from('ingredients')
    .select('id,name,kind,base_unit_id,purchase_yield_pct,is_active')
    .eq('id', id).is('deleted_at', null).maybeSingle()

  if (!ingredient) notFound()

  const [{ data: units }, { data: prices }, { data: conversions }, { data: missing }, { data: basisRow }] =
    await Promise.all([
      supabase.from('units').select('id,code,name,kind,factor_to_base,is_base').order('kind').order('code')
        .returns<Unit[]>(),
      costs
        ? supabase.from('ingredient_prices')
            .select('id,qty_base,amount,unit_cost,effective_date,source,supplier_id,purchase_line_id')
            .eq('ingredient_id', id)
            // A cancelled purchase keeps its price row with reversed_at set. The
            // ingredients list already skipped those; this page did not, so a
            // cancelled receipt could stand as "Latest price".
            .is('reversed_at', null)
            .order('effective_date', { ascending: false })
            .order('created_at', { ascending: false })
            .returns<Price[]>()
        : Promise.resolve({ data: null }),
      supabase.from('ingredient_unit_conversions').select('id,unit_id,qty_in_base')
        .eq('ingredient_id', id).returns<Conversion[]>(),
      supabase.from('v_missing_unit_conversions')
        // Only measures something actually uses. 'suggested' rows are the starter
        // list's ideas (a crate of eggs), not a blocker, and must not read as one.
        .select('ingredient_id,unit_code,reason').eq('ingredient_id', id).neq('reason', 'suggested')
        .returns<{ ingredient_id: string; unit_code: string; reason: string }[]>(),
      // The engine's own current price, so this page and every dish agree.
      costs && businessId
        ? supabase.rpc('fn_ingredient_cost_basis', { p_ingredient_id: id, p_business_id: businessId })
        : Promise.resolve({ data: null }),
    ])

  // The base unit is free to change only while nothing is measured in it
  // (the 0060 trigger refuses otherwise). Counted here so the form can say so
  // instead of offering a change the database will refuse. Purchase lines are
  // counted too: ingredient prices are hidden from kitchen, and without them
  // a cook was offered a change the database would refuse.
  const [{ count: priceRows }, { count: lineRows }, { count: boughtRows }] = await Promise.all([
    costs
      ? supabase.from('ingredient_prices').select('id', { count: 'exact', head: true }).eq('ingredient_id', id)
      : Promise.resolve({ count: 0 }),
    supabase.from('recipe_lines').select('id', { count: 'exact', head: true }).eq('ingredient_id', id),
    supabase.from('purchase_lines').select('id', { count: 'exact', head: true }).eq('ingredient_id', id),
  ])
  const measureLocked = (priceRows ?? 0) > 0 || (lineRows ?? 0) > 0 || (boughtRows ?? 0) > 0

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

  // ---- the price, for a role that may see it ------------------------------
  const history = prices ?? []
  const basis = (Array.isArray(basisRow) ? basisRow[0] : basisRow) as Basis | null
  const current = basis && basis.unit_cost !== null && basis.unit_cost !== undefined ? Number(basis.unit_cost) : null
  const currentPer = current !== null && Number.isFinite(current) ? perBuyingUnit(current, base?.code) : null
  const yieldPct = Number(ingredient.purchase_yield_pct ?? 100)
  let usablePer: { value: number; per: string } | null = null
  if (currentPer && businessId && yieldPct < 100) {
    const { data } = await supabase.rpc('fn_ingredient_usable_unit_cost', { p_ingredient_id: id, p_business_id: businessId })
    const v = data === null || data === undefined ? NaN : Number(data)
    if (Number.isFinite(v)) usablePer = perBuyingUnit(v, base?.code)
  }

  // "Rice up 8% since September": her own purchases only, oldest first. No
  // sentence and no line with fewer than three, because two are not a trend.
  const bought = history.filter((p) => p.source === 'purchase').slice(0, TREND_POINTS).reverse()
  const points = bought.map((p) => perBuyingUnit(Number(p.unit_cost), base?.code).value)
  const trend = priceTrend(bought.map((p, i) => ({ day: p.effective_date, price: points[i] })))
  const today = localToday()

  // What each purchase was bought as ("2 paint"), and from whom.
  const lineIds = history.map((p) => p.purchase_line_id).filter((x): x is string => !!x)
  const supplierIds = [...new Set(history.map((p) => p.supplier_id).filter((x): x is string => !!x))]
  const [{ data: lines }, { data: suppliers }] = await Promise.all([
    lineIds.length
      ? supabase.from('purchase_lines').select('id,qty,unit_id').in('id', lineIds.slice(0, 100))
          .returns<{ id: string; qty: string; unit_id: string }[]>()
      : Promise.resolve({ data: null }),
    supplierIds.length
      ? supabase.from('suppliers').select('id,name').in('id', supplierIds)
          .returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: null }),
  ])
  const lineOf = new Map((lines ?? []).map((l) => [l.id, l]))
  const supplierOf = new Map((suppliers ?? []).map((s) => [s.id, s.name]))
  /** "2 paint (8 kg)" for a local measure, "10 kg" otherwise. */
  const boughtAs = (p: Price) => {
    const inBase = quantity(Number(p.qty_base), base?.code ?? null)
    const line = p.purchase_line_id ? lineOf.get(p.purchase_line_id) : undefined
    const unit = line ? unitById.get(line.unit_id) : undefined
    if (!line || !unit || unit.factor_to_base !== null) return inBase
    return `${quantity(Number(line.qty), unit.code)} (${inBase})`
  }

  const historyRow = (p: Price) => {
    const per = perBuyingUnit(Number(p.unit_cost), base?.code)
    const from = p.supplier_id ? supplierOf.get(p.supplier_id) : undefined
    return (
      <li key={p.id}>
        <div className="mm-buy-row">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {formatDay(p.effective_date)}{from ? ` · ${from}` : ''}
              {p.source !== 'purchase' && <span style={{ color: 'var(--mm-muted)' }}> · estimate</span>}
            </span>
            <span className="block text-sm" style={{ color: 'var(--mm-muted)' }}>
              {boughtAs(p)} for <span className="mm-num">{money(p.amount)}</span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="mm-num block font-semibold">{money(per.value)}</span>
            <span className="block text-xs" style={{ color: 'var(--mm-muted)' }}>{per.per}</span>
          </span>
        </div>
      </li>
    )
  }

  const measuredIn = base?.name.toLowerCase() ?? baseCode

  return (
    <div className="space-y-6">
      <BackLink href="/ingredients">Ingredients</BackLink>

      <PageHeader
        title={ingredient.name}
        icon="ingredients"
        sub={`${ingredient.kind === 'packaging' ? 'Packaging' : 'Ingredient'}, measured in ${measuredIn}.` +
          (yieldPct < 100 ? ` Usable after cleaning: ${yieldPct}%.` : '')}
      />

      {notice && <Notice tone={/could not|not know|cannot|already|give the|between/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {missing && missing.length > 0 && (
        <Notice>
          A dish or purchase uses {missing.map((m) => m.unit_code).join(', ')} for this item. Say how
          much {baseCode} one holds under Local measurements, and it can be costed.
        </Notice>
      )}

      {/* ------------------------------------------------------------------ */}
      {costs && (
        <section className="mm-card" aria-label="Current price">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
            Current price
          </div>
          {currentPer && current !== null ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="mm-num mm-buy-hero">{money(currentPer.value)}</span>
                <span className="text-sm" style={{ color: 'var(--mm-muted)' }}>{currentPer.per}</span>
              </div>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                <span className="mm-num">{money(current)}</span> per {baseCode}
                {basisWords(basis as Basis) ? ` · ${basisWords(basis as Basis)}` : ''}
              </p>
              {usablePer && (
                <p className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                  {yieldPct}% usable after cleaning, so <span className="mm-num">{money(usablePer.value)}</span> {usablePer.per} usable
                </p>
              )}
              {trend && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--mm-line)' }}>
                  <p className="min-w-0 text-sm font-medium">
                    {ingredient.name} {trendWords(trend.change, percent)} since {sinceWords(trend.since, today)}
                  </p>
                  <Sparkline
                    className="shrink-0"
                    points={points}
                    labels={bought.map((p) => dayShort(p.effective_date))}
                    ariaLabel={`Price of ${ingredient.name} ${currentPer.per}, your last ${points.length} purchases.`}
                    width={96} height={32}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-1 text-lg font-semibold">No price yet</div>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                Record what you paid and every dish using it is costed.
              </p>
            </>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {canBuy && (
        <section className="space-y-3">
          <SectionHeading sub="What you actually paid, the way you bought it: 2 paint for ₦9,000. Menu Master never supplies a price.">
            Record a purchase
          </SectionHeading>

          <form action={addPrice} className="mm-card grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="ingredient_id" value={ingredient.id} />
            <Field label="Quantity bought">
              <input name="qty" type="number" step="any" min="0" required inputMode="decimal"
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
              <input name="amount" type="number" step="0.01" min="0" required inputMode="decimal"
                className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Date">
              <input name="effective_date" type="date" className={inputClass} style={inputStyle} />
            </Field>
            <div className="col-span-2 sm:col-span-1"><Submit>Record</Submit></div>
          </form>
          <p className="text-sm">
            <Link href={`/purchases/new?ingredient=${ingredient.id}`} className="mm-tap underline">
              Bought several things on one trip? Record them together →
            </Link>
          </p>
        </section>
      )}

      {costs && (
        <section className="space-y-3">
          <SectionHeading>Price history</SectionHeading>
          {history.length === 0 ? (
            <Empty>No purchase recorded yet. Until one is, dishes using this item cannot be costed.</Empty>
          ) : (
            <>
              <ul className="mm-buy-rows">{history.slice(0, RECENT).map(historyRow)}</ul>
              {history.length > RECENT && (
                <Disclosure summary={`Older purchases (${history.length - RECENT})`}>
                  <ul className="mm-buy-rows">{history.slice(RECENT).map(historyRow)}</ul>
                </Disclosure>
              )}
            </>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionHeading sub={`How much ${baseCode} one paint, derica or bag of this item holds. It is different for every item, so only you can say.`}>
          Local measurements
        </SectionHeading>

        {conversions && conversions.length > 0 ? (
          <ul className="mm-buy-rows">
            {conversions.map((c) => {
              const code = unitById.get(c.unit_id)?.code ?? '?'
              return (
                <li key={c.id} className="px-[.9rem] py-2">
                  <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <p className="font-medium">
                      1 {code} = <span className="mm-num">{Number(c.qty_in_base)}</span> {baseCode}
                    </p>
                    {canRemove && (
                      <form action={removeConversion}>
                        <input type="hidden" name="ingredient_id" value={ingredient.id} />
                        <input type="hidden" name="conversion_id" value={c.id} />
                        <ConfirmSubmit message={`Remove the ${code} measure? Anything recorded in it cannot be costed until you add it again.`}>Remove</ConfirmSubmit>
                      </form>
                    )}
                  </div>
                  {canMeasure && (
                    <Disclosure summary="Edit">
                      <form action={updateConversion} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="ingredient_id" value={ingredient.id} />
                        <input type="hidden" name="conversion_id" value={c.id} />
                        <label className="block">
                          <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>1 {code} holds this much {baseCode}</span>
                          <input name="qty_in_base" type="number" step="any" min="0" inputMode="decimal"
                            defaultValue={Number(c.qty_in_base)} className="mm-input mt-1" style={{ width: '8rem' }} />
                        </label>
                        <InlineSubmit>Update</InlineSubmit>
                      </form>
                    </Disclosure>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty>None yet. Bought in paints, dericas, bags or baskets? Say how much one holds.</Empty>
        )}

        {canMeasure && (
          <Disclosure summary="Add a local measure (paint, derica, bag…)" open={(conversions ?? []).length === 0 && (missing ?? []).length > 0}>
            <form action={addConversion} className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:items-end">
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
                <input name="qty_in_base" type="number" step="any" min="0" required inputMode="decimal"
                  className={inputClass} style={inputStyle} />
              </Field>
              <div className="col-span-2 sm:col-span-1"><Submit>Save conversion</Submit></div>
            </form>
          </Disclosure>
        )}
      </section>

      {canEdit && (
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
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="purchase_yield_pct" className="text-sm font-medium">Usable after cleaning (%)</label>
                <Info label="About usable after cleaning">
                  What is left after peeling, boning or trimming: a yam that loses 30% to the peel is 70%.
                  Leave it at 100 if nothing is thrown away.
                </Info>
              </div>
              <input id="purchase_yield_pct" name="purchase_yield_pct" type="number" step="any" min="1" max="100" inputMode="decimal"
                defaultValue={ingredient.purchase_yield_pct ?? 100} className={inputClass} style={inputStyle} />
            </div>
            {measureLocked ? (
              <p className="sm:col-span-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                Measured in <strong>{measuredIn}</strong>. That cannot change now:
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
          </form>
        </Disclosure>
      )}

      {canEdit && (
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
      )}
    </div>
  )
}
