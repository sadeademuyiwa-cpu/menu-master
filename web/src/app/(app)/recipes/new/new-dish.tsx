'use client'

import { useActionState, useMemo, useState } from 'react'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import type { CatalogItem } from '@/lib/data/purchase-catalog'
import type { DishResult } from './actions'

type YieldUnit = { id: string; code: string; label: string }
type Row = { key: number; ingredientId: string; unitId: string }

/**
 * A new dish on one screen: its name, how much one batch makes, and what goes
 * into it. Ingredients already priced by the owner come first, so the cost
 * can be worked out at once; anything else can be added and priced later.
 * Field names match the recipe form they replace (name, batch_yield_qty,
 * yield_unit_id, portion_qty).
 */
export function NewDish({ items, priced, yieldUnits, action }: {
  items: CatalogItem[]
  /** Ingredients with a price from the owner's own purchases. */
  priced: string[]
  yieldUnits: YieldUnit[]
  action: (prev: DishResult, formData: FormData) => Promise<DishResult>
}) {
  const [result, formAction] = useActionState(action, null)
  const portionUnit = yieldUnits.find((u) => u.code === 'portion')
  const [yieldUnitId, setYieldUnitId] = useState(portionUnit?.id ?? yieldUnits[0]?.id ?? '')
  const byPortion = yieldUnits.find((u) => u.id === yieldUnitId)?.code === 'portion'
  const [rows, setRows] = useState<Row[]>([0, 1, 2].map((key) => ({ key, ingredientId: '', unitId: '' })))
  const [nextKey, setNextKey] = useState(3)

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const pricedSet = useMemo(() => new Set(priced), [priced])
  const pricedItems = items.filter((i) => pricedSet.has(i.id))
  const groups = useMemo(() => {
    const g = new Map<string, CatalogItem[]>()
    for (const i of items) if (!pricedSet.has(i.id)) g.set(i.group, [...(g.get(i.group) ?? []), i])
    return [...g.entries()]
  }, [items, pricedSet])
  const set = (key: number, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const unpricedChosen = rows.some((r) => r.ingredientId && !pricedSet.has(r.ingredientId))

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">New dish</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          Tell us how much one pot makes and what goes into it. Menu Master works out what one portion costs you.
        </p>
      </div>

      <div className="mm-card space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Dish name</span>
          <input name="name" required placeholder="e.g. Egusi soup" className="mm-input mt-1" />
        </label>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <label className="block">
            <span className="text-sm font-medium">One batch makes</span>
            <input name="batch_yield_qty" required inputMode="decimal" placeholder="e.g. 20" className="mm-input mt-1" />
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
            <input name="portion_qty" inputMode="decimal" placeholder="e.g. 500" className="mm-input mt-1" />
            <span className="mt-1 block text-xs" style={{ color: 'var(--mm-muted)' }}>
              In the same unit. Leave it empty if you sell this only in your own sizes.
            </span>
          </label>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">What goes into one batch</h2>
        <ol className="space-y-2">
          {rows.map((r, index) => {
            const item = byId.get(r.ingredientId)
            return (
              <li key={r.key} className="mm-card space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    name="line_ingredient_id" value={r.ingredientId} aria-label={`Ingredient ${index + 1}`}
                    onChange={(e) => set(r.key, { ingredientId: e.target.value, unitId: byId.get(e.target.value)?.units[0]?.id ?? '' })}
                    className="mm-input min-w-0 flex-1"
                  >
                    <option value="">Choose an ingredient…</option>
                    {pricedItems.length > 0 && (
                      <optgroup label="Priced by you">
                        {pricedItems.map((i) => <option key={`p-${i.id}`} value={i.id}>{i.name}</option>)}
                      </optgroup>
                    )}
                    {groups.map(([group, list]) => (
                      <optgroup key={group} label={`${group} (no price yet)`}>
                        {list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {rows.length > 1 && (
                    <button type="button" className="mm-icon-btn shrink-0" aria-label={`Remove ingredient ${index + 1}`}
                            onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}>×</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input name="line_qty" inputMode="decimal" aria-label={`How much, ingredient ${index + 1}`}
                         placeholder="How much" className="mm-input" />
                  <select name="line_unit_id" value={r.unitId} aria-label={`Unit, ingredient ${index + 1}`}
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
                onClick={() => { setRows((all) => [...all, { key: nextKey, ingredientId: '', unitId: '' }]); setNextKey((k) => k + 1) }}>
          + Add another ingredient
        </button>
        {unpricedChosen && (
          <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
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
