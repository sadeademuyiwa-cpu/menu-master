'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Disclosure, Field, inputClass } from '@/components/ui'
import { Button } from '@/components/button'
import { ItemPicker } from '@/components/item-picker'
import type { CatalogUnit, LastBought, PriceKind } from '@/lib/data/purchase-catalog'
import type { CreatedItem } from '@/lib/actions/items'
import type { PickItem } from '@/lib/item-search'
import { money } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { onDay } from '../../purchases/buy-figures'
import type { Unit } from './types'

type Item = PickItem & { buyUnits?: CatalogUnit[] }
const muted = { color: 'var(--mm-muted)' }

/** "1 bag", "25 kg", "2 pieces": a quantity said with its unit. */
function amountOf(qty: number, unit: string): string {
  const one: Record<string, string> = { pieces: 'piece', grams: 'gram', litres: 'litre', pairs: 'pair' }
  return `${qty.toLocaleString('en-NG', { maximumFractionDigits: 3 })} ${qty === 1 ? (one[unit] ?? unit) : unit}`.trim()
}

/**
 * "Add an ingredient": one fold, opened by itself while the dish is empty.
 *
 * The ingredient starts empty and must be chosen: as a <select> with no
 * empty option, the first item (Acha) went in whenever only a quantity was
 * typed. A search that finds nothing offers to add the item there and then.
 *
 * Someone who records purchases may also say what she paid for it: empty
 * boxes for an item with no price; for one with a price, that price and
 * "Paid a new price?". Recorded as a real purchase by addLine. Never
 * pre-filled: a new amount over last time's quantity would cost every dish
 * that uses it wrongly.
 */
export function AddIngredient({ recipeId, ingredients, units, open, action, canAddItems, canBuy, priced, lastBought, today, createItem }: {
  recipeId: string
  ingredients: Item[]
  units: Unit[]
  open: boolean
  action: (formData: FormData) => void | Promise<void>
  canAddItems: boolean
  canBuy: boolean
  /** Which items have a price, and how it came about (loadPricedItems). */
  priced: Record<string, PriceKind>
  lastBought: Record<string, LastBought>
  today: string
  createItem: (name: string, measuredBy: 'weight' | 'volume' | 'count', purpose: 'buy' | 'dish') => Promise<CreatedItem>
}) {
  const [items, setItems] = useState(ingredients)
  const [itemId, setItemId] = useState('')
  const [newPrice, setNewPrice] = useState(false)
  const [paidUnitId, setPaidUnitId] = useState('')
  const item = items.find((i) => i.id === itemId)
  const last = item ? lastBought[item.id] : undefined
  const hasPrice = !!item && !!priced[item.id]
  const showBoxes = canBuy && !!item && (!hasPrice || newPrice)
  /** The unit she last bought it in, if offered here; else the first that is (see NewDish). */
  const buyUnitOf = (it: Item | undefined) => {
    const lastUnit = it && lastBought[it.id]?.unitId
    return (lastUnit && it?.buyUnits?.some((u) => u.id === lastUnit) ? lastUnit : it?.buyUnits?.[0]?.id) ?? ''
  }

  return (
    <Disclosure summary="Add an ingredient" open={open}>
      <form action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <input type="hidden" name="recipe_id" value={recipeId} />
        <div className="sm:col-span-2">
          <Field label="Ingredient">
            <ItemPicker items={items} name="ingredient_id" required label="Ingredient" title="Which ingredient?"
                        placeholder="Choose an ingredient…" missing="Choose the ingredient first." className="mt-1"
                        value={itemId}
                        onChange={(id) => {
                          setItemId(id); setNewPrice(false)
                          setPaidUnitId(buyUnitOf(items.find((i) => i.id === id)))
                        }}
                        onCreate={canAddItems ? async (n, m) => {
                          const res = await createItem(n, m, 'dish')
                          return 'error' in res ? res : { item: res.item as Item }
                        } : undefined}
                        onCreated={(made) => {
                          setItems((current) => (current.some((i) => i.id === made.id) ? current : [...current, made]))
                          setItemId(made.id); setNewPrice(false); setPaidUnitId(buyUnitOf(made))
                        }} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field label="Quantity">
            <input name="qty" type="number" step="any" min="0" required inputMode="decimal" className={inputClass} />
          </Field>
          <Field label="Unit">
            {/* Empty first, for the same reason: never a unit nobody chose. */}
            <select name="unit_id" required defaultValue="" className={inputClass}>
              <option value="" disabled>Choose…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {canBuy && item && hasPrice && !newPrice && (
          <p className="text-xs sm:col-span-4" style={muted} data-price-known>
            {last && last.amount !== undefined
              ? <>You paid <span className="mm-num font-semibold" style={{ color: 'var(--mm-fg)' }}>{money(last.amount)}</span> for {amountOf(last.qty, last.unit)} {onDay(formatDay(last.day))}.{' '}</>
              : priced[item.id] === 'estimate'
                ? <>Costed from an estimate you typed, not a purchase.{' '}</>
                : <>Priced from what you paid.{' '}</>}
            <button type="button" className="mm-inline-tap font-semibold underline" style={{ color: 'var(--mm-fg)' }}
                    onClick={() => setNewPrice(true)}>
              Paid a new price?
            </button>
          </p>
        )}
        {showBoxes && (
          // Keyed by the item: what she typed for one item never stays in the
          // boxes when she chooses another (the boxes hold their own text).
          <div key={item.id} className="space-y-2 rounded-[11px] border p-2 sm:col-span-4" style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-surface-2)' }} data-price-boxes>
            <p className="text-xs font-medium" style={muted}>{hasPrice ? 'What you paid this time' : 'What you paid for it (optional)'}</p>
            <div className="grid grid-cols-[1.1fr_0.8fr_1fr] gap-2">
              <input name="paid" inputMode="decimal" aria-label="You paid in naira" className="mm-input" autoFocus={newPrice}
                     placeholder={last?.amount !== undefined ? `₦ e.g. ${last.amount.toLocaleString('en-NG')}` : '₦ e.g. 3000'} />
              <input name="paid_qty" inputMode="decimal" aria-label="Quantity bought for that price" className="mm-input"
                     placeholder={last ? `for ${last.qty}` : 'for 1'} />
              <select name="paid_unit_id" aria-label="Bought in" className="mm-input" value={paidUnitId} onChange={(e) => setPaidUnitId(e.target.value)}>
                {(item.buyUnits ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
            <label className="flex flex-wrap items-center gap-2 text-xs" style={muted}>
              <span>Paid on</span>
              <input type="date" name="paid_on" defaultValue={today} max={today} className="mm-input" style={{ width: 'auto' }} />
            </label>
          </div>
        )}
        <div className="sm:col-span-4"><Button className="w-full sm:w-auto">Add ingredient</Button></div>
      </form>
      {items.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: 'var(--mm-warn)' }}>
          You have no ingredients yet. Add them under{' '}
          <Link href="/ingredients" className="mm-inline-tap">Ingredients</Link> first, with what you paid.
        </p>
      )}
    </Disclosure>
  )
}
