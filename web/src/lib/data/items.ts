import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { describeWriteError } from './context'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** How an item is bought, as an owner says it, and the base unit each means. */
export const BASE_UNIT = { weight: 'g', volume: 'ml', count: 'unit' } as const
export type MeasuredBy = keyof typeof BASE_UNIT

/**
 * "%" and "_" are wildcards to ilike; an item's name is matched as written.
 * PostgREST also reads "*" as "%", with no way to escape it, so a name with
 * one is refused by ensureItem rather than matched against other items.
 */
const literal = (s: string) => s.replace(/[\\%_]/g, '\\$&')

/**
 * Her item called `name`, without ever making a second one:
 * - the one she has, whatever its case (names are unique per business,
 *   0001 ux_ingredients_account_name);
 * - else one she put away, brought back with its prices (a put-away item does
 *   not hold its name, so a new one would leave the old one unrestorable);
 * - else a new item, measured `measuredBy`, filed under `category` if her
 *   business has it, otherwise under her own items.
 * Row-level security decides who may add (owner, manager, kitchen; 0015);
 * `refused` is a write the database turned away without an error.
 */
export async function ensureItem(supabase: Supabase, accountId: string, name: string, measuredBy: MeasuredBy, category?: string):
  Promise<{ id: string } | { error: string } | { refused: true }> {
  // "Ata*" would find Ata rodo, or bring back a different put-away item.
  if (name.includes('*')) return { error: 'Leave the * out of the item name.' }
  const active = async () => {
    const { data } = await supabase.from('ingredients').select('id').eq('account_id', accountId)
      .ilike('name', literal(name)).is('deleted_at', null).limit(1).returns<{ id: string }[]>()
    return data?.[0]?.id
  }
  const have = await active()
  if (have) return { id: have }

  const { data: away } = await supabase.from('ingredients').select('id').eq('account_id', accountId)
    .ilike('name', literal(name)).not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false }).limit(1).returns<{ id: string }[]>()
  if (away?.[0]) {
    const { data: back, error } = await supabase.from('ingredients').update({ deleted_at: null })
      .eq('id', away[0].id).select('id').maybeSingle<{ id: string }>()
    if (error && error.code !== '23505') return { error: describeWriteError(error) ?? `We could not add ${name}.` }
    if (back) return { id: back.id }
  }

  const [{ data: unit }, { data: categories }] = await Promise.all([
    supabase.from('units').select('id').eq('code', BASE_UNIT[measuredBy]).maybeSingle<{ id: string }>(),
    category
      // Her own business's category: someone in two businesses can read both.
      ? supabase.from('ingredient_categories').select('id').eq('account_id', accountId).eq('name', category)
          .limit(1).returns<{ id: string }[]>()
      : Promise.resolve({ data: null }),
  ])
  if (!unit) return { error: `We could not add ${name}. Try again.` }
  const { data: made, error } = await supabase.from('ingredients').insert({
    account_id: accountId, name, kind: 'ingredient', base_unit_id: unit.id, category_id: categories?.[0]?.id ?? null,
  }).select('id').maybeSingle<{ id: string }>()
  if (made) return { id: made.id }
  if (error && error.code !== '23505') return { error: describeWriteError(error) ?? `We could not add ${name}.` }
  // Added a moment ago (another tab, a double tap): use that one.
  const now = await active()
  return now ? { id: now } : { refused: true }
}
