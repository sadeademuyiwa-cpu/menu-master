import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { PageHeader, Card, Field, Submit, inputClass, inputStyle, DataList } from '@/components/ui'
import { NOT_ENTERED, money } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  kind: 'ingredient' | 'packaging'
  purchase_yield_pct: number | null
  is_active: boolean
  base_unit_id: string
}

async function addIngredient(formData: FormData) {
  'use server'
  const supabase = await createClient()

  // account_id is required by the table; RLS still refuses a foreign one, so
  // this is a convenience lookup, never an authorization decision.
  const { data: m } = await supabase.from('memberships').select('account_id').limit(1).single()
  if (!m) return

  await supabase.from('ingredients').insert({
    account_id: m.account_id,
    name: String(formData.get('name') ?? '').trim(),
    kind: String(formData.get('kind') ?? 'ingredient'),
    base_unit_id: String(formData.get('base_unit_id') ?? ''),
  })
  revalidatePath('/ingredients')
}

export default async function IngredientsPage() {
  const supabase = await createClient()

  const [{ data: ingredients }, { data: units }, { data: missing }] = await Promise.all([
    supabase.from('ingredients').select('id,name,kind,purchase_yield_pct,is_active,base_unit_id')
      .is('deleted_at', null).order('name').returns<Row[]>(),
    supabase.from('units').select('id,code,name,kind').order('code')
      .returns<{ id: string; code: string; name: string; kind: string }[]>(),
    supabase.from('v_missing_unit_conversions').select('ingredient_id,ingredient_name,unit_code,reason')
      .returns<{ ingredient_id: string; ingredient_name: string; unit_code: string; reason: string }[]>(),
  ])

  const unitCode = new Map((units ?? []).map((u) => [u.id, u.code]))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ingredients"
        sub="Your own items and prices. Menu Master never supplies a price or a conversion for you."
      />

      {missing && missing.length > 0 && (
        <Card>
          <p className="text-sm font-medium">Conversions you still need to enter</p>
          <ul className="mt-2 space-y-1 text-sm">
            {missing.slice(0, 8).map((m, i) => (
              <li key={i}>
                <span className="font-medium">{m.ingredient_name}</span> — {m.unit_code}
                <span className="mm-absent"> · {m.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs" style={{ color: 'var(--mm-muted)' }}>
            Until you enter these, recipes using them stay incomplete. No factor
            is assumed on your behalf.
          </p>
        </Card>
      )}

      <section>
        <h2 className="text-base font-medium">Add an item</h2>
        <form action={addIngredient} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Name">
            <input name="name" required className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Kind">
            <select name="kind" className={inputClass} style={inputStyle}>
              <option value="ingredient">ingredient</option>
              <option value="packaging">packaging</option>
            </select>
          </Field>
          <Field label="Base unit">
            <select name="base_unit_id" required className={inputClass} style={inputStyle}>
              {(units ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </Field>
          <Submit>Add</Submit>
        </form>
      </section>

      <section>
        <h2 className="text-base font-medium">
          Your items {ingredients ? `(${ingredients.length})` : ''}
        </h2>
        <div className="mt-3">
          <DataList
            rows={ingredients ?? []}
            keyOf={(r) => r.id}
            empty="No ingredients yet."
            render={(r) => [
              { label: 'Name', value: r.name },
              { label: 'Kind', value: r.kind },
              { label: 'Base unit', value: unitCode.get(r.base_unit_id) ?? NOT_ENTERED },
              {
                label: 'Purchase yield',
                value: r.purchase_yield_pct === null
                  ? <span className="mm-absent">{NOT_ENTERED}</span>
                  : `${r.purchase_yield_pct}%`,
              },
            ]}
          />
        </div>
      </section>

      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        Prices are entered per item and are never shown as {money(null)} when
        absent — an unpriced item reads &ldquo;{NOT_ENTERED}&rdquo;.
      </p>
    </div>
  )
}
