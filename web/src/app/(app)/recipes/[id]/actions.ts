'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  currentContext, contextRedirect, describeWriteError, withNotice, refusalNotice, writeRefusal,
} from '@/lib/data/context'
import { priceReturnPath, recipeIdOrNull } from '@/lib/pricing'
import { DISH_BUCKET, canAddDishPhotos, dishThumbPath, isDishPhotoPath } from '@/lib/dish-photo'

// ---------------------------------------------------------------------------
// The dish page's writes. They were inline in page.tsx; they moved here when
// the page was rebuilt, with the same fields, the same rows written and the
// same notices, so the journeys that post them still do. Prices are not
// here: both price forms post to setPrice (lib/actions/set-price.ts).
//
// F3 IS A HARD INVARIANT. Nothing recomputes a recipe when its lines change:
// 0008 installs recompute triggers on ingredient_prices,
// ingredient_unit_conversions and ingredients, and recipe_lines carries only a
// cycle guard. Every line mutation is followed by an explicit snapshot, and
// EXACTLY ONE per action -- two snapshots in one transaction share now(), and
// v_recipe_cost_current's "latest" is then ambiguous (tests/021 check 20).
//
// AN EDIT THAT CHANGED NOTHING IS NOT A SAVE. Row-level security refuses an
// update or delete with no error and zero rows -- after a trial ends it does
// so to every role. Every edit and remove here asks for its rows back
// (.select('id')); when none come back it says "Nothing was changed." and why
// (writeRefusal, lib/data/context.ts), and the dish is NOT re-costed: there is
// nothing new to cost, and the snapshot would be a write on a closed account.
// ---------------------------------------------------------------------------

type Client = Awaited<ReturnType<typeof createClient>>

async function recompute(supabase: Client, recipeId: string): Promise<string | null> {
  const { error } = await supabase.rpc('fn_compute_recipe_cost_snapshot', { p_recipe_id: recipeId })
  if (error) {
    // Kitchen may change a dish but not read its costs, and the snapshot
    // function refuses anyone who cannot (fn_require_cost_access). The change
    // itself WAS saved, so "could not save that" would be untrue; say what
    // actually happens instead.
    if (error.code === '42501' && /cost information/i.test(error.message ?? '')) {
      return 'Saved. The cost updates the next time the owner or a manager changes this dish.'
    }
    return describeWriteError(error)
  }

  // A size's economics live in its own snapshot. Recomputing the dish
  // without them would leave every size showing the previous batch's figures.
  const { data: active } = await supabase.from('recipe_variants')
    .select('id').eq('recipe_id', recipeId).eq('is_active', true)
    .returns<{ id: string }[]>()
  for (const v of active ?? []) {
    await supabase.rpc('fn_compute_variant_cost_snapshot', { p_variant_id: v.id })
  }
  return null
}

export async function addLine(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const ingredientId = String(formData.get('ingredient_id') ?? '')
  const unitId = String(formData.get('unit_id') ?? '')
  if (!ingredientId) redirect(withNotice(here, 'Choose the ingredient first.'))
  if (!unitId) redirect(withNotice(here, 'Choose the unit the amount is in.'))
  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'Enter how much of that ingredient the dish uses. It must be greater than zero.'))
  }

  const { error } = await supabase.from('recipe_lines').insert({
    account_id: accountId,
    recipe_id: recipeId,
    ingredient_id: ingredientId,
    qty,
    unit_id: unitId,
  })
  if (error) redirect(withNotice(here, describeWriteError(error)))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Ingredient added.'))
}

/**
 * A dish made from another dish: the stew in the jollof, the dough in the
 * meat pie. The engine (fn__recipe_cost_core, 0007) costs a sub-recipe line
 * from the other dish's cost per yield unit. The quantity is in the other
 * dish's measure.
 */
export async function addSubRecipe(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'How much of that dish goes into one batch? It must be more than zero.'))
  }
  const subId = String(formData.get('sub_recipe_id') ?? '')
  if (!subId || subId === recipeId) redirect(withNotice(here, 'Choose another dish.'))

  const { error } = await supabase.from('recipe_lines').insert({
    account_id: accountId, recipe_id: recipeId, sub_recipe_id: subId, qty,
    unit_id: String(formData.get('unit_id') ?? ''),
  })
  if (error) {
    redirect(withNotice(here, error.code === '23514' && /itself|cycle|reach/i.test(error.message)
      ? 'That dish already contains this one, so it cannot also be made from it.'
      : describeWriteError(error)))
  }
  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Dish added as an ingredient.'))
}

/**
 * Scale the whole batch: a pot for 50 becomes a pot for 200 and every
 * quantity and every hour of work scales with it. One snapshot after (F3).
 */
export async function scaleRecipe(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx

  const target = Number(formData.get('new_batch'))
  if (!Number.isFinite(target) || target <= 0) {
    redirect(withNotice(here, 'How much should one batch make now? It must be more than zero.'))
  }
  const { data: current } = await supabase.from('recipes').select('batch_yield_qty')
    .eq('id', recipeId).maybeSingle<{ batch_yield_qty: string }>()
  const from = Number(current?.batch_yield_qty ?? 0)
  if (!(from > 0)) redirect(withNotice(here, 'This dish has no batch size to scale from.'))
  const factor = target / from
  if (Math.abs(factor - 1) < 1e-9) redirect(withNotice(here, 'That is the size it already makes.'))

  const [{ data: lines }, { data: labour }] = await Promise.all([
    supabase.from('recipe_lines').select('id,qty').eq('recipe_id', recipeId).returns<{ id: string; qty: string }[]>(),
    supabase.from('recipe_labour').select('id,hours').eq('recipe_id', recipeId).returns<{ id: string; hours: string }[]>(),
  ])
  const round = (v: number, places: number) => Number(v.toFixed(places))
  // The batch first, on its own: one row that is always there, written by
  // the same roles as its lines and its work (0015). If it changes nothing,
  // nothing at all has changed and the notice can say so truthfully. A line
  // that then comes back empty was removed in another tab meanwhile.
  const { data: batched, error } = await supabase.from('recipes')
    .update({ batch_yield_qty: target }).eq('id', recipeId).select('id')
  const refused = await writeRefusal(error, batched, ctx.role)
  if (refused) redirect(withNotice(here, refused))
  for (const l of lines ?? []) {
    const { error } = await supabase.from('recipe_lines').update({ qty: round(Number(l.qty) * factor, 3) }).eq('id', l.id)
    if (error) redirect(withNotice(here, describeWriteError(error)))
  }
  for (const l of labour ?? []) {
    const { error } = await supabase.from('recipe_labour').update({ hours: round(Number(l.hours) * factor, 2) }).eq('id', l.id)
    if (error) redirect(withNotice(here, describeWriteError(error)))
  }

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? `Scaled ×${round(factor, 2)}: every quantity and hour of work with it. The cost per portion is unchanged; the batch is bigger.`))
}

/** Quantity AND unit. Changing "4 kg" to "4 paint" used to mean remove and re-add. */
export async function updateLine(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx

  const qty = Number(formData.get('qty'))
  if (!Number.isFinite(qty) || qty <= 0) {
    redirect(withNotice(here, 'A quantity has to be greater than zero.'))
  }
  const unitId = String(formData.get('unit_id') ?? '')
  const patch: { qty: number; unit_id?: string } = { qty }
  if (unitId) patch.unit_id = unitId

  const { data, error } = await supabase.from('recipe_lines')
    .update(patch).eq('id', String(formData.get('line_id') ?? '')).select('id')
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused) redirect(withNotice(here, refused))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Ingredient updated.'))
}

export async function removeLine(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx

  const { data, error } = await supabase.from('recipe_lines')
    .delete().eq('id', String(formData.get('line_id') ?? '')).select('id')
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused) redirect(withNotice(here, refused))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Ingredient removed.'))
}

/**
 * The dish itself: its name, what one batch makes, what one portion is.
 * These are current facts, not history: the old snapshot keeps the old
 * figures, and exactly one new snapshot follows (F3).
 */
export async function updateRecipe(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'A dish needs a name.'))
  const batch = Number(formData.get('batch_yield_qty'))
  if (!Number.isFinite(batch) || batch <= 0) {
    redirect(withNotice(here, 'How much does one batch make? It must be more than zero.'))
  }
  const yieldUnit = String(formData.get('yield_unit_id') ?? '')
  if (!yieldUnit) redirect(withNotice(here, 'Say what the batch is measured in.'))
  const portionRaw = String(formData.get('portion_qty') ?? '').trim()
  const portion = portionRaw === '' ? null : Number(portionRaw)
  if (portion !== null && (!Number.isFinite(portion) || portion <= 0)) {
    redirect(withNotice(here, 'A portion must be more than zero. Leave it blank if you sell this in sizes.'))
  }
  const cooking = Number(formData.get('cooking_yield_pct') || 100)
  if (!Number.isFinite(cooking) || cooking <= 0 || cooking > 100) {
    redirect(withNotice(here, 'What is left after cooking is a percentage between 1 and 100.'))
  }

  const { data, error } = await supabase.from('recipes').update({
    name,
    category: String(formData.get('category') ?? '').trim() || null,
    batch_yield_qty: batch,
    yield_unit_id: yieldUnit,
    portion_qty: portion,
    cooking_yield_pct: cooking,
  }).eq('id', recipeId).select('id')
  if (error?.code === '23505') {
    redirect(withNotice(here, `You already have a dish called “${name}”. Give this one a different name.`))
  }
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused) redirect(withNotice(here, refused))

  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  revalidatePath('/recipes')
  redirect(withNotice(here, failed ?? 'Dish updated.'))
}

/**
 * Put a dish away. Never deleted: its snapshots, prices and sales keep
 * pointing at it. It leaves every list and the sale picker (both filter on
 * deleted_at), and its name is free for a new dish. Brought back from the
 * Dishes list.
 */
export async function archiveRecipe(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('recipes')
    .update({ deleted_at: new Date().toISOString() }).eq('id', recipeId)
    .is('deleted_at', null).select('name').maybeSingle<{ name: string }>()
  // No row back: refused quietly (or put away already), so it is still on the
  // list. "Has been put away" would send her looking for it in the wrong place.
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused || !data) redirect(withNotice(`/recipes/${recipeId}`, refused))
  revalidatePath('/recipes')
  redirect(withNotice('/recipes', `${data.name} has been put away. Find it under “Put away” to bring it back.`))
}

/**
 * Attach one of the business's own sizes to this dish. Doing so switches the
 * dish to the size-based model: the size becomes what is sold and a portion
 * size is no longer required (0039). The batch economics are projected onto
 * each size by fn_variant_cost -- never duplicated.
 */
export async function addVariant(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, here))

  const { error } = await supabase.from('recipe_variants').insert({
    account_id: accountId, business_id: businessId, recipe_id: recipeId,
    format_id: String(formData.get('format_id') ?? ''), costing_basis: 'capacity',
  })
  const failed = error ? null : await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? failed ?? 'Size added to this dish.'))
}

/**
 * A new size made right on the dish ("Party tray", 20 plates), then attached
 * to it: the same row the Sizes page writes (formats/page.tsx addFormat) and
 * the same row addVariant writes, so Kemi prices her cake sizes without
 * leaving the cake. serving_formats takes owner and manager only.
 */
export async function makeSize(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, here))

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'Give this size a name your customers would recognise.'))
  const qtyRaw = String(formData.get('capacity_qty') ?? '').trim()
  const unitRaw = String(formData.get('capacity_unit_id') ?? '')
  const qty = qtyRaw === '' ? null : Number(qtyRaw)
  if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
    redirect(withNotice(here, 'A size must be greater than zero. Leave it blank if you sell by the piece.'))
  }
  // Size and unit travel together: a number with no unit means nothing, and
  // the engine would have no way to turn a batch into servings.
  if ((qty === null) !== (unitRaw === '')) {
    redirect(withNotice(here, 'Give both a size and its unit, or neither.'))
  }

  const { data: made, error } = await supabase.from('serving_formats').insert({
    account_id: accountId, business_id: businessId, name,
    description: null, capacity_qty: qty, capacity_unit_id: unitRaw || null,
  }).select('id').single<{ id: string }>()
  if (error || !made) {
    redirect(withNotice(here, error?.code === '23505'
      ? `You already have a size called “${name}”. Choose it from the list instead.`
      : describeWriteError(error) ?? 'Menu Master could not save that. Nothing was changed.'))
  }
  revalidatePath('/formats')

  const { error: vErr } = await supabase.from('recipe_variants').insert({
    account_id: accountId, business_id: businessId, recipe_id: recipeId,
    format_id: made.id, costing_basis: 'capacity',
  })
  if (vErr) {
    revalidatePath(here)
    redirect(withNotice(here, `${name} was made, but could not be added to this dish. ${describeWriteError(vErr)}`))
  }
  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? `${name} made and added to this dish.`))
}

export async function removeVariant(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx
  // Switched off, not deleted. recipe_variants has no DELETE policy (0021),
  // so a delete would match nothing and still say "removed". Past sales and
  // prices in this size keep their reference.
  const { data, error } = await supabase.from('recipe_variants')
    .update({ is_active: false }).eq('id', String(formData.get('id') ?? '')).select('id')
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused) redirect(withNotice(here, refused))
  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Size removed from this dish.'))
}

/**
 * Labour on THIS dish: how many hours of a named kind of work one batch
 * takes. The rate lives on the business (labour_rates) so changing it once
 * applies everywhere. If the rate has no figure, the engine reports the dish
 * incomplete -- it never treats the work as free.
 */
export async function addLabour(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))

  const hours = Number(formData.get('hours'))
  if (!Number.isFinite(hours) || hours <= 0) {
    redirect(withNotice(here, 'How many hours does one batch take? It must be more than zero.'))
  }
  const { error } = await supabase.from('recipe_labour').insert({
    account_id: accountId, recipe_id: recipeId,
    labour_rate_id: String(formData.get('labour_rate_id') ?? ''), hours,
  })
  const failed = error ? null : await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? failed ?? 'Work added.'))
}

/**
 * A new kind of paid work, made from the dish: the same row Settings writes
 * (settings/page.tsx addRate), and, when hours are given, the hours on this
 * dish too. labour_rates takes owner, manager and accountant; the hours on
 * the dish take owner, manager and kitchen, so the accountant's form has no
 * hours field.
 */
export async function addKindOfWork(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase, accountId, businessId } = ctx
  if (!accountId || !businessId) redirect(contextRedirect(ctx, here))

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect(withNotice(here, 'Give this kind of work a name.'))
  const raw = String(formData.get('rate_per_hour') ?? '').trim()
  const rate = raw === '' ? null : Number(raw)
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
    redirect(withNotice(here, 'An hourly rate cannot be negative.'))
  }
  const hoursRaw = String(formData.get('hours') ?? '').trim()
  const hours = hoursRaw === '' ? null : Number(hoursRaw)
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0)) {
    redirect(withNotice(here, 'How many hours does one batch take? It must be more than zero.'))
  }

  // NULL is allowed and meaningful: the business pays for this work but has
  // not said how much. The engine treats that as incomplete, never as free.
  const { data: made, error } = await supabase.from('labour_rates').insert({
    account_id: accountId, business_id: businessId, name, rate_per_hour: rate,
  }).select('id').single<{ id: string }>()
  revalidatePath('/settings')
  if (error || !made) {
    redirect(withNotice(here, error?.code === '23505'
      ? `You already have a kind of work called “${name}”. Choose it from the list instead.`
      : describeWriteError(error) ?? 'Menu Master could not save that. Nothing was changed.'))
  }
  if (hours === null) {
    revalidatePath(here)
    redirect(withNotice(here, 'Kind of work added.'))
  }

  const { error: lErr } = await supabase.from('recipe_labour').insert({
    account_id: accountId, recipe_id: recipeId, labour_rate_id: made.id, hours,
  })
  if (lErr) {
    revalidatePath(here)
    redirect(withNotice(here, `${name} was added, but its hours could not be put on this dish. ${describeWriteError(lErr)}`))
  }
  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Work added.'))
}

export async function removeLabour(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const { data, error } = await supabase.from('recipe_labour')
    .delete().eq('id', String(formData.get('id') ?? '')).select('id')
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused) redirect(withNotice(here, refused))
  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Work removed.'))
}

export async function updateLabour(formData: FormData) {
  const recipeId = String(formData.get('recipe_id') ?? '')
  const here = `/recipes/${recipeId}`
  const ctx = await currentContext()
  const { supabase } = ctx
  const hours = Number(formData.get('hours'))
  if (!Number.isFinite(hours) || hours <= 0) {
    redirect(withNotice(here, 'How many hours does one batch take? It must be more than zero.'))
  }
  const { data, error } = await supabase.from('recipe_labour')
    .update({ hours }).eq('id', String(formData.get('id') ?? '')).select('id')
  const refused = await writeRefusal(error, data, ctx.role)
  if (refused) redirect(withNotice(here, refused))
  const failed = await recompute(supabase, recipeId)
  revalidatePath(here)
  redirect(withNotice(here, failed ?? 'Hours updated.'))
}

/**
 * Save (or clear) the dish's photo, after components/dish-photo-upload.tsx
 * has put the files in the 'dish' bucket.
 *
 * The name arrives in a form field, so it is checked before it is written:
 * it must sit in THIS dish's own folder of ITS business (isDishPhotoPath),
 * which the database checks again (0063, 23514). The business is read from
 * the dish itself, not from the caller's default business, so a dish of an
 * account's second business is not refused.
 *
 * .select() because an update RLS does not allow (sales, accountant) returns
 * no error and no rows; without it the page would say "Photo saved." For
 * owner, manager and kitchen the role is allowed (0063 mirrors
 * p_recipes_update), so no rows means the other gate, the subscription, and
 * refusalNotice names it for this role: the owner is told to choose a plan,
 * never to "ask the owner".
 *
 * The old files are removed after the new name is saved, best effort: a
 * failure there leaves an unused file behind, never a dish without a photo.
 */
export async function setDishPhoto(formData: FormData) {
  const recipeId = recipeIdOrNull(formData.get('recipe_id'))
  if (!recipeId) redirect(withNotice('/recipes', 'That dish could not be found. Reload and try again.'))
  const here = `/recipes/${recipeId}`
  const back = priceReturnPath(formData.get('return_to'), recipeId)
  const raw = String(formData.get('photo_path') ?? '').trim()

  const ctx = await currentContext()
  const { supabase } = ctx
  if (!ctx.accountId) redirect(contextRedirect(ctx, back))

  const { data: dish } = await supabase.from('recipes').select('business_id,photo_path')
    .eq('id', recipeId).maybeSingle<{ business_id: string; photo_path: string | null }>()
  if (!dish) redirect(withNotice('/recipes', 'That dish could not be found. Reload and try again.'))
  if (raw && !isDishPhotoPath(raw, dish.business_id, recipeId)) {
    redirect(withNotice(back, 'That photo could not be saved. Try again.'))
  }

  const { data, error } = await supabase.from('recipes')
    .update({ photo_path: raw || null }).eq('id', recipeId).select('id')
  if (!error && (data ?? []).length === 0) {
    redirect(withNotice(back, canAddDishPhotos(ctx.role)
      ? await refusalNotice(ctx.role)
      : 'Your role does not allow changing this dish’s photo. Ask the owner.'))
  }

  const old = dish.photo_path
  if (!error && old && old !== raw && isDishPhotoPath(old, dish.business_id, recipeId)) {
    await supabase.storage.from(DISH_BUCKET).remove([old, dishThumbPath(old)]).catch(() => undefined)
  }

  for (const path of new Set([here, '/recipes', '/dashboard', '/sales/new', back.split('?')[0]])) {
    revalidatePath(path)
  }
  redirect(withNotice(back, describeWriteError(error) ?? (raw ? 'Photo saved.' : 'Photo removed.')))
}
