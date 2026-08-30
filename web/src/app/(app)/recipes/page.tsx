import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import {
  PageHeader, Field, Submit, inputClass, inputStyle, Notice, SectionHeading, Empty, Card,
} from '@/components/ui'
import { money, NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Unit = { id: string; code: string; name: string; kind: string }
type Recipe = {
  id: string; name: string; batch_yield_qty: string; yield_unit_id: string
  portion_qty: string | null; status: string
}
type Cost = { recipe_id: string; is_complete: boolean; cost_per_portion: string | null }

async function createRecipe(formData: FormData) {
  'use server'
  const here = '/recipes'
  const { supabase, accountId, businessId } = await currentContext()
  if (!accountId || !businessId) {
    redirect(withNotice(here, 'Set up your business before creating recipes.'))
  }

  const batchYield = Number(formData.get('batch_yield_qty'))
  const portionRaw = String(formData.get('portion_qty') ?? '').trim()
  const portion = portionRaw === '' ? null : Number(portionRaw)

  if (!Number.isFinite(batchYield) || batchYield <= 0) {
    redirect(withNotice(here, 'A batch has to produce something. Enter a yield greater than zero.'))
  }
  if (portion !== null && (!Number.isFinite(portion) || portion <= 0)) {
    redirect(withNotice(here, 'A portion has to be greater than zero, or left empty.'))
  }

  const { data, error } = await supabase.from('recipes').insert({
    account_id: accountId,
    business_id: businessId,
    name: String(formData.get('name') ?? '').trim(),
    batch_yield_qty: batchYield,
    yield_unit_id: String(formData.get('yield_unit_id') ?? ''),
    portion_qty: portion,
    status: 'active',
  }).select('id').maybeSingle()

  if (error || !data) redirect(withNotice(here, describeWriteError(error) ?? 'Could not create that recipe.'))

  revalidatePath(here)
  redirect(`/recipes/${data.id}`)
}

export default async function RecipesPage(props: {
  searchParams: Promise<{ notice?: string }>
}) {
  const { notice } = await props.searchParams
  const supabase = await createClient()

  const [{ data: recipes }, { data: units }, { data: costs }] = await Promise.all([
    supabase.from('recipes')
      .select('id,name,batch_yield_qty,yield_unit_id,portion_qty,status')
      .is('deleted_at', null).order('name').returns<Recipe[]>(),
    supabase.from('units').select('id,code,name,kind').order('kind').order('code').returns<Unit[]>(),
    supabase.from('v_recipe_cost_current')
      .select('recipe_id,is_complete,cost_per_portion').returns<Cost[]>(),
  ])

  const unitCode = new Map((units ?? []).map((u) => [u.id, u.code]))
  const costOf = new Map((costs ?? []).map((c) => [c.recipe_id, c]))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Recipes"
        sub="What a dish really costs to make, from the prices you entered yourself."
      />
      <p className="text-sm">
        <Link href="/formats" className="mm-tap underline">The sizes you sell in →</Link>
      </p>

      {notice && <Notice>{notice}</Notice>}

      <section className="space-y-3">
        <SectionHeading sub="A batch is what one cooking produces. A portion is what you sell.">
          New recipe
        </SectionHeading>
        <form action={createRecipe} className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <Field label="Name">
            <input name="name" required className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Batch makes">
            <input name="batch_yield_qty" type="number" step="any" min="0" required
              className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Measured in">
            <select name="yield_unit_id" required className={inputClass} style={inputStyle}>
              {(units ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </Field>
          <Field label="One portion is (optional)">
            <input name="portion_qty" type="number" step="any" min="0"
              className={inputClass} style={inputStyle} />
          </Field>
          <Submit>Create</Submit>
        </form>
      </section>

      <section className="space-y-3">
        <SectionHeading>Your recipes {recipes ? `(${recipes.length})` : ''}</SectionHeading>

        {!recipes || recipes.length === 0 ? (
          <Empty>You have not added anything you make yet. Add your first product to discover what it really costs you.</Empty>
        ) : (
          <ul className="space-y-3">
            {recipes.map((r) => {
              const c = costOf.get(r.id)
              return (
                <li key={r.id}>
                  <Link href={`/recipes/${r.id}`} className="block">
                    <Card>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-sm tabular-nums">
                          {c?.is_complete
                            ? `${money(c.cost_per_portion === null ? null : Number(c.cost_per_portion))} per portion`
                            : <span className="mm-absent">
                                {c ? 'costing incomplete' : 'not costed yet'}
                              </span>}
                        </span>
                      </div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>
                        Batch {Number(r.batch_yield_qty)} {unitCode.get(r.yield_unit_id) ?? NOT_ENTERED}
                        {r.portion_qty !== null &&
                          ` · portion ${Number(r.portion_qty)} ${unitCode.get(r.yield_unit_id) ?? ''}`}
                      </div>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
