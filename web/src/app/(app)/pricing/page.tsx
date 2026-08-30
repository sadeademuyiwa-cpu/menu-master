import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Empty } from '@/components/ui'
import { money, percent, NOT_AVAILABLE } from '@/lib/format'

export const dynamic = 'force-dynamic'

type PriceCheck = {
  recipe_id: string
  name: string
  channel_id: string | null
  channel_name: string | null
  is_complete: boolean
  required_inputs: number
  priced_inputs: number
  unpriced_items: { name?: string; problem?: string }[] | null
  cost_floor_per_portion: number | null
  cost_per_portion: number | null
  selling_price: number | null
  profit: number | null
  margin_pct: number | null
  recommended_price: number | null
  target_margin: number | null
  commission_pct: number | null
}

export default async function PricingPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_price_check')
    .select('*')
    .order('name')
    .returns<PriceCheck[]>()

  const rows = data ?? []
  const incomplete = rows.filter((r) => !r.is_complete)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pricing and margins"
        sub="A recipe with any missing input gets no margin and no recommended price. That is deliberate."
      />

      {incomplete.length > 0 && (
        <Card>
          <p className="text-sm font-medium">
            {incomplete.length} recipe{incomplete.length === 1 ? '' : 's'} cannot be priced yet
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>
            Menu Master will not estimate the missing figures. Enter them and the
            price appears.
          </p>
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty>Nothing is priced yet. Once a product is costed, set what you charge and Menu Master shows your profit and margin.</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.recipe_id}-${r.channel_id ?? 'default'}`}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                    {r.channel_name ?? 'default channel'}
                  </p>
                </div>

                {r.is_complete ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <Cell k="Cost per portion" v={money(r.cost_per_portion)} />
                    <Cell k="Selling price" v={money(r.selling_price)} />
                    <Cell k="Profit" v={money(r.profit)} />
                    <Cell k="Margin" v={percent(r.margin_pct)} />
                    <Cell k="Target margin" v={percent(r.target_margin)} />
                    <Cell k="Recommended" v={money(r.recommended_price)} />
                  </dl>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm" style={{ color: 'var(--mm-warn)' }}>
                      Incomplete — {r.priced_inputs} of {r.required_inputs} inputs priced.
                      No margin and no recommended price.
                    </p>
                    {r.cost_floor_per_portion !== null && (
                      <p className="text-sm">
                        Known cost so far, a floor and not the cost:{' '}
                        <span className="tabular-nums">{money(r.cost_floor_per_portion)}</span>
                      </p>
                    )}
                    {r.unpriced_items && r.unpriced_items.length > 0 && (
                      <ul className="text-sm">
                        {r.unpriced_items.slice(0, 6).map((u, i) => (
                          <li key={i} className="mm-absent">
                            {u.name ?? 'item'} — {u.problem ?? 'not priced'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Audit item 27: commission is stored and displayed here today
                    but does not yet enter the economics. Saying so is required
                    -- an unlabelled inert number is a misleading number. */}
                <p className="mt-3 text-xs" style={{ color: 'var(--mm-muted)' }}>
                  Channel commission:{' '}
                  {r.commission_pct === null ? NOT_AVAILABLE : `${r.commission_pct}%`}
                  {' · '}not yet applied to these figures
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="contents">
      <dt style={{ color: 'var(--mm-muted)' }}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  )
}
