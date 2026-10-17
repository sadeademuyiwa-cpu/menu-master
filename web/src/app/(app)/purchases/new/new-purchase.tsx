'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import type { CatalogItem, CatalogUnit, LastBought } from '@/lib/data/purchase-catalog'
import { formatDay } from '@/lib/dates'
import { money } from '@/lib/format'
import { inSentence, sumMoney } from '../buy-figures'
import type { MeasureResult, PurchaseResult } from './actions'

type Row = { key: number; ingredientId: string; qty: string; unitId: string; amount: string }
type Supplier = { id: string; name: string }
type SizeDraft = { size: string; sizeUnitId: string; error?: string }
type MeasureInput = { ingredientId: string; unitId: string; size: number | null; sizeUnitId: string }

const num = (raw: string): number | null => {
  const t = raw.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const blank = (key: number, ingredientId = '', unitId = ''): Row => ({ key, ingredientId, qty: '', unitId, amount: '' })
const touched = (r: Row) => !!(r.ingredientId || r.qty.trim() || r.amount.trim())

/** "1 bag", "25 kg", "2 pieces": a quantity said with its unit. */
function amountOf(qty: number, unit: string): string {
  const one: Record<string, string> = { pieces: 'piece', grams: 'gram', litres: 'litre', pairs: 'pair' }
  return `${qty.toLocaleString('en-NG', { maximumFractionDigits: 3 })} ${qty === 1 ? (one[unit] ?? unit) : unit}`.trim()
}


/**
 * Recording a purchase: everything bought on one trip, on one screen.
 *
 * Two shortcuts for a market run she makes every week, and neither copies a
 * number. "Same as last market run" brings back the items and the units
 * only; "Bought before" adds one item in a tap. Quantities and amounts are
 * typed fresh, with "Last time: 1 bag for ₦85,000" beside them as a hint,
 * because unit cost is what she paid divided by how much she bought, and a
 * stale figure would silently give every dish a wrong cost.
 *
 * A local measure with no size yet (a paint of rice) can be chosen; the line
 * then asks "How much is one paint of rice?" in place and saves the answer
 * through the ingredient's own measure path, keeping every typed row.
 *
 * Nothing is saved until Record (or Save for later); then the whole purchase
 * is written in one step (actions.ts) and every dish using these items is
 * re-costed by the database.
 */
export function NewPurchase({
  items, often, lastRun, lastRunDay, lastBought, suppliers, today, first, action, canMeasure, saveMeasure,
}: {
  items: CatalogItem[]
  /** Item ids, most often bought first. */
  often: string[]
  /** The items and units of the last recorded purchase. */
  lastRun: { ingredientId: string; unitId: string }[]
  lastRunDay: string | null
  /** What each item came to last time. Amounts only for a role that may see costs. */
  lastBought: Record<string, LastBought>
  suppliers: Supplier[]
  today: string
  /** An item to start with, e.g. when arriving from its own page. */
  first: string | null
  action: (prev: PurchaseResult, formData: FormData) => Promise<PurchaseResult>
  /** Whether this person may say how much a local measure holds (owner, manager, kitchen). */
  canMeasure: boolean
  saveMeasure: (input: MeasureInput) => Promise<MeasureResult>
}) {
  const [result, formAction] = useActionState(action, null)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  // Sizes saved on this screen. The page's own list catches up when it next
  // renders; until then these make the unit usable straight away.
  const [sized, setSized] = useState<Record<string, CatalogUnit[]>>({})

  /** The units an item can be bought in now, and its local measures still without a size. */
  const unitsFor = (id: string): { ready: CatalogUnit[]; unsized: CatalogUnit[] } => {
    const item = byId.get(id)
    if (!item) return { ready: [], unsized: [] }
    const extra = (sized[id] ?? []).filter((u) => !item.units.some((x) => x.id === u.id))
    const ready = [...item.units, ...extra]
    const unsized = (item.unsized ?? []).filter((u) => !ready.some((x) => x.id === u.id))
    return { ready, unsized }
  }
  /** The unit to start an item in: the one she bought it in last time, when it is still offered. */
  const startUnit = (id: string): string => {
    const { ready, unsized } = unitsFor(id)
    const last = lastBought[id]?.unitId
    if (last && [...ready, ...unsized].some((u) => u.id === last)) return last
    return ready[0]?.id ?? ''
  }

  const nextKey = useRef(1)
  const [rows, setRows] = useState<Row[]>(() => {
    const start = first && byId.has(first) ? first : ''
    return [blank(0, start, start ? startUnit(start) : '')]
  })
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [drafts, setDrafts] = useState<Record<string, SizeDraft>>({})
  const [savedSizes, setSavedSizes] = useState<Record<string, string>>({})
  const [measuring, startMeasuring] = useTransition()
  const [measuringKey, setMeasuringKey] = useState<string | null>(null)

  // After a shortcut adds a line, the cursor waits in its "How much" box.
  const [focusKey, setFocusKey] = useState<number | null>(null)
  useEffect(() => {
    if (focusKey === null) return
    document.getElementById(`qty-${focusKey}`)?.focus()
    setFocusKey(null)
  }, [focusKey])

  const groups = useMemo(() => {
    const g = new Map<string, CatalogItem[]>()
    for (const i of items) g.set(i.group, [...(g.get(i.group) ?? []), i])
    return [...g.entries()]
  }, [items])
  const boughtBefore = often.map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i)
  const chips = boughtBefore.slice(0, 8)
  const repeat = lastRun.filter((l) => byId.has(l.ingredientId))

  const filled = rows.filter(touched)
  const total = sumMoney(filled.map((r) => num(r.amount)))
  const missingAmounts = filled.some((r) => num(r.amount) === null)
  const set = (key: number, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  /** "Bought before": one tap puts the item on a line, in the unit she used last time. */
  const addItem = (id: string) => {
    const existing = rows.find((r) => r.ingredientId === id)
    if (existing) { setFocusKey(existing.key); return }
    const empty = rows.find((r) => !touched(r))
    if (empty) {
      set(empty.key, { ingredientId: id, unitId: startUnit(id) })
      setFocusKey(empty.key)
      return
    }
    const key = nextKey.current++
    setRows((all) => [...all, blank(key, id, startUnit(id))])
    setFocusKey(key)
  }

  /** The last market run's items and units. Never its quantities or amounts. */
  const sameAsLast = () => {
    const kept = rows.filter(touched)
    const have = new Set(kept.map((r) => r.ingredientId))
    const added = repeat.filter((l) => !have.has(l.ingredientId)).map((l) => {
      const { ready, unsized } = unitsFor(l.ingredientId)
      const unit = [...ready, ...unsized].some((u) => u.id === l.unitId) ? l.unitId : startUnit(l.ingredientId)
      return blank(nextKey.current++, l.ingredientId, unit)
    })
    const next = [...kept, ...added]
    setRows(next.length ? next : [blank(nextKey.current++)])
    const firstNew = added[0] ?? next[0]
    if (firstNew) setFocusKey(firstNew.key)
  }

  const setDraft = (k: string, patch: Partial<SizeDraft>, fallbackUnit: string) =>
    setDrafts((all) => ({ ...all, [k]: { ...(all[k] ?? { size: '', sizeUnitId: fallbackUnit }), ...patch } }))

  /** "How much is one paint of rice?", saved without leaving the purchase. */
  const saveSize = (row: Row, unit: CatalogUnit, sizeUnits: CatalogUnit[]) => {
    const k = `${row.ingredientId}:${row.unitId}`
    const d = drafts[k] ?? { size: '', sizeUnitId: sizeUnits[0]?.id ?? '' }
    const size = num(d.size)
    if (size === null || size <= 0) {
      setDraft(k, { error: 'Say how much one holds. It must be more than zero.' }, sizeUnits[0]?.id ?? '')
      return
    }
    setMeasuringKey(k)
    startMeasuring(async () => {
      const res = await saveMeasure({ ingredientId: row.ingredientId, unitId: row.unitId, size, sizeUnitId: d.sizeUnitId })
      setMeasuringKey(null)
      if (!res || 'error' in res) {
        setDraft(k, { error: res?.error ?? 'We could not save that size. Try again.' }, d.sizeUnitId)
        return
      }
      const said = `${d.size.trim()} ${sizeUnits.find((u) => u.id === d.sizeUnitId)?.label ?? ''}`.trim()
      setSized((all) => ({
        ...all,
        [row.ingredientId]: [...(all[row.ingredientId] ?? []), { id: row.unitId, label: `${unit.label} (yours: ${said})` }],
      }))
      setSavedSizes((all) => ({ ...all, [k]: `Saved. One ${unit.label} is ${said}.` }))
      setDraft(k, { error: undefined }, d.sizeUnitId)
    })
  }

  const payload = JSON.stringify({
    lines: filled.map((r) => ({
      ingredientId: r.ingredientId, qty: num(r.qty) ?? 0, unitId: r.unitId, amount: num(r.amount),
    })),
    supplierId: supplierId || null, date, reference,
  })
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Record a purchase</h1>

      {(repeat.length > 0 || chips.length > 0) && (
        <section className="space-y-3" aria-label="Quick start">
          {repeat.length > 0 && (
            <button type="button" onClick={sameAsLast} className="mm-btn mm-btn-secondary w-full">
              <AppIcon name="purchases" size={18} />
              <span className="flex min-w-0 flex-col items-start text-left">
                <span>Same as last market run</span>
                <span className="text-xs font-medium" style={{ color: 'var(--mm-muted)' }}>
                  {repeat.length} item{repeat.length === 1 ? '' : 's'} from {inSentence(formatDay(lastRunDay))}. You type today’s amounts.
                </span>
              </span>
            </button>
          )}
          {chips.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold">Bought before</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {chips.map((i) => {
                  const added = rows.some((r) => r.ingredientId === i.id)
                  return (
                    <li key={i.id}>
                      <button type="button" className="mm-buy-chip" data-added={added || undefined}
                              aria-label={added ? `${i.name}, on the list` : `Add ${i.name}`}
                              onClick={() => addItem(i.id)}>
                        <AppIcon name={added ? 'check' : 'plus'} size={15} className="shrink-0" />
                        <span className="truncate">{i.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      <ol className="space-y-3">
        {rows.map((r, index) => {
          const item = byId.get(r.ingredientId)
          const { ready, unsized } = unitsFor(r.ingredientId)
          const unsizedUnit = unsized.find((u) => u.id === r.unitId)
          const sizeUnits = item?.sizeUnits ?? []
          const k = `${r.ingredientId}:${r.unitId}`
          const draft = drafts[k] ?? { size: '', sizeUnitId: sizeUnits[0]?.id ?? '' }
          const last = item ? lastBought[item.id] : undefined
          return (
            <li key={r.key} className="mm-card space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
                  Item {index + 1}
                </span>
                {rows.length > 1 && (
                  <button type="button" className="mm-tap text-sm underline" style={{ color: 'var(--mm-muted)' }}
                          onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}>
                    Remove
                  </button>
                )}
              </div>
              <label className="block">
                <span className="text-sm font-medium">What did you buy?</span>
                <select
                  value={r.ingredientId} aria-label={`Item ${index + 1}`}
                  onChange={(e) => set(r.key, { ingredientId: e.target.value, unitId: startUnit(e.target.value) })}
                  className="mm-input mt-1"
                >
                  <option value="">Choose…</option>
                  {boughtBefore.length > 0 && (
                    <optgroup label="Bought before">
                      {boughtBefore.slice(0, 12).map((i) => <option key={`r-${i.id}`} value={i.id}>{i.name}</option>)}
                    </optgroup>
                  )}
                  {groups.map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-sm font-medium">How much</span>
                  <input id={`qty-${r.key}`} inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })}
                         aria-label={`How much, item ${index + 1}`} placeholder="e.g. 5" className="mm-input mt-1" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Unit</span>
                  <select value={r.unitId} disabled={!item} onChange={(e) => set(r.key, { unitId: e.target.value })}
                          aria-label={`Unit, item ${index + 1}`} className="mm-input mt-1">
                    {!item && <option value="">—</option>}
                    {ready.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                    {unsized.length > 0 && (
                      <optgroup label="Local measures">
                        {unsized.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                      </optgroup>
                    )}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">You paid (₦)</span>
                  <input inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })}
                         aria-label={`Paid, item ${index + 1}`} placeholder="e.g. 8000" className="mm-input mt-1" />
                </label>
              </div>

              {last && (
                <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                  Last time: {amountOf(last.qty, last.unit)}
                  {last.amount !== undefined ? <> for <span className="mm-num">{money(last.amount)}</span></> : null}
                </p>
              )}
              {savedSizes[k] && !unsizedUnit && (
                <p className="text-xs" style={{ color: 'var(--mm-accent)' }}>{savedSizes[k]}</p>
              )}

              {item && unsizedUnit && (
                <div className="space-y-2 rounded-[11px] border p-3"
                     style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-surface-2)' }}>
                  {canMeasure && sizeUnits.length > 0 ? (
                    <>
                      <p className="text-sm font-medium" id={`size-q-${r.key}`}>
                        How much is one {unsizedUnit.label} of {item.name}?
                      </p>
                      <div className="flex gap-2">
                        <input
                          inputMode="decimal" value={draft.size} placeholder="e.g. 3"
                          aria-labelledby={`size-q-${r.key}`} className="mm-input min-w-0 flex-1"
                          onChange={(e) => setDraft(k, { size: e.target.value, error: undefined }, sizeUnits[0]?.id ?? '')}
                          // Enter here saves the size; it must not record the whole purchase.
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveSize(r, unsizedUnit, sizeUnits) } }}
                        />
                        <select
                          value={draft.sizeUnitId} aria-label={`Size of one ${unsizedUnit.label}, in`}
                          className="mm-input shrink-0" style={{ width: 'auto' }}
                          onChange={(e) => setDraft(k, { sizeUnitId: e.target.value }, sizeUnits[0]?.id ?? '')}
                        >
                          {sizeUnits.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                        <Button type="button" variant="secondary" className="shrink-0"
                                busy={measuring && measuringKey === k} busyLabel="Saving…"
                                onClick={() => saveSize(r, unsizedUnit, sizeUnits)}>
                          Save
                        </Button>
                      </div>
                      {draft.error && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{draft.error}</p>}
                    </>
                  ) : (
                    <p className="text-sm">
                      We need to know how much one {unsizedUnit.label} of {item.name} holds. Ask the owner or a
                      manager to add it, or choose another unit. Until then, save this purchase for later.
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <button type="button" className="mm-btn mm-btn-secondary w-full"
              onClick={() => { const key = nextKey.current++; setRows((all) => [...all, blank(key)]) }}>
        + Add another item
      </button>

      <details className="mm-card">
        <summary className="mm-tap cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">
          <span style={{ color: 'var(--mm-muted)' }}>Date, supplier and reference</span>
          <span className="ml-auto truncate pl-3 font-medium">{formatDay(date)}{supplierName ? ` · ${supplierName}` : ''}{reference ? ` · ${reference}` : ''}</span>
        </summary>
        <div className="grid gap-3 pt-2 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mm-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Supplier or market (optional)</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mm-input mt-1">
              <option value="">Not recorded</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Receipt number (optional)</span>
            <input name="reference_input" value={reference} onChange={(e) => setReference(e.target.value)} className="mm-input mt-1" />
          </label>
        </div>
        <p className="mt-2 text-xs">
          <Link href="/suppliers" className="mm-inline-tap" style={{ color: 'var(--mm-muted)' }}>Add a supplier or market</Link>
        </p>
      </details>

      {result?.error && (
        <div role="alert" className="mm-notice" data-tone="warn">
          <span className="mt-0.5 shrink-0" aria-hidden><AppIcon name="alert" size={19} /></span>
          <div className="min-w-0">{result.error}</div>
        </div>
      )}

      <div className="mm-cart-bar">
        <div className="min-w-0">
          {/* Empty: one line, the same words as New sale's empty basket. */}
          {filled.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--mm-muted)' }}>Nothing added yet</div>
          ) : (
            <>
              <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                {filled.length} item{filled.length === 1 ? '' : 's'}
              </div>
              {total !== null ? (
                <div className="mm-num text-lg font-semibold">
                  {money(total)}{missingAmounts && <span className="text-xs font-normal" style={{ color: 'var(--mm-muted)' }}> so far</span>}
                </div>
              ) : (
                <div className="text-sm" style={{ color: 'var(--mm-muted)' }}>No amounts yet</div>
              )}
            </>
          )}
        </div>
        <Button name="mode" value="post" disabled={filled.length === 0} busyLabel="Recording…">
          Record purchase
        </Button>
      </div>
      {/* The label says what it does; a sentence beside it squeezed it onto two lines. */}
      <div className="flex justify-end">
        <Button name="mode" value="draft" variant="secondary" disabled={filled.length === 0} busyLabel="Saving…">
          Save for later
        </Button>
      </div>
    </form>
  )
}
