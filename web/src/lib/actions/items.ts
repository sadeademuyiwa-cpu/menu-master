'use server'

import { revalidatePath } from 'next/cache'
import { currentContext, refusalNotice } from '@/lib/data/context'
import { ensureItem, type MeasuredBy } from '@/lib/data/items'
import { loadPurchaseCatalog, type CatalogItem, type CatalogUnit } from '@/lib/data/purchase-catalog'
import { canEditItems } from '@/app/(app)/purchases/buy-roles'
import { normal } from '@/lib/item-search'

/** An item as a screen needs it: for buying, or for a dish (its cooking units, and the units it is bought in). */
export type NewOwnItem = CatalogItem & { buyUnits?: CatalogUnit[] }
export type CreatedItem = { item: NewOwnItem } | { error: string }

const MEASURES: MeasuredBy[] = ['weight', 'volume', 'count']

/**
 * An item she typed in a search that found nothing ("+ Add 'Ofe leaf'"),
 * added without leaving the purchase or the dish. Who may add one follows
 * the database (owner, manager, kitchen; 0015). A name she already has, or
 * put away, is that item: never a second one.
 */
export async function createOwnItem(rawName: string, measuredBy: MeasuredBy, purpose: 'buy' | 'dish', category?: string): Promise<CreatedItem> {
  const name = String(rawName ?? '').replace(/\s+/g, ' ').trim()
  // Letters or digits, not "--" or ".": the search reads only those, so a
  // name without them could never be found again.
  if (normal(name).length < 2) return { error: 'Give the item a name.' }
  if (name.length > 80) return { error: 'That name is too long. Keep it under 80 letters.' }
  if (!MEASURES.includes(measuredBy)) return { error: 'Say whether it is bought by weight, by volume or by the piece.' }

  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) return { error: 'Your session has ended. Sign in again, then add the item.' }
  if (!canEditItems(ctx.role)) return { error: 'Ask the owner or a manager to add this item under Ingredients.' }

  const made = await ensureItem(supabase, accountId, name, measuredBy, category)
  if ('error' in made) return made
  if ('refused' in made) return { error: await refusalNotice(ctx.role) }

  revalidatePath('/ingredients')
  return itemFor(supabase, made.id, purpose, name)
}

/** The item as the screen's own list holds it, so it can be used at once. */
async function itemFor(supabase: Awaited<ReturnType<typeof currentContext>>['supabase'], id: string, purpose: 'buy' | 'dish', name: string): Promise<CreatedItem> {
  if (purpose === 'buy') {
    const item = (await loadPurchaseCatalog(supabase, 'buy')).items.find((i) => i.id === id)
    return item ? { item } : { error: `${name} was added. Reload the page to use it.` }
  }
  const [cook, buy] = await Promise.all([loadPurchaseCatalog(supabase, 'cook'), loadPurchaseCatalog(supabase, 'buy')])
  const item = cook.items.find((i) => i.id === id)
  if (!item) return { error: `${name} was added. Reload the page to use it.` }
  return { item: { ...item, buyUnits: buy.items.find((i) => i.id === id)?.units ?? [] } }
}
