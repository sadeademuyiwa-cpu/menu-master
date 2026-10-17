import { money } from '@/lib/format'
import type { MonthDay } from './report-data'

const UNKNOWN = 'not known yet'
const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * A month of days as bars: what came in (light) with what was kept laid over
 * it (Forest), the way the week chart on Home reads, but one bar a day so 31
 * of them fit a 360px phone. Drawn with the shared chart classes and rules
 * (components/charts.tsx, globals.css):
 *
 *   - three days with sales, or `empty` shows instead;
 *   - a day whose kept figure is not known yet is a dashed outline over its
 *     sold bar, and the legend says "Kept: not known yet" -- never a bar of 0;
 *   - a loss goes below the line;
 *   - one plain sentence as its label, and a hidden table of its numbers.
 *
 * `withKept` false (sales) draws no kept series at all: the figure is withheld
 * from that role, not unknown, so the chart must not say "not known yet".
 */
export function MonthBars({
  days, withKept, ariaLabel, empty = null, height = 140,
}: {
  days: MonthDay[]
  withKept: boolean
  ariaLabel: string
  empty?: React.ReactNode
  height?: number
}) {
  const withSales = days.filter((d) => known(d.sold) && d.sold > 0)
  if (withSales.length < 3) return <>{empty}</>

  const unknownKept = (d: MonthDay) => withKept && !known(d.kept) && known(d.sold) && d.sold > 0
  const anyUnknown = days.some(unknownKept)

  const values = days.flatMap((d) => [d.sold, withKept ? d.kept : null]).filter(known)
  const top = Math.max(0, ...values)
  const bottom = Math.min(0, ...values)
  const span = top - bottom || 1
  const PAD = 4 // % kept clear above the tallest bar, as WeekBars does
  const y = (v: number) => PAD + ((top - v) / span) * (100 - PAD)
  const base = y(0)
  const slot = 100 / days.length
  const x = (i: number) => `${slot * i + slot * 0.16}%`
  const w = `${slot * 0.68}%`
  const rect = (v: number) => {
    const a = y(v)
    return { y: `${Math.min(a, base)}%`, height: `${Math.abs(base - a)}%` }
  }

  return (
    <figure className="mm-chart">
      <div role="img" aria-label={ariaLabel}>
        <svg className="mm-chart-plot" height={height} aria-hidden="true" focusable="false">
          {days.map((d, i) => (
            <g key={d.date}>
              {known(d.sold) && d.sold !== 0 && <rect className="mm-chart-sold" x={x(i)} width={w} rx={2} {...rect(d.sold)} />}
              {withKept && known(d.kept) && d.kept !== 0 && <rect className="mm-chart-kept" x={x(i)} width={w} rx={2} {...rect(d.kept)} />}
              {unknownKept(d) && <rect className="mm-chart-unknown" x={x(i)} width={w} rx={2} {...rect(d.sold as number)} />}
            </g>
          ))}
          <line className="mm-chart-axis" x1="0" x2="100%" y1={`${base}%`} y2={`${base}%`} />
        </svg>
        {/* A day number once a week; the rest of the row stays clear. */}
        <div className="mm-month-days" style={{ '--mm-chart-n': days.length } as React.CSSProperties} aria-hidden="true">
          {days.map((d) => <span key={d.date}>{d.day % 7 === 1 ? d.day : ''}</span>)}
        </div>
      </div>

      <div className="mm-chart-legend" aria-hidden="true">
        <span className="mm-chart-key"><span className="mm-chart-swatch" data-kind="sold" />Sold</span>
        {withKept && <span className="mm-chart-key"><span className="mm-chart-swatch" data-kind="kept" />Kept</span>}
        {anyUnknown && (
          <span className="mm-chart-key"><span className="mm-chart-swatch" data-kind="unknown" />Kept: {UNKNOWN}</span>
        )}
      </div>

      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <thead>
          <tr><th scope="col">Day</th><th scope="col">Sold</th>{withKept && <th scope="col">Kept</th>}</tr>
        </thead>
        <tbody>
          {withSales.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.day}</th>
              <td>{money(d.sold)}</td>
              {withKept && <td>{known(d.kept) ? money(d.kept) : UNKNOWN}</td>}
            </tr>
          ))}
        </tbody>
      </table></div>
    </figure>
  )
}
