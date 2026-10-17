'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/button'
import { Sheet } from '@/components/sheet'
import { AppIcon } from '@/components/icons'
import { DishTile } from '@/components/dish-tile'
import type { MenuItem } from '@/lib/data/menu'
import { money } from '@/lib/format'
import { keepAt } from '@/lib/pricing'
import { formatDay } from '@/lib/dates'
import type { OrderResult } from './actions'
import type { RecentExtra } from './order-data'
import type { CarriedLine } from './carry'
import './take-order.css'

type Customer = { id: string; name: string; phone: string | null }
type Line = {
  key: string; product: string | null; name: string
  qty: number; price: number | null
  /** Taken off this item only, in naira. */
  discount: number
  /** What one of a NON-DISH item costs the owner, if they said. */
  cost?: number | null
}
type Who =
  | { kind: 'none' }
  | { kind: 'existing'; id: string; name: string }
  | { kind: 'new'; name: string; phone: string }
type Editing = { key: string; name: string; product: string | null; isNew: boolean }
type Payment = 'paid' | 'part' | 'none'

/** What the owner typed, as a non-negative amount, or null. Blank is not zero. */
const amount = (raw: string): number | null => {
  const t = raw.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const label = (m: MenuItem) => (m.size ? `${m.name} · ${m.size}` : m.name)
const lineTotal = (l: Line) => l.qty * (l.price ?? 0) - l.discount
/** Dishes with no category, when others have one. */
const OTHER = ''
const MUTED = { color: 'var(--mm-muted)' } as const

/**
 * Taking an order: tap what they bought, check it, confirm -- or save it for
 * later, for an order taken today and served another day. Nothing is saved
 * until one of those buttons, and then the whole sale is written in one step
 * (actions.ts). The total here is a running sum of the prices on screen; the
 * recorded figures, and every cost, come from the database.
 *
 * `costs` is there only for the roles that may see costs (page.tsx decides
 * on the server); without it this screen shows no cost and no "you keep".
 */
export function TakeOrder({
  menu, customers, today, action, costs, extras, carried = [],
}: {
  menu: MenuItem[]
  customers: Customer[]
  today: string
  action: (prev: OrderResult, formData: FormData) => Promise<OrderResult>
  /** What one of each dish costs ("recipeId:variantId"), for cost roles only. */
  costs?: Record<string, number | null>
  /** Recent things not on the menu, for the chips in that sheet. */
  extras: RecentExtra[]
  /** An order carried from Price per head: dishes and how many, no prices. */
  carried?: CarriedLine[]
}) {
  const byValue = useMemo(() => new Map(menu.map((m) => [m.value, m])), [menu])
  const [result, formAction] = useActionState(action, null)
  // An order carried in from Price per head arrives filled in: straight to
  // the check step, where extras such as delivery are added.
  const [step, setStep] = useState<'menu' | 'review'>(carried.length > 0 ? 'review' : 'menu')
  const [lines, setLines] = useState<Line[]>(() => carried.flatMap((c) => {
    const m = byValue.get(c.key)
    return m ? [{ key: m.value, product: m.value, name: label(m), qty: c.qty, price: m.price, discount: 0 }] : []
  }))
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [who, setWho] = useState<Who>({ kind: 'none' })
  const [discount, setDiscount] = useState(0)
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  // Most food sales are paid on the spot; a sale left "not paid" is chased later.
  const [payment, setPayment] = useState<Payment>('paid')
  const [partRaw, setPartRaw] = useState('')

  const [editing, setEditing] = useState<Editing | null>(null)
  const [otherOpen, setOtherOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)

  const count = lines.reduce((t, l) => t + l.qty, 0)
  const subtotal = lines.reduce((t, l) => t + lineTotal(l), 0)
  const total = Math.max(0, subtotal - discount)
  const lineOf = (key: string) => lines.find((l) => l.key === key) ?? null
  const unpriced = lines.some((l) => l.price === null)

  // Part paid: what they handed over must be a real amount below the total.
  const partAmount = payment === 'part' ? amount(partRaw) : null
  const partProblem: { text: string; warn: boolean } | null = payment !== 'part' ? null
    : partRaw.trim() === '' ? { text: 'Type what they paid so far.', warn: false }
    : partAmount === null || partAmount === 0 ? { text: 'Type the amount in naira, using digits only.', warn: true }
    : partAmount >= total ? { text: 'That is the whole total. Choose Paid now.', warn: true }
    : null

  /*
    "You keep about", for cost roles only. The same rule as the sale page:
    the profit is over the items whose cost is known, and the whole-sale
    discount is shared across items by what each comes to, as
    fn_allocate_order_discount shares it. An extra with no cost typed is left
    out, as the database leaves it out. A dish whose cost is not known makes
    the answer "not known yet", never a guess. It is "about" because the
    database freezes the cost at the moment of confirming.
  */
  const keep = useMemo((): number | null | undefined => {
    if (!costs) return undefined
    const all = lines.reduce((t, l) => t + lineTotal(l), 0)
    let net = 0, cost = 0, any = false
    for (const l of lines) {
      if (l.price === null) return null
      const unit = l.product ? (costs[l.product] ?? null) : (l.cost ?? null)
      if (unit === null) { if (l.product) return null; continue }
      const share = all > 0 ? (discount * lineTotal(l)) / all : 0
      net += lineTotal(l) - share
      cost += l.qty * unit
      any = true
    }
    return any ? keepAt(Math.round(net * 100) / 100, Math.round(cost * 10000) / 10000) : null
  }, [costs, lines, discount])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menu.filter((m) =>
      (!q || label(m).toLowerCase().includes(q)) &&
      (category === null || (m.category || OTHER) === category))
  }, [menu, search, category])
  // Category chips only when the menu really has more than one group.
  const categories = useMemo(() => {
    const named = [...new Set(menu.map((m) => m.category).filter((c): c is string => !!c))]
    const loose = menu.some((m) => !m.category)
    return named.length + (loose ? 1 : 0) > 1 ? [...named, ...(loose ? [OTHER] : [])] : []
  }, [menu])
  const groups = useMemo(() => {
    const g = new Map<string, MenuItem[]>()
    for (const m of shown) {
      const name = m.category || (categories.length ? 'Other dishes' : 'Your menu')
      g.set(name, [...(g.get(name) ?? []), m])
    }
    return [...g.entries()]
  }, [shown, categories])

  function add(m: MenuItem) {
    const existing = lineOf(m.value)
    if (existing) {
      setLines((all) => all.map((l) => (l.key === m.value ? { ...l, qty: l.qty + 1 } : l)))
    } else if (m.price === null) {
      // No price recorded for this dish: ask, never assume.
      setEditing({ key: m.value, name: label(m), product: m.value, isNew: true })
    } else {
      setLines((all) => [...all, { key: m.value, product: m.value, name: label(m), qty: 1, price: m.price, discount: 0 }])
    }
  }
  function change(key: string, by: number) {
    setLines((all) => all.flatMap((l) => {
      if (l.key !== key) return [l]
      const qty = l.qty + by
      // A per-item discount can never exceed what the item now comes to.
      return qty > 0 ? [{ ...l, qty, discount: Math.min(l.discount, qty * (l.price ?? 0)) }] : []
    }))
  }
  const edit = (l: Line) => setEditing({ key: l.key, name: l.name, product: l.product, isNew: false })

  const payload = JSON.stringify({
    lines: lines.map((l) => ({
      product: l.product, description: l.product ? null : l.name,
      qty: l.qty, price: l.price, discount: l.discount,
      cost: l.product ? null : (l.cost ?? null),
    })),
    customerId: who.kind === 'existing' ? who.id : null,
    newCustomer: who.kind === 'new' ? { name: who.name, phone: who.phone } : null,
    date, reference, discount,
    paid: payment === 'paid',
    paidAmount: payment === 'part' ? partAmount : null,
  })

  const stepper = (l: Line) => (
    <div className="mm-sell-stepper">
      <button type="button" className="mm-step-btn" aria-label={`One less ${l.name}`} onClick={() => change(l.key, -1)}>−</button>
      <button type="button" className="mm-tap mm-num min-w-8 justify-center text-lg font-semibold underline decoration-dotted underline-offset-4"
              aria-label={`How many ${l.name}: ${l.qty}. Change`} onClick={() => edit(l)}>
        {l.qty}
      </button>
      <button type="button" className="mm-step-btn" data-add="true" aria-label={`One more ${l.name}`} onClick={() => change(l.key, 1)}>+</button>
    </div>
  )

  const card = (m: MenuItem) => {
    const l = lineOf(m.value)
    const price = l?.price ?? m.price
    return (
      <li key={m.value} className="mm-sell-card" data-in-cart={l ? true : undefined}>
        <div className="mm-sell-media">
          {/* The picture adds one too, like tapping a dish in a food app. The
              "+" is the labelled control; this is a bigger target for a thumb. */}
          <button type="button" className="mm-sell-photo" tabIndex={-1} aria-hidden="true" onClick={() => add(m)}>
            <DishTile name={m.name} photoPath={m.photo_path} size="card" className="rounded-none" />
          </button>
          {l ? (
            <span className="mm-sell-count" aria-hidden="true">{l.qty}</span>
          ) : (
            <button type="button" className="mm-sell-add" aria-label={`Add ${label(m)}`} onClick={() => add(m)}>+</button>
          )}
        </div>
        <div className="mm-sell-body">
          <div className="line-clamp-2 font-semibold leading-snug">{m.name}</div>
          {m.size && <div className="truncate text-xs" style={MUTED}>{m.size}</div>}
          <div className="mm-num mt-auto pt-1 text-sm font-semibold"
               style={{ color: price === null ? 'var(--mm-muted)' : 'var(--mm-accent-strong)' }}>
            {price === null ? 'No price yet' : money(price)}
          </div>
          {l && stepper(l)}
        </div>
      </li>
    )
  }

  const notOnMenu = (
    <button type="button" className="mm-btn mm-btn-secondary w-full" onClick={() => setOtherOpen(true)}>
      + Something not on the menu
    </button>
  )

  return (
    <div className="space-y-4">
      {step === 'menu' ? (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">New sale</h1>
            <p className="mt-1 text-sm" style={MUTED}>Tap what they bought.</p>
          </div>

          {menu.length > 8 && (
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a dish…" aria-label="Find a dish" className="mm-input"
            />
          )}
          {categories.length > 0 && (
            <div className="mm-sell-chips" role="group" aria-label="Show dishes from">
              <button type="button" className="mm-sell-chip" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
              {categories.map((c) => (
                <button key={c || 'other'} type="button" className="mm-sell-chip" aria-pressed={category === c}
                        onClick={() => setCategory(c)}>
                  {c || 'Other dishes'}
                </button>
              ))}
            </div>
          )}

          {menu.length === 0 ? (
            <div className="mm-empty">
              <span className="mm-empty-icon"><AppIcon name="info" size={18} /></span>
              <p>
                You have no dishes to sell yet.{' '}
                <Link href="/recipes" className="underline">Add a dish</Link> first, or add an item that is not on your menu below.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm" style={MUTED}>No dish matches “{search}”.</p>
          ) : category === null && groups.length > 1 ? (
            groups.map(([group, items]) => (
              <section key={group} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em]" style={MUTED}>{group}</h2>
                <ul className="mm-sell-grid">{items.map(card)}</ul>
              </section>
            ))
          ) : (
            <ul className="mm-sell-grid">{shown.map(card)}</ul>
          )}

          {notOnMenu}

          <div className="mm-cart-bar">
            {/* An empty basket has no total yet: one line, never ₦0, the same
                as New purchase. */}
            {count === 0 ? (
              <div className="min-w-0 text-sm" style={MUTED}>Nothing added yet</div>
            ) : (
              <div className="min-w-0">
                <div className="text-xs" style={MUTED}>{`${count} item${count === 1 ? '' : 's'}`}</div>
                <div className="mm-num text-lg font-semibold">{money(subtotal)}</div>
              </div>
            )}
            <button type="button" className="mm-btn mm-btn-primary" disabled={count === 0} onClick={() => setStep('review')}>
              Next <AppIcon name="arrow-right" size={18} />
            </button>
          </div>
        </>
      ) : (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="payload" value={payload} />
          {/* How saving works is there when asked for, behind the (i), not
              two more sentences on every sale. Same markup as the page
              header's InfoHint (components/ui). */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Check and confirm</h1>
            <details className="mm-info relative shrink-0">
              <summary className="mm-icon-btn" aria-label="About saving this sale" title="About saving this sale">
                <AppIcon name="info" size={18} />
              </summary>
              <div className="mm-info-popover">
                Nothing is saved until you press a button below. Save for later is for an order you will
                serve another day; it does not count as a sale until you confirm it.
              </div>
            </details>
          </div>

          {lines.length === 0 ? (
            <p className="mm-empty">Nothing on this sale yet. Tap Add more to choose dishes.</p>
          ) : (
            <ul className="mm-card divide-y" style={{ borderColor: 'var(--mm-line)' }}>
              {lines.map((l) => {
                const m = l.product ? byValue.get(l.product) : undefined
                return (
                  <li key={l.key} className="py-3 first:pt-0 last:pb-0" style={{ borderColor: 'var(--mm-line)' }}>
                    <div className="flex items-center gap-3">
                      <DishTile name={m?.name ?? l.name} photoPath={m?.photo_path} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
                      <span className="mm-num shrink-0 font-semibold">{money(lineTotal(l))}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <button type="button" className="mm-tap min-w-0 text-left text-sm underline" style={MUTED}
                              onClick={() => edit(l)}>
                        {l.price === null ? 'Set price' : `${money(l.price)} each`}
                        {l.discount > 0 ? ` · less ${money(l.discount)} off` : ''} · Change
                      </button>
                      <div className="shrink-0">{stepper(l)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {notOnMenu}

          <div className="mm-card space-y-3">
            <Row label="Customer" value={who.kind === 'none' ? 'Not recorded' : who.name}
                 action={who.kind === 'none' ? 'Add' : 'Change'} onAction={() => setCustomerOpen(true)} />
            <Row label="Discount on the whole sale" value={discount > 0 ? `−${money(discount)}` : 'None'}
                 action={discount > 0 ? 'Change' : 'Add'} onAction={() => setDiscountOpen(true)} />
            <div className="space-y-2">
              <div className="text-sm" style={MUTED}>Payment</div>
              <div className="mm-sell-seg" role="radiogroup" aria-label="Payment">
                {([['paid', 'Paid now'], ['part', 'Part paid'], ['none', 'Not paid']] as const).map(([v, text]) => (
                  <button key={v} type="button" role="radio" aria-checked={payment === v} onClick={() => setPayment(v)}>
                    {text}
                  </button>
                ))}
              </div>
              {payment === 'part' && (
                <label className="block">
                  <span className="text-sm font-medium">Paid so far (₦)</span>
                  <input name="part_paid_input" inputMode="decimal" value={partRaw} autoFocus
                         onChange={(e) => setPartRaw(e.target.value)} placeholder="e.g. 10000" className="mm-input mt-1" />
                  {partProblem && (
                    <span className="mt-1 block text-sm" style={{ color: partProblem.warn ? 'var(--mm-warn)' : 'var(--mm-muted)' }}>
                      {partProblem.text}
                    </span>
                  )}
                </label>
              )}
            </div>
            <details>
              <summary className="mm-tap cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">
                <span style={MUTED}>Date and reference</span>
                <span className="ml-auto pl-3 font-medium">{formatDay(date)}{reference ? ` · ${reference}` : ''}</span>
              </summary>
              <div className="grid gap-3 pb-2 pt-1 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">Date</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mm-input mt-1" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Your reference (optional)</span>
                  <input name="reference_input" value={reference} onChange={(e) => setReference(e.target.value)}
                         placeholder="e.g. Sat wedding" className="mm-input mt-1" />
                </label>
              </div>
            </details>
          </div>

          <div className="mm-card">
            {discount > 0 && (
              <div className="flex justify-between text-sm" style={MUTED}>
                <span>Before the discount</span><span className="mm-num">{money(subtotal)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Total</span>
              <span className="mm-num text-2xl font-semibold">{money(total)}</span>
            </div>
            {keep !== undefined && (
              <p className="mm-num mt-1 text-right text-sm font-semibold" style={{
                color: keep === null ? 'var(--mm-muted)' : keep < 0 ? 'var(--mm-bad)' : 'var(--mm-accent)',
              }}>
                {keep === null ? 'You keep: not known yet'
                  : keep < 0 ? `This sale loses about ${money(-keep)}`
                  : `You keep about ${money(keep)}`}
              </p>
            )}
          </div>

          {unpriced && (
            <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>Set a price for every item before you save the sale.</p>
          )}
          {result?.error && (
            <div role="alert" className="mm-notice" data-tone="warn">
              <span className="mt-0.5 shrink-0" aria-hidden><AppIcon name="alert" size={19} /></span>
              <div className="min-w-0">{result.error}</div>
            </div>
          )}

          {/* One main button. The check step stays: a confirmed sale can only
              be cancelled and re-issued, so it is never confirmed from the cart. */}
          <Button name="mode" value="send" className="w-full" busyLabel="Recording the sale…"
                  disabled={lines.length === 0 || unpriced || partProblem !== null}>
            Confirm and send receipt
          </Button>
          <Button name="mode" value="confirm" variant="secondary" className="w-full" busyLabel="Recording the sale…"
                  disabled={lines.length === 0 || unpriced || partProblem !== null}>
            Confirm sale
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="mm-btn mm-btn-secondary" onClick={() => setStep('menu')}>
              <AppIcon name="arrow-left" size={18} /> Add more
            </button>
            <Button name="mode" value="draft" variant="secondary" busyLabel="Saving…" disabled={lines.length === 0 || unpriced}>
              Save for later
            </Button>
          </div>
        </form>
      )}

      <ItemSheet
        editing={editing}
        line={editing ? lineOf(editing.key) : null}
        onClose={() => setEditing(null)}
        onSave={(qty, price, itemDiscount) => {
          if (!editing) return
          if (editing.isNew) {
            setLines((all) => [...all, { key: editing.key, product: editing.product, name: editing.name, qty, price, discount: itemDiscount }])
          } else {
            setLines((all) => all.map((l) => (l.key === editing.key ? { ...l, qty, price, discount: itemDiscount } : l)))
          }
          setEditing(null)
        }}
      />
      <OtherItemSheet
        open={otherOpen}
        extras={extras}
        onClose={() => setOtherOpen(false)}
        onSave={(name, qty, price, cost) => {
          setLines((all) => [...all, { key: `other-${all.length}-${name}`, product: null, name, qty, price, discount: 0, cost }])
          setOtherOpen(false)
        }}
      />
      <DiscountSheet
        open={discountOpen} subtotal={subtotal} current={discount}
        onClose={() => setDiscountOpen(false)}
        onSave={(d) => { setDiscount(d); setDiscountOpen(false) }}
      />
      <CustomerSheet
        open={customerOpen} customers={customers}
        onClose={() => setCustomerOpen(false)}
        onPick={(w) => { setWho(w); setCustomerOpen(false) }}
      />
    </div>
  )
}

function Row({ label, value, action, onAction }: { label: string; value: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span style={MUTED}>{label}</span>
      <span className="ml-auto truncate font-medium">{value}</span>
      <button type="button" className="mm-tap font-semibold underline" style={{ color: 'var(--mm-accent)' }}
              aria-label={`${action} ${label.toLowerCase()}`} onClick={onAction}>{action}</button>
    </div>
  )
}

/** How many, the price for one, and an optional discount on just this item. */
function ItemSheet({ editing, line, onClose, onSave }: {
  editing: Editing | null
  line: Line | null
  onClose: () => void
  onSave: (qty: number, price: number, discount: number) => void
}) {
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [disc, setDisc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reset = () => { setQty(''); setPrice(''); setDisc(''); setError(null) }
  return (
    <Sheet open={editing !== null} onClose={() => { reset(); onClose() }} title={editing?.name ?? 'Item'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          const q = qty.trim() === '' ? (line?.qty ?? 1) : Number(qty)
          const p = price.trim() === '' ? (line?.price ?? null) : amount(price)
          const d = disc.trim() === '' ? (line?.discount ?? 0) : amount(disc)
          if (!Number.isFinite(q) || q <= 0) { setError('How many? It must be more than zero.'); return }
          if (p === null) { setError('Enter what you charge for one, in naira, using digits only.'); return }
          if (d === null) { setError('Enter the discount in naira, using digits only, or leave it empty.'); return }
          if (d > q * p) { setError(`The discount cannot be more than these come to (${money(q * p)}).`); return }
          reset(); onSave(q, p, d)
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-sm font-medium">How many</span>
            <input name="item_qty" autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                   placeholder={String(line?.qty ?? 1)} className="mm-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Price for one (₦)</span>
            <input name="item_price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                   placeholder={line?.price !== null && line?.price !== undefined ? String(line.price) : 'e.g. 1500'} className="mm-input mt-1" />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Discount on these only (₦, optional)</span>
          <input name="item_discount" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)}
                 placeholder={line && line.discount > 0 ? String(line.discount) : 'e.g. 500'} className="mm-input mt-1" />
        </label>
        {error && <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
        <button type="submit" className="mm-btn mm-btn-primary w-full">Done</button>
      </form>
    </Sheet>
  )
}

/**
 * Something not on the menu: delivery, serving staff, drinks bought in.
 * A recent extra is a chip that fills in the name and the charge only. What
 * it costs is typed fresh, with last time's figure beside the box as a hint
 * (cost roles only): the driver's fare changes, and a copied cost would
 * quietly make the profit wrong.
 */
function OtherItemSheet({ open, extras, onClose, onSave }: {
  open: boolean
  extras: RecentExtra[]
  onClose: () => void
  onSave: (name: string, qty: number, price: number, cost: number | null) => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reset = () => { setName(''); setQty('1'); setPrice(''); setCost(''); setError(null) }
  const before = extras.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
  const lastCost = before?.lastCost ?? null
  return (
    <Sheet open={open} onClose={() => { reset(); onClose() }} title="Something not on the menu">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          const q = Number(qty), p = amount(price)
          const c = cost.trim() === '' ? null : amount(cost)
          if (!name.trim()) { setError('Say what it is, e.g. Delivery.'); return }
          if (!Number.isFinite(q) || q <= 0) { setError('How many? It must be more than zero.'); return }
          if (p === null) { setError('Enter what you charged for one, in naira.'); return }
          if (cost.trim() !== '' && c === null) { setError('What it costs you is an amount in naira, or leave it empty.'); return }
          reset(); onSave(name.trim(), q, p, c)
        }}
      >
        {extras.length > 0 && (
          <div className="mm-sell-chips" role="group" aria-label="Charged before">
            {extras.map((x) => (
              <button key={x.name} type="button" className="mm-sell-chip" aria-pressed={before === x}
                      onClick={() => { setName(x.name); setPrice(String(x.price)); setError(null) }}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        <label className="block">
          <span className="text-sm font-medium">What is it?</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery, Extra plantain" className="mm-input mt-1" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-sm font-medium">How many</span>
            <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="mm-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Price for one (₦)</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 500" className="mm-input mt-1" />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-medium">What one costs you (₦, optional)</span>
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)}
                 placeholder={lastCost !== null ? `last time ${money(lastCost)}` : 'e.g. 300'} className="mm-input mt-1" />
          <span className="mt-1 block text-xs" style={MUTED}>
            {lastCost !== null
              ? `Last time it cost you ${money(lastCost)}. Type what it costs today.`
              : 'With it, this item counts in your profit.'}
          </span>
        </label>
        {error && <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
        <button type="submit" className="mm-btn mm-btn-primary w-full">Add to sale</button>
      </form>
    </Sheet>
  )
}

function DiscountSheet({ open, subtotal, current, onClose, onSave }: {
  open: boolean; subtotal: number; current: number
  onClose: () => void
  onSave: (discount: number) => void
}) {
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet open={open} onClose={() => { setRaw(''); setError(null); onClose() }} title="Discount on the whole sale">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          const d = raw.trim() === '' ? 0 : amount(raw)
          if (d === null) { setError('Enter the discount in naira, using digits only.'); return }
          if (d > subtotal) { setError(`The discount cannot be more than the sale (${money(subtotal)}).`); return }
          setRaw(''); setError(null); onSave(d)
        }}
      >
        <label className="block">
          <span className="text-sm font-medium">Amount taken off (₦)</span>
          <input name="order_discount_input" autoFocus inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)}
                 placeholder={current > 0 ? String(current) : 'e.g. 500'} className="mm-input mt-1" />
        </label>
        <p className="text-xs" style={MUTED}>
          It is shared across the items, so each dish still shows its true profit. Leave it empty for no discount.
        </p>
        {error && <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}
        <button type="submit" className="mm-btn mm-btn-primary w-full">Save discount</button>
      </form>
    </Sheet>
  )
}

function CustomerSheet({ open, customers, onClose, onPick }: {
  open: boolean
  customers: Customer[]
  onClose: () => void
  onPick: (who: Who) => void
}) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const reset = () => { setQ(''); setAdding(false); setName(''); setPhone('') }
  const term = q.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const found = term
    ? customers.filter((c) => c.name.toLowerCase().includes(term) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)))
    : customers.slice(0, 8)

  return (
    <Sheet open={open} onClose={() => { reset(); onClose() }} title="Who is buying?">
      {!adding ? (
        <div className="space-y-3">
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Name or phone number" aria-label="Find a customer" className="mm-input" />
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {found.map((c) => (
              <li key={c.id}>
                <button type="button" className="mm-tap w-full rounded-lg px-2 text-left hover:bg-[var(--mm-surface-2)]"
                        onClick={() => { reset(); onPick({ kind: 'existing', id: c.id, name: c.name }) }}>
                  <span className="font-medium">{c.name}</span>
                  {c.phone && <span className="ml-2 text-xs" style={MUTED}>{c.phone}</span>}
                </button>
              </li>
            ))}
            {term && found.length === 0 && (
              <li className="px-2 text-sm" style={MUTED}>No customer matches “{q}”.</li>
            )}
          </ul>
          <button type="button" className="mm-btn mm-btn-secondary w-full"
                  onClick={() => { setAdding(true); if (/^[\d+\s]+$/.test(q.trim())) setPhone(q.trim()); else setName(q.trim()) }}>
            + Add a new customer
          </button>
          <button type="button" className="mm-tap w-full justify-center text-sm underline" style={MUTED}
                  onClick={() => { reset(); onPick({ kind: 'none' }) }}>
            Sell without recording a customer
          </button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const w = { kind: 'new' as const, name: name.trim(), phone: phone.trim() }; reset(); onPick(w) }}
        >
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ngozi Adeyemi" className="mm-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Phone (for the WhatsApp receipt)</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0803 123 4567" className="mm-input mt-1" />
          </label>
          <p className="text-xs" style={MUTED}>They are saved to your customers when you save the sale.</p>
          <button type="submit" className="mm-btn mm-btn-primary w-full">Use this customer</button>
          <button type="button" className="mm-tap w-full justify-center text-sm underline" style={MUTED} onClick={() => setAdding(false)}>
            Back to the list
          </button>
        </form>
      )}
    </Sheet>
  )
}
