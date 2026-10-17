import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { BackLink, Card, Empty, Notice, SectionHeading, Stat, StatRow, Badge } from '@/components/ui'
import { DishTile } from '@/components/dish-tile'
import { DishPhotoUpload } from '@/components/dish-photo-upload'
import { CostBreakdown } from '@/components/charts'
import { setPrice } from '@/lib/actions/set-price'
import { money, percent, quantity, NOT_ENTERED } from '@/lib/format'
import { canSeeCosts, canSeeSellingPrices, canSetPrices } from '@/lib/pricing'
import { canAddDishPhotos } from '@/lib/dish-photo'
import { noticeTone } from '@/lib/ui/notice-tone'
import { setDishPhoto } from './actions'
import { canAddKindsOfWork, canEditDish, canMakeSizes } from './roles'
import { costParts, portionShare, type PartLine } from './breakdown'
import {
  DishFix, MissingNotice, MoneyCard, SalesPrices, SizesFix, SizesMoneyCard, VerdictWord, dishVerdict,
  type DishVerdict, type SizeMoney,
} from './money'
import { charged } from './charged'
import { AddIngredient, AddSubDish, WhatGoesIn } from './lines'
import { TimeItTakes } from './work'
import { AboutDish } from './about'
import { TryPrice } from './try-price'
import {
  dishBlockers, n, type Format, type LabourLine, type Line, type MenuPrice, type PriceCheck,
  type Settings, type Snapshot, type Unit, type Variant,
} from './types'

export const dynamic = 'force-dynamic'

type Recipe = {
  id: string; name: string; kind: string | null; category: string | null; business_id: string
  batch_yield_qty: string | null; yield_unit_id: string; portion_qty: string | null
  cooking_yield_pct: string | null; status: string | null; photo_path?: string | null
}

/** A plain recipe_lines row, for the roles that may not read costs. */
type PlainLine = {
  id: string; qty: string; ingredient_id: string | null; sub_recipe_id: string | null
  is_cost_bearing: boolean; unit_id: string
  unit: { code: string } | null
  ingredient: { name: string; kind: 'ingredient' | 'packaging' | null } | null
  sub: { name: string } | null
}

/** Run a read only when it is wanted; otherwise do not send it at all. */
async function when<T>(on: boolean, read: () => PromiseLike<{ data: T | null }>): Promise<T | null> {
  if (!on) return null
  const { data } = await read()
  return data
}

/**
 * v_price_check and fn_menu_prices repeat a row per sales channel. Keep one
 * per size (or for the dish itself), preferring one that carries a price.
 */
function onePer<T extends { variant_id: string | null; selling_price: string | null }>(rows: T[]): Map<string, T> {
  const by = new Map<string, T>()
  for (const r of rows) {
    const key = r.variant_id ?? ''
    const had = by.get(key)
    if (!had || (had.selling_price === null && r.selling_price !== null)) by.set(key, r)
  }
  return by
}

const RECIPE_COLUMNS = 'id,name,kind,category,business_id,batch_yield_qty,yield_unit_id,portion_qty,cooking_yield_pct,status'

// ---------------------------------------------------------------------------
// THE DISH PAGE, top to bottom: the photo and name; what it costs, sells for
// and keeps; what to charge, and a price to try; what is missing; what one
// portion is made of; what goes in; the time it takes; and the dish's own
// facts, folded away.
//
// WHO SEES WHAT is decided here, on the server, before anything is read:
//   owner, manager, accountant  costs, prices, "you keep", the fix
//   sales                       what it sells for (fn_menu_prices), no cost
//   kitchen                     what goes in and how much; no money at all
// A figure a role may not see is not queried, so it cannot reach the phone.
// The forms follow what the database lets each role write (roles.ts).
// ---------------------------------------------------------------------------

export default async function DishPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string; view?: string }>
}) {
  const { id } = await props.params
  const { notice, view } = await props.searchParams
  const here = `/recipes/${id}`

  const ctx = await currentContext()
  const { supabase } = ctx
  if (!ctx.accountId) redirect(contextRedirect(ctx, here))

  const role = ctx.role
  const costs = canSeeCosts(role)
  const setsPrices = canSetPrices(role)
  const seesPrices = canSeeSellingPrices(role)
  const edits = canEditDish(role)
  const photos = canAddDishPhotos(role)
  const addsKinds = canAddKindsOfWork(role)
  const makesSizes = canMakeSizes(role)
  const pro = costs && view === 'pro'
  const returnTo = pro ? `${here}?view=pro` : here

  // photo_path arrives with 0063. Before it is applied the column does not
  // exist and asking for it fails the whole read, so the page asks again
  // without it rather than calling every dish missing.
  let { data: found, error: foundError } = await supabase.from('recipes')
    .select(`${RECIPE_COLUMNS},photo_path`).eq('id', id).is('deleted_at', null).maybeSingle<Recipe>()
  if (foundError?.code === '42703') {
    ({ data: found, error: foundError } = await supabase.from('recipes')
      .select(RECIPE_COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle<Recipe>())
  }
  if (!found) notFound()
  const recipe = found

  const [
    units, ingredients, otherRecipes, costLines, plainLines, checks, snaps, settings,
    menuPrices, basisRows, formats, variants, labourLines, labourRates,
  ] = await Promise.all([
    when(true, () => supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>()),
    when(edits, () => supabase.from('ingredients').select('id,name').is('deleted_at', null).eq('is_active', true)
      .order('name').returns<{ id: string; name: string }[]>()),
    when(edits, () => supabase.from('recipes').select('id,name,yield_unit_id')
      .is('deleted_at', null).neq('id', id).order('name')
      .returns<{ id: string; name: string; yield_unit_id: string }[]>()),
    // v_recipe_line_costs prices every line and raises for a role that may
    // not see costs (fn_require_cost_access), so those roles read the lines
    // themselves: names and quantities, no money.
    when(costs, () => supabase.from('v_recipe_line_costs').select('*').eq('recipe_id', id).returns<Line[]>()),
    when(!costs, () => supabase.from('recipe_lines')
      .select('id,qty,ingredient_id,sub_recipe_id,is_cost_bearing,unit_id,'
        + 'unit:units!recipe_lines_unit_id_fkey(code),'
        + 'ingredient:ingredients!recipe_lines_ingredient_id_fkey(name,kind),'
        + 'sub:recipes!recipe_lines_sub_recipe_id_fkey(name)')
      .eq('recipe_id', id).returns<PlainLine[]>()),
    when(costs, () => supabase.from('v_price_check')
      .select('recipe_id,is_complete,selling_price,profit,margin_pct,recommended_price,target_margin,markup_pct,variant_id,format_name,resolved_qty,cost_per_portion')
      .eq('recipe_id', id).returns<PriceCheck[]>()),
    // The dish's OWN newest snapshot (variant_id null): the row v_price_check
    // costs the dish from. Not v_recipe_cost_current, whose newest row is
    // usually the last size's (recompute writes the dish, then each size), so
    // one size missing its packaging price would hide every complete size.
    // RLS lets only the cost roles read cost_snapshots, as the views do.
    when(costs, () => supabase.from('cost_snapshots')
      .select('is_complete,unpriced_items,required_inputs,priced_inputs,excluded_inputs,ingredient_cost,packaging_cost,labour_cost,overhead_cost,batch_cost,cost_per_yield_unit,cost_per_portion')
      .eq('recipe_id', id).is('variant_id', null)
      .order('computed_at', { ascending: false }).order('seq', { ascending: false }).limit(1)
      .returns<Snapshot[]>()),
    when(costs, () => supabase.from('business_settings')
      .select('default_target_margin,overhead_enabled,price_rounding_to,show_markup_alongside')
      .eq('business_id', recipe.business_id).returns<Settings[]>()),
    // Selling prices only, never a cost (0064). Before 0064, or on any
    // error, there are simply no prices to show.
    when(seesPrices && !costs, async () => {
      const { data } = await supabase.rpc('fn_menu_prices').select('recipe_id,variant_id,selling_price')
        .eq('recipe_id', id)
      return { data: Array.isArray(data) ? (data as MenuPrice[]) : null }
    }),
    when(true, () => supabase.from('v_recipe_basis').select('costing_basis,active_formats,portion_qty')
      .eq('recipe_id', id)
      .returns<{ costing_basis: string; active_formats: number; portion_qty: string | null }[]>()),
    when(edits, () => supabase.from('serving_formats').select('id,name,capacity_qty,capacity_unit:units(code)')
      .eq('is_active', true).order('name').returns<Format[]>()),
    when(true, () => supabase.from('recipe_variants')
      .select('id,is_active,format:serving_formats!fk_recipe_variants_format(id,name,capacity_qty,capacity_unit:units(code))')
      .eq('recipe_id', id).returns<Variant[]>()),
    // The hourly rate is a cost: read only for the roles that see costs.
    when(true, () => supabase.from('recipe_labour')
      .select(costs
        ? 'id,hours,rate:labour_rates!recipe_labour_labour_rate_id_fkey(id,name,rate_per_hour)'
        : 'id,hours,rate:labour_rates!recipe_labour_labour_rate_id_fkey(id,name)')
      .eq('recipe_id', id).returns<LabourLine[]>()),
    when(edits, () => supabase.from('labour_rates').select('id,name').eq('is_active', true)
      .order('name').returns<{ id: string; name: string }[]>()),
  ])

  // One shape for the lines, whoever is looking. The plain read leaves every
  // cost field null: not zero, not known to this person.
  const lines: Line[] = costs ? (costLines ?? []) : (plainLines ?? []).map((l) => ({
    line_id: l.id, ingredient_id: l.ingredient_id, sub_recipe_id: l.sub_recipe_id,
    item_name: l.ingredient?.name ?? l.sub?.name ?? null,
    item_kind: l.ingredient?.kind ?? null,
    is_cost_bearing: l.is_cost_bearing,
    recipe_qty: l.qty, recipe_unit: l.unit?.code ?? null, unit_id: l.unit_id,
    base_unit: null, base_qty: null, unit_cost: null, line_cost: null,
    purchase_qty_base: null, purchase_amount: null, purchase_date: null, purchase_count: null,
    cost_basis: null, problem: null,
  }))

  // Every server render gets a new stamp; a row's sheet closes when it changes.
  const stamp = Date.now()
  const unitList = units ?? []
  const unitById = new Map(unitList.map((u) => [u.id, u]))
  const yieldCode = unitById.get(recipe.yield_unit_id)?.code ?? NOT_ENTERED
  const sellsOnItsOwn = recipe.kind !== 'sub_recipe'

  const batchYield = n(recipe.batch_yield_qty)
  const portionQty = n(recipe.portion_qty)
  const cookingYield = n(recipe.cooking_yield_pct) ?? 100
  const effectiveYield = batchYield === null ? null : batchYield * (cookingYield / 100)
  const portions = effectiveYield !== null && portionQty !== null && portionQty > 0
    ? Math.floor(effectiveYield / portionQty)
    : null

  const activeVariants = (variants ?? []).filter((v) => v.is_active)
  const basis = basisRows?.[0] ?? null
  const bySize = basis?.costing_basis === 'format'

  // ---- money, for the cost roles -------------------------------------------
  const s = snaps?.[0]
  const costed = s?.is_complete === true
  const blockers = dishBlockers(s)
  const bs = settings?.[0]
  // v_price_check emits one row for the dish itself (variant_id null) while it
  // has no sizes, and one per size once it has. A size's margin is not the
  // dish's, so the two are kept apart.
  const priceRows = onePer(checks ?? [])
  const check = priceRows.get('')
  const sizeChecks = activeVariants.flatMap((v) => {
    const c = priceRows.get(v.id)
    return c ? [{ v, c }] : []
  })
  // The verdict and its target are v_price_check's own, judged by
  // v_product_attention's rule (dishVerdict), so this page names a dish the
  // way Home and Dishes do and offers the fix exactly where they do. No
  // fallback to the business default: the view does not fall back either.
  const target = n(check?.target_margin)
  const marginPct = n(check?.margin_pct)
  const verdict = dishVerdict(check)
  const price = n(check?.selling_price)
  const suggested = n(check?.recommended_price)
  const fixable = (v: DishVerdict | null, rec: number | null): rec is number =>
    !!v && (v.state === 'losing_money' || v.state === 'below_target') && rec !== null && rec > 0

  const sizes: (SizeMoney & { suggested: number | null; target: number | null })[] = sizeChecks.map(({ v, c }) => {
    const m = n(c.margin_pct)
    const t = n(c.target_margin)
    return {
      variantId: v.id,
      name: c.format_name ?? v.format?.name ?? 'Size',
      complete: c.is_complete,
      cost: c.is_complete ? n(c.cost_per_portion) : null,
      price: n(c.selling_price),
      keep: n(c.profit),
      marginPct: m,
      verdict: dishVerdict(c),
      suggested: n(c.recommended_price),
      target: t,
    }
  })

  // ---- selling prices, for a sales member --------------------------------
  const menu = onePer(menuPrices ?? [])
  const salesSizes = activeVariants.map((v) => ({
    variantId: v.id, name: v.format?.name ?? 'Size', price: n(menu.get(v.id)?.selling_price),
  }))

  // Which ingredient each missing item is, so its fix can be linked.
  const idByName = new Map(lines.flatMap((l) =>
    l.ingredient_id && l.item_name ? [[l.item_name, l.ingredient_id] as const] : []))

  // ---- what one portion is made of -----------------------------------------
  const share = !bySize ? portionShare(portionQty, batchYield, cookingYield) : null
  const partLines: PartLine[] = lines.map((l) => ({
    name: l.item_name ?? 'Unknown item',
    packaging: l.item_kind === 'packaging',
    costBearing: l.is_cost_bearing,
    lineCost: n(l.line_cost),
  }))
  const partLabour = (labourLines ?? []).map((l) => ({ hours: Number(l.hours), ratePerHour: n(l.rate?.rate_per_hour) }))
  const parts = costs && lines.length > 0
    ? costParts({
        lines: partLines,
        labour: partLabour,
        scale: share ?? 1,
        runningCosts: share !== null && bs?.overhead_enabled ? n(s?.overhead_cost) : undefined,
      })
    : []

  const sub = [
    recipe.category,
    !sellsOnItsOwn ? 'used inside other dishes'
      : bySize ? `sold in ${activeVariants.length} size${activeVariants.length === 1 ? '' : 's'}`
      : portions !== null ? `about ${portions} portion${portions === 1 ? '' : 's'} a batch`
      : portionQty === null ? 'no portion size yet' : null,
  ].filter(Boolean).join(' · ')

  const otherView = pro ? here : `${here}?view=pro`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink href="/recipes">Dishes</BackLink>
        {costs && (
          <Link href={otherView} className="mm-tap text-sm underline" style={{ color: 'var(--mm-muted)' }}>
            {pro ? 'Hide the detail' : 'See every cost'}
          </Link>
        )}
      </div>

      {/* 1. THE DISH: her photo, or its tile until she takes one. */}
      <header className="space-y-3">
        <DishTile name={recipe.name} photoPath={recipe.photo_path ?? null} size="lg" />
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight break-words">{recipe.name}</h1>
          {sub && <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{sub}</p>}
        </div>
        {photos && (
          <DishPhotoUpload businessId={recipe.business_id} recipeId={recipe.id}
                           photoPath={recipe.photo_path ?? null} action={setDishPhoto} returnTo={returnTo} />
        )}
      </header>

      {notice && <Notice tone={noticeTone(notice)}>{notice}</Notice>}

      {/* 2. THE MONEY. Cost roles: what it costs, sells for and keeps, or what
             is still missing. Sales: what it sells for. Kitchen: nothing. */}
      {costs && (
        <section className="space-y-3">
          {!s ? (
            <Empty>Add what goes into one batch and the cost shows here.</Empty>
          ) : !costed ? (
            <MissingNotice blockers={blockers} idByName={idByName} />
          ) : !sellsOnItsOwn ? (
            <MoneyCard costLabel={`Cost per ${yieldCode}`} cost={n(s.cost_per_yield_unit)} />
          ) : bySize ? (
            <SizesMoneyCard sizes={sizes} />
          ) : (
            <MoneyCard
              costLabel="Cost per portion"
              cost={n(s.cost_per_portion)}
              costSub={portionQty !== null ? `for ${quantity(portionQty, yieldCode)}` : undefined}
              price={price}
              keep={n(check?.profit)}
              verdict={verdict}
              marginPct={marginPct}
            />
          )}
          {/* A size can be blocked while the dish itself is complete. */}
          {costed && bySize && sizes.some((z) => !z.complete) && (
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
              A size marked “Cost incomplete” is missing something of its own, such as its packaging price.
            </p>
          )}
        </section>
      )}

      {!costs && seesPrices && sellsOnItsOwn && (
        <SalesPrices dishPrice={n(menu.get('')?.selling_price)} sizes={salesSizes} />
      )}

      {/* 3. THE FIX AND THE PRICE, for the roles that set prices. The price
             form is drawn once, here, whether or not the dish has a price. */}
      {setsPrices && sellsOnItsOwn && (
        <section className="space-y-3">
          {!bySize && costed && verdict && (verdict.state === 'losing_money' || fixable(verdict, suggested)) && (
            <DishFix recipeId={recipe.id} dishName={recipe.name} verdict={verdict}
                     suggested={suggested} target={target} returnTo={returnTo} />
          )}
          {bySize && (
            <SizesFix recipeId={recipe.id} dishName={recipe.name} returnTo={returnTo}
              sizes={sizes.flatMap((z) => z.verdict && fixable(z.verdict, z.suggested)
                ? [{ variantId: z.variantId, name: z.name, suggested: z.suggested, target: z.target, verdict: z.verdict }]
                : [])} />
          )}

          {!bySize ? (
            <div className="mm-card space-y-1">
              <h2 className="text-base font-semibold tracking-tight">{price !== null ? 'Try a price' : 'Set your selling price'}</h2>
              {costed && price !== null && (
                <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>Nothing changes until you save.</p>
              )}
              <div className="pt-2">
                <TryPrice
                  key={String(price)}
                  recipeId={recipe.id} action={setPrice} returnTo={returnTo}
                  label="Price per portion (₦)"
                  current={price}
                  cost={costed && check?.is_complete ? n(check.cost_per_portion) : null}
                  suggested={costed ? suggested : null}
                  target={target}
                  rounding={n(bs?.price_rounding_to)}
                  slider
                />
              </div>
            </div>
          ) : sizes.length > 0 && (
            <div className="mm-card space-y-4">
              <h2 className="text-base font-semibold tracking-tight">Your prices</h2>
              {sizes.map((z, i) => (
                <div key={z.variantId} className={i === 0 ? '' : 'border-t pt-4'} style={{ borderColor: 'var(--mm-line)' }}>
                  <TryPrice
                    key={String(z.price)}
                    recipeId={recipe.id} variantId={z.variantId} action={setPrice} returnTo={returnTo}
                    label={`Price for ${z.name} (₦)`}
                    current={z.price}
                    cost={z.complete ? z.cost : null}
                    suggested={z.complete ? z.suggested : null}
                    target={z.target}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 5. WHAT ONE PORTION IS MADE OF: one bar, unknown parts hatched. */}
      {parts.length > 0 && (
        <section className="space-y-3">
          <SectionHeading sub={`This covers the ingredients, packaging and labour you have entered${bs?.overhead_enabled
            ? ', plus a share of your monthly bills.'
            : '. Monthly bills such as rent, gas and light are switched off under Settings.'}`}>
            {share !== null ? 'What one portion is made of' : 'What one batch is made of'}
          </SectionHeading>
          <div className="mm-card">
            <CostBreakdown
              parts={parts}
              total={share !== null ? (costed ? n(s?.cost_per_portion) : null) : (costed ? n(s?.batch_cost) : null)}
              ariaLabel={share !== null ? `What one portion of ${recipe.name} is made of.` : `What one batch of ${recipe.name} is made of.`}
            />
          </div>
        </section>
      )}

      {/* 6. WHAT GOES IN: short rows; tap one to change or remove it. */}
      <section className="space-y-3">
        <SectionHeading sub={edits
          ? 'What one batch uses. Tap an item to change how much, or to remove it.'
          : 'What one batch uses.'}>
          What goes in
        </SectionHeading>

        {lines.length === 0 ? (
          <Empty>Nothing in this dish yet.{edits ? ' Add what goes into one batch and the cost works itself out as you go.' : ''}</Empty>
        ) : (
          <WhatGoesIn
            lines={lines} recipeId={recipe.id} units={unitList}
            costs={costs} edits={edits} pro={pro} stamp={stamp}
            footer={costs && costed && n(s?.batch_cost) !== null ? (
              <span className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">One batch{portions !== null && !bySize
                  ? <span className="font-normal" style={{ color: 'var(--mm-muted)' }}> · about {portions} portions</span>
                  : null}</span>
                <span className="mm-num font-semibold">{money(n(s?.batch_cost))}</span>
              </span>
            ) : undefined}
          />
        )}

        {edits && (
          <>
            <AddIngredient recipeId={recipe.id} ingredients={ingredients ?? []} units={unitList} open={lines.length === 0} />
            <AddSubDish recipeId={recipe.id} dishes={otherRecipes ?? []} units={unitList}
                        unitCode={(uid) => unitById.get(uid)?.code ?? '?'} />
          </>
        )}
      </section>

      {/* EVERY COST: the full worksheet, behind "See every cost". Every
          figure here is read from v_price_check or the dish's own snapshot. */}
      {pro && costed && s && (
        <section className="space-y-4">
          <SectionHeading sub="Everything the batch costs you, and where it goes.">Every cost</SectionHeading>

          <StatRow>
            <Stat label="Ingredients (batch)" value={money(n(s.ingredient_cost))} />
            <Stat label="Packaging (batch)" value={money(n(s.packaging_cost))}
              sub={n(s.packaging_cost) === 0 ? 'none recorded' : undefined} />
            <Stat label="Paid work (batch)" value={money(n(s.labour_cost))}
              sub={n(s.labour_cost) === 0 ? 'none recorded' : undefined} />
          </StatRow>
          <StatRow>
            <Stat label="Batch cost" value={money(n(s.batch_cost))} sub="ingredients + packaging + paid work" />
            <Stat label={`Cost per ${yieldCode}`} value={money(n(s.cost_per_yield_unit))} />
            <Stat label="Monthly bills per portion"
              value={bs?.overhead_enabled ? money(n(s.overhead_cost)) : NOT_ENTERED}
              sub={bs?.overhead_enabled ? 'from your monthly overheads' : 'overheads are switched off'} />
          </StatRow>

          <Card>
            <p className="mb-3 text-sm font-medium">Where the batch cost goes</p>
            <CostBreakdown
              parts={costParts({ lines: partLines, labour: partLabour, scale: 1 })}
              total={n(s.batch_cost)}
              ariaLabel={`Where the batch cost of ${recipe.name} goes.`}
            />
          </Card>

          {sellsOnItsOwn && !bySize && (
            <Card>
              <p className="text-sm font-medium">Profitability, per portion</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt style={{ color: 'var(--mm-muted)' }}>It costs you</dt>
                <dd className="mm-num">{money(n(s.cost_per_portion))}</dd>
                <dt style={{ color: 'var(--mm-muted)' }}>You sell it for</dt>
                <dd className="mm-num">{charged(price)}</dd>
                <dt style={{ color: 'var(--mm-muted)' }}>You keep</dt>
                <dd className="mm-num">{money(n(check?.profit))}</dd>
                <dt style={{ color: 'var(--mm-muted)' }}>Margin — what you keep, as a share of the price</dt>
                <dd className="mm-num">{percent(marginPct)}</dd>
                {bs?.show_markup_alongside && (
                  <>
                    <dt style={{ color: 'var(--mm-muted)' }}>Markup (added to your cost)</dt>
                    <dd className="mm-num">{percent(n(check?.markup_pct))}</dd>
                  </>
                )}
                <dt style={{ color: 'var(--mm-muted)' }}>Your target margin</dt>
                <dd className="mm-num">{percent(target)}</dd>
                <dt style={{ color: 'var(--mm-muted)' }}>Price to hit that target</dt>
                <dd className="mm-num">{charged(suggested)}</dd>
                <dt style={{ color: 'var(--mm-muted)' }}>Status</dt>
                <dd>{verdict ? <VerdictWord verdict={verdict} marginPct={null} /> : <Badge tone="muted">No price set</Badge>}</dd>
              </dl>
              {bs?.show_markup_alongside && (
                <p className="mt-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                  Margin is your profit as a share of what you charge. Markup is the same profit as a share of
                  what it cost you. They are always different numbers for the same dish.
                </p>
              )}
            </Card>
          )}

          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt style={{ color: 'var(--mm-muted)' }}>Batch makes</dt>
              <dd className="mm-num">{quantity(batchYield, yieldCode)}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>After cooking loss</dt>
              <dd className="mm-num">{quantity(effectiveYield, yieldCode)} ({cookingYield}%)</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>One portion</dt>
              <dd className="mm-num">{quantity(portionQty, yieldCode)}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>Portions per batch</dt>
              <dd className="mm-num">{portions ?? NOT_ENTERED}</dd>
            </dl>
          </Card>
        </section>
      )}

      {/* 7. TIME IT TAKES: visible, because labour is what owners forget. */}
      <TimeItTakes
        recipeId={recipe.id} labour={labourLines ?? []} rates={labourRates ?? []}
        costs={costs} edits={edits} addsKinds={addsKinds} stamp={stamp}
      />

      {/* 8. ABOUT THIS DISH: edit, sizes, put away. Folded. */}
      {(edits || makesSizes) && (
        <AboutDish
          recipe={{
            id: recipe.id, name: recipe.name, category: recipe.category,
            batch_yield_qty: batchYield, yield_unit_id: recipe.yield_unit_id,
            portion_qty: portionQty, cooking_yield_pct: cookingYield,
          }}
          units={unitList}
          yieldCode={yieldCode}
          edits={edits}
          makesSizes={makesSizes}
          sellsOnItsOwn={sellsOnItsOwn}
          variants={activeVariants}
          formats={(formats ?? []).filter((f) => !activeVariants.some((v) => v.format?.id === f.id))}
        />
      )}
    </div>
  )
}
