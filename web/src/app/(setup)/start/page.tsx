import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requiredAmount } from '@/lib/money-input'
import {
  currentContext, contextRedirect, describeWriteError, withNotice, hasSalesEntitlement,
} from '@/lib/data/context'
import {
  wizardStep, resolveView, neighbours, isRevisit, SETUP_COOKIE, type SetupView,
} from '@/lib/setup-gate'
import { localToday } from '@/lib/dates'
import { entitlementStatus } from '@/lib/data/context'
import { loadPlanOffers, cheapest } from '@/lib/data/plans'
import { daysLeft } from '@/lib/trial'
import { noticeTone } from '@/lib/ui/notice-tone'
import { queueEvent } from '@/lib/analytics/queue'
import { BUSINESS_TYPES, isBusinessType } from '@/lib/business-types'
import { money, percent, quantity, marginVerdict } from '@/lib/format'
import { Card, Notice, HeroStat, Badge, Disclosure } from '@/components/ui'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { SetupSteps, SetupTitle, StepNav } from '../steps'
import {
  PurchaseRows, type InitialRow, type MeasureKind, type StarterIngredient, type StarterUnit,
} from './purchase-rows'

export const dynamic = 'force-dynamic'

const HERE = '/start'
const at = (view: SetupView) => `${HERE}?step=${view}`

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
type Supabase = Ctx['supabase']

async function requireOwner(): Promise<Ctx & { accountId: string; businessId: string }> {
  const ctx = await currentContext()
  if (ctx.status !== 'ok' || !ctx.accountId || !ctx.businessId) redirect(contextRedirect(ctx, HERE))
  return ctx as Ctx & { accountId: string; businessId: string }
}

const isKind = (k: string | undefined): k is MeasureKind => k === 'mass' || k === 'volume' || k === 'count'

// ---------------------------------------------------------------------------
// READS shared by the steps
// ---------------------------------------------------------------------------

/**
 * The purchase setup recorded: the business's first purchase that still
 * stands. A corrected one is marked 'reversed' and drops out, so after a
 * correction this is the corrected purchase.
 */
async function firstPurchase(supabase: Supabase, businessId: string) {
  const { data } = await supabase.from('purchases').select('id, purchase_date')
    .eq('business_id', businessId).eq('status', 'posted')
    .order('created_at', { ascending: true }).limit(1)
    .maybeSingle<{ id: string; purchase_date: string }>()
  return data
}

/** The dish setup made: the business's first recipe that has not been deleted. */
async function firstDish(supabase: Supabase, businessId: string) {
  const { data } = await supabase.from('recipes').select('id, name, batch_yield_qty')
    .eq('business_id', businessId).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(1)
    .maybeSingle<{ id: string; name: string; batch_yield_qty: string }>()
  return data
}

async function unitRows(supabase: Supabase) {
  const { data } = await supabase.from('units').select('id,code,kind')
    .returns<{ id: string; code: string; kind: string }[]>()
  return data ?? []
}

// ---------------------------------------------------------------------------
// WRITES
// ---------------------------------------------------------------------------

type PurchaseLine = { ingredient_id: string; qty: number; unit_id: string; amount: number }

/**
 * The rows of "What did you pay?", checked. An empty row is skipped, a
 * half-filled one is refused with its number. Nothing is pre-filled and
 * nothing is assumed.
 */
function purchaseLines(formData: FormData, back: string): PurchaseLine[] {
  const ids = formData.getAll('ingredient_id').map(String)
  const qtys = formData.getAll('qty').map(String)
  const unitIds = formData.getAll('unit_id').map(String)
  const amounts = formData.getAll('amount').map(String)

  const lines: PurchaseLine[] = []
  for (let i = 0; i < ids.length; i++) {
    const [id, qtyRaw, unitId, amountRaw] = [ids[i], (qtys[i] ?? '').trim(), unitIds[i] ?? '', (amounts[i] ?? '').trim()]
    if (!id && !qtyRaw && !amountRaw) continue
    const qty = Number(qtyRaw)
    const amount = Number(amountRaw)
    if (!id) redirect(withNotice(back, `Item ${i + 1}: choose which ingredient it is, or clear the row.`))
    if (!qtyRaw || !Number.isFinite(qty) || qty <= 0 || !unitId) {
      redirect(withNotice(back, `Item ${i + 1}: enter how much you bought. It must be more than zero.`))
    }
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
      redirect(withNotice(back, `Item ${i + 1}: enter what you paid, in naira, using digits only. It must be more than zero.`))
    }
    if (lines.some((l) => l.ingredient_id === id)) {
      redirect(withNotice(back, `Item ${i + 1}: that ingredient is already on the list. Keep one row for it.`))
    }
    lines.push({ ingredient_id: id, qty, unit_id: unitId, amount })
  }
  if (lines.length === 0) {
    redirect(withNotice(back, 'Add at least one ingredient you bought and what you paid for it.'))
  }
  return lines
}

/**
 * One real purchase through the ledger (fn_post_purchase), exactly as
 * Purchases records one. Undone if any part fails, so nothing half-saved is
 * left behind. Returns the new purchase's id.
 */
async function postPurchase(
  ctx: Ctx & { accountId: string; businessId: string }, lines: PurchaseLine[], back: string,
): Promise<string> {
  const { supabase, accountId, businessId } = ctx
  const { data: purchase, error: pErr } = await supabase.from('purchases')
    .insert({ account_id: accountId, business_id: businessId, purchase_date: localToday() })
    .select('id').single()
  if (pErr || !purchase) redirect(withNotice(back, describeWriteError(pErr) ?? 'We could not save that purchase.'))

  const discard = async () => { await supabase.from('purchases').delete().eq('id', purchase.id) }

  const { error: lErr } = await supabase.from('purchase_lines')
    .insert(lines.map((l) => ({ account_id: accountId, purchase_id: purchase.id, ...l })))
  if (lErr) {
    await discard()
    redirect(withNotice(back, describeWriteError(lErr) ?? 'We could not save those items.'))
  }

  const { data: posted, error: postErr } = await supabase.rpc('fn_post_purchase', { p_purchase_id: purchase.id })
  if (postErr || (posted && posted.posted === false)) {
    await discard()
    redirect(withNotice(back, describeWriteError(postErr) ??
      `We could not record that purchase (${String(posted?.reason ?? 'unknown').replace(/_/g, ' ')}).`))
  }
  return purchase.id
}

/** Step 2, first time: one real purchase with every row the owner filled in. */
async function recordStarterPurchase(formData: FormData) {
  'use server'
  const ctx = await requireOwner()
  const lines = purchaseLines(formData, at('purchase'))
  await postPurchase(ctx, lines, at('purchase'))
  await queueEvent('first_purchase_recorded')
  // The next step appearing is the confirmation; a toast on top of it would
  // only cover the form on a phone.
  revalidatePath(HERE)
  redirect(HERE)
}

/**
 * Step 2, revisited: a correction. A posted purchase is never edited -- its
 * prices are history. The corrected purchase is recorded first; only once
 * that has succeeded is the original reversed (fn_reverse_purchase), which
 * keeps it on file as cancelled and undoes the prices it set. The setup dish
 * is then re-costed once, so step 4 shows the corrected cost.
 */
async function correctStarterPurchase(formData: FormData) {
  'use server'
  const ctx = await requireOwner()
  const back = at('purchase')
  const original = String(formData.get('purchase_id') ?? '')
  const lines = purchaseLines(formData, back)

  await postPurchase(ctx, lines, back)
  const { error: rErr } = await ctx.supabase.rpc('fn_reverse_purchase',
    { p_purchase_id: original, p_reason: 'Corrected during setup' })

  const dish = await firstDish(ctx.supabase, ctx.businessId)
  if (dish) await ctx.supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: dish.id })

  revalidatePath(HERE)
  redirect(withNotice(rErr ? back : at('dish'), rErr
    ? 'Your corrected purchase is saved, but the earlier one could not be cancelled. Open Purchases to cancel it.'
    : 'Purchase corrected. The earlier one is kept in Purchases as cancelled.'))
}

/**
 * Step 3, first time: the first dish. One pot makes N plates; each plate is
 * one portion. Lines use only ingredients that already have a price, so the
 * costing is complete at once. EXACTLY ONE snapshot follows, as on the recipe
 * page (F3).
 */
async function createFirstDish(formData: FormData) {
  'use server'
  const { supabase, accountId, businessId } = await requireOwner()
  const back = at('dish')

  const name = String(formData.get('name') ?? '').trim()
  const plates = Number(formData.get('plates'))
  if (!name) redirect(withNotice(back, 'Give your dish a name.'))
  if (!Number.isFinite(plates) || plates <= 0) {
    redirect(withNotice(back, 'Enter how many plates one pot makes. It must be more than zero.'))
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
      redirect(withNotice(back, 'Every amount you fill in must be more than zero. Leave a row empty if the dish does not use it.'))
    }
    lines.push({ ingredient_id: ids[i], qty, unit_id: unitIds[i] })
  }
  if (lines.length === 0) {
    redirect(withNotice(back, 'Fill in how much of at least one ingredient goes into one pot.'))
  }

  const { data: portion } = await supabase.from('units').select('id').eq('code', 'portion').maybeSingle<{ id: string }>()
  if (!portion) redirect(withNotice(back, 'We could not set up that dish. Please try again.'))

  const { data: recipe, error: rErr } = await supabase.from('recipes').insert({
    account_id: accountId, business_id: businessId, name,
    batch_yield_qty: plates, yield_unit_id: portion.id, portion_qty: 1, status: 'active',
  }).select('id').single()
  if (rErr || !recipe) redirect(withNotice(back, describeWriteError(rErr) ?? 'We could not save that dish.'))

  const { error: lErr } = await supabase.from('recipe_lines')
    .insert(lines.map((l) => ({ account_id: accountId, recipe_id: recipe.id, ...l })))
  if (lErr) {
    await supabase.from('recipes').delete().eq('id', recipe.id)
    redirect(withNotice(back, describeWriteError(lErr) ?? 'We could not save what goes into that dish.'))
  }

  const { error: sErr } = await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipe.id })
  revalidatePath(HERE)
  redirect(sErr ? withNotice(back, describeWriteError(sErr)) : HERE)
}

/**
 * Step 3, revisited: change the dish. Name and plates are updated; each row
 * becomes an update, an insert, or -- when the amount is cleared -- a removal
 * of that ingredient. Lines the setup form does not show (added later on the
 * recipe page) are left alone. EXACTLY ONE snapshot follows (F3).
 */
async function updateFirstDish(formData: FormData) {
  'use server'
  const { supabase, accountId } = await requireOwner()
  const back = at('dish')
  const recipeId = String(formData.get('recipe_id') ?? '')

  const name = String(formData.get('name') ?? '').trim()
  const plates = Number(formData.get('plates'))
  if (!name) redirect(withNotice(back, 'Give your dish a name.'))
  if (!Number.isFinite(plates) || plates <= 0) {
    redirect(withNotice(back, 'Enter how many plates one pot makes. It must be more than zero.'))
  }

  const ids = formData.getAll('ingredient_id').map(String)
  const lineIds = formData.getAll('line_id').map(String)
  const qtys = formData.getAll('qty').map(String)
  const unitIds = formData.getAll('unit_id').map(String)
  type Change = { lineId: string; ingredientId: string; qty: number | null; unitId: string }
  const changes: Change[] = []
  for (let i = 0; i < ids.length; i++) {
    const raw = (qtys[i] ?? '').trim()
    const qty = raw ? Number(raw) : null
    if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
      redirect(withNotice(back, 'Every amount you fill in must be more than zero. Clear a row to take that ingredient out.'))
    }
    changes.push({ lineId: lineIds[i] ?? '', ingredientId: ids[i], qty, unitId: unitIds[i] })
  }
  const { count: otherLines } = await supabase.from('recipe_lines').select('id', { count: 'exact', head: true })
    .eq('recipe_id', recipeId).is('ingredient_id', null)
  if (!changes.some((c) => c.qty !== null) && !otherLines) {
    redirect(withNotice(back, 'Keep at least one ingredient in the dish.'))
  }

  const { error: rErr } = await supabase.from('recipes').update({ name, batch_yield_qty: plates }).eq('id', recipeId)
  if (rErr) redirect(withNotice(back, describeWriteError(rErr) ?? 'We could not save that dish.'))

  for (const c of changes) {
    let error = null
    if (c.lineId && c.qty === null) {
      ({ error } = await supabase.from('recipe_lines').delete().eq('id', c.lineId))
    } else if (c.lineId && c.qty !== null) {
      ({ error } = await supabase.from('recipe_lines').update({ qty: c.qty, unit_id: c.unitId }).eq('id', c.lineId))
    } else if (!c.lineId && c.qty !== null) {
      ({ error } = await supabase.from('recipe_lines')
        .insert({ account_id: accountId, recipe_id: recipeId, ingredient_id: c.ingredientId, qty: c.qty, unit_id: c.unitId }))
    }
    if (error) redirect(withNotice(back, describeWriteError(error) ?? 'We could not save what goes into that dish.'))
  }

  const { error: sErr } = await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipeId })
  revalidatePath(HERE)
  redirect(withNotice(sErr ? back : at('price'), sErr ? describeWriteError(sErr) : 'Dish saved. Here is its new cost.'))
}

/**
 * Step 4: the owner's own selling price, appended as on the recipe page.
 * A price is history, never edited: a change adds the new price. The
 * "setup finished" moment is reported once, the first time only.
 */
async function setFirstPrice(formData: FormData) {
  'use server'
  const { supabase, accountId } = await requireOwner()
  const revisit = formData.get('revisit') === '1'
  const back = at('price')
  const recipeId = String(formData.get('recipe_id') ?? '')
  const price = requiredAmount(formData, 'price')
  if (price === null || price <= 0) {
    redirect(withNotice(back, 'Enter what you sell one plate for, in naira. It must be more than zero.'))
  }
  const { error } = await supabase.from('recipe_prices').insert({ account_id: accountId, recipe_id: recipeId, price })
  if (!error && !revisit) await queueEvent('setup_completed')
  revalidatePath(HERE)
  if (error) redirect(withNotice(back, describeWriteError(error)))
  redirect(revisit ? withNotice(at('done'), 'Price saved.') : HERE)
}

/** Step 1, revisited: the business's name and what it sells. */
async function updateBusiness(formData: FormData) {
  'use server'
  const { supabase, businessId } = await requireOwner()
  const back = at('business')
  const name = String(formData.get('name') ?? '').trim()
  const type = String(formData.get('business_type') ?? '')
  if (!name) redirect(withNotice(back, 'Give your business a name.'))
  if (name.length > 120) redirect(withNotice(back, 'That name is too long. Keep it under 120 characters.'))
  if (!isBusinessType(type)) redirect(withNotice(back, 'Choose what you sell.'))

  const { error } = await supabase.from('businesses').update({ name, type }).eq('id', businessId)
  if (error) {
    redirect(withNotice(back, error.code === '23505'
      ? 'You already have a business with that name. Try a slightly different name.'
      : describeWriteError(error) ?? 'We could not save your business details.'))
  }
  revalidatePath('/', 'layout')
  redirect(withNotice(at('purchase'), 'Business details saved.'))
}

/**
 * "Skip for now". Remembered on the login itself (user metadata), so every
 * device agrees, and in the setup cookie on this one, so the check stops at
 * once. Setup stays open at /start, from Home and from More.
 */
async function skipSetup() {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  await supabase.auth.updateUser({ data: { setup_skipped: true } })
  const jar = await cookies()
  jar.set(SETUP_COOKIE, user.id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 })
  redirect(withNotice('/dashboard', 'Setup skipped. You can finish it any time from Home or More → Setup guide.'))
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

export default async function StartPage(props: { searchParams: Promise<{ notice?: string; step?: string }> }) {
  const { notice, step: requested } = await props.searchParams
  const ctx = await currentContext()
  if (ctx.status !== 'ok') redirect(contextRedirect(ctx, HERE))
  // Setup is the owner's and manager's job; anyone else goes to the app.
  if (ctx.role !== 'owner' && ctx.role !== 'manager') redirect('/dashboard')
  const { supabase } = ctx
  const businessId = ctx.businessId as string

  const { data: status } = await supabase.from('v_onboarding_status')
    .select('prices_entered,complete_costings,selling_prices_set').limit(1)
    .maybeSingle<{ prices_entered: number; complete_costings: number; selling_prices_set: number }>()
  const progress = wizardStep({
    pricesEntered: status?.prices_entered ?? 0,
    completeCostings: status?.complete_costings ?? 0,
    pricesSet: status?.selling_prices_set ?? 0,
  })
  const view = resolveView(requested, progress)
  const revisit = isRevisit(view, progress)
  const { back, next } = neighbours(view, progress)

  const warning = notice && noticeTone(notice) === 'warn' ? <Notice>{notice}</Notice> : null

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {progress === 'done' ? (
          <Link href="/dashboard" className="mm-btn mm-btn-quiet">Go to my dashboard <AppIcon name="arrow-right" size={16} /></Link>
        ) : (
          <form action={skipSetup}>
            <Button variant="quiet" busyLabel="Skipping…">Skip setup for now</Button>
          </form>
        )}
      </div>
      <SetupSteps view={view} progress={progress} />
      {warning}
      {view === 'business' && <BusinessStep supabase={supabase} businessId={businessId} />}
      {view === 'purchase' && (revisit
        ? <PurchaseReview supabase={supabase} businessId={businessId} />
        : <PurchaseStep supabase={supabase} />)}
      {view === 'dish' && (revisit
        ? <DishReview supabase={supabase} businessId={businessId} />
        : <DishStep supabase={supabase} />)}
      {view === 'price' && <PriceStep supabase={supabase} businessId={businessId} revisit={revisit} />}
      {view === 'done' && <DoneStep supabase={supabase} />}
      <StepNav back={back} next={next} />
    </div>
  )
}

// --- step 1, revisited -------------------------------------------------------

async function BusinessStep({ supabase, businessId }: { supabase: Supabase; businessId: string }) {
  const { data: b } = await supabase.from('businesses').select('name, type').eq('id', businessId)
    .maybeSingle<{ name: string; type: string }>()

  return (
    <>
      <SetupTitle title="Your business">
        Change the name or what you sell. Your purchases, dishes and prices stay exactly as they are.
      </SetupTitle>
      <form action={updateBusiness} className="space-y-5">
        <label className="block">
          <span className="text-sm font-medium">Business name</span>
          <input name="name" required maxLength={120} defaultValue={b?.name ?? ''}
                 autoComplete="organization" className="mm-input mt-1" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What do you sell?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BUSINESS_TYPES.map((t) => (
              <label key={t.value} className="mm-card flex cursor-pointer items-start gap-3">
                <input type="radio" name="business_type" value={t.value} defaultChecked={b?.type === t.value}
                       className="mt-1 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-[13px]" style={{ color: 'var(--mm-muted)' }}>{t.example}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button className="w-full" busyLabel="Saving…">Save and continue</Button>
      </form>
    </>
  )
}

// --- step 2 ------------------------------------------------------------------

async function purchaseOptions(supabase: Supabase) {
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
  return { items, offered, common, units }
}

async function PurchaseStep({ supabase }: { supabase: Supabase }) {
  const { items, offered, common } = await purchaseOptions(supabase)
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

/** Step 2, revisited: what was recorded, and a pre-filled form to correct it. */
async function PurchaseReview({ supabase, businessId }: { supabase: Supabase; businessId: string }) {
  const purchase = await firstPurchase(supabase, businessId)
  if (!purchase) return <PurchaseStep supabase={supabase} />

  const [{ data: lines }, opts] = await Promise.all([
    supabase.from('purchase_lines').select('ingredient_id, qty, unit_id, amount').eq('purchase_id', purchase.id)
      .returns<{ ingredient_id: string; qty: string; unit_id: string; amount: string }[]>(),
    purchaseOptions(supabase),
  ])
  const { items, offered, common, units } = opts
  const nameOf = new Map(items.map((i) => [i.id, i.name]))
  const { data: extra } = await supabase.from('ingredients').select('id, name')
    .in('id', (lines ?? []).map((l) => l.ingredient_id).filter((id) => !nameOf.has(id)).concat(['00000000-0000-0000-0000-000000000000']))
    .returns<{ id: string; name: string }[]>()
  for (const e of extra ?? []) nameOf.set(e.id, e.name)
  const unitLabel = new Map(units.map((u) => [u.id, u.code]))
  for (const u of offered) unitLabel.set(u.id, u.label)

  // Correctable here only if every line uses an ingredient and unit this form
  // offers; anything else (a derica, a sub-measure) is corrected in Purchases.
  const offeredIds = new Set(offered.map((u) => u.id))
  const itemIds = new Set(items.map((i) => i.id))
  const correctable = (lines ?? []).every((l) => itemIds.has(l.ingredient_id) && offeredIds.has(l.unit_id))
  const initial: InitialRow[] = (lines ?? []).map((l) => ({
    ingredientId: l.ingredient_id, unitId: l.unit_id, qty: String(Number(l.qty)), amount: String(Number(l.amount)),
  }))

  return (
    <>
      <SetupTitle title="What you paid">
        This is the purchase you recorded. Spotted a mistake? Correct it below.
      </SetupTitle>
      <Card>
        <ul className="divide-y text-sm" style={{ borderColor: 'var(--mm-line)' }}>
          {(lines ?? []).map((l) => (
            <li key={l.ingredient_id} className="flex items-baseline justify-between gap-3 py-2" style={{ borderColor: 'var(--mm-line)' }}>
              <span className="min-w-0">
                {nameOf.get(l.ingredient_id) ?? 'Ingredient'}{' '}
                <span style={{ color: 'var(--mm-muted)' }}>{quantity(Number(l.qty), unitLabel.get(l.unit_id) ?? '')}</span>
              </span>
              <span className="mm-num font-medium">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {correctable ? (
        <Disclosure summary="Correct what you entered">
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
              Saving records the corrected purchase and cancels this one. The cancelled one stays in
              Purchases as a record, and your dish is re-costed with the corrected prices.
            </p>
            <PurchaseRows ingredients={items} units={offered} common={common} action={correctStarterPurchase}
                          initial={initial} hidden={{ purchase_id: purchase.id }}
                          submitLabel="Save the correction" busyLabel="Saving the correction…" />
          </div>
        </Disclosure>
      ) : (
        <p className="text-sm">
          <Link href={`/purchases/${purchase.id}`} className="mm-inline-tap font-semibold">Open this purchase</Link>{' '}
          to cancel it and record it again.
        </p>
      )}
    </>
  )
}

// --- step 3 ------------------------------------------------------------------

type DishRow = { id: string; name: string; options: { id: string; label: string }[]; lineId: string; qty: string; unitId: string }

async function dishRows(supabase: Supabase, existing: { id: string; ingredient_id: string; qty: string; unit_id: string }[]) {
  const [{ data: prices }, units] = await Promise.all([
    supabase.from('ingredient_prices').select('ingredient_id,effective_date')
      .is('reversed_at', null).order('effective_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(200).returns<{ ingredient_id: string }[]>(),
    unitRows(supabase),
  ])
  const inDish = existing.map((l) => l.ingredient_id)
  const pricedIds = [...new Set((prices ?? []).map((p) => p.ingredient_id))].slice(0, 12)
  const ids = [...new Set([...inDish, ...pricedIds])]
  const { data: ingredients } = await supabase.from('ingredients').select('id,name,base_unit_id')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    .returns<{ id: string; name: string; base_unit_id: string }[]>()

  const kindOfUnit = new Map(units.map((u) => [u.id, u.kind]))
  const codeOf = new Map(units.map((u) => [u.id, u.code]))
  const byCode = new Map(units.map((u) => [u.code, u.id]))
  return ids.flatMap((id): DishRow[] => {
    const ing = (ingredients ?? []).find((i) => i.id === id)
    const line = existing.find((l) => l.ingredient_id === id)
    const kind = ing ? kindOfUnit.get(ing.base_unit_id) : undefined
    if (!ing || (!isKind(kind) && !line)) return []
    const options = (isKind(kind) ? RECIPE_UNITS[kind] : []).flatMap((u) => {
      const uid = byCode.get(u.code)
      return uid ? [{ id: uid, label: u.label }] : []
    })
    // The unit the owner used stays on offer even if this form would not
    // offer it, so saving never changes it silently.
    if (line && !options.some((o) => o.id === line.unit_id)) {
      options.unshift({ id: line.unit_id, label: codeOf.get(line.unit_id) ?? 'current unit' })
    }
    return [{
      id: ing.id, name: ing.name, options,
      lineId: line?.id ?? '', qty: line ? String(Number(line.qty)) : '', unitId: line?.unit_id ?? options[0]?.id ?? '',
    }]
  })
}

function DishForm({ action, rows, recipe }: {
  action: (formData: FormData) => Promise<void>
  rows: DishRow[]
  recipe?: { id: string; name: string; plates: string }
}) {
  return (
    <form action={action} className="space-y-4">
      {recipe && <input type="hidden" name="recipe_id" value={recipe.id} />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Dish name</span>
            <input name="name" required defaultValue={recipe?.name} placeholder="e.g. Jollof rice and chicken" className="mm-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">One pot makes</span>
            <span className="mt-1 flex items-center gap-2">
              <input name="plates" type="number" step="any" min="0" inputMode="decimal" required
                     defaultValue={recipe?.plates} placeholder="e.g. 20" className="mm-input" />
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
              {recipe && <input type="hidden" name="line_id" value={r.lineId} />}
              <div className="grid grid-cols-[1fr_6rem_8rem] items-end gap-2">
                <span className="min-w-0 pb-3 font-medium">{r.name}</span>
                <label className="block">
                  <span className="sr-only">How much {r.name}</span>
                  <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                         defaultValue={r.qty} placeholder="0" className="mm-input" />
                </label>
                <label className="block">
                  <span className="sr-only">Unit for {r.name}</span>
                  <select name="unit_id" defaultValue={r.unitId} className="mm-input">
                    {r.options.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          {recipe
            ? 'Clear an amount to take that ingredient out of the dish.'
            : 'Only ingredients you have priced are listed, so the cost can be worked out straight away. You can add the rest of the recipe after setup.'}
        </p>
      </section>

      <Button className="w-full" busyLabel="Working out the cost…">
        {recipe ? 'Save and work out the cost' : 'Work out the cost'}
      </Button>
    </form>
  )
}

async function DishStep({ supabase }: { supabase: Supabase }) {
  const rows = await dishRows(supabase, [])
  return (
    <>
      <SetupTitle title="Now, one dish you sell">
        Tell us how many plates one pot makes and how much of each ingredient goes into that
        pot. Leave a row empty if the dish does not use it.
      </SetupTitle>
      <DishForm action={createFirstDish} rows={rows} />
    </>
  )
}

/** Step 3, revisited: the dish as it was saved, every field ready to change. */
async function DishReview({ supabase, businessId }: { supabase: Supabase; businessId: string }) {
  const dish = await firstDish(supabase, businessId)
  if (!dish) return <DishStep supabase={supabase} />
  const { data: lines } = await supabase.from('recipe_lines').select('id, ingredient_id, qty, unit_id')
    .eq('recipe_id', dish.id).not('ingredient_id', 'is', null)
    .returns<{ id: string; ingredient_id: string; qty: string; unit_id: string }[]>()
  const rows = await dishRows(supabase, lines ?? [])
  return (
    <>
      <SetupTitle title="Your first dish">
        Change the name, how many plates one pot makes, or how much of each ingredient goes in.
        The cost is worked out again when you save.
      </SetupTitle>
      <DishForm action={updateFirstDish} rows={rows}
                recipe={{ id: dish.id, name: dish.name, plates: String(Number(dish.batch_yield_qty)) }} />
    </>
  )
}

// --- step 4 ------------------------------------------------------------------

async function PriceStep({ supabase, businessId, revisit }: { supabase: Supabase; businessId: string; revisit: boolean }) {
  let dish: PriceCheck | undefined
  if (revisit) {
    const first = await firstDish(supabase, businessId)
    if (first) {
      const { data } = await supabase.from('v_price_check')
        .select('recipe_id,name,is_complete,cost_per_portion,selling_price,profit,margin_pct,recommended_price,target_margin')
        .eq('recipe_id', first.id).is('variant_id', null).limit(1).returns<PriceCheck[]>()
      dish = data?.[0]
    }
  } else {
    const { data: checks } = await supabase.from('v_price_check')
      .select('recipe_id,name,is_complete,cost_per_portion,selling_price,profit,margin_pct,recommended_price,target_margin')
      .is('variant_id', null).eq('is_complete', true).is('selling_price', null)
      .returns<PriceCheck[]>()
    dish = checks?.[0]
    if (!dish) redirect('/dashboard')
  }

  if (!dish || !dish.is_complete) {
    return (
      <>
        <SetupTitle title="Your price">
          Your dish&apos;s cost is not complete yet, so there is nothing to price against. Open
          &ldquo;Your first dish&rdquo; and make sure every ingredient in it has a price.
        </SetupTitle>
        <Link href={at('dish')} className="mm-btn mm-btn-primary w-full">Open your first dish</Link>
      </>
    )
  }

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
        {revisit && <input type="hidden" name="revisit" value="1" />}
        <label className="block">
          <span className="text-sm font-medium">
            {revisit ? 'Your price for one plate (₦)' : 'What do you sell one plate for? (₦)'}
          </span>
          <input name="price" type="number" step="0.01" min="0" inputMode="decimal" required
                 defaultValue={revisit && dish.selling_price ? Number(dish.selling_price) : undefined}
                 placeholder={dish.recommended_price ? `e.g. ${Number(dish.recommended_price)}` : 'e.g. 1500'}
                 className="mm-input mt-1" />
        </label>
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          {revisit
            ? 'Saving a different amount sets your new price. Your earlier prices are kept as history.'
            : 'Enter the price you actually charge. Not sure yet? Use the suggested price; you can change it any time.'}
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
