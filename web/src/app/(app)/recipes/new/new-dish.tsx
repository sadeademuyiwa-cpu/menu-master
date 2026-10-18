'use client'

import { useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { ItemPicker } from '@/components/item-picker'
import type { LastBought, PriceKind } from '@/lib/data/purchase-catalog'
import type { CreatedItem, NewOwnItem } from '@/lib/actions/items'
import { DISHES, NEW_ITEMS, type LibraryDish } from '@/lib/dish-library-data'
import { findDishes, ownItemFinder, suggestFor, type Suggestion } from '@/lib/item-search'
import { money } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { onDay } from '../../purchases/buy-figures'
import type { AddedItem, DishResult } from './actions'

type Item = NewOwnItem
type YieldUnit = { id: string; code: string; label: string }
/**
 * One ingredient line. `suggested`: put there by a dish suggestion and not
 * chosen by her since. `paid`, `paidQty`, `paidUnitId`: what she paid for it,
 * if she says ("₦3,000 for 1 paint"); `newPrice` opens those boxes for an
 * item that already has a price.
 */
type Row = {
  key: number; ingredientId: string; unitId: string; qty: string; suggested?: boolean
  paid: string; paidQty: string; paidUnitId: string; newPrice?: boolean
}
type Followup = {
  dish: string; partial: boolean; added: number
  optional: Item[]; notInList: Suggestion<Item>['notInList']
}

const muted = { color: 'var(--mm-muted)' }
const empty = { ingredientId: '', unitId: '', qty: '', paid: '', paidQty: '', paidUnitId: '' }

/** "1 bag", "25 kg", "2 pieces": a quantity said with its unit. */
function amountOf(qty: number, unit: string): string {
  const one: Record<string, string> = { pieces: 'piece', grams: 'gram', litres: 'litre', pairs: 'pair' }
  return `${qty.toLocaleString('en-NG', { maximumFractionDigits: 3 })} ${qty === 1 ? (one[unit] ?? unit) : unit}`.trim()
}

/**
 * A new dish on one screen: its name, how much one batch makes, and what goes
 * into it. Ingredients already priced by the owner come first, so the cost
 * can be worked out at once; anything else can be added and priced later.
 * Field names match the recipe form they replace (name, batch_yield_qty,
 * yield_unit_id, portion_qty).
 *
 * Typing a dish's name offers its usual ingredients, by NAME, from the
 * dishes Recipe by LunchLoft's kitchen has checked (lib/dish-library-data.ts).
 * They become rows with the quantity left empty: she types every quantity,
 * and a row without one is refused on save.
 *
 * Beside each ingredient, someone who records purchases may say what she
 * paid for it. An item with no price gets empty boxes; one with a price
 * shows it ("You paid ₦85,000 for 1 bag on 12 Oct"), and "Paid a new price?"
 * opens empty boxes with that purchase as a hint. Never pre-filled: a new
 * amount over last time's quantity would cost every dish wrongly. What she
 * types is recorded as a real purchase when the dish is saved.
 *
 * Every field is held here, so a refused save keeps what she typed (React
 * resets an uncontrolled form after each submission).
 */
export function NewDish({ items, priced, recent, lastBought, yieldUnits, today, action, canAddItems, canBuy, addItem, createItem }: {
  items: Item[]
  /** Which ingredients have a price, and how it came about; null for a role that may not see costs. */
  priced: Record<string, PriceKind> | null
  /** Ingredients priced most recently first: the short list before she types. */
  recent: string[]
  /** What each item came to last time. Amounts only for a role that may see costs. */
  lastBought: Record<string, LastBought>
  yieldUnits: YieldUnit[]
  today: string
  action: (prev: DishResult, formData: FormData) => Promise<DishResult>
  /** Whether she may add an item (owner, manager, kitchen). */
  canAddItems: boolean
  /** Whether she may record what was paid (of the dish roles: owner, manager). */
  canBuy: boolean
  addItem: (name: string) => Promise<AddedItem>
  createItem: (name: string, measuredBy: 'weight' | 'volume' | 'count', purpose: 'buy' | 'dish') => Promise<CreatedItem>
}) {
  const [result, formAction] = useActionState(action, null)
  const portionUnit = yieldUnits.find((u) => u.code === 'portion')
  const [yieldUnitId, setYieldUnitId] = useState(portionUnit?.id ?? yieldUnits[0]?.id ?? '')
  const byPortion = yieldUnits.find((u) => u.id === yieldUnitId)?.code === 'portion'
  const [name, setName] = useState('')
  const [batch, setBatch] = useState('')
  const [portion, setPortion] = useState('')
  const [paidOn, setPaidOn] = useState(today)
  // Typed on a slow phone before the page's script arrived: keep it, or the
  // next render would clear it.
  const nameRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (nameRef.current?.value) setName(nameRef.current.value)
    if (batchRef.current?.value) setBatch(batchRef.current.value)
  }, [])
  const nextKey = useRef(3)
  const blank = (): Row => ({ key: nextKey.current++, ...empty })
  const [rows, setRows] = useState<Row[]>([0, 1, 2].map((key) => ({ key, ...empty })))

  // Items added on this screen; the page's own list catches up on its next render.
  const [extra, setExtra] = useState<Item[]>([])
  const all = useMemo(() => {
    const seen = new Set(items.map((i) => i.id))
    return [...items, ...extra.filter((i) => !seen.has(i.id))]
  }, [items, extra])
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all])
  const isPriced = (id: string) => !!priced?.[id]
  const pricedItems = priced ? recent.filter((id) => byId.has(id) && priced[id]) : []
  const set = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  /** A row for an item: its usual cooking unit, and the unit it is most often bought in. */
  const rowFor = (item: Item, patch: Partial<Row> = {}): Row =>
    ({ ...blank(), ingredientId: item.id, unitId: item.units[0]?.id ?? '', paidUnitId: buyUnitOf(item), ...patch })
  /**
   * The unit she last bought it in, if this screen offers it; else the first
   * it does. A unit from the item's own page (tablespoons) or a measure since
   * removed would be posted while the box showed something else.
   */
  const buyUnitOf = (item: Item | undefined) => {
    const last = item && lastBought[item.id]?.unitId
    return (last && item?.buyUnits?.some((u) => u.id === last) ? last : item?.buyUnits?.[0]?.id) ?? ''
  }
  const unpricedChosen = !!priced && rows.some((r) => r.ingredientId && !priced[r.ingredientId] && !r.paid.trim())
  const anyPaid = rows.some((r) => r.paid.trim())

  // React resets the form after every save attempt. Inputs held here keep
  // their text, but a select drops back to its first option while her choice
  // is still in state, so a second tap of Save would post "Plates" or "kg".
  // Put the choices back in the same commit, before she can tap again.
  const formRef = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    const form = formRef.current
    if (!form || result === null) return
    const counted = form.elements.namedItem('yield_unit_id')
    if (counted instanceof HTMLSelectElement) counted.value = yieldUnitId
    for (const r of rows) {
      const unit = document.getElementById(`unit-${r.key}`)
      if (unit instanceof HTMLSelectElement) unit.value = r.unitId
      const paidUnit = document.getElementById(`paid-unit-${r.key}`)
      if (paidUnit instanceof HTMLSelectElement) paidUnit.value = r.paidUnitId
    }
    // Only after a save attempt: the rest of the time React keeps them in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // Back from adding an item in another tab ("Add it under Ingredients"):
  // fetch her list again. Only the page's data is refreshed; what she has
  // typed here stays.
  const router = useRouter()
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') router.refresh() }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [router])
  const findOwn = useMemo(() => ownItemFinder(all), [all])

  // --- suggestions ------------------------------------------------------------
  const matches = useMemo(() => findDishes(DISHES, name), [name])
  const offered = matches[0]
  const preview = useMemo(() => (offered ? suggestFor(offered, all, NEW_ITEMS, name) : null), [offered, all, name])
  const [applied, setApplied] = useState<string | null>(null)
  const [followup, setFollowup] = useState<Followup | null>(null)
  const [adding, startAdding] = useTransition()
  const [addingName, setAddingName] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // After a suggestion adds rows, the cursor waits in the first quantity;
  // after one item is added, in that item's; when a suggestion added nothing,
  // on the note that says why.
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const [focusItem, setFocusItem] = useState<string | null>(null)
  const [focusNote, setFocusNote] = useState(false)
  useEffect(() => {
    if (focusNote) { document.getElementById('dish-followup')?.focus(); setFocusNote(false); return }
    const key = focusKey ?? rows.find((r) => r.ingredientId === focusItem)?.key
    if (key === undefined || key === null) return
    document.getElementById(`qty-${key}`)?.focus()
    setFocusKey(null)
    setFocusItem(null)
  }, [focusKey, focusItem, focusNote, rows])

  /** Put an item on a row of its own, or go to the row it is already on. Read against the latest rows. */
  function addRow(item: Item) {
    setRows((current) => (current.some((r) => r.ingredientId === item.id)
      ? current
      : [...current.filter((r) => r.ingredientId || r.qty.trim()), rowFor(item)]))
    setFocusItem(item.id)
  }

  /**
   * A dish's usual ingredients as rows: her items only, quantities empty.
   * Another dish chosen instead replaces the rows the last suggestion put
   * there that she has not touched; her own rows, and any with a quantity, stay.
   */
  function apply(dish: LibraryDish) {
    const s = suggestFor(dish, all, NEW_ITEMS, name)
    const kept = rows.filter((r) => (r.ingredientId || r.qty.trim()) && !(r.suggested && !r.qty.trim() && !r.paid.trim()))
    const have = new Set(kept.map((r) => r.ingredientId))
    const added = s.rows.filter((r) => !r.optional && !have.has(r.item.id)).map((r) => rowFor(r.item, { suggested: true }))
    const next = [...kept, ...added]
    setRows(next.length ? next : [blank()])
    setApplied(dish.name)
    setFollowup({ dish: dish.name, partial: !!dish.partial, added: added.length,
      optional: s.rows.filter((r) => r.optional).map((r) => r.item), notInList: s.notInList })
    setAddError(null)
    if (added[0]) setFocusKey(added[0].key)
    else setFocusNote(true)
  }

  /** An ingredient she has no item for yet, added without leaving the dish. One at a time. */
  function addMissing(missingName: string) {
    if (adding) return
    setAddError(null)
    setAddingName(missingName)
    startAdding(async () => {
      let res: AddedItem
      try {
        res = await addItem(missingName)
      } catch {
        // A dropped connection: say so here, and keep everything she typed.
        setAddingName(null)
        setAddError(`We could not add ${missingName}. Check your connection and try again.`)
        return
      }
      setAddingName(null)
      if ('error' in res) { setAddError(res.error); return }
      setExtra((current) => (current.some((i) => i.id === res.item.id) ? current : [...current, res.item]))
      takeFound(missingName, res.item)
    })
  }

  /** An ingredient she now has (added here or in another tab): onto the dish, and off the "not on your list" list. */
  function takeFound(missingName: string, item: Item) {
    addRow(item)
    setFollowup((f) => f && { ...f, notInList: f.notInList.filter((n) => n.name !== missingName) })
  }

  const requiredPreview = preview
    ? [...preview.rows.filter((r) => !r.optional).map((r) => r.item.name), ...preview.notInList.filter((n) => !n.optional).map((n) => n.name)]
    : []

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">New dish</h1>
        <p className="mt-1 text-sm" style={muted}>
          Tell us how much one pot makes and what goes into it. Menu Master works out what one portion costs you.
        </p>
      </div>

      <div className="mm-card space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Dish name</span>
          <input ref={nameRef} name="name" required placeholder="e.g. Egusi soup" className="mm-input mt-1" autoComplete="off"
                 value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {offered && !matches.some((m) => m.name === applied) && (
          <div className="space-y-2 rounded-[11px] border p-3" data-suggest
               style={{ borderColor: 'var(--mm-accent)', background: 'var(--mm-accent-soft)' }}>
            <p className="text-sm font-semibold">
              Usual ingredients for {offered.name}{offered.partial ? ', to start you off' : ''}
            </p>
            <p className="text-sm">{requiredPreview.join(', ')}</p>
            <button type="button" className="mm-btn mm-btn-primary w-full" onClick={() => apply(offered)}>
              Add these to the dish
            </button>
            {matches.length > 1 && (
              <p className="text-xs" style={muted}>
                Not this one?{' '}
                {matches.slice(1).map((d, i) => (
                  <span key={d.name}>
                    {i > 0 && ' · '}
                    <button type="button" className="mm-inline-tap font-semibold underline" style={{ color: 'var(--mm-fg)' }}
                            onClick={() => apply(d)}>{d.name}</button>
                  </span>
                ))}
              </p>
            )}
            <p className="text-xs" style={muted}>
              From Recipe by LunchLoft&apos;s checked recipes. Only the names: you type the quantity of each you use.
            </p>
          </div>
        )}

        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <label className="block">
            <span className="text-sm font-medium">One batch makes</span>
            <input ref={batchRef} name="batch_yield_qty" required inputMode="decimal" placeholder="e.g. 20" className="mm-input mt-1"
                   value={batch} onChange={(e) => setBatch(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Counted in</span>
            <select name="yield_unit_id" value={yieldUnitId} onChange={(e) => setYieldUnitId(e.target.value)} className="mm-input mt-1">
              {yieldUnits.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </label>
        </div>
        {!byPortion && (
          <label className="block">
            <span className="text-sm font-medium">One portion is (optional)</span>
            <input name="portion_qty" inputMode="decimal" placeholder="e.g. 500" className="mm-input mt-1"
                   value={portion} onChange={(e) => setPortion(e.target.value)} />
            <span className="mt-1 block text-xs" style={muted}>
              In the same unit. Leave it empty if you sell this only in your own sizes.
            </span>
          </label>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">What goes into one batch</h2>

        {followup && followup.dish === applied && (
          <div className="mm-card space-y-3" data-followup id="dish-followup" tabIndex={-1}>
            <p className="text-sm" role="status">
              {followup.added === 0
                ? `None of the usual ingredients for ${followup.dish} are on your list yet. Add them below, or choose your own in the rows.`
                : followup.partial
                  ? `Added what we know goes into ${followup.dish}. Add the rest yourself, then type the quantity of each in one batch.`
                  : `Added the usual ingredients for ${followup.dish}. Type the quantity of each in one batch, and remove any you don't use.`}
            </p>
            {matches.some((m) => m.name !== applied) && (
              <p className="text-xs" style={muted}>
                Not this dish?{' '}
                {matches.filter((m) => m.name !== applied).map((d, i) => (
                  <span key={d.name}>
                    {i > 0 && ' · '}
                    <button type="button" className="mm-inline-tap font-semibold underline" style={{ color: 'var(--mm-fg)' }}
                            onClick={() => apply(d)}>{d.name}</button>
                  </span>
                ))}
              </p>
            )}
            {followup.optional.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={muted}>Often added</p>
                <div className="flex flex-wrap gap-2">
                  {followup.optional.map((i) => (
                    <button key={i.id} type="button" className="mm-tap rounded-full border px-3 text-sm font-medium"
                            style={{ borderColor: 'var(--mm-line)' }} onClick={() => addRow(i)}>
                      + {i.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {followup.notInList.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={muted}>Not on your list yet</p>
                <ul className="space-y-1">
                  {followup.notInList.map((n) => {
                    // Added since, in another tab: it is on her list now.
                    const found = findOwn(n.name)
                    return (
                    <li key={n.name} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{n.name}{n.optional ? <span style={muted}> (optional)</span> : null}</span>
                      {found ? (
                        <Button type="button" variant="secondary" onClick={() => takeFound(n.name, found)}>
                          Use it
                        </Button>
                      ) : canAddItems && n.item ? (
                        <Button type="button" variant="secondary" busy={adding && addingName === n.name} busyLabel="Adding…"
                                disabled={adding && addingName !== n.name} onClick={() => addMissing(n.name)}>
                          Add it
                        </Button>
                      ) : canAddItems ? (
                        // A starter item she put away or renamed: add it back where items are kept, in a new tab so this dish stays.
                        <Link href="/ingredients" target="_blank" rel="noopener" className="mm-inline-tap text-sm font-semibold underline">
                          Add it under Ingredients
                        </Link>
                      ) : (
                        <span className="text-xs" style={muted}>Ask the owner or a manager to add it under Ingredients.</span>
                      )}
                    </li>
                    )
                  })}
                </ul>
                <p className="text-xs" style={muted}>Already have it under another name? Choose it in a row instead.</p>
              </div>
            )}
            {addError && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{addError}</p>}
          </div>
        )}

        <ol className="space-y-2">
          {rows.map((r, index) => {
            const item = byId.get(r.ingredientId)
            const last = item ? lastBought[item.id] : undefined
            const hasPrice = !!item && isPriced(item.id)
            const showBoxes = canBuy && !!item && (!hasPrice || r.newPrice)
            return (
              <li key={r.key} className="mm-card space-y-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ItemPicker
                      items={all} name="line_ingredient_id" value={r.ingredientId} label={`Ingredient ${index + 1}`}
                      title="Which ingredient?" placeholder="Choose an ingredient…"
                      top={pricedItems.length > 0 ? { label: 'Priced by you', ids: pricedItems } : undefined}
                      note={(i) => (priced && !priced[i.id] ? 'no price yet' : undefined)}
                      onChange={(id) => set(r.key, { ingredientId: id, unitId: byId.get(id)?.units[0]?.id ?? '', suggested: false,
                        paid: '', paidQty: '', paidUnitId: buyUnitOf(byId.get(id)), newPrice: false })}
                      onCreate={canAddItems ? (n, m) => createItem(n, m, 'dish') : undefined}
                      onCreated={(made) => {
                        setExtra((current) => (current.some((i) => i.id === made.id) ? current : [...current, made]))
                        set(r.key, { ingredientId: made.id, unitId: made.units[0]?.id ?? '', suggested: false,
                          paid: '', paidQty: '', paidUnitId: made.buyUnits?.[0]?.id ?? '', newPrice: false })
                        setFocusKey(r.key)
                      }}
                    />
                  </div>
                  {rows.length > 1 && (
                    <button type="button" className="mm-icon-btn shrink-0" aria-label={`Remove ingredient ${index + 1}`}
                            onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}>×</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-medium" style={muted}>Quantity in one batch</span>
                    <input id={`qty-${r.key}`} name="line_qty" inputMode="decimal" aria-label={`Quantity, ingredient ${index + 1}`}
                           placeholder="e.g. 2" className="mm-input mt-1" value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium" style={muted}>Unit</span>
                    <select id={`unit-${r.key}`} name="line_unit_id" value={r.unitId} aria-label={`Unit, ingredient ${index + 1}`}
                            onChange={(e) => set(r.key, { unitId: e.target.value })} className="mm-input mt-1">
                      {!item && <option value="">Unit</option>}
                      {item?.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </label>
                </div>

                {/* What she paid, sent for every row so the lists stay aligned. */}
                <input type="hidden" name="line_paid" value={showBoxes ? r.paid : ''} />
                <input type="hidden" name="line_paid_qty" value={showBoxes ? r.paidQty : ''} />
                <input type="hidden" name="line_paid_unit_id" value={showBoxes ? r.paidUnitId : ''} />
                {canBuy && item && hasPrice && !r.newPrice && (
                  <p className="text-xs" style={muted} data-price-known>
                    {last && last.amount !== undefined
                      ? <>You paid <span className="mm-num font-semibold" style={{ color: 'var(--mm-fg)' }}>{money(last.amount)}</span> for {amountOf(last.qty, last.unit)} {onDay(formatDay(last.day))}.{' '}</>
                      : priced?.[item.id] === 'estimate'
                        ? <>Costed from an estimate you typed, not a purchase.{' '}</>
                        : <>Priced from what you paid.{' '}</>}
                    <button type="button" className="mm-inline-tap font-semibold underline" style={{ color: 'var(--mm-fg)' }}
                            onClick={() => set(r.key, { newPrice: true, paidUnitId: r.paidUnitId || buyUnitOf(item) })}>
                      Paid a new price?
                    </button>
                  </p>
                )}
                {showBoxes && (
                  <div className="space-y-1 rounded-[11px] border p-2" style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-surface-2)' }} data-price-boxes>
                    <p className="text-xs font-medium" style={muted}>
                      {hasPrice ? 'What you paid this time' : 'What you paid for it (optional)'}
                    </p>
                    <div className="grid grid-cols-[1.1fr_0.8fr_1fr] gap-2">
                      {/* After "Paid a new price?" (gone with its own tap), the cursor waits here. */}
                      <input inputMode="decimal" aria-label={`You paid in naira, ingredient ${index + 1}`} className="mm-input"
                             autoFocus={!!r.newPrice}
                             placeholder={last?.amount !== undefined ? `₦ e.g. ${last.amount.toLocaleString('en-NG')}` : '₦ e.g. 3000'}
                             value={r.paid} onChange={(e) => set(r.key, { paid: e.target.value })} />
                      <input inputMode="decimal" aria-label={`Quantity bought for that price, ingredient ${index + 1}`} className="mm-input"
                             placeholder={last ? `for ${last.qty}` : 'for 1'}
                             value={r.paidQty} onChange={(e) => set(r.key, { paidQty: e.target.value })} />
                      <select id={`paid-unit-${r.key}`} aria-label={`Bought in, ingredient ${index + 1}`} className="mm-input"
                              value={r.paidUnitId} onChange={(e) => set(r.key, { paidUnitId: e.target.value })}>
                        {(item.buyUnits ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <button type="button" className="mm-btn mm-btn-secondary w-full"
                onClick={() => setRows((current) => [...current, blank()])}>
          + Add another ingredient
        </button>
        {anyPaid && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span>The prices you typed were paid on</span>
            <input type="date" name="paid_on" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)}
                   className="mm-input" style={{ width: 'auto' }} />
          </label>
        )}
        {unpricedChosen && (
          <p className="text-xs" style={muted}>
            Some of these have no price yet. The dish is saved, and its page tells you exactly what to price.
          </p>
        )}
      </section>

      {result?.error && (
        <div role="alert" className="mm-notice" data-tone="warn">
          <span className="mt-0.5 shrink-0" aria-hidden><AppIcon name="alert" size={19} /></span>
          <div className="min-w-0">{result.error}</div>
        </div>
      )}

      <Button className="w-full" busyLabel="Saving the dish…">Save dish and see its cost</Button>
    </form>
  )
}
