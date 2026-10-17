'use client'

import { useState } from 'react'
import { Button } from '@/components/button'
import { keepAt, marginAt } from '@/lib/pricing'
import { money, percent } from '@/lib/format'
import { priceState } from '../../pricing/price-rows'
import { charged } from './charged'

/** A step the slider can move in that suits this dish's prices: ₦12 soup or ₦18,000 cake. */
function sliderStep(base: number, rounding: number | null): number {
  if (rounding !== null && rounding > 0 && rounding <= base / 10) return rounding
  const steps = [1000, 500, 250, 100, 50, 25, 10, 5, 1]
  return steps.find((s) => s <= base / 20) ?? 1
}

const floorTo = (v: number, step: number) => Math.floor(v / step) * step
const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step

/**
 * The selling-price form, drawn once on the dish page: "Set your selling
 * price" for a dish with none, "Try a price" for one that has one.
 *
 * Nothing changes until Save. While she types or slides, one line says what
 * the price would keep: "At ₦1,300 you keep about ₦450 (35%)". That line uses
 * keepAt and marginAt (lib/pricing.ts), the same sums v_price_check does, and
 * it says "about" because the saved figure is the database's, not this one.
 * Its colour is v_product_attention's rule (priceState), the one Home and the
 * dish page judge by: amber under the target, red below cost.
 *
 * The price itself, typed or offered, reads to the kobo when it has kobo
 * (charged): what the Save button names is exactly what it posts.
 *
 * `cost` is passed ONLY when the costing is complete and the person may see
 * costs: the server leaves it out otherwise, and then there is no slider and
 * no "you keep" line, just the price and Save. The fields are the ones the
 * dish page always posted (recipe_id, price, variant_id), now to setPrice.
 */
export function TryPrice({
  recipeId, variantId, action, returnTo, label, current, cost, suggested = null, target = null,
  rounding = null, slider = false,
}: {
  recipeId: string
  /** A size of the dish; leave out for the dish's own price. */
  variantId?: string | null
  /** setPrice from '@/lib/actions/set-price'. */
  action: (formData: FormData) => Promise<void>
  returnTo?: string
  /** The field's label: "Price per portion (₦)", "Price for Family bowl (₦)". */
  label: string
  /** What it sells for now. */
  current: number | null
  /** Its complete cost, per portion or per size. Null: no live line. */
  cost: number | null
  /** v_price_check.recommended_price, offered as "Try ₦1,450" before a price exists. */
  suggested?: number | null
  /** The owner's target margin, for the colour of the live line. */
  target?: number | null
  /** business_settings.price_rounding_to: the slider moves in these steps when they suit. */
  rounding?: number | null
  /** The range slider under the field (the dish's own price, not each size). */
  slider?: boolean
}) {
  const [value, setValue] = useState(current !== null ? String(current) : '')

  const typed = value.trim() === '' ? null : Number(value)
  const price = typed !== null && Number.isFinite(typed) && typed >= 0 ? typed : null

  const keep = cost !== null && price !== null ? keepAt(price, cost) : null
  const margin = cost !== null && price !== null ? marginAt(price, cost) : null
  const state = keep === null ? null
    : priceState({ is_complete: true, selling_price: price, profit: keep, margin_pct: margin, target_margin: target })
  const tone = state === 'losing_money' ? 'var(--mm-bad)'
    : state === 'below_target' ? 'var(--mm-warn)'
    : state === 'healthy' ? 'var(--mm-accent)' : 'inherit'

  // The slider spans from a little under the cost to well past the target,
  // so both a loss and a healthy price can be felt out.
  const offerSuggested = suggested !== null && suggested > 0 ? suggested : null
  const range = slider && cost !== null && cost > 0 ? (() => {
    const base = Math.max(cost, offerSuggested ?? 0, current ?? 0)
    const step = sliderStep(base, rounding)
    const min = Math.max(0, floorTo(cost * 0.8, step))
    const max = Math.max(min + step, ceilTo(Math.max(cost * 2.5, (offerSuggested ?? 0) * 1.4, (current ?? 0) * 1.3), step))
    const at = price ?? offerSuggested ?? current ?? ceilTo(cost * 1.5, step)
    return { step, min, max, at: Math.min(max, Math.max(min, at)) }
  })() : null

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="recipe_id" value={recipeId} />
      {variantId && <input type="hidden" name="variant_id" value={variantId} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}

      {current === null && offerSuggested !== null && cost !== null && target !== null && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          <span>
            To keep {percent(target)} you would charge about{' '}
            <span className="mm-num font-semibold" style={{ color: 'var(--mm-fg)' }}>{charged(offerSuggested)}</span>.
          </span>
          <Button type="button" variant="secondary" onClick={() => setValue(String(offerSuggested))}>
            Try {charged(offerSuggested)}
          </Button>
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium">{label}</span>
        <input
          name="price" type="number" step="0.01" min="0" required inputMode="decimal"
          value={value} onChange={(e) => setValue(e.target.value)}
          className="mm-input mm-num mt-1 font-semibold"
        />
      </label>

      {range && (
        <input
          type="range" aria-label="Slide to try a price"
          min={range.min} max={range.max} step={range.step} value={range.at}
          onChange={(e) => setValue(e.target.value)}
          className="block h-11 w-full cursor-pointer"
          style={{ accentColor: 'var(--mm-accent)' }}
        />
      )}

      {cost !== null && (
        <p aria-live="polite" className="mm-num min-h-6 text-[15px]">
          {price === null || keep === null ? (
            <span style={{ color: 'var(--mm-muted)' }}>Type a price to see what you would keep.</span>
          ) : keep < 0 ? (
            <>At {charged(price)} you lose about{' '}
              <span className="font-semibold" style={{ color: 'var(--mm-bad)' }}>{money(-keep)}</span> on each one.</>
          ) : (
            <>At {charged(price)} you keep about{' '}
              <span className="font-semibold" style={{ color: tone }}>{money(keep)}</span>
              {margin !== null && <span style={{ color: 'var(--mm-muted)' }}> ({percent(margin)})</span>}.</>
          )}
        </p>
      )}

      <Button className="w-full" busyLabel="Saving…">
        {price !== null && price !== current ? `Save ${charged(price)} as the price` : 'Save price'}
      </Button>
    </form>
  )
}
