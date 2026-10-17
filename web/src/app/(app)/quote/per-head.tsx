'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AppIcon } from '@/components/icons'
import { DishTile } from '@/components/dish-tile'
import { whatsappLink, receiptMoney } from '@/lib/receipt'
import { orderLink } from '../sales/new/carry'
import { guestsOf } from './guests'

/*
  Every amount on this screen uses the receipt's rule (kobo kept), not
  money(): it is a quote, and "Take the order" records qty x guests at these
  exact prices. With money() 1.5 x ₦1,225 read "₦1,838 per guest" beside
  "₦183,750 in all", and a customer multiplying got ₦183,800.
*/
const fmt = receiptMoney

export type PerHeadItem = {
  /** "recipeId:variantId", the value New sale uses. */
  key: string
  /** As listed: the dish and its size. */
  name: string
  /** The dish's own name, for its tile. */
  dish: string
  photoPath: string | null
  /** The owner's own price for one, or null if none is set. */
  price: number | null
  /** Cost roles only (page.tsx): the database's cost for one, or null while
   *  the costing is incomplete. Absent for everyone else. */
  cost?: number | null
  /** Cost roles only: the price that would hit the target margin, or null. */
  suggested?: number | null
}

const MUTED = { color: 'var(--mm-muted)' } as const
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em]'

/**
 * Per head and for the whole event. Costs are summed only over the dishes
 * whose cost is known, and the screen says so; a missing cost is never a
 * zero. Prices are the owner's list prices; the suggested figure is the
 * database's recommended price per item, summed. Costs and the suggestion
 * show only when the page sent them (cost roles).
 */
export function PerHead({ items, showCosts, targetMargin, businessName, canTakeOrder }: {
  items: PerHeadItem[]
  showCosts: boolean
  targetMargin: number | null
  businessName: string
  /** Whether this role may record the sale (page.tsx, 0015); otherwise
   *  "Take the order" would open a page that refuses them. */
  canTakeOrder: boolean
}) {
  const [heads, setHeads] = useState('100')
  const [perHead, setPerHead] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')

  const n = guestsOf(heads)
  /** The event total under a per-guest figure, or a prompt while the count
   *  cannot be read: never "₦0 for 0 guests". */
  const forGuests = (perGuest: number) => n === null
    ? 'Type how many guests to see the total.'
    : `${fmt(perGuest * n)} for ${n} guest${n === 1 ? '' : 's'}`
  const qtyOf = (i: PerHeadItem) => {
    const q = Number(perHead[i.key] ?? 0)
    return Number.isFinite(q) && q > 0 ? q : 0
  }
  const chosen = items.filter((i) => qtyOf(i) > 0)

  const totals = useMemo(() => {
    let cost = 0, price = 0, suggested = 0
    let uncosted = 0, unpriced = 0, unsuggested = 0
    for (const i of chosen) {
      const q = qtyOf(i)
      if (i.cost === null || i.cost === undefined) uncosted++; else cost += q * i.cost
      if (i.price === null) unpriced++; else price += q * i.price
      if (i.suggested === null || i.suggested === undefined) unsuggested++; else suggested += q * i.suggested
    }
    return { cost, price, suggested, uncosted, unpriced, unsuggested }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.map((i) => `${i.key}=${perHead[i.key]}`).join(',')])

  const shown = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : items

  // Built only once the number of guests can be read.
  const quoteText = n === null ? null : [
    `*${businessName}*`,
    `Quote for ${n} guest${n === 1 ? '' : 's'}`,
    '────────────',
    ...chosen.map((i) => `${qtyOf(i)} × ${i.name} per guest`),
    '────────────',
    totals.unpriced === 0
      ? `*${fmt(totals.price)} per guest · ${fmt(totals.price * n)} in all*`
      : `Price per guest: to be confirmed (${totals.unpriced} item${totals.unpriced === 1 ? '' : 's'} not priced yet)`,
    '', 'Reply to confirm.',
  ].join('\n')

  // Guests x what each guest gets, carried into New sale: no retyping. Not
  // offered while the count cannot be read: it would open an empty sale.
  const takeOrder = n !== null
    ? orderLink(chosen.map((i) => ({ key: i.key, qty: qtyOf(i) * n })))
    : null

  return (
    <div className="space-y-4">
      <div className="mm-card grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="text-sm font-medium">How many guests?</span>
          <input inputMode="numeric" aria-label="How many guests?" value={heads}
                 onChange={(e) => setHeads(e.target.value)} className="mm-input mt-1" />
        </label>
        {items.length > 8 && (
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a dish…" aria-label="Find a dish" className="mm-input" />
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">What each guest gets</h2>
        <p className="text-sm" style={MUTED}>How many of each, for one guest: 1 plate of jollof, 2 pieces of chicken.</p>
        <ul className="mm-card divide-y" style={{ borderColor: 'var(--mm-line)' }}>
          {shown.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0" style={{ borderColor: 'var(--mm-line)' }}>
              <DishTile name={i.dish} photoPath={i.photoPath} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{i.name}</div>
                <div className="text-xs" style={MUTED}>
                  {i.price === null ? 'No price yet' : `${fmt(i.price)} each`}
                  {showCosts && i.cost === null ? ' · cost not complete' : ''}
                </div>
              </div>
              <input
                inputMode="decimal" aria-label={`${i.name} per guest`}
                value={perHead[i.key] ?? ''} placeholder="0"
                onChange={(e) => setPerHead((all) => ({ ...all, [i.key]: e.target.value }))}
                // .mm-input is width:100% and sits outside Tailwind's utility
                // layer, so a plain w-20 loses and the input swallowed the row,
                // squeezing the dish name to nothing. Force the width and keep
                // the input from shrinking.
                className="mm-input w-20! shrink-0 text-center"
              />
            </li>
          ))}
        </ul>
      </section>

      {chosen.length > 0 && (
        <>
          <section className={`grid gap-2 ${showCosts ? 'sm:grid-cols-3' : ''}`}>
            {showCosts && (
              <div className="mm-hero-stat">
                <div className={LABEL} style={MUTED}>Food costs you, per guest</div>
                <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl">
                  {totals.uncosted === chosen.length ? 'not known yet' : fmt(totals.cost)}
                </div>
                <div className="mt-1 text-[13px]" style={MUTED}>
                  {totals.uncosted > 0
                    ? `${totals.uncosted} item${totals.uncosted === 1 ? '' : 's'} not costed yet, so the real figure is higher.`
                    : forGuests(totals.cost)}
                </div>
              </div>
            )}
            <div className="mm-hero-stat">
              <div className={LABEL} style={MUTED}>At your prices, per guest</div>
              <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl">
                {totals.unpriced === chosen.length ? 'no price yet' : fmt(totals.price)}
              </div>
              <div className="mt-1 text-[13px]" style={MUTED}>
                {totals.unpriced > 0
                  ? `${totals.unpriced} item${totals.unpriced === 1 ? '' : 's'} with no price set.`
                  : `${forGuests(totals.price)}${showCosts && totals.uncosted === 0 && totals.price > 0 ? ` · you keep ${fmt(totals.price - totals.cost)} a head` : ''}`}
              </div>
            </div>
            {showCosts && (
              <div className="mm-hero-stat">
                <div className={LABEL} style={MUTED}>
                  To keep {targetMargin !== null ? `${targetMargin}%` : 'your margin'}, per guest
                </div>
                <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl" style={{ color: 'var(--mm-accent)' }}>
                  {totals.unsuggested > 0 ? 'not known yet' : fmt(totals.suggested)}
                </div>
                <div className="mt-1 text-[13px]" style={MUTED}>
                  {totals.unsuggested > 0
                    ? `${totals.unsuggested} item${totals.unsuggested === 1 ? '' : 's'} cannot be suggested until costed.`
                    : forGuests(totals.suggested)}
                </div>
              </div>
            )}
          </section>
          <p className="text-xs" style={MUTED}>
            Food only. Add serving staff, transport and drinks as extras when you take the order.
          </p>
          {/* Nothing to send or carry while the number of guests cannot be
              read; the lines above already ask for it. */}
          {quoteText !== null && (
            <div className="grid gap-2 sm:grid-cols-2">
              <a href={whatsappLink(null, quoteText)} target="_blank" rel="noreferrer" className="mm-btn mm-btn-secondary">
                Send the quote on WhatsApp
              </a>
              {canTakeOrder && takeOrder !== null && (
                <Link href={takeOrder} className="mm-btn mm-btn-primary">
                  Take the order <AppIcon name="arrow-right" size={18} />
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
