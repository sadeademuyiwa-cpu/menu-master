'use client'

import { useState } from 'react'
import { Field } from '@/components/ui'

export type ProductOption = {
  /** "recipeId:variantId" -- the value addLine splits to get both. */
  value: string
  label: string
  /** The selling price already recorded for this product, if there is one. */
  price: string | null
}

/**
 * The product chooser and the price it is normally sold at.
 *
 * Menu Master already knows what this dish sells for -- the dashboard says so
 * on the same screen the owner just came from -- so making them retype it is
 * both friction and a chance to get it wrong. Choosing a product fills the
 * price in, and the field stays editable because the price actually charged is
 * frequently not the list price.
 *
 * The two controls live together in one client component because the price
 * has to react to the select. Everything else on the form stays server
 * rendered, and the server action still validates what arrives: this is a
 * convenience, never the check.
 */
export function ProductAndPriceFields({ products }: { products: ProductOption[] }) {
  const [price, setPrice] = useState('')
  const [touched, setTouched] = useState(false)

  return (
    <>
      <div className="sm:col-span-2">
        <Field label="What was sold">
          <select
            name="product"
            className="mm-input mt-1"
            onChange={(e) => {
              const known = products.find((p) => p.value === e.target.value)?.price
              // Never overwrite a figure the owner has typed themselves.
              if (!touched) setPrice(known ?? '')
            }}
          >
            <option value="">Something not on your menu</option>
            {products.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="How many">
        <input name="qty" type="number" step="0.001" min="0.001"
               inputMode="decimal" className="mm-input mt-1" />
      </Field>
      <Field label="Price for one">
        <input name="unit_price" type="number" step="0.01" min="0"
               inputMode="decimal" className="mm-input mt-1"
               value={price}
               onChange={(e) => { setTouched(true); setPrice(e.target.value) }} />
      </Field>
    </>
  )
}
