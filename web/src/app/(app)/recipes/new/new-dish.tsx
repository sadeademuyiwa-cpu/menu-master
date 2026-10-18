'use client'

import { useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import { ItemPicker } from '@/components/item-picker'
import type { CatalogItem } from '@/lib/data/purchase-catalog'
import { DISHES, NEW_ITEMS, type LibraryDish } from '@/lib/dish-library-data'
import { findDishes, ownItemFinder, suggestFor, type Suggestion } from '@/lib/item-search'
import type { AddedItem, DishResult } from './actions'

type YieldUnit = { id: string; code: string; label: string }
/** `suggested`: put there by a dish suggestion and not chosen by her since. */
type Row = { key: number; ingredientId: string; unitId: string; qty: string; suggested?: boolean }
type Followup = {
  dish: string; partial: boolean; added: number
  optional: CatalogItem[]; notInList: Suggestion<CatalogItem>['notInList']
}

const muted = { color: 'var(--mm-muted)' }

/**
 * A new dish on one screen: its name, how much one batch makes, and what goes
 * into it. Ingredients already priced by the owner come first, so the cost
 * can be worked out at once; anything else can be added and priced later.
 * Field names match the recipe form they replace (name, batch_yield_qty,
 * yield_unit_id, portion_qty).
 *
 * Typing a dish's name offers its usual ingredients, by NAME, from the
 * dishes Recipe by LunchLoft's kitchen has checked (lib/dish-library-data.ts).
 * They become rows with the amount left empty: she types every amount, and
 * a row without one is refused on save. Every field is held here, so a
 * refused save keeps what she typed (React resets an uncontrolled form after
 * each submission).
 */
export function NewDish({ items, priced, yieldUnits, action, canAddItems, addItem }: {
  items: CatalogItem[]
  /** Ingredients with a price from the owner's own purchases. */
  priced: string[]
  yieldUnits: YieldUnit[]
  action: (prev: DishResult, formData: FormData) => Promise<DishResult>
  /** Whether she may add an item (owner, manager, kitchen). */
  canAddItems: boolean
  addItem: (name: string) => Promise<AddedItem>
}) {
  const [result, formAction] = useActionState(action, null)
  const portionUnit = yieldUnits.find((u) => u.code === 'portion')
  const [yieldUnitId, setYieldUnitId] = useState(portionUnit?.id ?? yieldUnits[0]?.id ?? '')
  const byPortion = yieldUnits.find((u) => u.id === yieldUnitId)?.code === 'portion'
  const [name, setName] = useState('')
  const [batch, setBatch] = useState('')
  const [portion, setPortion] = useState('')
  // Typed on a slow phone before the page's script arrived: keep it, or the
  // next render would clear it.
  const nameRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (nameRef.current?.value) setName(nameRef.current.value)
    if (batchRef.current?.value) setBatch(batchRef.current.value)
  }, [])
  const nextKey = useRef(3)
  const blank = (): Row => ({ key: nextKey.current++, ingredientId: '', unitId: '', qty: '' })
  const [rows, setRows] = useState<Row[]>([0, 1, 2].map((key) => ({ key, ingredientId: '', unitId: '', qty: '' })))

  // Items added from a suggestion on this screen; the page's own list catches up on its next render.
  const [extra, setExtra] = useState<CatalogItem[]>([])
  const all = useMemo(() => {
    const seen = new Set(items.map((i) => i.id))
    return [...items, ...extra.filter((i) => !seen.has(i.id))]
  }, [items, extra])
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all])
  const pricedSet = useMemo(() => new Set(priced), [priced])
  const pricedItems = all.filter((i) => pricedSet.has(i.id))
  const set = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const unpricedChosen = rows.some((r) => r.ingredientId && !pricedSet.has(r.ingredientId))

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

  // After a suggestion adds rows, the cursor waits in the first "How much";
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
  function addRow(item: CatalogItem) {
    setRows((current) => (current.some((r) => r.ingredientId === item.id)
      ? current
      : [...current.filter((r) => r.ingredientId || r.qty.trim()), { ...blank(), ingredientId: item.id, unitId: item.units[0]?.id ?? '' }]))
    setFocusItem(item.id)
  }

  /**
   * A dish's usual ingredients as rows: her items only, amounts empty. Another
   * dish chosen instead replaces the rows the last suggestion put there that
   * she has not touched; her own rows, and any with an amount, stay.
   */
  function apply(dish: LibraryDish) {
    const s = suggestFor(dish, all, NEW_ITEMS, name)
    const kept = rows.filter((r) => (r.ingredientId || r.qty.trim()) && !(r.suggested && !r.qty.trim()))
    const have = new Set(kept.map((r) => r.ingredientId))
    const added = s.rows.filter((r) => !r.optional && !have.has(r.item.id))
      .map((r) => ({ ...blank(), ingredientId: r.item.id, unitId: r.item.units[0]?.id ?? '', suggested: true }))
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
  function takeFound(missingName: string, item: CatalogItem) {
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
              From Recipe by LunchLoft&apos;s checked recipes. Only the names: you type how much of each you use.
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
                  ? `Added what we know goes into ${followup.dish}. Add the rest yourself, then type how much of each goes into one batch.`
                  : `Added the usual ingredients for ${followup.dish}. Type how much of each goes into one batch, and remove any you don't use.`}
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
            return (
              <li key={r.key} className="mm-card space-y-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ItemPicker
                      items={all} name="line_ingredient_id" value={r.ingredientId} label={`Ingredient ${index + 1}`}
                      title="Which ingredient?" placeholder="Choose an ingredient…"
                      top={pricedItems.length > 0 ? { label: 'Priced by you', ids: pricedItems.map((i) => i.id) } : undefined}
                      note={(i) => (pricedSet.has(i.id) ? undefined : 'no price yet')}
                      onChange={(id) => set(r.key, { ingredientId: id, unitId: byId.get(id)?.units[0]?.id ?? '', suggested: false })}
                    />
                  </div>
                  {rows.length > 1 && (
                    <button type="button" className="mm-icon-btn shrink-0" aria-label={`Remove ingredient ${index + 1}`}
                            onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}>×</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input id={`qty-${r.key}`} name="line_qty" inputMode="decimal" aria-label={`How much, ingredient ${index + 1}`}
                         placeholder="How much" className="mm-input" value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} />
                  <select id={`unit-${r.key}`} name="line_unit_id" value={r.unitId} aria-label={`Unit, ingredient ${index + 1}`}
                          onChange={(e) => set(r.key, { unitId: e.target.value })} className="mm-input">
                    {!item && <option value="">Unit</option>}
                    {item?.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </div>
              </li>
            )
          })}
        </ol>
        <button type="button" className="mm-btn mm-btn-secondary w-full"
                onClick={() => setRows((current) => [...current, blank()])}>
          + Add another ingredient
        </button>
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
