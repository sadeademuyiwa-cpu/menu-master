import Link from 'next/link'
import { Badge, Disclosure, Field, inputClass } from '@/components/ui'
import { Button } from '@/components/button'
import { ConfirmSubmit } from '@/components/confirm-submit'
import { money, quantity, lineStatus } from '@/lib/format'
import { formatDay } from '@/lib/dates'
import { onDay, perBuyingUnit } from '../../purchases/buy-figures'
import { addSubRecipe, removeLine, updateLine } from './actions'
import { TapRow } from './tap-row'
import { n, type Line, type Unit } from './types'

const muted = { color: 'var(--mm-muted)' }
const line = { borderColor: 'var(--mm-line)' }

/**
 * Where a line's cost came from, in the owner's language. cost_basis comes
 * from fn_ingredient_cost_basis -- the same function that produced the cost
 * -- so what is claimed here and what was charged cannot disagree. An
 * estimate is never dressed up as a purchase, and an averaged cost never
 * implies one receipt. Cost roles only: the page passes no costed line to
 * anyone else.
 */
function Provenance({ l, links = true }: { l: Line; links?: boolean }) {
  const unitCost = n(l.unit_cost)
  // Said the way it is bought (₦4 per litre, ₦1,125 per kg), as the
  // ingredient page does: per ml or per g, water at ₦100 for 25 litres is
  // ₦0.004 and would read "₦0", a priced item shown as free. Anything still
  // under half a kobo says so rather than round to nothing.
  const per = unitCost !== null && l.base_unit ? perBuyingUnit(unitCost, l.base_unit) : null
  const pQty = n(l.purchase_qty_base)
  const pAmt = n(l.purchase_amount)
  return (
    // Spans, not paragraphs: with "See every cost" on, this sits inside the
    // row's button, where only phrasing content belongs.
    <span className="block space-y-1 text-sm" style={muted}>
      {per && (
        <span className="mm-num block">
          {per.value > 0 && per.value < 0.005 ? 'under ₦0.01' : money(per.value)} {per.per}
        </span>
      )}
      {pAmt !== null && pQty !== null && l.base_unit && (
        <span className="block">
          {l.cost_basis === 'manual' ? (
            <><span style={{ color: 'var(--mm-warn)' }}>Estimated price</span>
              {' '}— not from a purchase. Record what you paid to cost this properly.</>
          ) : (l.purchase_count ?? 0) > 1 ? (
            <>Averaged over your last {l.purchase_count} purchases:{' '}
              {quantity(pQty, l.base_unit)} for {money(pAmt)} · uses {quantity(n(l.base_qty), l.base_unit)} of it</>
          ) : l.cost_basis === 'purchase_latest' ? (
            /*
              STALE. No purchase falls inside the costing window, so the engine
              is using an older real receipt. Owner rule 7: make that obvious
              and show the date, rather than let a months-old price look
              current. No inflation guess is applied.
            */
            <><span style={{ color: 'var(--mm-warn)' }}>Old price</span> — your last purchase was{' '}
              {quantity(pQty, l.base_unit)} for {money(pAmt)}
              {l.purchase_date ? ` ${onDay(formatDay(l.purchase_date))}` : ''}. Record what you pay now to keep this accurate.</>
          ) : (
            <>You bought {quantity(pQty, l.base_unit)} for {money(pAmt)}
              {l.purchase_date ? ` ${onDay(formatDay(l.purchase_date))}` : ''}
              {' '}· uses {quantity(n(l.base_qty), l.base_unit)} of it</>
          )}
        </span>
      )}
      {links && l.problem === 'missing_price' && l.ingredient_id && (
        <span className="block" style={{ color: 'var(--mm-warn)' }}>
          No purchase price yet.{' '}
          <Link href={`/ingredients/${l.ingredient_id}`} className="mm-inline-tap">Tell us what you paid</Link>
        </span>
      )}
      {links && l.problem === 'missing_conversion' && l.ingredient_id && (
        <span className="block" style={{ color: 'var(--mm-warn)' }}>
          We do not know how much one {l.recipe_unit} of this weighs.{' '}
          <Link href={`/ingredients/${l.ingredient_id}`} className="mm-inline-tap">Add the measurement</Link>
        </span>
      )}
    </span>
  )
}

/** What the row says: the name, how much, and (for cost roles) the batch cost. */
function RowBody({ l, costs, pro }: { l: Line; costs: boolean; pro: boolean }) {
  const lineCost = n(l.line_cost)
  // The badge is about the line, not its price: "Made from another dish"
  // and "Not counted" are for everyone; "No price yet" only where costs show.
  const status = l.sub_recipe_id ? 'sub_recipe'
    : !l.is_cost_bearing ? 'excluded'
    : costs && l.problem && l.problem !== 'ok' ? l.problem : null
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          <span className="min-w-0 break-words">{l.item_name ?? 'Unknown item'}</span>
          {status && <Badge tone={lineStatus(status).tone}>{lineStatus(status).label}</Badge>}
        </span>
        <span className="mm-num mt-0.5 block text-sm" style={muted}>{quantity(n(l.recipe_qty), l.recipe_unit)}</span>
        {pro && costs && <span className="mt-1 block"><Provenance l={l} links={false} /></span>}
      </span>
      {costs && l.is_cost_bearing && (
        <span className="mm-num shrink-0 font-semibold">
          {lineCost !== null ? money(lineCost) : <span className="mm-absent text-sm font-normal">not known yet</span>}
        </span>
      )}
    </span>
  )
}

function LineSheet({ l, recipeId, units, costs, edits }: {
  l: Line; recipeId: string; units: Unit[]; costs: boolean; edits: boolean
}) {
  const unitId = l.unit_id ?? units.find((u) => u.code === l.recipe_unit)?.id ?? ''
  return (
    <div className="space-y-5">
      <p className="mm-num text-sm">
        {quantity(n(l.recipe_qty), l.recipe_unit)} in one batch
        {costs && n(l.line_cost) !== null && <> · <span className="font-semibold">{money(n(l.line_cost))}</span></>}
      </p>
      {costs && <Provenance l={l} />}
      {edits && (
        <>
          <form action={updateLine} className="grid grid-cols-2 gap-3">
            <input type="hidden" name="recipe_id" value={recipeId} />
            <input type="hidden" name="line_id" value={l.line_id} />
            <Field label="Quantity">
              <input name="qty" type="number" step="any" min="0" required inputMode="decimal"
                defaultValue={Number(l.recipe_qty)} className={inputClass} />
            </Field>
            <Field label="Unit">
              <select name="unit_id" defaultValue={unitId} className={inputClass}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                ))}
              </select>
            </Field>
            <div className="col-span-2"><Button className="w-full" busyLabel="Saving…">Save</Button></div>
          </form>
          <form action={removeLine} className="border-t pt-4" style={line}>
            <input type="hidden" name="recipe_id" value={recipeId} />
            <input type="hidden" name="line_id" value={l.line_id} />
            <ConfirmSubmit variant="secondary" message={`Remove ${l.item_name ?? 'this ingredient'} from this dish?`}>Remove from this dish</ConfirmSubmit>
          </form>
        </>
      )}
    </div>
  )
}

function Rows({ lines, title, ...rest }: {
  lines: Line[]
  title: string | null
  recipeId: string
  units: Unit[]
  costs: boolean
  edits: boolean
  pro: boolean
  stamp: number
  footer?: React.ReactNode
}) {
  if (lines.length === 0) return null
  const { recipeId, units, costs, edits, pro, stamp, footer } = rest
  // A row opens only when its sheet has something in it: the forms for
  // whoever may change the dish, where the cost came from for whoever may
  // see costs. For anyone else it is a plain row.
  const opens = edits || costs
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-medium" style={muted}>{title}</h3>}
      <ul className="overflow-hidden rounded-[var(--mm-radius)] border bg-[var(--mm-surface)]" style={line}>
        {lines.map((l, i) => (
          <li key={`${l.line_id}`} className={i === 0 ? '' : 'border-t'} style={line}>
            {opens ? (
              <TapRow stamp={stamp} title={l.item_name ?? 'Ingredient'}
                      sheet={<LineSheet l={l} recipeId={recipeId} units={units} costs={costs} edits={edits} />}>
                <RowBody l={l} costs={costs} pro={pro} />
              </TapRow>
            ) : (
              <div className="px-3 py-2.5"><RowBody l={l} costs={costs} pro={pro} /></div>
            )}
          </li>
        ))}
        {footer && <li className="border-t bg-[var(--mm-surface-2)] px-3 py-2.5" style={line}>{footer}</li>}
      </ul>
    </div>
  )
}

/** Cooking lines first, then packaging; the costliest first where costs show. */
export function WhatGoesIn({ lines, footer, ...rest }: {
  lines: Line[]
  recipeId: string
  units: Unit[]
  costs: boolean
  edits: boolean
  pro: boolean
  stamp: number
  footer?: React.ReactNode
}) {
  const byCost = (a: Line, b: Line) => (n(b.line_cost) ?? -1) - (n(a.line_cost) ?? -1)
  const sorted = (ls: Line[]) => (rest.costs ? [...ls].sort(byCost) : ls)
  const cook = sorted(lines.filter((l) => l.item_kind !== 'packaging'))
  const pack = sorted(lines.filter((l) => l.item_kind === 'packaging'))
  return (
    <div className="space-y-4">
      <Rows lines={cook} title={null} {...rest} footer={pack.length === 0 ? footer : undefined} />
      <Rows lines={pack} title="Packaging" {...rest} footer={pack.length > 0 ? footer : undefined} />
    </div>
  )
}

/** "Add a dish you make": the stew in the jollof, the dough in the pie. */
export function AddSubDish({ recipeId, dishes, units, unitCode }: {
  recipeId: string
  dishes: { id: string; name: string; yield_unit_id: string }[]
  units: Unit[]
  unitCode: (id: string) => string
}) {
  if (dishes.length === 0) return null
  return (
    <Disclosure summary="Add a dish you make">
      <form action={addSubRecipe} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <input type="hidden" name="recipe_id" value={recipeId} />
        <div className="sm:col-span-2">
          <Field label="Which dish">
            <select name="sub_recipe_id" required className={inputClass}>
              {dishes.map((r) => (
                <option key={r.id} value={r.id}>{r.name} (made in {unitCode(r.yield_unit_id)})</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field label="How much of it">
            <input name="qty" type="number" step="any" min="0" required inputMode="decimal" className={inputClass} />
          </Field>
          <Field label="Unit">
            <select name="unit_id" required className={inputClass}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="sm:col-span-4"><Button className="w-full sm:w-auto">Add dish</Button></div>
        <p className="text-xs sm:col-span-4" style={muted}>
          Use the unit that dish is made in: litres of stew, grams of dough.
        </p>
      </form>
    </Disclosure>
  )
}
