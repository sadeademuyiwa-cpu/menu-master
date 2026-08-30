import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty, SectionHeading,
} from '@/components/ui'
import { money, NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Rate = { id: string; name: string; rate_per_hour: string | null; is_active: boolean }
type Overhead = { id: string; name: string; monthly_cost: string | null; is_active: boolean }
type Settings = {
  overhead_enabled: boolean
  overhead_basis_qty: string | null
  overhead_basis_unit_id: string | null
  default_target_margin: string | null; price_rounding_to: string | null
  show_markup_alongside: boolean
}

async function addRate(formData: FormData) {
  'use server'
  const { supabase, accountId, businessId } = await currentContext()
  if (!accountId || !businessId) redirect(withNotice('/settings', 'No business found for your login.'))
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
  const { supabase, accountId, businessId } = await currentContext()
  if (!accountId || !businessId) redirect(withNotice('/settings', 'No business found for your login.'))
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice('/settings', 'Give this running cost a name.'))

  const raw = String(formData.get('monthly_cost') ?? '').trim()
  const cost = raw === '' ? null : Number(raw)
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    redirect(withNotice('/settings', 'A monthly cost cannot be negative.'))
  }
  const { error } = await supabase.from('overhead_items').insert({
    account_id: accountId, business_id: businessId, name, monthly_cost: cost,
  })
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Running cost added.'))
}

async function saveOverheadSettings(formData: FormData) {
  'use server'
  const { supabase, businessId } = await currentContext()
  if (!businessId) redirect(withNotice('/settings', 'No business found for your login.'))

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
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Saved.'))
}

async function deactivateRate(formData: FormData) {
  'use server'
  const { supabase } = await currentContext()
  const { error } = await supabase.from('labour_rates')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? ''))
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Hidden.'))
}

async function deactivateOverhead(formData: FormData) {
  'use server'
  const { supabase } = await currentContext()
  const { error } = await supabase.from('overhead_items')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? ''))
  revalidatePath('/settings')
  redirect(withNotice('/settings', describeWriteError(error) ?? 'Hidden.'))
}

export default async function SettingsPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const { supabase, accountId, businessId } = await currentContext()
  if (!accountId) redirect('/onboarding')

  const [{ data: rates }, { data: overheads }, { data: settings }, { data: units }] = await Promise.all([
    supabase.from('labour_rates').select('id,name,rate_per_hour,is_active')
      .order('is_active', { ascending: false }).order('name').returns<Rate[]>(),
    supabase.from('overhead_items').select('id,name,monthly_cost,is_active')
      .order('is_active', { ascending: false }).order('name').returns<Overhead[]>(),
    supabase.from('business_settings')
      .select('overhead_enabled,overhead_basis_qty,overhead_basis_unit_id,default_target_margin,price_rounding_to,show_markup_alongside')
      .eq('business_id', businessId ?? '').maybeSingle<Settings>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code')
      .returns<{ id: string; code: string; name: string; kind: string }[]>(),
  ])

  const inputClass = 'mt-1 w-full rounded border px-3 py-2 text-base'
  const inputStyle = { borderColor: 'var(--mm-line)', background: 'transparent' }

  return (
    <div className="space-y-6">
      <PageHeader title="Your business settings"
        sub="How Menu Master costs and prices for you." />
      {notice && <Notice tone={/could not|cannot|must be|give /i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {/* LABOUR ------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="What you pay per hour for the work that goes into a batch. Add it to a recipe to include it in the cost.">
          Kinds of work
        </SectionHeading>
        <Card>
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
        </Card>
        {!rates?.length ? (
          <Empty>No kinds of work yet.</Empty>
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
                  {r.is_active && (
                    <form action={deactivateRate} className="mt-2">
                      <input type="hidden" name="id" value={r.id} />
                      <InlineSubmit>Hide</InlineSubmit>
                    </form>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* OVERHEAD ----------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="Rent, gas, electricity, airtime — the costs you pay whether you cook or not.">
          Monthly running costs
        </SectionHeading>
        <Card>
          <form action={saveOverheadSettings} className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="overhead_enabled"
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
        <Card>
          <form action={addOverhead} className="grid gap-3 sm:grid-cols-3">
            <Field label="What is it?">
              <input name="name" required placeholder="Gas" className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Cost each month (₦)">
              <input name="monthly_cost" type="number" step="0.01" min="0"
                className={inputClass} style={inputStyle} />
            </Field>
            <div className="flex items-end"><Submit>Add</Submit></div>
          </form>
        </Card>
        {!overheads?.length ? (
          <Empty>No running costs yet.</Empty>
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
                  {o.is_active && (
                    <form action={deactivateOverhead} className="mt-2">
                      <input type="hidden" name="id" value={o.id} />
                      <InlineSubmit>Hide</InlineSubmit>
                    </form>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <p className="text-sm font-medium">How you price</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt style={{ color: 'var(--mm-muted)' }}>Target margin</dt>
          <dd className="tabular-nums">{settings?.default_target_margin ?? NOT_ENTERED}%</dd>
          <dt style={{ color: 'var(--mm-muted)' }}>Suggested prices rounded up to</dt>
          <dd className="tabular-nums">
            {settings?.price_rounding_to ? money(Number(settings.price_rounding_to)) : NOT_ENTERED}
          </dd>
        </dl>
        <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
          Suggested prices are always rounded <strong>up</strong>. Rounding down
          would put the price below the margin you asked for.
        </p>
      </Card>
    </div>
  )
}
