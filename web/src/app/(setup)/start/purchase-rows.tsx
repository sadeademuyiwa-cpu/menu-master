'use client'

import { useState } from 'react'
import { Button } from '@/components/button'

export type MeasureKind = 'mass' | 'volume' | 'count'
export type StarterIngredient = { id: string; name: string; group: string; kind: MeasureKind }
export type StarterUnit = { id: string; label: string; kind: MeasureKind; isDefault: boolean }

type Row = { key: number; ingredientId: string; unitId: string; qty?: string; amount?: string }

/** A row as the owner entered it before, to correct. */
export type InitialRow = { ingredientId: string; unitId: string; qty: string; amount: string }

const FIRST_ROWS = 3
const MAX_ROWS = 8

/**
 * "What did you pay?" rows for setup. Only the units that need no conversion
 * are offered (kg/g, litres/ml, pieces/dozen) and only those that match the
 * chosen ingredient, so every row can be costed the moment it is saved.
 * Nothing is computed here; the server action records a real purchase.
 */
export function PurchaseRows({
  ingredients, units, common, action, initial, hidden, submitLabel = 'Save and continue', busyLabel = 'Saving what you paid…',
}: {
  ingredients: StarterIngredient[]
  units: StarterUnit[]
  /** Ids of the staples most owners buy, offered first. */
  common: string[]
  action: (formData: FormData) => void | Promise<void>
  /** What the owner entered before, when correcting it. */
  initial?: InitialRow[]
  /** Extra fields the action needs (e.g. which purchase is being corrected). */
  hidden?: Record<string, string>
  submitLabel?: string
  busyLabel?: string
}) {
  const [rows, setRows] = useState<Row[]>(
    initial && initial.length
      ? initial.map((r, i) => ({ key: i, ...r }))
      : Array.from({ length: FIRST_ROWS }, (_, i) => ({ key: i, ingredientId: '', unitId: '' })),
  )
  const [nextKey, setNextKey] = useState(Math.max(FIRST_ROWS, initial?.length ?? 0))

  const byId = new Map(ingredients.map((i) => [i.id, i]))
  const groups = new Map<string, StarterIngredient[]>()
  for (const i of ingredients) groups.set(i.group, [...(groups.get(i.group) ?? []), i])
  const commonItems = common.map((id) => byId.get(id)).filter((i): i is StarterIngredient => !!i)

  const unitsFor = (ingredientId: string) => {
    const kind = byId.get(ingredientId)?.kind
    return kind ? units.filter((u) => u.kind === kind) : []
  }

  function choose(key: number, ingredientId: string) {
    const kind = byId.get(ingredientId)?.kind
    const unit = units.find((u) => u.kind === kind && u.isDefault) ?? units.find((u) => u.kind === kind)
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ingredientId, unitId: unit?.id ?? '' } : r)))
  }

  return (
    <form action={action} className="space-y-4">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <ol className="space-y-3">
        {rows.map((r, index) => (
          <li key={r.key} className="mm-card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
                Item {index + 1}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="mm-tap text-sm underline"
                  style={{ color: 'var(--mm-muted)' }}
                  onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                >
                  Remove
                </button>
              )}
            </div>

            <label className="block">
              <span className="text-sm font-medium">Ingredient</span>
              <select
                name="ingredient_id" value={r.ingredientId}
                onChange={(e) => choose(r.key, e.target.value)}
                className="mm-input mt-1"
              >
                <option value="">Choose an ingredient…</option>
                {commonItems.length > 0 && (
                  <optgroup label="Most bought">
                    {commonItems.map((i) => <option key={`c-${i.id}`} value={i.id}>{i.name}</option>)}
                  </optgroup>
                )}
                {[...groups.entries()].map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-sm font-medium">You bought</span>
                <input name="qty" type="number" step="any" min="0" inputMode="decimal"
                       defaultValue={r.qty} placeholder="e.g. 5" className="mm-input mt-1" />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Unit</span>
                <select
                  name="unit_id" value={r.unitId} disabled={!r.ingredientId}
                  onChange={(e) => setRows((all) => all.map((x) => (x.key === r.key ? { ...x, unitId: e.target.value } : x)))}
                  className="mm-input mt-1"
                >
                  {!r.ingredientId && <option value="">—</option>}
                  {unitsFor(r.ingredientId).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
                {/* A disabled select submits nothing; keep the rows aligned. */}
                {!r.ingredientId && <input type="hidden" name="unit_id" value="" />}
              </label>
              <label className="block">
                <span className="text-sm font-medium">You paid (₦)</span>
                <input name="amount" type="number" step="0.01" min="0" inputMode="decimal"
                       defaultValue={r.amount} placeholder="e.g. 8000" className="mm-input mt-1" />
              </label>
            </div>
          </li>
        ))}
      </ol>

      {rows.length < MAX_ROWS && (
        <button
          type="button"
          className="mm-btn mm-btn-secondary w-full"
          onClick={() => {
            setRows((all) => [...all, { key: nextKey, ingredientId: '', unitId: '' }])
            setNextKey((k) => k + 1)
          }}
        >
          + Add another item
        </button>
      )}

      <Button className="w-full" busyLabel={busyLabel}>{submitLabel}</Button>
    </form>
  )
}
