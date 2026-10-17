import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * "1 paint of THIS rice is 4,000 g." The one write of a local measure, used
 * by the ingredient page and by "How much is one paint of rice?" on the
 * purchase screen, so the two can never save a measure differently.
 *
 * Private measurement data, per ingredient: a paint of rice and a paint of
 * garri are different weights, so nothing here is shared or guessed. The
 * 0008 trigger re-costs every dish that uses the measure, and row-level
 * security decides who may write it (owner, manager, kitchen; 0015).
 *
 * qtyInBase is in the item's own base unit. Callers check it is above zero;
 * the table's check refuses anything else regardless.
 */
export async function writeMeasure(
  supabase: Supabase,
  m: { accountId: string; ingredientId: string; unitId: string; qtyInBase: number },
) {
  const { error } = await supabase.from('ingredient_unit_conversions').insert({
    account_id: m.accountId,
    ingredient_id: m.ingredientId,
    unit_id: m.unitId,
    qty_in_base: m.qtyInBase,
  })
  return { error }
}
