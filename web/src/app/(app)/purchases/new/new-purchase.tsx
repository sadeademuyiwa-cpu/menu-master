'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/button'
import { AppIcon } from '@/components/icons'
import type { CatalogItem } from '@/lib/data/purchase-catalog'
import type { PurchaseResult } from './actions'

type Row = { key: number; ingredientId: string; qty: string; unitId: string; amount: string }
type Supplier = { id: string; name: string }

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })
const num = (raw: string): number | null => {
  const t = raw.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const blank = (key: number, ingredientId = '', unitId = ''): Row => ({ key, ingredientId, qty: '', unitId, amount: '' })

/**
 * Recording a purchase: everything bought on one trip, on one screen. Each
 * row offers only the units that item can be bought in without a guess.
 * Nothing is saved until Record (or Save for later); then the whole purchase
 * is written in one step (actions.ts) and every dish using these items is
 * re-costed by the database.
 */
export function NewPurchase({
  items, recent, suppliers, today, first, action,
}: {
  items: CatalogItem[]
  recent: string[]
  suppliers: Supplier[]
  today: string
  /** An item to start with, e.g. when arriving from its own page. */
  first: string | null
  action: (prev: PurchaseResult, formData: FormData) => Promise<PurchaseResult>
}) {
  const [result, formAction] = useActionState(action, null)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const startWith = first && byId.has(first) ? first : ''
  const [rows, setRows] = useState<Row[]>([
    blank(0, startWith, startWith ? byId.get(startWith)?.units[0]?.id ?? '' : ''),
    blank(1), blank(2),
  ])
  const [nextKey, setNextKey] = useState(3)
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')

  const groups = useMemo(() => {
    const g = new Map<string, CatalogItem[]>()
    for (const i of items) g.set(i.group, [...(g.get(i.group) ?? []), i])
    return [...g.entries()]
  }, [items])
  const recentItems = recent.map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i)

  const filled = rows.filter((r) => r.ingredientId || r.qty.trim() || r.amount.trim())
  const total = filled.reduce((t, r) => t + (num(r.amount) ?? 0), 0)
  const set = (key: number, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))

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
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Record a purchase</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          Everything you bought on this trip, and what you paid. Every dish that uses these is re-costed for you.
        </p>
      </div>

      <ol className="space-y-3">
        {rows.map((r, index) => {
          const item = byId.get(r.ingredientId)
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
                  onChange={(e) => set(r.key, { ingredientId: e.target.value, unitId: byId.get(e.target.value)?.units[0]?.id ?? '' })}
                  className="mm-input mt-1"
                >
                  <option value="">Choose…</option>
                  {recentItems.length > 0 && (
                    <optgroup label="Bought before">
                      {recentItems.map((i) => <option key={`r-${i.id}`} value={i.id}>{i.name}</option>)}
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
                  <input inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })}
                         aria-label={`How much, item ${index + 1}`} placeholder="e.g. 5" className="mm-input mt-1" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Unit</span>
                  <select value={r.unitId} disabled={!item} onChange={(e) => set(r.key, { unitId: e.target.value })}
                          aria-label={`Unit, item ${index + 1}`} className="mm-input mt-1">
                    {!item && <option value="">—</option>}
                    {item?.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">You paid (₦)</span>
                  <input inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })}
                         aria-label={`Paid, item ${index + 1}`} placeholder="e.g. 8000" className="mm-input mt-1" />
                </label>
              </div>
              {item && (
                <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                  Bought in a local measure like a paint or derica?{' '}
                  <Link href={`/ingredients/${item.id}`} className="underline">Tell us its size</Link> and it will appear here.
                </p>
              )}
            </li>
          )
        })}
      </ol>

      <button type="button" className="mm-btn mm-btn-secondary w-full"
              onClick={() => { setRows((all) => [...all, blank(nextKey)]); setNextKey((k) => k + 1) }}>
        + Add another item
      </button>

      <details className="mm-card">
        <summary className="mm-tap cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">
          <span style={{ color: 'var(--mm-muted)' }}>Date, supplier and reference</span>
          <span className="ml-auto truncate pl-3 font-medium">{date}{supplierName ? ` · ${supplierName}` : ''}{reference ? ` · ${reference}` : ''}</span>
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
        <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
          <Link href="/suppliers" className="underline">Add a supplier or market</Link>
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
          <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>
            {filled.length === 0 ? 'Nothing added yet' : `${filled.length} item${filled.length === 1 ? '' : 's'}`}
          </div>
          <div className="mm-num text-lg font-semibold">{naira.format(total)}</div>
        </div>
        <Button name="mode" value="post" disabled={filled.length === 0} busyLabel="Recording…">
          Record purchase
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>Not finished? Save it and complete it later.</p>
        <Button name="mode" value="draft" variant="secondary" disabled={filled.length === 0} busyLabel="Saving…">
          Save for later
        </Button>
      </div>
    </form>
  )
}
