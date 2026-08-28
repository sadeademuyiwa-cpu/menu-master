import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { money, percent, coverageLabel, NOT_AVAILABLE } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Waterfall = {
  business_id: string
  period: string
  revenue: number | null
  cogs: number | null
  gross_profit: number | null
  gross_margin_pct: number | null
  cost_coverage_pct: number | null
  revenue_without_cost: number | null
  confidence: string | null
}

type OnboardingStatus = {
  business_id: string
  name: string
  ingredients: number | null
  prices_entered: number | null
  recipes: number | null
  complete_costings: number | null
  blocking_conversions: number | null
  selling_prices_set: number | null
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // RLS scopes every row to the caller's account. There is no client-side
  // account filter anywhere in this file, deliberately.
  const [{ data: status }, { data: waterfall }] = await Promise.all([
    supabase.from('v_onboarding_status').select('*').returns<OnboardingStatus[]>(),
    supabase
      .from('v_dashboard_waterfall')
      .select('*')
      .order('period', { ascending: false })
      .limit(1)
      .returns<Waterfall[]>(),
  ])

  // No business yet means onboarding has not been completed.
  if (status && status.length === 0) redirect('/onboarding')

  const w = waterfall?.[0]

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {w ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
            Period {w.period} · {coverageLabel(w.cost_coverage_pct)}
          </p>
        ) : (
          <p className="mt-1 text-sm mm-absent">
            No sales recorded yet, so there is nothing to report.
          </p>
        )}
      </section>

      {w && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Revenue" value={money(w.revenue)} />
          <Stat label="COGS" value={money(w.cogs)} />
          <Stat label="Gross profit" value={money(w.gross_profit)} />
          <Stat
            label="Gross margin"
            value={percent(w.gross_margin_pct)}
            note={coverageLabel(w.cost_coverage_pct)}
          />
        </section>
      )}

      {w && w.revenue_without_cost !== null && Number(w.revenue_without_cost) > 0 && (
        <p className="rounded border p-3 text-sm" style={{ borderColor: 'var(--mm-line)' }}>
          {money(w.revenue_without_cost)} of revenue has no verified cost behind
          it. That revenue counts; its profit does not.
        </p>
      )}

      <section>
        <h2 className="text-base font-medium">Setup progress</h2>
        <div className="mt-3 space-y-3">
          {(status ?? []).map((s) => (
            <div key={s.business_id} className="rounded border p-3" style={{ borderColor: 'var(--mm-line)' }}>
              <p className="font-medium">{s.name}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Row k="Ingredients" v={s.ingredients} />
                <Row k="Prices entered" v={s.prices_entered} />
                <Row k="Recipes" v={s.recipes} />
                <Row k="Recipes fully costed" v={s.complete_costings} />
                <Row k="Measurements still needed" v={s.blocking_conversions} />
                <Row k="Selling prices set" v={s.selling_prices_set} />
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--mm-line)' }}>
      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-[11px]" style={{ color: 'var(--mm-muted)' }}>{note}</p>}
    </div>
  )
}

/** Counts are counts: a real 0 is meaningful here. A NULL is not. */
function Row({ k, v }: { k: string; v: number | null }) {
  return (
    <>
      <dt style={{ color: 'var(--mm-muted)' }}>{k}</dt>
      <dd className={v === null ? 'mm-absent' : 'tabular-nums'}>
        {v === null ? NOT_AVAILABLE : v}
      </dd>
    </>
  )
}
