'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/button'
import { Sheet } from '@/components/sheet'
import { money } from '@/lib/format'

type Size = { variantId: string; size: string; price: number | null }

/** A price worth offering: a real, positive amount. Never "Use ₦0". */
const offerable = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

/** "a, b and c" */
function listed(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * "Use ₦1,450": take the suggested price in two taps, with one sentence to
 * confirm it and a toast after.
 *
 * The figure is v_price_check.recommended_price, worked out by the database
 * from the owner's own cost and her own target (or suggestedPrice() in
 * lib/pricing.ts, the same sum). This only offers it: confirming calls the
 * server action you pass in -- setPrice from lib/actions/set-price.ts -- which
 * appends the price, so changing it back later is just setting the old one.
 *
 * ONLY RENDER IT FOR A ROLE THAT MAY SET PRICES: canSetPrices(ctx.role) from
 * lib/pricing.ts (owner, manager, accountant). There is deliberately no prop
 * to hide it: a suggested price is worked out from a cost, so passing one to
 * this component sends it to the phone. For sales and kitchen, leave it out
 * on the server, with the figure, rather than rendering and hiding it.
 *
 * It renders nothing when the price is missing or not above zero, so a dish
 * whose cost is incomplete is never offered a number.
 *
 * One size, or the dish itself: pass recipeId, variantId (for a size) and
 * price. A dish sold in sizes, all below target: pass `sizes` instead, and the
 * one button sets every size's suggested price together.
 *
 * Do not put it inside another <form>: its confirm sheet carries a form of
 * its own, and a form inside a form is broken HTML.
 */
export function UsePrice({
  recipeId, variantId, price, sizes, dishName, action, label, returnTo, note,
  variant = 'primary', className = '',
}: {
  recipeId: string
  /** The size being priced (recipe_variants.id). Leave out for the dish's own price. */
  variantId?: string | null
  /** The suggested price. Null or not above zero renders nothing. */
  price?: number | null
  /** Several sizes at once, each with its size name and suggested price.
   *  Renders nothing unless every one has a price above zero. */
  sizes?: Size[]
  /** As the owner calls it; for a single size include the size: "Jollof rice (Big plate)". */
  dishName: string
  /** setPrice from '@/lib/actions/set-price'. */
  action: (formData: FormData) => Promise<void>
  /** The button's words. Default "Use ₦1,450", or "Use suggested prices for both sizes". */
  label?: string
  /** Where to land afterwards. Default: the page this button is on. */
  returnTo?: string
  /** One short line under the sentence, e.g. "That keeps your 40% target." */
  note?: React.ReactNode
  variant?: 'primary' | 'secondary' | 'quiet'
  className?: string
}) {
  const pathname = usePathname() ?? ''
  const [open, setOpen] = useState(false)

  const many = sizes && sizes.length > 0 ? sizes : null
  if (many ? !many.every((s) => offerable(s.price)) : !offerable(price)) return null

  const words = label ?? (many
    ? (many.length === 2 ? 'Use suggested prices for both sizes' : `Use suggested prices for all ${many.length} sizes`)
    : `Use ${money(price)}`)
  const sentence = many
    ? `From now on, ${dishName} sells for ${listed(many.map((s) => `${money(s.price)} (${s.size})`))}.`
    : `From now on, ${dishName} sells for ${money(price)}.`

  // A redirect from the action rejects this promise with Next's redirect
  // signal, which the router then follows; `finally` closes the sheet either
  // way and lets the signal through untouched.
  async function confirm(formData: FormData) {
    try {
      await action(formData)
    } finally {
      setOpen(false)
    }
  }

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        {words}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New selling price">
        <p className="text-[15px] leading-snug">{sentence}</p>
        {note && <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{note}</p>}
        <form action={confirm} className="mt-5 grid gap-2 sm:flex sm:flex-row-reverse sm:justify-start">
          <input type="hidden" name="recipe_id" value={recipeId} />
          <input type="hidden" name="return_to" value={returnTo ?? pathname} />
          {many
            ? many.map((s) => (
                <span key={s.variantId} hidden>
                  <input type="hidden" name="variant_id" value={s.variantId} />
                  <input type="hidden" name="price" value={String(s.price)} />
                </span>
              ))
            : (
                <>
                  <input type="hidden" name="price" value={String(price)} />
                  {variantId && <input type="hidden" name="variant_id" value={variantId} />}
                </>
              )}
          <Button busyLabel="Saving…">Confirm</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Keep current price</Button>
        </form>
      </Sheet>
    </>
  )
}
