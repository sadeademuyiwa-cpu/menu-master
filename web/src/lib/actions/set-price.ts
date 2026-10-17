'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { requiredAmount } from '@/lib/money-input'
import { priceReturnPath, recipeIdOrNull } from '@/lib/pricing'

/**
 * A new selling price, from any screen: the dish page's price card, Home's
 * "Use ₦1,450", Prices. One action, so every place that sets a price sets it
 * the same way. It records exactly what the dish page's setSellingPrice (a
 * dish's own, per-portion price) and setFormatPrice (one size's price) did.
 *
 * APPEND-ONLY. A price is a new recipe_prices row, never an update: last
 * month's margin stays true, and undoing a change is just setting the old
 * price again. Margin and suggested price are NOT worked out here --
 * v_price_check owns that arithmetic and withholds it while a costing is
 * incomplete.
 *
 * WHO. recipe_prices is guarded by fn_can_see_costs (0004): owner, manager
 * and accountant. Anyone else is refused by RLS and told so in plain words
 * (describeWriteError). Screens show the button only to those roles
 * (lib/pricing.ts canSetPrices), but that is a courtesy, not the check.
 *
 * FORM FIELDS
 *   recipe_id   the dish (required)
 *   price       what it sells for. Blank is refused, never stored as 0
 *               (lib/money-input.ts); a typed 0 is a real, free item.
 *   variant_id  a size of the dish. Leave it out for the dish's own price.
 *               Repeat variant_id and price, in pairs and in the same order,
 *               to set several sizes at once ("Use suggested prices for both
 *               sizes"); they are saved in one statement, all or nothing.
 *   return_to   where to go afterwards: Home, the dish list, the dish,
 *               Prices or New sale (lib/pricing.ts priceReturnPath).
 *               Anything else, or nothing, goes back to the dish.
 *
 * It always ends in a redirect with ?notice=, which the toaster shows.
 */

export type SetPriceArgs = {
  recipeId: string
  /** A size of the dish. Omit it, or pass null, for the dish's own price. */
  variantId?: string | null
  price: number
  returnTo?: string | null
} | {
  recipeId: string
  /** Several sizes at once, saved together. */
  sizes: { variantId: string; price: number }[]
  returnTo?: string | null
}

/** The typed form of a call, read through the same checks as a form post. */
function toForm(args: SetPriceArgs): FormData {
  const f = new FormData()
  f.set('recipe_id', args.recipeId)
  if (args.returnTo) f.set('return_to', args.returnTo)
  if ('sizes' in args) {
    for (const s of args.sizes) {
      f.append('variant_id', s.variantId)
      f.append('price', String(s.price))
    }
  } else {
    f.set('price', String(args.price))
    if (args.variantId) f.set('variant_id', args.variantId)
  }
  return f
}

/** One typed price, read by money-input's own rule: blank is not zero. */
function amount(raw: FormDataEntryValue): number | null {
  const one = new FormData()
  if (typeof raw === 'string') one.set('price', raw)
  return requiredAmount(one, 'price')
}

export async function setPrice(input: FormData | SetPriceArgs): Promise<void> {
  const form = input instanceof FormData ? input : toForm(input)

  const recipeId = recipeIdOrNull(form.get('recipe_id'))
  if (!recipeId) redirect(withNotice('/recipes', 'That dish could not be found. Reload and try again.'))

  const here = `/recipes/${recipeId}`
  const back = priceReturnPath(form.get('return_to'), recipeId)
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, back))

  const variants = form.getAll('variant_id').map((v) => String(v).trim())
  const prices = form.getAll('price')
  let error: Parameters<typeof describeWriteError>[0] = null
  let saved: string

  if (variants.length === 0 || (variants.length === 1 && variants[0] === '')) {
    // The dish's own price, per portion: setSellingPrice.
    const price = requiredAmount(form, 'price')
    if (price === null) {
      redirect(withNotice(back, 'Enter the price you sell one portion for.'))
    }
    const res = await supabase.from('recipe_prices')
      .insert({ account_id: accountId, recipe_id: recipeId, price })
    error = res.error
    saved = 'Selling price saved.'
  } else {
    // One or more sizes: setFormatPrice, each size priced on its own.
    const rows: { variant_id: string; price: number }[] = []
    if (variants.some((v) => v === '') || prices.length !== variants.length) {
      redirect(withNotice(back, 'Enter what you charge for this size. It must be more than zero.'))
    }
    for (let i = 0; i < variants.length; i++) {
      const price = amount(prices[i])
      if (price === null) {
        redirect(withNotice(back, 'Enter what you charge for this size. It must be more than zero.'))
      }
      rows.push({ variant_id: variants[i], price })
    }
    // Two prices for one size in the same statement share created_at, and
    // v_price_check could then pick either. One price per size per save.
    if (new Set(rows.map((r) => r.variant_id)).size !== rows.length) {
      redirect(withNotice(back, 'Each size takes one price at a time.'))
    }
    // No effective_from: the column's default (the database's current_date)
    // applies, as for the dish's own price above. v_price_check and
    // fn_menu_prices read prices with effective_from <= CURRENT_DATE, the
    // database's own date (UTC), so a Lagos date sent between 00:00 and 01:00
    // is "tomorrow" there and the new price stayed hidden until 01:00.
    const res = await supabase.from('recipe_prices').insert(rows.map((r) => ({
      account_id: accountId, recipe_id: recipeId,
      variant_id: r.variant_id, price: r.price,
    })))
    error = res.error
    saved = rows.length === 1
      ? 'Price saved for that size.'
      : `Prices saved for ${rows.length === 2 ? 'both' : `all ${rows.length}`} sizes.`
  }

  // Every page that shows what this dish sells for, so none of them serves
  // the old price from its cache.
  for (const path of new Set([here, '/dashboard', '/recipes', '/pricing', '/sales/new', back.split('?')[0]])) {
    revalidatePath(path)
  }
  redirect(withNotice(back, describeWriteError(error) ?? saved))
}
