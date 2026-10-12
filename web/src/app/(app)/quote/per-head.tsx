'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AppIcon } from '@/components/icons'
import { whatsappLink } from '@/lib/receipt'

export type PerHeadItem = {
  key: string
  name: string
  /** The database's cost for one, or null while the costing is incomplete. */
  cost: number | null
  /** The owner's own price for one, or null if none is set. */
  price: number | null
  /** The price that would hit the target margin, or null. */
  suggested: number | null
}

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })
const money = (n: number) => naira.format(n)

/**
 * Per head and for the whole event. Costs are summed only over the dishes
 * whose cost is known, and the screen says so; a missing cost is never a
 * zero. Prices are the owner's list prices; the suggested figure is the
 * database's recommended price per item, summed.
 */
export function PerHead({ items, targetMargin, businessName }: {
  items: PerHeadItem[]
  targetMargin: number | null
  businessName: string
}) {
  const [heads, setHeads] = useState('100')
  const [perHead, setPerHead] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')

  const n = Math.max(0, Math.floor(Number(heads) || 0))
  const chosen = items.filter((i) => Number(perHead[i.key] ?? 0) > 0)
  const qtyOf = (i: PerHeadItem) => Number(perHead[i.key] ?? 0)

  const totals = useMemo(() => {
    let cost = 0, price = 0, suggested = 0
    let uncosted = 0, unpriced = 0, unsuggested = 0
    for (const i of chosen) {
      const q = qtyOf(i)
      if (i.cost === null) uncosted++; else cost += q * i.cost
      if (i.price === null) unpriced++; else price += q * i.price
      if (i.suggested === null) unsuggested++; else suggested += q * i.suggested
    }
    return { cost, price, suggested, uncosted, unpriced, unsuggested }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.map((i) => `${i.key}=${perHead[i.key]}`).join(',')])

  const shown = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : items

  const quoteText = [
    `*${businessName}*`,
    `Quote for ${n} guest${n === 1 ? '' : 's'}`,
    '────────────',
    ...chosen.map((i) => `${qtyOf(i)} × ${i.name} per guest`),
    '────────────',
    totals.unpriced === 0
      ? `*${money(totals.price)} per guest · ${money(totals.price * n)} in all*`
      : `Price per guest: to be confirmed (${totals.unpriced} item${totals.unpriced === 1 ? '' : 's'} not priced yet)`,
    '', 'Reply to confirm.',
  ].join('\n')

  return (
    <div className="space-y-4">
      <div className="mm-card grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="text-sm font-medium">How many guests?</span>
          <input inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value)} className="mm-input mt-1" />
        </label>
        {items.length > 8 && (
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a dish…" aria-label="Find a dish" className="mm-input" />
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">What each guest gets</h2>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>Type how many of each a guest gets: 1 plate of jollof, 2 pieces of chicken, 1 drink.</p>
        <ul className="mm-card divide-y" style={{ borderColor: 'var(--mm-line)' }}>
          {shown.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0" style={{ borderColor: 'var(--mm-line)' }}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{i.name}</div>
                <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                  {i.cost === null ? 'cost not complete' : `costs you ${money(i.cost)}`}
                  {' · '}
                  {i.price === null ? 'no price set' : `you charge ${money(i.price)}`}
                </div>
              </div>
              <input
                inputMode="decimal" aria-label={`${i.name} per guest`}
                value={perHead[i.key] ?? ''} placeholder="0"
                onChange={(e) => setPerHead((all) => ({ ...all, [i.key]: e.target.value }))}
                className="mm-input w-20 text-center"
              />
            </li>
          ))}
        </ul>
      </section>

      {chosen.length > 0 && (
        <>
          <section className="grid gap-0 sm:grid-cols-3 sm:gap-3">
            <div className="mm-hero-stat">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>Food costs you, per guest</div>
              <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl">{money(totals.cost)}</div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                {totals.uncosted > 0
                  ? `${totals.uncosted} item${totals.uncosted === 1 ? '' : 's'} not costed yet, so the real figure is higher.`
                  : `${money(totals.cost * n)} for ${n} guests`}
              </div>
            </div>
            <div className="mm-hero-stat">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>At your prices, per guest</div>
              <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl">{money(totals.price)}</div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                {totals.unpriced > 0
                  ? `${totals.unpriced} item${totals.unpriced === 1 ? '' : 's'} with no price set.`
                  : `${money(totals.price * n)} for ${n} guests${totals.uncosted === 0 && totals.price > 0 ? ` · you keep ${money(totals.price - totals.cost)} a head` : ''}`}
              </div>
            </div>
            <div className="mm-hero-stat">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
                To keep {targetMargin !== null ? `${targetMargin}%` : 'your margin'}, per guest
              </div>
              <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl" style={{ color: 'var(--mm-accent)' }}>
                {totals.unsuggested > 0 && totals.suggested === 0 ? '—' : money(totals.suggested)}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
                {totals.unsuggested > 0
                  ? `${totals.unsuggested} item${totals.unsuggested === 1 ? '' : 's'} cannot be suggested until costed.`
                  : `${money(totals.suggested * n)} for ${n} guests`}
              </div>
            </div>
          </section>
          <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
            Food only. Serving staff, crockery, transport and drinks bought in are added as extras when you take the order.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={whatsappLink(null, quoteText)} target="_blank" rel="noreferrer" className="mm-btn mm-btn-secondary">
              Send the quote on WhatsApp
            </a>
            <Link href="/sales/new" className="mm-btn mm-btn-primary">
              Take the order <AppIcon name="arrow-right" size={18} />
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
