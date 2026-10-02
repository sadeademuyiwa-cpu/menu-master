import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requiredAmount } from '@/lib/money-input'
import {
  currentContext, contextRedirect, describeWriteError, withNotice, hasSalesEntitlement,
} from '@/lib/data/context'
import { wizardStep, stepNumber } from '@/lib/setup-gate'
import { localToday } from '@/lib/dates'
import { entitlementStatus } from '@/lib/data/context'
import { loadPlanOffers, cheapest } from '@/lib/data/plans'
import { daysLeft } from '@/lib/trial'
import { noticeTone } from '@/lib/ui/notice-tone'
import { queueEvent } from '@/lib/analytics/queue'
import { money, percent, quantity, marginVerdict } from '@/lib/format'
import { Card, Notice, HeroStat, Badge } from '@/components/ui'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { SetupSteps, SetupTitle } from '../steps'
import { PurchaseRows, type MeasureKind, type StarterIngredient, type StarterUnit } from './purchase-rows'

export const dynamic = 'force-dynamic'

const HERE = '/start'

/**
 * Units that need no conversion, per kind, in the order offered. The first of
 * each kind is the default. Container units (paint, derica, bag) are left out
 * on purpose: they need a measurement first, and setup must always succeed.
 */
const PURCHASE_UNITS: Record<MeasureKind, { code: string; label: string }[]> = {
  mass: [{ code: 'kg', label: 'kg' }, { code: 'g', label: 'grams' }],
  volume: [{ code: 'l', label: 'litres' }, { code: 'ml', label: 'ml' }],
  count: [{ code: 'unit', label: 'pieces' }, { code: 'dozen', label: 'dozen' }],
}
const RECIPE_UNITS: Record<MeasureKind, { code: string; label: string }[]> = {
  mass: [{ code: 'kg', label: 'kg' }, { code: 'g', label: 'grams' }],
  volume: [
    { code: 'l', label: 'litres' }, { code: 'ml', label: 'ml' },
    { code: 'cup_m', label: 'cups (250 ml)' }, { code: 'tbsp', label: 'tablespoons' },
    { code: 'tsp', label: 'teaspoons' },
  ],
  count: [{ code: 'unit', label: 'pieces' }, { code: 'dozen', label: 'dozen' }],
}

/** Staples most owners buy, by their starter-catalogue names. Missing ones are skipped. */
const COMMON = [
  'Rice (local)', 'Rice (imported)', 'Vegetable oil', 'Palm oil', 'Tomato', 'Tatashe',
  'Fresh pepper (rodo)', 'Onion', 'Chicken (whole)', 'Beef', 'Seasoning cube', 'Salt',
  'Egusi (ground)', 'Plain flour', 'Granulated sugar', 'Egg',
]

type Ctx = Awaited<ReturnType<typeof currentContext>>

async function requireOwner(): Promise<Ctx & { accountId: string; businessId: string }> {
  const ctx = await currentContext()
  if (ctx.status !== 'ok' || !ctx.accountId || !ctx.businessId) redirect(contextRedirect(ctx, HERE))
  return ctx as Ctx & { accountId: string; businessId: string }
}

const isKind = (k: string | undefined): k is MeasureKind => k === 'mass' || k === 'volume' || k === 'count'

// ---------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------

/**
 * Step 2: one real purchase with every row the owner filled in, through the
 * ledger (fn_post_purchase) exactly as Purchases records one. Nothing is
 * pre-filled and nothing is assumed: an empty row is skipped, a half-filled
 * row is refused with its number.
 */
async function recordStarterPurchase(formData: FormData) {
  'use server'
  const { supabase, accountId, businessId } = await requireOwner()

  const ids = formData.getAll('ingredient_id').map(String)
  const qtys = formData.getAll('qty').map(String)
  const unitIds = formData.getAll('unit_id').map(String)
  const amounts = formData.getAll('amount').map(String)

  const lines: { ingredient_id: string; qty: number; unit_id: string; amount: number }[] = []
  for (let i = 0; i < ids.length; i++) {
    const [id, qtyRaw, unitId, amountRaw] = [ids[i], (qtys[i] ?? '').trim(), unitIds[i] ?? '', (amounts[i] ?? '').trim()]
    if (!id && !qtyRaw && !amountRaw) continue
    const qty = Number(qtyRaw)
    const amount = Number(amountRaw)
    if (!id) redirect(withNotice(HERE, `Item ${i + 1}: choose which ingredient it is, or clear the row.`))
    if (!qtyRaw || !Number.isFinite(qty) || qty <= 0 || !unitId) {
      redirect(withNotice(HERE, `Item ${i + 1}: enter how much you bought. It must be more than zero.`))
    }
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
      redirect(withNotice(HERE, `Item ${i + 1}: enter what you paid, in naira, using digits only. It must be more than zero.`))
    }
    if (lines.some((l) => l.ingredient_id === id)) {
      redirect(withNotice(HERE, `Item ${i + 1}: that ingredient is already on the list. Keep one row for it.`))
    }
    lines.push({ ingredient_id: id, qty, unit_id: unitId, amount })
  }
  if (lines.length === 0) {
    redirect(withNotice(HERE, 'Add at least one ingredient you bought and what you paid for it.'))
  }

  const { data: purchase, error: pErr } = await supabase.from('purchases')
    .insert({ account_id: accountId, business_id: businessId, purchase_date: localToday() })
    .select('id').single()
  if (pErr || !purchase) redirect(withNotice(HERE, describeWriteError(pErr) ?? 'We could not save that purchase.'))

  const discard = async () => { await supabase.from('purchases').delete().eq('id', purchase.id) }

  const { error: lErr } = await supabase.from('purchase_lines')
    .insert(lines.map((l) => ({ account_id: accountId, purchase_id: purchase.id, ...l })))
  if (lErr) {
    await discard()
    redirect(withNotice(HERE, describeWriteError(lErr) ?? 'We could not save those items.'))
  }

  const { data: posted, error: postErr } = await supabase.rpc('fn_post_purchase', { p_purchase_id: purchase.id })
  if (postErr || (posted && posted.posted === false)) {
    await discard()
    redirect(withNotice(HERE, describeWriteError(postErr) ??
      `We could not record that purchase (${String(posted?.reason ?? 'unknown').replace(/_/g, ' ')}).`))
  }

  await queueEvent('first_purchase_recorded')
  // The next step appearing is the confirmation; a toast on top of it would
  // only cover the form on a phone.
  revalidatePath(HERE)
  redirect(HERE)
}

/**
 * Step 3: the first dish. One pot makes N plates; each plate is one portion.
 * Lines use only ingredients that already have a price, so the costing is
 * complete at once. EXACTLY ONE snapshot follows, as on the recipe page (F3).
 */
async function createFirstDish(formData: FormData) {
  'use server'
  const { supabase, accountId, businessId } = await requireOwner()

  const name = String(formData.get('name') ?? '').trim()
  const plates = Number(formData.get('plates'))
  if (!name) redirect(withNotice(HERE, 'Give your dish a name.'))
  if (!Number.isFinite(plates) || plates <= 0) {
    redirect(withNotice(HERE, 'Enter how many plates one pot makes. It must be more than zero.'))
  }

  const ids = formData.getAll('ingredient_id').map(String)
  const qtys = formData.getAll('qty').map(String)
  const unitIds = formData.getAll('unit_id').map(String)
  const lines: { ingredient_id: string; qty: number; unit_id: string }[] = []
  for (let i = 0; i < ids.length; i++) {
    const raw = (qtys[i] ?? '').trim()
    if (!raw) continue
    const qty = Number(raw)
    if (!Number.isFinite(qty) || qty <= 0) {
      redirect(withNotice(HERE, 'Every amount you fill in must be more than zero. Leave a row empty if the dish does not use it.'))
    }
    lines.push({ ingredient_id: ids[i], qty, unit_id: unitIds[i] })
  }
  if (lines.length === 0) {
    redirect(withNotice(HERE, 'Fill in how much of at least one ingredient goes into one pot.'))
  }

  const { data: portion } = await supabase.from('units').select('id').eq('code', 'portion').maybeSingle<{ id: string }>()
  if (!portion) redirect(withNotice(HERE, 'We could not set up that dish. Please try again.'))

  const { data: recipe, error: rErr } = await supabase.from('recipes').insert({
    account_id: accountId, business_id: businessId, name,
    batch_yield_qty: plates, yield_unit_id: portion.id, portion_qty: 1, status: 'active',
  }).select('id').single()
  if (rErr || !recipe) redirect(withNotice(HERE, describeWriteError(rErr) ?? 'We could not save that dish.'))

  const { error: lErr } = await supabase.from('recipe_lines')
    .insert(lines.map((l) => ({ account_id: accountId, recipe_id: recipe.id, ...l })))
  if (lErr) {
    await supabase.from('recipes').delete().eq('id', recipe.id)
    redirect(withNotice(HERE, describeWriteError(lErr) ?? 'We could not save what goes into that dish.'))
  }

  const { error: sErr } = await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipe.id })
  revalidatePath(HERE)
  redirect(sErr ? withNotice(HERE, describeWriteError(sErr)) : HERE)
}

/** Step 4: the owner's own selling price, appended as on the recipe page. */
async function setFirstPrice(formData: FormData) {
  'use server'
  const { supabase, accountId } = await requireOwner()
  const recipeId = String(formData.get('recipe_id') ?? '')
  const price = requiredAmount(formData, 'price')
  if (price === null || price <= 0) {
    redirect(withNotice(HERE, 'Enter what you sell one plate for, in naira. It must be more than zero.'))
  }
  const { error } = await supabase.from('recipe_prices').insert({ account_id: accountId, recipe_id: recipeId, price })
  if (!error) await queueEvent('setup_completed')
  revalidatePath(HERE)
  redirect(error ? withNotice(HERE, describeWriteError(error)) : HERE)
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------

type PriceCheck = {
  recipe_id: string; name: string; is_complete: boolean
  cost_per_portion: string | null; selling_price: string | null
  profit: string | null; margin_pct: string | null
  recommended_price: string | null; target_margin: string | null
}

export default async function StartPage(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const ctx = await currentContext()
  if (ctx.status !== 'ok') redirect(contextRedirect(ctx, HERE))
  // Setup is the owner's and manager's job; anyone else goes to the app.
  if (ctx.role !== 'owner' && ctx.role !== 'manager') redirect('/dashboard')
  const { supabase } = ctx

  const { data: status } = await supabase.from('v_onboarding_status')
    .select('prices_entered,complete_costings,selling_prices_set').limit(1)
    .maybeSingle<{ prices_entered: number; complete_costings: number; selling_prices_set: number }>()
  const step = wizardStep({
    pricesEntered: status?.prices_entered ?? 0,
    completeCostings: status?.complete_costings ?? 0,
    pricesSet: status?.selling_prices_set ?? 0,
  })

  const warning = notice && noticeTone(notice) === 'warn' ? <Notice>{notice}</Notice> : null

  return (
    <div className="space-y-6">
      <SetupSteps current={step === 'done' ? 5 : stepNumber(step)} />
      {warning}
      {step === 'purchase' && <PurchaseStep supabase={supabase} />}
      {step === 'dish' && <DishStep supabase={supabase} />}
      {step === 'price' && <PriceStep supabase={supabase} />}
      {step === 'done' && <DoneStep supabase={supabase} />}
    </div>
  )
}

type Supabase = Ctx['supabase']

async function unitRows(supabase: Supabase) {
  const { data } = await supabase.from('units').select('id,code,kind')
    .returns<{ id: string; code: string; kind: string }[]>()
  return data ?? []
}

// --- step 2 ----------------------------------------------------------------

async function PurchaseStep({ supabase }: { supabase: Supabase }) {
  const [{ data: ingredients }, { data: categories }, units] = await Promise.all([
    supabase.from('ingredients').select('id,name,category_id,base_unit_id')
      .eq('kind', 'ingredient').is('deleted_at', null).order('name')
      .returns<{ id: string; name: string; category_id: string | null; base_unit_id: string }[]>(),
    supabase.from('ingredient_categories').select('id,name').order('name')
      .returns<{ id: string; name: string }[]>(),
    unitRows(supabase),
  ])

  const kindOfUnit = new Map(units.map((u) => [u.id, u.kind]))
  const groupOf = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const items: StarterIngredient[] = (ingredients ?? []).flatMap((i) => {
    const kind = kindOfUnit.get(i.base_unit_id)
    return isKind(kind) ? [{ id: i.id, name: i.name, group: groupOf.get(i.category_id ?? '') ?? 'Your own items', kind }] : []
  }).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))

  const byCode = new Map(units.map((u) => [u.code, u.id]))
  const offered: StarterUnit[] = (Object.keys(PURCHASE_UNITS) as MeasureKind[]).flatMap((kind) =>
    PURCHASE_UNITS[kind].flatMap((u, i) => {
      const id = byCode.get(u.code)
      return id ? [{ id, label: u.label, kind, isDefault: i === 0 }] : []
    }))

  const nameToId = new Map(items.map((i) => [i.name, i.id]))
  const common = COMMON.map((n) => nameToId.get(n)).filter((x): x is string => !!x)

  return (
    <>
      <SetupTitle title="What did you pay for your ingredients?">
        Think of the dish you sell most. Pick a few things you bought for it, and enter how
        much you bought and what you paid. Menu Master works out the cost per kilo, litre or
        piece, and whenever a price changes later, every dish that uses it is re-costed for you.
      </SetupTitle>
      <PurchaseRows ingredients={items} units={offered} common={common} action={recordStarterPurchase} />
      <p className="text-xs leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
        Bought in paints, dericas or bags? Enter it in kg or litres for now. You can teach
        Menu Master your local measures after setup.
      </p>
    </>
  )
}

// --- step 3 ----------------------------------------------------------------

async function DishStep({ supabase }: { supabase: Supabase }) {
  const [{ data: prices }, units] = await Promise.all([
    supabase.from('ingredient_prices').select('ingredient_id,effective_date')
      .is('reversed_at', null).order('effective_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(200).returns<{ ingredient_id: string }[]>(),
    unitRows(supabase),
  ])
  const pricedIds = [...new Set((prices ?? []).map((p) => p.ingredient_id))].slice(0, 12)
  const { data: ingredients } = await supabase.from('ingredients').select('id,name,base_unit_id')
    .in('id', pricedIds.length ? pricedIds : ['00000000-0000-0000-0000-000000000000'])
    .returns<{ id: string; name: string; base_unit_id: string }[]>()

  const kindOfUnit = new Map(units.map((u) => [u.id, u.kind]))
  const byCode = new Map(units.map((u) => [u.code, u.id]))
  const rows = pricedIds.flatMap((id) => {
    const ing = (ingredients ?? []).find((i) => i.id === id)
    const kind = ing ? kindOfUnit.get(ing.base_unit_id) : undefined
    if (!ing || !isKind(kind)) return []
    const options = RECIPE_UNITS[kind].flatMap((u) => {
      const uid = byCode.get(u.code)
      return uid ? [{ id: uid, label: u.label }] : []
    })
    return [{ id: ing.id, name: ing.name, options }]
  })

  return (
    <>
      <SetupTitle title="Now, one dish you sell">
        Tell us how many plates one pot makes and how much of each ingredient goes into that
        pot. Leave a row empty if the dish does not use it.
      </SetupTitle>

      <form action={createFirstDish} className="space-y-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Dish name</span>
              <input name="name" required placeholder="e.g. Jollof rice and chicken" className="mm-input mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">One pot makes</span>
              <span className="mt-1 flex items-center gap-2">
                <input name="plates" type="number" step="any" min="0" inputMode="decimal" required
                       placeholder="e.g. 20" className="mm-input" />
                <span className="shrink-0 text-sm" style={{ color: 'var(--mm-muted)' }}>plates</span>
              </span>
            </label>
          </div>
        </Card>

        <section className="space-y-2">
          <h2 className="text-base font-semibold tracking-tight">What goes into one pot</h2>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="mm-card">
                <input type="hidden" name="ingredient_id" value={r.id} />
                <div className="grid grid-cols-[1fr_6rem_8rem] items-end gap-2">
                  <span className="min-w-0 pb-3 font-medium">{r.name}</span>
                  <label className="block">
                    <span className="sr-only">How much {r.name}</span>
                    <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                           placeholder="0" className="mm-input" />
                  </label>
                  <label className="block">
                    <span className="sr-only">Unit for {r.name}</span>
                    <select name="unit_id" className="mm-input">
                      {r.options.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
            Only ingredients you have priced are listed, so the cost can be worked out straight
            away. You can add the rest of the recipe after setup.
          </p>
        </section>

        <Button className="w-full" busyLabel="Working out the cost…">Work out the cost</Button>
      </form>
    </>
  )
}

// --- step 4 ----------------------------------------------------------------

async function PriceStep({ supabase }: { supabase: Supabase }) {
  const { data: checks } = await supabase.from('v_price_check')
    .select('recipe_id,name,is_complete,cost_per_portion,selling_price,profit,margin_pct,recommended_price,target_margin')
    .is('variant_id', null).eq('is_complete', true).is('selling_price', null)
    .returns<PriceCheck[]>()
  const dish = checks?.[0]
  if (!dish) redirect('/dashboard')

  const [{ data: cost }, { data: recipe }, { data: lines }] = await Promise.all([
    supabase.from('v_recipe_cost_current').select('batch_cost').eq('recipe_id', dish.recipe_id)
      .maybeSingle<{ batch_cost: string | null }>(),
    supabase.from('recipes').select('batch_yield_qty').eq('id', dish.recipe_id)
      .maybeSingle<{ batch_yield_qty: string }>(),
    supabase.from('v_recipe_line_costs').select('line_id,item_name,recipe_qty,recipe_unit,line_cost')
      .eq('recipe_id', dish.recipe_id)
      .returns<{ line_id: string; item_name: string | null; recipe_qty: string; recipe_unit: string | null; line_cost: string | null }[]>(),
  ])
  const plates = recipe ? Number(recipe.batch_yield_qty) : null

  return (
    <>
      <SetupTitle title={`Here is what one plate of ${dish.name} costs you`}>
        Worked out from what you paid. Nothing is estimated.
      </SetupTitle>

      <Card>
        <ul className="divide-y text-sm" style={{ borderColor: 'var(--mm-line)' }}>
          {(lines ?? []).map((l) => (
            <li key={l.line_id} className="flex items-baseline justify-between gap-3 py-2" style={{ borderColor: 'var(--mm-line)' }}>
              <span className="min-w-0">
                {l.item_name}{' '}
                <span style={{ color: 'var(--mm-muted)' }}>{quantity(Number(l.recipe_qty), l.recipe_unit ?? '')}</span>
              </span>
              <span className="mm-num font-medium">{money(l.line_cost)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 py-2 font-semibold">
            <span>One pot{plates ? ` (${plates} plates)` : ''}</span>
            <span className="mm-num">{money(cost?.batch_cost ?? null)}</span>
          </li>
        </ul>
      </Card>

      <section className="grid gap-2 sm:grid-cols-2">
        <HeroStat label="One plate costs you" value={money(dish.cost_per_portion)} />
        <HeroStat
          label="Suggested price"
          value={money(dish.recommended_price, 'not available')}
          tone="good"
          sub={dish.target_margin ? `Keeps about ${Number(dish.target_margin)}% for you, rounded up.` : undefined}
        />
      </section>

      <form action={setFirstPrice} className="space-y-3">
        <input type="hidden" name="recipe_id" value={dish.recipe_id} />
        <label className="block">
          <span className="text-sm font-medium">What do you sell one plate for? (₦)</span>
          <input name="price" type="number" step="0.01" min="0" inputMode="decimal" required
                 placeholder={dish.recommended_price ? `e.g. ${Number(dish.recommended_price)}` : 'e.g. 1500'}
                 className="mm-input mt-1" />
        </label>
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          Enter the price you actually charge. Not sure yet? Use the suggested price; you can change it any time.
        </p>
        <Button className="w-full" busyLabel="Saving your price…">Save my price</Button>
      </form>
    </>
  )
}

// --- finished ----------------------------------------------------------------

async function DoneStep({ supabase }: { supabase: Supabase }) {
  const [{ data: checks }, canSell, entitlement, { offers }] = await Promise.all([
    supabase.from('v_price_check')
      .select('recipe_id,name,is_complete,cost_per_portion,selling_price,profit,margin_pct,recommended_price,target_margin')
      .is('variant_id', null).eq('is_complete', true).not('selling_price', 'is', null)
      .returns<PriceCheck[]>(),
    hasSalesEntitlement(),
    entitlementStatus(),
    loadPlanOffers(supabase),
  ])
  const trialDays = entitlement?.reason === 'trial_active' ? daysLeft(entitlement.boundary) : null
  const from = cheapest(offers)
  const dish = checks?.[0]
  const verdict = dish
    ? marginVerdict(dish.margin_pct === null ? null : Number(dish.margin_pct),
                    dish.target_margin === null ? null : Number(dish.target_margin))
    : null
  const tone = verdict?.tone === 'ok' ? 'plain' : verdict?.tone

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="mm-action-icon"><AppIcon name="check" size={22} /></span>
        <SetupTitle title="You're all set">
          Menu Master now knows what your dish costs and what you charge for it.
        </SetupTitle>
      </div>

      {dish && (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{dish.name}</span>
            {verdict && <Badge tone={tone}>{verdict.label}</Badge>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt style={{ color: 'var(--mm-muted)' }}>One plate costs</dt><dd className="mm-num mt-0.5 font-semibold">{money(dish.cost_per_portion)}</dd></div>
            <div><dt style={{ color: 'var(--mm-muted)' }}>You sell it for</dt><dd className="mm-num mt-0.5 font-semibold">{money(dish.selling_price)}</dd></div>
            <div><dt style={{ color: 'var(--mm-muted)' }}>You keep</dt><dd className="mm-num mt-0.5 font-semibold">{money(dish.profit)}</dd></div>
            <div><dt style={{ color: 'var(--mm-muted)' }}>Margin</dt><dd className="mm-num mt-0.5 font-semibold">{percent(dish.margin_pct)}</dd></div>
          </dl>
          {verdict && <p className="mt-3 text-sm" style={{ color: 'var(--mm-muted)' }}>{verdict.sentence}</p>}
        </Card>
      )}

      <ul className="space-y-2 text-sm">
        <li className="flex gap-2"><AppIcon name="check" size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--mm-accent)' }} />When you record a new purchase, every dish that uses it is re-costed automatically.</li>
        <li className="flex gap-2"><AppIcon name="check" size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--mm-accent)' }} />Home tells you when a dish needs attention, like a price that has gone up.</li>
        <li className="flex gap-2"><AppIcon name="check" size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--mm-accent)' }} />Add more dishes, sizes, packaging and monthly bills whenever you are ready.</li>
      </ul>

      {/* Said now, while it is good news, not first on the day it runs out. */}
      {trialDays !== null && (
        <Card>
          <p className="text-sm">
            <span className="font-semibold">You are on a free trial — {trialDays} day{trialDays === 1 ? '' : 's'} left.</span>{' '}
            Everything is open to you until then.{from !== null ? ` Plans start at ${money(from)} a month.` : ''}{' '}
            <Link href="/subscribe" className="mm-inline-tap font-semibold">See plans</Link>
          </p>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {canSell !== false && (
          <Link href="/sales/new" className="mm-btn mm-btn-primary w-full">Record your first sale</Link>
        )}
        <Link href="/dashboard" className={`mm-btn ${canSell !== false ? 'mm-btn-secondary' : 'mm-btn-primary'} w-full`}>
          Go to my dashboard
        </Link>
      </div>
    </>
  )
}
