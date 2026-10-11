import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty, SectionHeading, Disclosure,
} from '@/components/ui'
import { money, NOT_ENTERED } from '@/lib/format'
import { BUSINESS_TYPES, isBusinessType } from '@/lib/business-types'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * After a wage, a bill or a pricing setting changes, every dish of the
 * business is costed again -- one call, one snapshot per dish (0060). Nothing
 * in the schema recomputes on these tables, so without this the change would
 * show only after the next unrelated purchase.
 *
 * Before 0060 the function does not exist (42883): the change is still saved,
 * and the owner is told to open a dish to refresh it.
 */
async function recomputeAll(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('fn_recompute_business_recipes', { p_business_id: businessId })
  if (error) {
    return error.code === '42883'
      ? ' Open a dish and change any quantity to refresh its cost.'
      : ` Your dishes could not be re-costed: ${describeWriteError(error) ?? error.message}`
  }
  const n = Number(data ?? 0)
  return n > 0 ? ` ${n} dish${n === 1 ? '' : 'es'} re-costed.` : ''
}

type Rate = { id: string; name: string; rate_per_hour: string | null; is_active: boolean }
type Overhead = {
  id: string; name: string; monthly_cost: string | null; is_active: boolean
  basis_qty: string | null
  basis_unit: { code: string; name: string } | null
}
type Settings = {
  overhead_enabled: boolean
  overhead_basis_qty: string | null
  overhead_basis_unit_id: string | null
  default_target_margin: string | null; price_rounding_to: string | null
  show_markup_alongside: boolean
  wavg_window_days: number | null
}

async function addRate(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, '/settings'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/settings', 'Give this kind of work a name.'))

  const raw = String(formData.get('rate_per_hour') ?? '').trim()
  const rate = raw === '' ? null : Number(raw)
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
    redirect(withNotice('/settings', 'An hourly rate cannot be negative.'))
  }
  // NULL is allowed and meaningful: the business knows it pays for this work
  // but has not said how much. The engine treats that as incomplete, never
  // as free.
  const { error } = await supabase.from('labour_rates').insert({
    account_id: accountId, business_id: businessId, name, rate_per_hour: rate,
  })
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Kind of work added.'))
}

async function addOverhead(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, '/settings'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/settings', 'Give this running cost a name.'))

  const raw = String(formData.get('monthly_cost') ?? '').trim()
  const cost = raw === '' ? null : Number(raw)
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    redirect(withNotice('/settings', 'A monthly cost cannot be negative.'))
  }

  // Each running cost says how much output it is spread across. A soup
  // kitchen that also bakes splits its bills between litres and kilograms;
  // each naira belongs to one line and is spread one way, so nothing is ever
  // counted twice. Left blank, the line falls back to the business default.
  const qRaw = String(formData.get('basis_qty') ?? '').trim()
  const uRaw = String(formData.get('basis_unit_id') ?? '')
  const bQty = qRaw === '' ? null : Number(qRaw)
  if (bQty !== null && (!Number.isFinite(bQty) || bQty <= 0)) {
    redirect(withNotice('/settings', 'How much this is spread across must be more than zero.'))
  }
  if ((bQty === null) !== (uRaw === '')) {
    redirect(withNotice('/settings', 'Give both an amount and its unit, or leave both blank.'))
  }

  const { error } = await supabase.from('overhead_items').insert({
    account_id: accountId, business_id: businessId, name, monthly_cost: cost,
    basis_qty: bQty, basis_unit_id: uRaw || null,
  })
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Running cost added.'))
}

async function saveOverheadSettings(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  if (!businessId) redirect(contextRedirect(ctx, '/settings'))

  // The engine (fn_overhead_rate, 0023) spreads running costs over HOW MUCH
  // YOU PRODUCE, expressed as a quantity and a unit -- litres of soup, kilos
  // of bread. Not "servings", which the schema no longer uses: the older
  // expected_monthly_units column is superseded and read by nothing.
  const raw = String(formData.get('overhead_basis_qty') ?? '').trim()
  const unitRaw = String(formData.get('overhead_basis_unit_id') ?? '')
  const qty = raw === '' ? null : Number(raw)
  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
    redirect(withNotice('/settings', 'How much you produce in a month must be more than zero.'))
  }
  // A quantity without its unit cannot be converted to a recipe's yield unit,
  // so the engine would have no rate. Both or neither.
  if ((qty === null) !== (unitRaw === '')) {
    redirect(withNotice('/settings', 'Give both how much you produce and its unit, or neither.'))
  }
  const { error } = await supabase.from('business_settings').update({
    overhead_enabled: formData.get('overhead_enabled') === 'on',
    overhead_basis_qty: qty,
    overhead_basis_unit_id: unitRaw || null,
  }).eq('business_id', businessId)
  if (error) redirect(withNotice('/settings', describeWriteError(error)))
  const note = await recomputeAll(supabase, businessId)
  revalidatePath('/settings')
  redirect(withNotice('/settings', `Saved.${note}`))
}

async function deactivateRate(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('labour_rates')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? ''))
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Hidden. Recipes that use it keep it.'))
}

async function restoreRate(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase } = ctx
  const { error } = await supabase.from('labour_rates')
    .update({ is_active: true }).eq('id', String(formData.get('id') ?? ''))
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Shown again.'))
}

/** A changed wage reaches every dish that uses it, at once. */
async function updateRate(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  if (!businessId) redirect(contextRedirect(ctx, '/settings'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/settings', 'Give this kind of work a name.'))
  const raw = String(formData.get('rate_per_hour') ?? '').trim()
  const rate = raw === '' ? null : Number(raw)
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
    redirect(withNotice('/settings', 'An hourly rate cannot be negative.'))
  }
  const { error } = await supabase.from('labour_rates')
    .update({ name, rate_per_hour: rate }).eq('id', String(formData.get('id') ?? ''))
  if (error) redirect(withNotice('/settings', describeWriteError(error)))
  const note = await recomputeAll(supabase, businessId)
  revalidatePath('/settings')
  redirect(withNotice('/settings', `Kind of work updated.${note}`))
}

async function deactivateOverhead(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  const { error } = await supabase.from('overhead_items')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? ''))
  if (error) redirect(withNotice('/settings', describeWriteError(error)))
  const note = businessId ? await recomputeAll(supabase, businessId) : ''
  revalidatePath('/settings')
  redirect(withNotice('/settings', `Hidden.${note}`))
}

async function restoreOverhead(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  const { error } = await supabase.from('overhead_items')
    .update({ is_active: true }).eq('id', String(formData.get('id') ?? ''))
  if (error) redirect(withNotice('/settings', describeWriteError(error)))
  const note = businessId ? await recomputeAll(supabase, businessId) : ''
  revalidatePath('/settings')
  redirect(withNotice('/settings', `Shown again.${note}`))
}

async function updateOverhead(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  if (!businessId) redirect(contextRedirect(ctx, '/settings'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/settings', 'Give this running cost a name.'))
  const raw = String(formData.get('monthly_cost') ?? '').trim()
  const cost = raw === '' ? null : Number(raw)
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    redirect(withNotice('/settings', 'A monthly cost cannot be negative.'))
  }
  const qRaw = String(formData.get('basis_qty') ?? '').trim()
  const uRaw = String(formData.get('basis_unit_id') ?? '')
  const bQty = qRaw === '' ? null : Number(qRaw)
  if (bQty !== null && (!Number.isFinite(bQty) || bQty <= 0)) {
    redirect(withNotice('/settings', 'How much this is spread across must be more than zero.'))
  }
  if ((bQty === null) !== (uRaw === '')) {
    redirect(withNotice('/settings', 'Give both an amount and its unit, or leave both blank.'))
  }
  const { error } = await supabase.from('overhead_items').update({
    name, monthly_cost: cost, basis_qty: bQty, basis_unit_id: uRaw || null,
  }).eq('id', String(formData.get('id') ?? ''))
  if (error) redirect(withNotice('/settings', describeWriteError(error)))
  const note = await recomputeAll(supabase, businessId)
  revalidatePath('/settings')
  redirect(withNotice('/settings', `Running cost updated.${note}`))
}

/**
 * Target margin, rounding and the price window. These lived in
 * business_settings with no screen; the owner saw "40%" and could not change
 * it. RLS lets an owner update the row (0015).
 */
async function savePricing(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  if (!businessId) redirect(contextRedirect(ctx, '/settings'))
  const margin = Number(formData.get('default_target_margin'))
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) {
    redirect(withNotice('/settings', 'A target margin is a percentage from 0 to 99.'))
  }
  const rounding = Number(formData.get('price_rounding_to'))
  if (!Number.isFinite(rounding) || rounding <= 0) {
    redirect(withNotice('/settings', 'Round prices up to an amount above zero — ₦10, ₦50, ₦100.'))
  }
  const window = Number(formData.get('wavg_window_days'))
  if (!Number.isInteger(window) || window < 1 || window > 365) {
    redirect(withNotice('/settings', 'The price window is a number of days, from 1 to 365.'))
  }
  const { error } = await supabase.from('business_settings').update({
    default_target_margin: margin,
    price_rounding_to: rounding,
    wavg_window_days: window,
    show_markup_alongside: formData.get('show_markup_alongside') === 'on',
  }).eq('business_id', businessId)
  if (error) redirect(withNotice('/settings', describeWriteError(error)))
  const note = await recomputeAll(supabase, businessId)
  revalidatePath('/settings')
  redirect(withNotice('/settings', `Pricing saved.${note}`))
}

/** The business's own name and kind. Previously only in the Setup guide. */
async function saveBusiness(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, businessId } = ctx
  if (!businessId) redirect(contextRedirect(ctx, '/settings'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/settings', 'Your business needs a name.'))
  const type = formData.get('type')
  if (!isBusinessType(type)) redirect(withNotice('/settings', 'Choose what kind of business this is.'))
  const { error } = await supabase.from('businesses').update({ name, type }).eq('id', businessId)
  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Business details saved.'))
}

export default async function SettingsPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId, businessId, role } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/settings'))

  const [{ data: rates }, { data: overheads }, { data: settings }, { data: units }, { data: business }] = await Promise.all([
    supabase.from('labour_rates').select('id,name,rate_per_hour,is_active')
      .order('is_active', { ascending: false }).order('name').returns<Rate[]>(),
    supabase.from('overhead_items')
      .select('id,name,monthly_cost,is_active,basis_qty,basis_unit:units(code,name)')
      .order('is_active', { ascending: false }).order('name').returns<Overhead[]>(),
    supabase.from('business_settings')
      .select('overhead_enabled,overhead_basis_qty,overhead_basis_unit_id,default_target_margin,price_rounding_to,show_markup_alongside,wavg_window_days')
      .eq('business_id', businessId ?? '').maybeSingle<Settings>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code')
      .returns<{ id: string; code: string; name: string; kind: string }[]>(),
    supabase.from('businesses').select('name,type').eq('id', businessId ?? '')
      .maybeSingle<{ name: string; type: string }>(),
  ])
  const isOwner = role === 'owner'

  const inputClass = 'mm-input mt-1'
  const inputStyle = undefined

  return (
    <div className="space-y-6">
      <PageHeader title="Your business settings"
        sub="How Menu Master costs and prices for you." />
      <p className="flex flex-wrap gap-x-4 text-sm">
        <Link href="/account" className="mm-tap underline">Your account and plan →</Link>
        <Link href="/settings/people" className="mm-tap underline">People on this account →</Link>
      </p>
      {notice && <Notice tone={/could not|cannot|must be|give |needs a name|choose|from 0|above zero|from 1/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {/* THE BUSINESS ----------------------------------------------- */}
      {business && (
        <section className="space-y-3">
          <SectionHeading sub="Its name is on your receipts and at the top of every page.">
            Your business
          </SectionHeading>
          {isOwner ? (
            <Card>
              <form action={saveBusiness} className="grid gap-3 sm:grid-cols-3 sm:items-end">
                <Field label="Name">
                  <input name="name" required maxLength={80} defaultValue={business.name}
                    className={inputClass} style={inputStyle} />
                </Field>
                <Field label="What kind of business">
                  <select name="type" defaultValue={business.type} className={inputClass} style={inputStyle}>
                    {BUSINESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <div className="flex items-end"><Submit>Save</Submit></div>
              </form>
            </Card>
          ) : (
            <Card>
              <p className="text-sm">
                <span className="font-medium">{business.name}</span>
                <span style={{ color: 'var(--mm-muted)' }}> · {BUSINESS_TYPES.find((t) => t.value === business.type)?.label ?? business.type}</span>
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>Only the owner can change these.</p>
            </Card>
          )}
        </section>
      )}

      {/* LABOUR ------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="What you pay per hour for the work that goes into a batch. Add it to a recipe to include it in the cost.">
          Kinds of work
        </SectionHeading>

        {!rates?.length ? (
          <Empty>No paid work added yet. If you pay someone to cook or prep, add it here and it will be counted in your costs.</Empty>
        ) : (
          <ul className="space-y-2">
            {rates.map((r) => (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">
                      {r.name}{!r.is_active && <span className="mm-absent"> · hidden</span>}
                    </span>
                    <span className="tabular-nums">
                      {r.rate_per_hour !== null
                        ? <>{money(Number(r.rate_per_hour))} an hour</>
                        : <span className="mm-absent">{NOT_ENTERED}</span>}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <Disclosure summary="Edit">
                      <form action={updateRate} className="mt-2 grid gap-3 sm:grid-cols-3 sm:items-end">
                        <input type="hidden" name="id" value={r.id} />
                        <Field label="What kind of work?">
                          <input name="name" required defaultValue={r.name} className={inputClass} style={inputStyle} />
                        </Field>
                        <Field label="Paid per hour (₦)">
                          <input name="rate_per_hour" type="number" step="0.01" min="0" inputMode="decimal"
                            defaultValue={r.rate_per_hour ?? ''} className={inputClass} style={inputStyle} />
                        </Field>
                        <div className="flex items-end"><Submit>Save</Submit></div>
                        <p className="sm:col-span-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                          Every dish that uses this work is re-costed when you save.
                        </p>
                      </form>
                    </Disclosure>
                    <form action={r.is_active ? deactivateRate : restoreRate}>
                      <input type="hidden" name="id" value={r.id} />
                      <InlineSubmit>{r.is_active ? 'Hide' : 'Show again'}</InlineSubmit>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Disclosure summary="Add a kind of work" open={!rates?.length}>
          <form action={addRate} className="grid gap-3 sm:grid-cols-3">
            <Field label="What kind of work?">
              <input name="name" required placeholder="Cooking" className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Paid per hour (₦)">
              <input name="rate_per_hour" type="number" step="0.01" min="0"
                className={inputClass} style={inputStyle} />
            </Field>
            <div className="flex items-end"><Submit>Add</Submit></div>
          </form>
          <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
            Leave the rate blank if you do not know it yet. Recipes using it will
            be reported as incomplete — never as if the work were free.
          </p>
        </Disclosure>
      </section>

      {/* OVERHEAD ----------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="Rent, gas, electricity, airtime — the costs you pay whether you cook or not.">
          Monthly running costs
        </SectionHeading>
        <Card>
          <form action={saveOverheadSettings} className="grid gap-3 sm:grid-cols-3">
            <label className="mm-tap flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="overhead_enabled" className="h-6 w-6"
                defaultChecked={settings?.overhead_enabled ?? false} />
              Include running costs in my recipe costs
            </label>
            <Field label="How much do you produce in a month?">
              <input name="overhead_basis_qty" type="number" step="any" min="0"
                defaultValue={settings?.overhead_basis_qty ?? undefined}
                placeholder="600" className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Measured in">
              <select name="overhead_basis_unit_id" defaultValue={settings?.overhead_basis_unit_id ?? ''}
                className={inputClass} style={inputStyle}>
                <option value="">— none —</option>
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-3"><Submit>Save</Submit></div>
            <p className="sm:col-span-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
              Running costs are spread across what you produce — 600 litres of
              soup a month, 400 kg of bread. Menu Master needs the amount and
              its unit to work out a share per recipe. If either is missing, or
              a running cost has no figure, recipes are reported as incomplete
              rather than being given a share of zero.
            </p>
          </form>
        </Card>

        {!overheads?.length ? (
          <Empty>No monthly bills added yet. Rent, gas and electricity are real costs — add them to see what a plate truly costs you.</Empty>
        ) : (
          <ul className="space-y-2">
            {overheads.map((o) => (
              <li key={o.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">
                      {o.name}{!o.is_active && <span className="mm-absent"> · hidden</span>}
                    </span>
                    <span className="tabular-nums">
                      {o.monthly_cost !== null
                        ? <>{money(Number(o.monthly_cost))} a month</>
                        : <span className="mm-absent">{NOT_ENTERED}</span>}
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                    {o.basis_qty !== null && o.basis_unit
                      ? <>spread across {Number(o.basis_qty)} {o.basis_unit.code} you make</>
                      : <>spread across your usual monthly amount</>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <Disclosure summary="Edit">
                      <form action={updateOverhead} className="mt-2 grid gap-3 sm:grid-cols-4 sm:items-end">
                        <input type="hidden" name="id" value={o.id} />
                        <Field label="What is it?">
                          <input name="name" required defaultValue={o.name} className={inputClass} style={inputStyle} />
                        </Field>
                        <Field label="Cost each month (₦)">
                          <input name="monthly_cost" type="number" step="0.01" min="0" inputMode="decimal"
                            defaultValue={o.monthly_cost ?? ''} className={inputClass} style={inputStyle} />
                        </Field>
                        <Field label="Spread across how much?">
                          <input name="basis_qty" type="number" step="any" min="0" inputMode="decimal"
                            defaultValue={o.basis_qty ?? ''} className={inputClass} style={inputStyle} />
                        </Field>
                        <Field label="Of what?">
                          <select name="basis_unit_id"
                            defaultValue={o.basis_unit ? (units ?? []).find((u) => u.code === o.basis_unit?.code)?.id ?? '' : ''}
                            className={inputClass} style={inputStyle}>
                            <option value="">— use my usual amount —</option>
                            {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                          </select>
                        </Field>
                        <div className="sm:col-span-4"><Submit>Save</Submit></div>
                      </form>
                    </Disclosure>
                    <form action={o.is_active ? deactivateOverhead : restoreOverhead}>
                      <input type="hidden" name="id" value={o.id} />
                      <InlineSubmit>{o.is_active ? 'Hide' : 'Show again'}</InlineSubmit>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Disclosure summary="Add a monthly bill" open={!overheads?.length}>
          <form action={addOverhead} className="grid gap-3 sm:grid-cols-4">
            <Field label="What is it?">
              <input name="name" required placeholder="Gas" className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Cost each month (₦)">
              <input name="monthly_cost" type="number" step="0.01" min="0"
                className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Spread across how much?">
              <input name="basis_qty" type="number" step="any" min="0" placeholder="600"
                className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Of what?">
              <select name="basis_unit_id" className={inputClass} style={inputStyle}>
                <option value="">— use my usual amount —</option>
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-4"><Submit>Add running cost</Submit></div>
            <p className="sm:col-span-4 text-xs" style={{ color: 'var(--mm-muted)' }}>
              If you make more than one kind of thing, say what each bill is
              spread across — for example rent for the soup pots over 600
              litres, and the bakery bill over 400 kg. Split the money between
              the lines; do not enter the same bill twice.
            </p>
          </form>
        </Disclosure>
      </section>

      {/* PRICING ------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionHeading sub="What you aim to keep from each sale, and how suggested prices are rounded.">
          How you price
        </SectionHeading>
        <Card>
          {isOwner && settings ? (
            <form action={savePricing} className="grid gap-3 sm:grid-cols-3 sm:items-end">
              <Field label="Target margin (%)">
                <input name="default_target_margin" type="number" step="any" min="0" max="99" required inputMode="decimal"
                  defaultValue={settings.default_target_margin ?? 40} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Round suggested prices up to (₦)">
                <input name="price_rounding_to" type="number" step="any" min="1" required inputMode="decimal"
                  defaultValue={settings.price_rounding_to ?? 50} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Use purchases from the last (days)">
                <input name="wavg_window_days" type="number" step="1" min="1" max="365" required inputMode="numeric"
                  defaultValue={settings.wavg_window_days ?? 90} className={inputClass} style={inputStyle} />
              </Field>
              <label className="mm-tap flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="show_markup_alongside" className="h-6 w-6"
                  defaultChecked={settings.show_markup_alongside} />
                Also show markup (profit as a share of the cost) on each dish
              </label>
              <div className="flex items-end"><Submit>Save pricing</Submit></div>
              <p className="sm:col-span-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                Margin is what you keep as a share of the price: at 40%, a plate that costs ₦600
                is priced at ₦1,000. Suggested prices are always rounded <strong>up</strong>, never
                down below your margin. Ingredient costs are averaged over your purchases in the
                last {settings.wavg_window_days ?? 90} days; older ones are shown as “Old price”.
              </p>
            </form>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt style={{ color: 'var(--mm-muted)' }}>Target margin</dt>
                <dd className="tabular-nums">{settings?.default_target_margin ?? NOT_ENTERED}%</dd>
                <dt style={{ color: 'var(--mm-muted)' }}>Suggested prices rounded up to</dt>
                <dd className="tabular-nums">
                  {settings?.price_rounding_to ? money(Number(settings.price_rounding_to)) : NOT_ENTERED}
                </dd>
                <dt style={{ color: 'var(--mm-muted)' }}>Purchases counted from the last</dt>
                <dd className="tabular-nums">{settings?.wavg_window_days ?? 90} days</dd>
              </dl>
              <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>Only the owner can change these.</p>
            </>
          )}
        </Card>
      </section>
    </div>
  )
}
