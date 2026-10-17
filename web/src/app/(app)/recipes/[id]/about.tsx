import Link from 'next/link'
import { Disclosure, Field, inputClass } from '@/components/ui'
import { Button } from '@/components/button'
import { quantity } from '@/lib/format'
import { addVariant, archiveRecipe, makeSize, removeVariant, scaleRecipe, updateRecipe } from './actions'
import type { Format, Unit, Variant } from './types'

const muted = { color: 'var(--mm-muted)' }
const line = { borderColor: 'var(--mm-line)' }

const sizeOf = (f: Format | null) =>
  f?.capacity_qty !== null && f?.capacity_qty !== undefined && f.capacity_unit
    ? quantity(Number(f.capacity_qty), f.capacity_unit.code)
    : 'sold by the piece'

/**
 * The dish's own facts and the things done to it once in a while: its name
 * and batch, its sizes, putting it away. Each is folded; none is needed to
 * read what the dish costs or to price it.
 *
 * Each fold keeps the title the journeys and owners already know ("Edit this
 * dish", "Put this dish away"), and the folds are side by side rather than
 * inside one "About" fold, so one tap opens any of them.
 */
export function AboutDish({
  recipe, units, yieldCode, edits, makesSizes, sellsOnItsOwn, variants, formats,
}: {
  recipe: {
    id: string; name: string; category: string | null
    batch_yield_qty: number | null; yield_unit_id: string
    portion_qty: number | null; cooking_yield_pct: number
  }
  units: Unit[]
  yieldCode: string
  edits: boolean
  makesSizes: boolean
  /** A dish (not a base used only inside other dishes): it has sizes and prices. */
  sellsOnItsOwn: boolean
  /** This dish's sizes that are switched on. */
  variants: Variant[]
  /** The business's sizes not yet on this dish. */
  formats: Format[]
}) {
  const batch = recipe.batch_yield_qty
  // A rule above the "new size" form only when something sits above it.
  const aboveNewSize = variants.length > 0 || (edits && formats.length > 0)
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">About this dish</h2>

      {edits && (
        <Disclosure summary="Edit this dish">
          <form action={updateRecipe} className="grid gap-3 sm:grid-cols-6 sm:items-end">
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <div className="sm:col-span-3">
              <Field label="Name">
                <input name="name" required maxLength={120} defaultValue={recipe.name} className={inputClass} />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Group (optional)">
                <input name="category" maxLength={60} defaultValue={recipe.category ?? ''}
                  placeholder="e.g. Rice dishes" className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-4">
              <Field label="One batch makes">
                <input name="batch_yield_qty" type="number" step="any" min="0" required inputMode="decimal"
                  defaultValue={batch ?? undefined} className={inputClass} />
              </Field>
              <Field label="Measured in">
                <select name="yield_unit_id" required defaultValue={recipe.yield_unit_id} className={inputClass}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-4">
              <Field label={`One portion is (${yieldCode})`}>
                <input name="portion_qty" type="number" step="any" min="0" inputMode="decimal"
                  defaultValue={recipe.portion_qty ?? undefined}
                  placeholder={variants.length > 0 ? 'sold in sizes' : 'e.g. 500'} className={inputClass} />
              </Field>
              <Field label="Left after cooking (%)">
                <input name="cooking_yield_pct" type="number" step="any" min="1" max="100" inputMode="decimal"
                  defaultValue={recipe.cooking_yield_pct} className={inputClass} />
              </Field>
            </div>
            <p className="text-xs sm:col-span-6" style={muted}>
              Leave the portion blank if you sell this only in sizes. Stock that cooks down from 5 litres to 4.6 is 92% left.
            </p>
            <div className="sm:col-span-6"><Button className="w-full sm:w-auto">Save changes</Button></div>
          </form>

          {batch !== null && (
            <form action={scaleRecipe} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3 sm:items-end" style={line}>
              <input type="hidden" name="recipe_id" value={recipe.id} />
              <div className="sm:col-span-2">
                <Field label={`Make ${yieldCode} instead of ${batch}`}>
                  <input name="new_batch" type="number" step="any" min="0" required inputMode="decimal"
                    placeholder={String(batch * 2)} className={inputClass} />
                </Field>
              </div>
              <Button variant="secondary" className="w-full sm:w-auto">Scale everything</Button>
              <p className="text-xs sm:col-span-3" style={muted}>
                Every ingredient and hour of work scales with it.
              </p>
            </form>
          )}
        </Disclosure>
      )}

      {/* The title is one span, not a fragment: the summary is a flex row
          (mm-tap), and as separate flex items the space before "·" was dropped. */}
      {sellsOnItsOwn && (edits || makesSizes) && (
        <Disclosure summary={<span>Sizes you sell this in <span className="font-normal" style={muted}>· {variants.length > 0
          ? `${variants.length} size${variants.length === 1 ? '' : 's'}`
          : 'Sold by the portion'}</span></span>}>
          <div className="space-y-5">
            {variants.length > 0 && (
              <ul className="space-y-2">
                {variants.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{v.format?.name ?? 'Unknown size'}</span>
                      <span className="mm-num block text-sm" style={muted}>{sizeOf(v.format)}</span>
                    </span>
                    {edits && (
                      <form action={removeVariant}>
                        <input type="hidden" name="recipe_id" value={recipe.id} />
                        <input type="hidden" name="id" value={v.id} />
                        <Button variant="secondary">Remove</Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {edits && formats.length > 0 && (
              <form action={addVariant} className={`grid gap-3 sm:grid-cols-3 sm:items-end ${variants.length > 0 ? 'border-t pt-4' : ''}`} style={line}>
                <input type="hidden" name="recipe_id" value={recipe.id} />
                <div className="sm:col-span-2">
                  <Field label="Sell this in a size">
                    <select name="format_id" required className={inputClass}>
                      {formats.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}{f.capacity_qty !== null && f.capacity_unit ? ` — ${sizeOf(f)}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Button className="w-full sm:w-auto">Add size</Button>
              </form>
            )}

            {makesSizes ? (
              <form action={makeSize} className={`grid gap-3 sm:grid-cols-3 sm:items-end ${aboveNewSize ? 'border-t pt-4' : ''}`} style={line}>
                <input type="hidden" name="recipe_id" value={recipe.id} />
                <p className="text-sm font-medium sm:col-span-3">A new size</p>
                <Field label="What do you call it?">
                  <input name="name" required maxLength={80} placeholder="Party tray" className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                  <Field label="How much it holds">
                    <input name="capacity_qty" type="number" step="any" min="0" inputMode="decimal" placeholder="2.5" className={inputClass} />
                  </Field>
                  <Field label="Measured in">
                    <select name="capacity_unit_id" defaultValue="" className={inputClass}>
                      <option value="">— by the piece —</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                    </select>
                  </Field>
                </div>
                <Button variant="secondary" className="w-full sm:col-span-3 sm:w-auto sm:justify-self-start">Make and add this size</Button>
              </form>
            ) : (
              <p className="text-sm" style={muted}>Only the owner or a manager can make a new size.</p>
            )}

            <Link href="/formats" className="mm-inline-tap text-sm" style={muted}>All your sizes</Link>
          </div>
        </Disclosure>
      )}

      {edits && (
        <Disclosure summary="Put this dish away">
          <p className="text-sm" style={muted}>
            It leaves your lists and the sale screen. Past sales keep it, and you can bring it back from Dishes.
          </p>
          <form action={archiveRecipe} className="mt-2">
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <Button variant="secondary">Put this dish away</Button>
          </form>
        </Disclosure>
      )}
    </section>
  )
}
