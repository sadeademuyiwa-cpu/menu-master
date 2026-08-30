import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Empty, DataList } from '@/components/ui'
import { money, percent, coverageLabel, NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

type ByPeriod = {
  period: string
  revenue: number | null
  costed_revenue: number | null
  cogs: number | null
  gross_profit: number | null
  gross_margin_pct: number | null
  cost_coverage_pct: number | null
  revenue_without_cost: number | null
}
type ByProduct = {
  recipe_id: string
  name: string
  units_sold: number | null
  revenue: number | null
  costed_revenue: number | null
  cogs: number | null
  gross_profit: number | null
  gross_margin_pct: number | null
  cost_coverage_pct: number | null
}
type Voided = {
  record_id: string
  reference: string | null
  sale_date: string | null
  voided_at: string | null
  void_reason: string | null
}

export default async function ReportsPage() {
  const supabase = await createClient()
  const [{ data: byPeriod }, { data: byProduct }, { data: voided }] = await Promise.all([
    supabase.from('v_profit_by_period').select('*').order('period', { ascending: false })
      .limit(12).returns<ByPeriod[]>(),
    supabase.from('v_profit_by_product').select('*').order('revenue', { ascending: false })
      .limit(50).returns<ByProduct[]>(),
    supabase.from('v_voided_sales').select('record_id,reference,sale_date,voided_at,void_reason')
      .order('voided_at', { ascending: false }).limit(20).returns<Voided[]>(),
  ])

  return (
    <div className="space-y-10">
      <PageHeader
        title="Reports"
        sub="Revenue always counts. Profit is worked out only over the sales whose cost was actually known at the time — counting the rest as pure profit would flatter the figure exactly where you know least."
      />

      <section>
        <h2 className="text-base font-medium">By period</h2>
        <div className="mt-3">
          <DataList
            rows={byPeriod ?? []}
            keyOf={(r) => r.period}
            empty="No sales recorded yet."
            render={(r) => [
              { label: 'Period', value: r.period },
              { label: 'Revenue', value: money(r.revenue) },
              { label: 'Of that, costed', value: money(r.costed_revenue) },
              { label: 'Gross profit', value: money(r.gross_profit) },
              { label: 'Margin', value: percent(r.gross_margin_pct) },
              { label: 'Coverage', value: coverageLabel(r.cost_coverage_pct) },
              { label: 'Revenue without cost', value: money(r.revenue_without_cost) },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium">By product</h2>
        <div className="mt-3">
          <DataList
            rows={byProduct ?? []}
            keyOf={(r) => r.recipe_id}
            empty="No product sales yet."
            render={(r) => [
              { label: 'Product', value: r.name },
              // No `?? 0` here. An absent figure says so; it is never a zero.
              { label: 'Units sold', value: r.units_sold ?? NOT_ENTERED },
              { label: 'Revenue', value: money(r.revenue) },
              { label: 'Gross profit', value: money(r.gross_profit) },
              { label: 'Margin', value: percent(r.gross_margin_pct) },
              { label: 'Coverage', value: coverageLabel(r.cost_coverage_pct) },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium">Voided sales</h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>
          Corrections are made by reversal, never by editing history.
        </p>
        <div className="mt-3">
          {(voided ?? []).length === 0 ? (
            <Empty>Nothing has been cancelled. Cancelled sales appear here so nothing disappears without a trace.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {(voided ?? []).map((v) => (
                <li key={v.record_id}>
                  <Card>
                    <p>{v.reference ?? v.record_id}</p>
                    <p className="mm-absent">
                      {v.sale_date} · voided {v.voided_at} · {v.void_reason ?? 'no reason given'}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
