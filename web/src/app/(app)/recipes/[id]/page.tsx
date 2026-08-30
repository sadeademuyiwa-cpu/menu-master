import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, inputClass, inputStyle,
  Notice, SectionHeading, BackLink, Empty, Stat, StatRow, HeroStat, CostBar, Disclosure,
} from '@/components/ui'
import { money, percent, quantity, marginVerdict, NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Unit = { id: string; code: string; name: string; kind: string }
type LineCost = {
  line_id: string; ingredient_id: string | null; sub_recipe_id: string | null
  item_name: string | null; item_kind: 'ingredient' | 'packaging' | null
  is_cost_bearing: boolean; exclusion_reason: string | null
  recipe_qty: string; recipe_unit: string | null; base_unit: string | null
  base_qty: string | null; unit_cost: string | null; line_cost: string | null
  purchase_qty_base: string | null; purchase_amount: string | null; purchase_date: string | null
  purchase_count: number | null; cost_basis: string | null
  problem: 'ok' | 'missing_price' | 'missing_conversion' | 'excluded' | 'sub_recipe'
}
type Snapshot = {
  is_complete: boolean
  required_inputs: number; priced_inputs: number; excluded_inputs: number
  ingredient_cost: string | null; packaging_cost: string | null
  labour_cost: string | null; overhead_cost: string | null
  batch_cost: string | null; cost_per_yield_unit: string | null; cost_per_portion: string | null
}
type PriceCheck = {
  recipe_id: string; is_complete: boolean
  selling_price: string | null; profit: string | null
  margin_pct: string | null; recommended_price: string | null; target_margin: string | null
}
type Blocker = { problem: string; ingredient_name: string | null; unit_code: string | null; item: string | null }

const n = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v)

// ---------------------------------------------------------------------------
// WRITES
//
// F3 IS A HARD INVARIANT. Nothing recomputes a recipe when its lines change:
// 0008 installs recompute triggers on ingredient_prices,
// ingredient_unit_conversions and ingredients, and recipe_lines carries only a
// cycle guard. Every line mutation is followed by an explicit snapshot, and
// EXACTLY ONE per action -- two snapshots in one transaction share now(), and
// v_recipe_cost_current's "latest" is then ambiguous (tests/021 check 20).
// ---------------------------------------------------------------------------

async function recompute(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recipeId: string,
): Promise<string | null> {
  const { error } = await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipeId })
  return error ? describeWriteError(error) : null
}

async function addLine(formData: FormData) {
  'use server'
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect(withNotice(here, 'No account found for your login.'))

  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how much of that ingredient the recipe uses. It must be greater than zero.'))
  }

  const { error } = await supabase.from('recipe_lines').insert({
    account_id: accountId,
    recipe_id: recipeId,
    ingredient_id: String(formData.get('ingredient_id') ?? ''),
    qty,
    unit_id: String(formData.get('unit_id') ?? ''),
  })
  if (error) redirect(withNotice(here, describeWriteError(error)))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Ingredient added.'))
}

async function updateLineQty(formData: FormData) {
  'use server'
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const { supabase } = await currentContext()

  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'A quantity has to be greater than zero.'))
  }

  const { error } = await supabase.from('recipe_lines')
    .update({ qty }).eq('id', String(formData.get('line_id') ?? ''))
  if (error) redirect(withNotice(here, describeWriteError(error)))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Quantity updated.'))
}

async function removeLine(formData: FormData) {
  'use server'
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const { supabase } = await currentContext()

  const { error } = await supabase.from('recipe_lines')
    .delete().eq('id', String(formData.get('line_id') ?? ''))
  if (error) redirect(withNotice(here, describeWriteError(error)))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Ingredient removed.'))
}

/**
 * Selling price. Appended, never overwritten, so last month's margin stays
 * true. Margin and recommended price are NOT computed here -- v_price_check
 * owns that arithmetic and withholds it entirely while the costing is
 * incomplete.
 */
async function setSellingPrice(formData: FormData) {
  'use server'
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect(withNotice(here, 'No account found for your login.'))

  const price = Number(formData.get('price'))
  if (!Number.isFinite(price) || price < 0) {
    redirect(withNotice(here, 'Enter the price you sell one portion for.'))
  }

  const { error } = await supabase.from('recipe_prices')
    .insert({ account_id: accountId, recipe_id: recipeId, price })

  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Selling price saved.'))
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------

export default async function RecipeDetail(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string; view?: string }>
}) {
  const { id } = await props.params
  const { notice, view } = await props.searchParams
  const pro = view === 'pro'
  const supabase = await createClient()

  const { data: recipe } = await supabase.from('recipes')
    .select('id,name,category,business_id,batch_yield_qty,yield_unit_id,portion_qty,cooking_yield_pct,status')
    .eq('id', id).is('deleted_at', null).maybeSingle()

  if (!recipe) notFound()

  const [{ data: lines }, { data: units }, { data: ingredients },
         { data: checks }, { data: blockers }, { data: snap }, { data: settings }] =
    await Promise.all([
      supabase.from('v_recipe_line_costs').select('*').eq('recipe_id', id).returns<LineCost[]>(),
      supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
      supabase.from('ingredients').select('id,name').is('deleted_at', null).eq('is_active', true)
        .order('name').returns<{ id: string; name: string }[]>(),
      supabase.from('v_price_check')
        .select('recipe_id,is_complete,selling_price,profit,margin_pct,recommended_price,target_margin')
        .eq('recipe_id', id).returns<PriceCheck[]>(),
      supabase.from('v_costing_blockers')
        .select('problem,ingredient_name,unit_code,item').eq('recipe_id', id).returns<Blocker[]>(),
      supabase.from('v_recipe_cost_current')
        .select('is_complete,required_inputs,priced_inputs,excluded_inputs,ingredient_cost,packaging_cost,labour_cost,overhead_cost,batch_cost,cost_per_yield_unit,cost_per_portion')
        .eq('recipe_id', id).returns<Snapshot[]>(),
      supabase.from('business_settings')
        .select('default_target_margin,overhead_enabled,price_rounding_to')
        .eq('business_id', recipe.business_id)
        .returns<{ default_target_margin: string | null; overhead_enabled: boolean; price_rounding_to: string | null }[]>(),
    ])

  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const yieldCode = unitById.get(recipe.yield_unit_id)?.code ?? NOT_ENTERED
  const s = snap?.[0]
  const check = checks?.find((c) => c.selling_price !== null) ?? checks?.[0]
  const bs = settings?.[0]
  const costed = s?.is_complete === true

  const batchYield = n(recipe.batch_yield_qty)
  const portionQty = n(recipe.portion_qty)
  const cookingYield = n(recipe.cooking_yield_pct) ?? 100
  const effectiveYield = batchYield === null ? null : batchYield * (cookingYield / 100)
  const portions = effectiveYield !== null && portionQty !== null && portionQty > 0
    ? Math.floor(effectiveYield / portionQty)
    : null

  const marginPct = n(check?.margin_pct ?? null)
  const target = n(check?.target_margin ?? bs?.default_target_margin ?? null)
  const verdict = marginVerdict(marginPct, target)

  // Cost breakdown. ONLY the categories this business actually tracks: a
  // component that invented "Gas 8%" would be lying about a number nobody
  // entered. It grows on its own as the costing model grows.
  const batchCost = n(s?.batch_cost ?? null)
  const breakdown: { label: string; amount: number; pct: number }[] =
    costed && batchCost !== null && batchCost > 0
      ? [
          { label: 'Ingredients', amount: n(s?.ingredient_cost ?? null) },
          { label: 'Packaging', amount: n(s?.packaging_cost ?? null) },
          { label: 'Labour', amount: n(s?.labour_cost ?? null) },
        ].flatMap((p) =>
          p.amount !== null && p.amount > 0
            ? [{ label: p.label, amount: p.amount, pct: (p.amount / batchCost) * 100 }]
            : [],
        )
      : []

  const cookLines = (lines ?? []).filter((l) => l.item_kind !== 'packaging')
  const packLines = (lines ?? []).filter((l) => l.item_kind === 'packaging')
  const byCost = (a: LineCost, b: LineCost) =>
    (n(b.line_cost) ?? -1) - (n(a.line_cost) ?? -1)

  const otherView = pro ? `/recipes/${id}` : `/recipes/${id}?view=pro`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink href="/recipes">← All recipes</BackLink>
        <Link href={otherView} className="text-sm underline" style={{ color: 'var(--mm-muted)' }}>
          {pro ? 'Simple view' : 'Full costing view'}
        </Link>
      </div>

      {/* 1. HEADER ----------------------------------------------------- */}
      <PageHeader
        title={recipe.name}
        sub={[
          recipe.category,
          batchYield !== null ? `One batch makes ${batchYield} ${yieldCode}` : null,
          portionQty !== null ? `one portion is ${portionQty} ${yieldCode}` : 'no portion size set',
          portions !== null ? `about ${portions} portions` : null,
        ].filter(Boolean).join(' · ')}
      />

      {notice && (
        <Notice tone={/could not|must be|does not allow|already/i.test(notice) ? 'warn' : 'info'}>
          {notice}
        </Notice>
      )}

      {/* 2. THE NUMBERS ------------------------------------------------ */}
      <section className="space-y-3">
        {!s ? (
          <Empty>Add your first ingredient below and the cost appears here.</Empty>
        ) : costed ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <HeroStat
                label="Cost per portion"
                value={money(n(s.cost_per_portion))}
                sub={portionQty !== null ? `for ${portionQty} ${yieldCode}` : 'no portion size set'}
              />
              <HeroStat
                label="You sell it for"
                value={money(n(check?.selling_price ?? null))}
                sub={check?.selling_price ? undefined : 'not set yet'}
              />
              <HeroStat
                label="Profit per portion"
                value={money(n(check?.profit ?? null))}
                tone={verdict?.tone === 'bad' ? 'bad' : verdict?.tone === 'good' ? 'good' : 'plain'}
                sub={verdict ? `${percent(marginPct)} — ${verdict.label}` : 'set a selling price'}
              />
            </div>

            {verdict && (
              <Notice tone={verdict.tone === 'bad' || verdict.tone === 'warn' ? 'warn' : 'info'}>
                <span className="font-medium">{verdict.label}.</span> {verdict.sentence}
                {verdict.tone === 'bad' && check?.recommended_price !== null && (
                  <> To reach your target you would need {money(n(check?.recommended_price ?? null))} a portion.</>
                )}
              </Notice>
            )}
          </>
        ) : (
          /* 2b. THE REFUSAL. Never ₦0 — a named, actionable blocker. */
          <Notice>
            {/*
              Not "{priced} of {required} items". The engine counts inputs the
              owner cannot see on this screen -- for a dish, portion size is a
              required input (0007), so two visible ingredients read as "2 of 3"
              and the third item is unfindable. The count below is the length of
              the list directly under it, so every number on screen can be
              accounted for by something also on screen.
            */}
            <p className="font-medium">
              {(blockers ?? []).length === 1
                ? 'Cost incomplete — one thing is still missing.'
                : `Cost incomplete — ${(blockers ?? []).length} things are still missing.`}
            </p>
            <ul className="mt-2 space-y-1">
              {(blockers ?? []).map((b, i) => (
                <li key={i}>
                  {b.problem === 'missing_price' &&
                    <>Cost incomplete — <strong>{b.ingredient_name ?? b.item}</strong> has no purchase price.</>}
                  {b.problem === 'missing_conversion' &&
                    <>Cost incomplete — tell us how much one <strong>{b.unit_code ?? 'measure'}</strong> of{' '}
                      <strong>{b.ingredient_name ?? b.item}</strong> weighs.</>}
                  {b.problem === 'missing_portion_size' &&
                    <>Cost incomplete — set how much one portion is, above.</>}
                  {!['missing_price','missing_conversion','missing_portion_size'].includes(b.problem) &&
                    <>Cost incomplete — {b.problem.replace(/_/g, ' ')}.</>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Menu Master will not show a cost it cannot stand behind, and it will
              never treat a missing price as nothing.
            </p>
          </Notice>
        )}
      </section>

      {/* 7. PROFITABILITY + 5. OTHER COSTS + 8. BREAKDOWN (pro) --------- */}
      {pro && costed && (
        <section className="space-y-4">
          <SectionHeading sub="Everything the batch costs you, and where it goes.">
            Full costing
          </SectionHeading>

          <StatRow>
            <Stat label="Ingredients (batch)" value={money(n(s.ingredient_cost))} />
            <Stat label="Packaging (batch)" value={money(n(s.packaging_cost))}
              sub={n(s.packaging_cost) === 0 ? 'none recorded' : undefined} />
            <Stat label="Labour (batch)" value={money(n(s.labour_cost))}
              sub={n(s.labour_cost) === 0 ? 'none recorded' : undefined} />
          </StatRow>

          <StatRow>
            <Stat label="Batch cost"
              value={money(n(s.batch_cost))}
              sub="ingredients + packaging + labour" />
            <Stat label={`Cost per ${yieldCode}`} value={money(n(s.cost_per_yield_unit))} />
            <Stat label="Overhead per portion"
              value={bs?.overhead_enabled ? money(n(s.overhead_cost)) : NOT_ENTERED}
              sub={bs?.overhead_enabled ? 'from your monthly overheads' : 'overheads are switched off'} />
          </StatRow>

          {breakdown.length > 0 && (
            <Card>
              <p className="text-sm font-medium">Where the batch cost goes</p>
              <div className="mt-3"><CostBar parts={breakdown} /></div>
              <p className="mt-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                Only costs you have actually entered appear here. Gas, electricity
                and water are not tracked yet and are not included.
              </p>
            </Card>
          )}

          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt style={{ color: 'var(--mm-muted)' }}>Batch makes</dt>
              <dd className="tabular-nums">{quantity(batchYield, yieldCode)}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>After cooking loss</dt>
              <dd className="tabular-nums">{quantity(effectiveYield, yieldCode)} ({cookingYield}%)</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>One portion</dt>
              <dd className="tabular-nums">{quantity(portionQty, yieldCode)}</dd>
              <dt style={{ color: 'var(--mm-muted)' }}>Portions per batch</dt>
              <dd className="tabular-nums">{portions ?? NOT_ENTERED}</dd>
            </dl>
          </Card>
        </section>
      )}

      {/* 3. INGREDIENT COSTING ----------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="What one batch uses, and what each item adds to the cost.">
          Ingredients
        </SectionHeading>

        {cookLines.length === 0 && packLines.length === 0 ? (
          <Empty>No ingredients yet. Add the first one below.</Empty>
        ) : (
          <>
            <LineGroup title={null} lines={[...cookLines].sort(byCost)} recipeId={recipe.id} pro={pro} />
            {packLines.length > 0 && (
              <LineGroup title="Packaging" lines={[...packLines].sort(byCost)} recipeId={recipe.id} pro={pro} />
            )}
          </>
        )}

        <Disclosure summary="Add an ingredient">
          <form action={addLine} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <Field label="Ingredient">
              <select name="ingredient_id" required className={inputClass} style={inputStyle}>
                {(ingredients ?? []).map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Quantity used">
              <input name="qty" type="number" step="any" min="0" required inputMode="decimal"
                className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Unit">
              <select name="unit_id" required className={inputClass} style={inputStyle}>
                {(units ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                ))}
              </select>
            </Field>
            <Submit>Add ingredient</Submit>
          </form>
          {(ingredients ?? []).length === 0 && (
            <p className="mt-3 text-sm" style={{ color: 'var(--mm-warn)' }}>
              You have no ingredients yet. Add them under Ingredients first, with
              what you paid for them.
            </p>
          )}
        </Disclosure>
      </section>

      {/* 6. SELLING PRICE ---------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="What you charge for one portion.">Selling price</SectionHeading>

        <form action={setSellingPrice} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <input type="hidden" name="recipe_id" value={recipe.id} />
          <Field label="Price per portion (₦)">
            <input name="price" type="number" step="0.01" min="0" required inputMode="decimal"
              defaultValue={check?.selling_price ? Number(check.selling_price) : undefined}
              className={inputClass} style={inputStyle} />
          </Field>
          <Submit>Save price</Submit>
        </form>

        {check && !check.is_complete && (
          <Notice>
            No margin is shown while the costing is incomplete. A margin worked out
            against a partial cost would tell you that you are making more than you are.
          </Notice>
        )}

        {pro && costed && check?.recommended_price !== null && (
          <Card>
            <p className="text-sm">
              To hit your {percent(target)} target you would charge{' '}
              <span className="font-medium tabular-nums">
                {money(n(check?.recommended_price ?? null))}
              </span>{' '}
              a portion.
            </p>
          </Card>
        )}
      </section>

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        This cost covers the ingredients, packaging and labour you have entered.
        Gas, electricity and water are not tracked yet.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One ingredient. A card on a phone; the same card, wider, on a desktop.
// Every figure comes from v_recipe_line_costs -- nothing is multiplied here.
// ---------------------------------------------------------------------------
function LineGroup({ title, lines, recipeId, pro }: {
  title: string | null
  lines: LineCost[]
  recipeId: string
  pro: boolean
}) {
  if (lines.length === 0) return null
  return (
    <div className="space-y-2">
      {title && (
        <h3 className="text-sm font-medium" style={{ color: 'var(--mm-muted)' }}>{title}</h3>
      )}
      <ul className="space-y-2">
        {lines.map((l) => {
          const lineCost = n(l.line_cost)
          const unitCost = n(l.unit_cost)
          const pQty = n(l.purchase_qty_base)
          const pAmt = n(l.purchase_amount)
          return (
            <li key={l.line_id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{l.item_name ?? 'Unknown item'}</span>
                  <span className="tabular-nums font-medium">
                    {lineCost !== null ? money(lineCost)
                      : <span className="mm-absent">no cost yet</span>}
                  </span>
                </div>

                <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                  {quantity(n(l.recipe_qty), l.recipe_unit)}
                  {unitCost !== null && l.base_unit && (
                    <> · {money(unitCost)} per {l.base_unit}</>
                  )}
                </div>

                {l.problem === 'missing_price' && (
                  <p className="mt-2 text-sm" style={{ color: 'var(--mm-warn)' }}>
                    No purchase price yet.{' '}
                    <Link href={`/ingredients/${l.ingredient_id}`} className="underline">
                      Tell us what you paid
                    </Link>
                  </p>
                )}
                {l.problem === 'missing_conversion' && (
                  <p className="mt-2 text-sm" style={{ color: 'var(--mm-warn)' }}>
                    We do not know how much one {l.recipe_unit} of this weighs.{' '}
                    <Link href={`/ingredients/${l.ingredient_id}`} className="underline">
                      Add the measurement
                    </Link>
                  </p>
                )}

                {/*
                  Provenance, in the owner's language. cost_basis comes from
                  fn_ingredient_cost_basis -- the same function that produced
                  the cost -- so what is claimed here and what was charged
                  cannot disagree. An estimate is never dressed up as a
                  purchase, and a averaged cost never implies one receipt.
                */}
                {pAmt !== null && pQty !== null && l.base_unit && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
                    {l.cost_basis === 'manual' ? (
                      <><span style={{ color: 'var(--mm-warn)' }}>Estimated price</span>
                        {' '}— not from a purchase. Record what you paid to cost this properly.</>
                    ) : (l.purchase_count ?? 0) > 1 ? (
                      <>Based on {l.purchase_count} purchases in your costing window:{' '}
                        {pQty} {l.base_unit} for {money(pAmt)} · uses {n(l.base_qty) ?? '?'} {l.base_unit} of it</>
                    ) : (
                      <>You bought {pQty} {l.base_unit} for {money(pAmt)}
                        {l.purchase_date ? ` on ${l.purchase_date}` : ''}
                        {l.cost_basis === 'purchase_latest' && <> — your most recent purchase</>}
                        {' '}· uses {n(l.base_qty) ?? '?'} {l.base_unit} of it</>
                    )}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <form action={updateLineQty} className="flex items-end gap-2">
                    <input type="hidden" name="recipe_id" value={recipeId} />
                    <input type="hidden" name="line_id" value={l.line_id} />
                    <label className="block">
                      <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Quantity</span>
                      <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                        defaultValue={Number(l.recipe_qty)}
                        className="mt-1 w-28 rounded border px-2 py-2 text-base"
                        style={inputStyle} />
                    </label>
                    <InlineSubmit>Update</InlineSubmit>
                  </form>
                  <form action={removeLine}>
                    <input type="hidden" name="recipe_id" value={recipeId} />
                    <input type="hidden" name="line_id" value={l.line_id} />
                    <InlineSubmit>Remove</InlineSubmit>
                  </form>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
