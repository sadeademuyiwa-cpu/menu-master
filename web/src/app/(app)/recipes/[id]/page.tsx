import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, inputClass, inputStyle,
  Notice, SectionHeading, BackLink, Empty, Stat, StatRow,
} from '@/components/ui'
import { money, percent, quantity, NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Unit = { id: string; code: string; name: string; kind: string }
type Line = {
  id: string; ingredient_id: string | null; sub_recipe_id: string | null
  qty: string; unit_id: string; is_cost_bearing: boolean
}
type PriceCheck = {
  recipe_id: string; name: string; is_complete: boolean
  required_inputs: number; priced_inputs: number; excluded_inputs: number
  unpriced_items: { name?: string; problem?: string }[] | null
  cost_per_portion: string | null; cost_floor_per_portion: string | null
  selling_price: string | null; profit: string | null
  margin_pct: string | null; recommended_price: string | null
  target_margin: string | null
}
type Blocker = { problem: string; ingredient_name: string | null; unit_code: string | null; item: string | null }

// ---------------------------------------------------------------------------
// WRITES
//
// F3 IS A HARD INVARIANT.
//   Nothing recomputes a recipe when its lines change: 0008 installs recompute
//   triggers on ingredient_prices, ingredient_unit_conversions and ingredients,
//   and recipe_lines carries only a cycle guard. So EVERY mutation of a line
//   must be followed by fn_compute_recipe_cost_snapshot, or the page renders a
//   snapshot that no longer describes the recipe.
//
//   Exactly ONE recompute per action. Two snapshots written inside a single
//   transaction share now(), and v_recipe_cost_current's "latest" is then
//   ambiguous between them (tests/021 check 20).
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

  const failed = await recompute(supabase, recipeId)   // F3
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

  const failed = await recompute(supabase, recipeId)   // F3
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

  const failed = await recompute(supabase, recipeId)   // F3
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
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await props.params
  const { notice } = await props.searchParams
  const supabase = await createClient()

  const { data: recipe } = await supabase.from('recipes')
    .select('id,name,batch_yield_qty,yield_unit_id,portion_qty,cooking_yield_pct,status')
    .eq('id', id).is('deleted_at', null).maybeSingle()

  if (!recipe) notFound()

  const [{ data: lines }, { data: units }, { data: ingredients }, { data: checks }, { data: blockers }, { data: cost }] =
    await Promise.all([
      supabase.from('recipe_lines')
        .select('id,ingredient_id,sub_recipe_id,qty,unit_id,is_cost_bearing')
        .eq('recipe_id', id).returns<Line[]>(),
      supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
      supabase.from('ingredients').select('id,name,base_unit_id')
        .is('deleted_at', null).eq('is_active', true).order('name')
        .returns<{ id: string; name: string; base_unit_id: string }[]>(),
      supabase.from('v_price_check').select('*').eq('recipe_id', id).returns<PriceCheck[]>(),
      supabase.from('v_costing_blockers')
        .select('problem,ingredient_name,unit_code,item').eq('recipe_id', id).returns<Blocker[]>(),
      supabase.from('v_recipe_cost_current')
        .select('recipe_id,is_complete,batch_cost,cost_per_yield_unit,cost_per_portion,required_inputs,priced_inputs')
        .eq('recipe_id', id)
        .returns<{ recipe_id: string; is_complete: boolean; batch_cost: string | null
                   cost_per_yield_unit: string | null; cost_per_portion: string | null
                   required_inputs: number; priced_inputs: number }[]>(),
    ])

  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const ingredientById = new Map((ingredients ?? []).map((i) => [i.name, i]))
  const nameById = new Map((ingredients ?? []).map((i) => [i.id, i.name]))
  const yieldCode = unitById.get(recipe.yield_unit_id)?.code ?? NOT_ENTERED
  const snapshot = cost?.[0]
  const check = checks?.find((c) => c.selling_price !== null) ?? checks?.[0]
  const costed = snapshot?.is_complete === true

  return (
    <div className="space-y-8">
      <BackLink href="/recipes">← All recipes</BackLink>

      <PageHeader
        title={recipe.name}
        sub={`Batch makes ${Number(recipe.batch_yield_qty)} ${yieldCode}` +
             (recipe.portion_qty !== null
               ? ` · one portion is ${Number(recipe.portion_qty)} ${yieldCode}`
               : ' · no portion size set')}
      />

      {notice && <Notice tone={/could not|must be|does not allow/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="Exactly what one batch uses. Quantities may be in any unit this item can be measured in.">
          Ingredients used
        </SectionHeading>

        {!lines || lines.length === 0 ? (
          <Empty>No ingredients yet. Add the first one below.</Empty>
        ) : (
          <ul className="space-y-3">
            {lines.map((l) => (
              <li key={l.id}>
                <Card>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {l.ingredient_id ? nameById.get(l.ingredient_id) ?? 'Unknown item' : 'Sub-recipe'}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                        {quantity(Number(l.qty), unitById.get(l.unit_id)?.code)}
                      </div>
                    </div>
                    <div className="flex items-end gap-3">
                      <form action={updateLineQty} className="flex items-end gap-2">
                        <input type="hidden" name="recipe_id" value={recipe.id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <label className="block">
                          <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>Quantity</span>
                          <input name="qty" type="number" step="any" min="0"
                            defaultValue={Number(l.qty)}
                            className="mt-1 w-28 rounded border px-2 py-1.5 text-base"
                            style={inputStyle} />
                        </label>
                        <InlineSubmit>Update</InlineSubmit>
                      </form>
                      <form action={removeLine}>
                        <input type="hidden" name="recipe_id" value={recipe.id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <InlineSubmit>Remove</InlineSubmit>
                      </form>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

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
            <input name="qty" type="number" step="any" min="0" required
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
          <Notice>
            You have no ingredients yet. Add them under Ingredients first, along
            with what you paid for them.
          </Notice>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading>What it costs</SectionHeading>

        {!snapshot ? (
          <Empty>Not costed yet. Add an ingredient and the cost appears here.</Empty>
        ) : costed ? (
          <StatRow>
            <Stat label="Cost of one batch"
              value={money(snapshot.batch_cost === null ? null : Number(snapshot.batch_cost))}
              sub={`ingredients only`} />
            <Stat label={`Cost per ${yieldCode}`}
              value={money(snapshot.cost_per_yield_unit === null ? null : Number(snapshot.cost_per_yield_unit))} />
            <Stat label="Cost per portion"
              value={money(snapshot.cost_per_portion === null ? null : Number(snapshot.cost_per_portion))}
              sub={recipe.portion_qty === null ? 'set a portion size to see this' : undefined} />
          </StatRow>
        ) : (
          <Notice>
            <p className="font-medium">
              This recipe cannot be costed yet — {snapshot.priced_inputs} of{' '}
              {snapshot.required_inputs} ingredients have a price.
            </p>
            <p className="mt-1">
              Menu Master will not show a cost it cannot stand behind, and it will
              not treat a missing price as nothing. Add what you paid for the
              items below and the cost appears straight away.
            </p>
            {blockers && blockers.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {blockers.map((b, i) => (
                  <li key={i}>
                    {b.ingredient_name ?? b.item ?? 'An ingredient'}
                    {b.problem === 'missing_price' && ' — no purchase price recorded'}
                    {b.problem === 'missing_conversion' &&
                      ` — tell us how much one ${b.unit_code ?? 'of that measure'} weighs`}
                    {b.problem !== 'missing_price' && b.problem !== 'missing_conversion' &&
                      ` — ${b.problem}`}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <SectionHeading sub="What you charge for one portion.">Selling price</SectionHeading>

        <form action={setSellingPrice} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <input type="hidden" name="recipe_id" value={recipe.id} />
          <Field label="Price per portion (₦)">
            <input name="price" type="number" step="0.01" min="0" required
              defaultValue={check?.selling_price ? Number(check.selling_price) : undefined}
              className={inputClass} style={inputStyle} />
          </Field>
          <Submit>Save price</Submit>
        </form>

        {check && check.is_complete && check.profit !== null && Number(check.profit) < 0 && (
          <Notice>
            <span className="font-medium">
              You are selling this below what it costs to make.
            </span>{' '}
            One portion costs {money(check.cost_per_portion === null ? null : Number(check.cost_per_portion))}{' '}
            and you are charging {money(check.selling_price === null ? null : Number(check.selling_price))}.
            {check.recommended_price !== null &&
              ` To reach your target margin you would need ${money(Number(check.recommended_price))}.`}
          </Notice>
        )}

        {check && (
          check.is_complete ? (
            <StatRow>
              <Stat label="Selling price"
                value={money(check.selling_price === null ? null : Number(check.selling_price))} />
              <Stat label="Profit per portion"
                value={money(check.profit === null ? null : Number(check.profit))} />
              <Stat label="Margin"
                value={percent(check.margin_pct === null ? null : Number(check.margin_pct))}
                sub={check.recommended_price !== null
                  ? `recommended ${money(Number(check.recommended_price))}`
                  : undefined} />
            </StatRow>
          ) : (
            <Notice>
              No margin is shown while the costing is incomplete. A margin
              calculated against a partial cost would overstate your profit.
            </Notice>
          )
        )}
      </section>

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        This cost covers ingredients only. Labour and overheads are not included
        in the September release.
      </p>
    </div>
  )
}
