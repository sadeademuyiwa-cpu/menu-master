import { money } from '@/lib/format'

/**
 * What came in each day, one bar a day, for a role that may not see costs
 * (sales).
 *
 * WHY NOT WeekBars. WeekBars (components/charts.tsx) always draws a kept
 * series. Given kept: null it draws a dashed "Kept: not known yet" outline
 * on every day, which tells a cashier the business does not know its costs;
 * given 0 its hidden table reads "Kept ₦0". Neither is true. The kept figure
 * is withheld from this role, not unknown, so the chart must not have a kept
 * series at all. Until WeekBars takes a sold-only series (asked for as a
 * shared change), this draws the same chart with the same classes and the
 * same rules: three days with sales or the empty state, a visible day row,
 * a one-sentence label and a hidden table for a screen reader.
 */
export function SoldBars({
  days, ariaLabel, empty = null, height = 132,
}: {
  days: { label: string; sold: number | null }[]
  ariaLabel: string
  empty?: React.ReactNode
  height?: number
}) {
  const sold = (d: { sold: number | null }) => (typeof d.sold === 'number' && Number.isFinite(d.sold) ? d.sold : null)
  if (days.length === 0 || days.filter((d) => (sold(d) ?? 0) > 0).length < 3) return <>{empty}</>

  const top = Math.max(0, ...days.map((d) => sold(d) ?? 0)) || 1
  const PAD = 4 // % kept clear above the tallest bar, as WeekBars does
  const y = (v: number) => PAD + ((top - v) / top) * (100 - PAD)
  const slot = 100 / days.length
  const barW = slot * 0.5

  return (
    <figure className="mm-chart">
      <div role="img" aria-label={ariaLabel}>
        <svg className="mm-chart-plot" height={height} aria-hidden="true" focusable="false">
          {days.map((d, i) => {
            const v = sold(d)
            if (v === null || v <= 0) return null
            return (
              <rect key={i} className="mm-chart-sold" x={`${slot * i + slot * 0.25}%`} width={`${barW}%`}
                    rx={3} y={`${y(v)}%`} height={`${100 - y(v)}%`} />
            )
          })}
          <line className="mm-chart-axis" x1="0" x2="100%" y1="100%" y2="100%" />
        </svg>
        <div className="mm-chart-days" style={{ '--mm-chart-n': days.length } as React.CSSProperties} aria-hidden="true">
          {days.map((d, i) => <span key={i}>{d.label}</span>)}
        </div>
      </div>
      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Sold</th></tr></thead>
        <tbody>
          {days.map((d, i) => {
            const v = sold(d)
            return (
              <tr key={i}><th scope="row">{d.label}</th><td>{v !== null && v > 0 ? money(v) : 'no sales'}</td></tr>
            )
          })}
        </tbody>
      </table></div>
    </figure>
  )
}
