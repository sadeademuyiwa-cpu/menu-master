import { useId } from 'react'
import { money, percent } from '@/lib/format'
import { foldCostParts, MAX_COST_PARTS, type CostPart } from '@/lib/ui/cost-parts'

export type { CostPart }

/**
 * Three small charts, drawn as inline SVG: no library, nothing to download,
 * and they render on the server, so a page shows them before any script runs.
 *
 * THE RULES (branding/09-uiux/04-simplify-plan.md, section 1)
 *   - A figure not known yet is drawn as a gap you can see -- a dashed
 *     outline or a hatch -- and labelled "not known yet". It is never a bar
 *     of zero, because a missing cost is not a free one.
 *   - A chart needs at least three days of data; with fewer, the caller's
 *     friendly empty state shows instead (WeekBars `empty`).
 *   - Every chart takes an ariaLabel, the one plain sentence of what it shows,
 *     and carries a visually hidden table of its numbers for a screen reader.
 *     The sr-only class sits on a wrapping div, never on the <table>: a table
 *     ignores width:1px and keeps its natural width, which pushed a 360 px
 *     phone page 13 px wide.
 *   - Brand greens and neutrals only. No gold, amber or red: a chart is not a
 *     warning, and gold is the screen's one highlight.
 *
 * Geometry is in percentages of the drawing (no viewBox), so bars keep their
 * rounded corners and dashes at any width, and labels are HTML in Inter,
 * readable at 360 px.
 */

const UNKNOWN = 'not known yet'

/** The id React gives, cut down to characters a url(#...) reference takes. */
function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

const known = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n)

// ---------------------------------------------------------------------------
// WEEK BARS: sold and kept, day by day
// ---------------------------------------------------------------------------

export type WeekDay = {
  /** As printed under the bar: "Mon", "12". */
  label: string
  /** Money in that day. Null or 0 when nothing was sold. */
  sold: number | null
  /** What she kept that day (v_sales_summary.gross_profit). Null when a cost
   *  behind one of the day's sales is not known yet. */
  kept: number | null
}

/**
 * Two bars a day: what came in (light) and what she kept (Forest).
 *
 * A day whose kept figure is not known yet shows a dashed outline the height
 * of what was sold -- she kept no more than that, and we do not know how much
 * -- and the legend gains "Not known yet". A loss goes below the line.
 *
 * Fewer than three days with sales: `empty` renders instead (a sentence such
 * as "Record sales on three days and your week shows here."), or nothing.
 */
export function WeekBars({
  days, ariaLabel, empty = null, caption, height = 132,
}: {
  days: WeekDay[]
  /** One plain sentence: "Sold and kept, each day this week." */
  ariaLabel: string
  /** What shows while fewer than three days have sales. */
  empty?: React.ReactNode
  /** An optional line under the chart, shown to everyone. */
  caption?: React.ReactNode
  /** Drawing height in px. */
  height?: number
}) {
  const daysWithSales = days.filter((d) => known(d.sold) && d.sold > 0).length
  if (days.length === 0 || daysWithSales < 3) return <>{empty}</>

  const unknownKept = (d: WeekDay) => !known(d.kept) && known(d.sold) && d.sold > 0
  const anyUnknown = days.some(unknownKept)

  // One scale for both series, with room below the line for a loss.
  const values = days.flatMap((d) => [d.sold, d.kept]).filter(known)
  const top = Math.max(0, ...values)
  const bottom = Math.min(0, ...values)
  const span = top - bottom || 1
  const PAD = 4 // % kept clear above the tallest bar
  const y = (v: number) => PAD + ((top - v) / span) * (100 - PAD)
  const base = y(0)

  const slot = 100 / days.length
  const barW = slot * 0.3
  const bar = (i: number, which: 0 | 1) => slot * i + slot * (which === 0 ? 0.17 : 0.53)

  /** A rect from the zero line to v, in % of the drawing. */
  const span01 = (v: number) => {
    const a = y(v)
    return { y: `${Math.min(a, base)}%`, height: `${Math.abs(base - a)}%` }
  }

  return (
    <figure className="mm-chart">
      <div role="img" aria-label={ariaLabel}>
        <svg className="mm-chart-plot" height={height} aria-hidden="true" focusable="false">
          {days.map((d, i) => (
            <g key={i}>
              {known(d.sold) && d.sold !== 0 && (
                <rect className="mm-chart-sold" x={`${bar(i, 0)}%`} width={`${barW}%`} rx={3} {...span01(d.sold)} />
              )}
              {known(d.kept) && d.kept !== 0 && (
                <rect className="mm-chart-kept" x={`${bar(i, 1)}%`} width={`${barW}%`} rx={3} {...span01(d.kept)} />
              )}
              {unknownKept(d) && (
                <rect className="mm-chart-unknown" x={`${bar(i, 1)}%`} width={`${barW}%`} rx={3} {...span01(d.sold as number)} />
              )}
            </g>
          ))}
          <line className="mm-chart-axis" x1="0" x2="100%" y1={`${base}%`} y2={`${base}%`} />
        </svg>
        <div className="mm-chart-days" style={{ '--mm-chart-n': days.length } as React.CSSProperties} aria-hidden="true">
          {days.map((d, i) => <span key={i}>{d.label}</span>)}
        </div>
      </div>

      <div className="mm-chart-legend" aria-hidden="true">
        <span className="mm-chart-key"><span className="mm-chart-swatch" data-kind="sold" />Sold</span>
        <span className="mm-chart-key"><span className="mm-chart-swatch" data-kind="kept" />Kept</span>
        {anyUnknown && (
          <span className="mm-chart-key"><span className="mm-chart-swatch" data-kind="unknown" />Kept: {UNKNOWN}</span>
        )}
      </div>
      {caption && <figcaption className="mm-chart-caption">{caption}</figcaption>}

      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Sold</th><th scope="col">Kept</th></tr></thead>
        <tbody>
          {days.map((d, i) => {
            const sold = known(d.sold) && d.sold !== 0
            return (
              <tr key={i}>
                <th scope="row">{d.label}</th>
                <td>{sold ? money(d.sold) : 'no sales'}</td>
                <td>{known(d.kept) ? money(d.kept) : sold ? UNKNOWN : 'no sales'}</td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// SPARKLINE: a small trend, with gaps where a figure is missing
// ---------------------------------------------------------------------------

/**
 * A small line for "Rice up 8% since September". A null point is a gap in
 * the line, never a drop to zero. The last known point is marked.
 *
 * Needs three known points; with fewer it renders `empty` (default nothing),
 * because two dots are not a trend.
 */
export function Sparkline({
  points, ariaLabel, labels, tone = 'forest', format = 'money',
  width = 96, height = 28, empty = null, className = '',
}: {
  points: (number | null)[]
  /** "Price of rice, last six purchases." */
  ariaLabel: string
  /** A name per point for the screen-reader table ("2 Sep"). Default: 1, 2, 3... */
  labels?: string[]
  tone?: 'forest' | 'kitchen' | 'muted'
  /** How the table reads each figure. */
  format?: 'money' | 'percent' | 'number'
  /** Drawing size in px; width may be '100%'. */
  width?: number | string
  height?: number
  empty?: React.ReactNode
  className?: string
}) {
  const knownCount = points.filter(known).length
  if (knownCount < 3) return <>{empty}</>

  const vals = points.filter(known)
  const hi = Math.max(...vals)
  const lo = Math.min(...vals)
  const n = points.length
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
  // 10% headroom top and bottom, so the stroke and the end dot are not clipped.
  const y = (v: number) => (hi === lo ? 50 : 10 + ((hi - v) / (hi - lo)) * 80)

  // One sub-path per run of known points; a lone point is a dot.
  let d = ''
  let open = false
  points.forEach((p, i) => {
    if (!known(p)) { open = false; return }
    const prev = i > 0 && known(points[i - 1])
    const next = i < n - 1 && known(points[i + 1])
    if (!open) {
      d += `M${x(i).toFixed(2)} ${y(p).toFixed(2)}`
      if (!prev && !next) d += 'h0' // a round cap on a zero-length line is a dot
      open = true
    } else {
      d += `L${x(i).toFixed(2)} ${y(p).toFixed(2)}`
    }
  })
  const last = points.reduce<number>((at, p, i) => (known(p) ? i : at), -1)
  const lastY = y(points[last] as number)

  const show = (v: number) => format === 'money' ? money(v) : format === 'percent' ? percent(v) : v.toLocaleString('en-NG')

  // The table sits beside the role="img", not inside it: everything inside an
  // img is hidden from a screen reader.
  return (
    <span className={className}>
      <span role="img" aria-label={ariaLabel}>
        <svg
          className="mm-spark" data-tone={tone} width={width} height={height}
          viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"
        >
          <path className="mm-spark-line" d={d} vectorEffect="non-scaling-stroke" />
          <path className="mm-spark-dot" d={`M${x(last).toFixed(2)} ${lastY.toFixed(2)}h0`} vectorEffect="non-scaling-stroke" />
        </svg>
      </span>
      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{labels?.[i] ?? String(i + 1)}</th>
              <td>{known(p) ? show(p) : UNKNOWN}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </span>
  )
}

// ---------------------------------------------------------------------------
// COST BREAKDOWN: what one plate is made of
// ---------------------------------------------------------------------------

/** Room given to each part not known yet. It is a visible gap, not a measure. */
const UNKNOWN_SHARE = 12

/**
 * One horizontal bar of what a plate costs, in the caller's order. A list of
 * more than six parts keeps its biggest known ones, wherever the caller put
 * them, and folds the smaller known ones into "Everything else"
 * (lib/ui/cost-parts.ts). The legend is one column on a phone and two from
 * 480 px; a name wraps rather than being cut, so the part not known yet --
 * the one the owner has to find -- always shows in full.
 *
 * A part not known yet gets a hatched stretch of the bar, labelled "not
 * known yet" -- its width is room to see the gap, not a guess at its size.
 * Known parts share the rest by their amounts. `total` is the plate's cost;
 * pass null while anything is missing and the table says so.
 *
 * Renders nothing when there are no parts or no part has a cost yet and none
 * is waiting for one.
 */
export function CostBreakdown({
  parts, total, ariaLabel, caption,
}: {
  parts: CostPart[]
  total: number | null
  /** "What one plate of jollof rice is made of." */
  ariaLabel: string
  caption?: React.ReactNode
}) {
  const hatchId = useSvgId('mm-hatch')

  const shown = foldCostParts(parts)

  const drawn = shown.filter((p) => !known(p.amount) || (p.amount as number) > 0)
  const knownSum = drawn.reduce((t, p) => t + (known(p.amount) ? p.amount : 0), 0)
  const gaps = drawn.filter((p) => !known(p.amount)).length
  if (drawn.length === 0 || (knownSum <= 0 && gaps === 0)) return null

  // Each gap's width: a fixed share while there are known parts beside it (at
  // most 45% for all gaps together), the whole bar when nothing is known yet.
  const gapShare = gaps === 0 ? 0 : knownSum > 0 ? Math.min(UNKNOWN_SHARE * gaps, 45) / gaps : 100 / gaps
  const knownShare = 100 - gapShare * gaps

  let at = 0
  let shade = 0
  const segments = drawn.map((p) => {
    const w = known(p.amount) ? (p.amount / knownSum) * knownShare : gapShare
    const seg = { part: p, x: at, w, shade: known(p.amount) ? shade++ % MAX_COST_PARTS : -1 }
    at += w
    return seg
  })
  const shadeOf = new Map(segments.map((s) => [s.part, s.shade]))

  return (
    <figure className="mm-chart">
      <div className="mm-cost-bar" role="img" aria-label={ariaLabel}>
        <svg width="100%" height="100%" aria-hidden="true" focusable="false">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect className="mm-cost-hatch-bg" width="6" height="6" />
              <line className="mm-cost-hatch-line" x1="3" y1="0" x2="3" y2="6" />
            </pattern>
          </defs>
          {segments.map((s, i) => s.shade < 0
            ? <rect key={i} className="mm-cost-seg" x={`${s.x}%`} width={`${s.w}%`} height="100%" fill={`url(#${hatchId})`} />
            : <rect key={i} className="mm-cost-seg" data-shade={s.shade} x={`${s.x}%`} width={`${s.w}%`} height="100%" />)}
        </svg>
      </div>

      <ul className="mm-cost-legend" aria-hidden="true">
        {shown.map((p, i) => {
          const s = shadeOf.get(p)
          return (
            <li key={i}>
              <span className="mm-chart-swatch" {...(s === undefined || s < 0
                ? { 'data-kind': known(p.amount) ? undefined : 'hatch' }
                : { 'data-shade': s })} />
              <span className="min-w-0 flex-1 break-words">{p.label}</span>
              {known(p.amount)
                ? <span className="mm-num shrink-0 whitespace-nowrap">{money(p.amount)}</span>
                : <span className="mm-absent shrink-0 whitespace-nowrap">{UNKNOWN}</span>}
            </li>
          )
        })}
      </ul>
      {caption && <figcaption className="mm-chart-caption">{caption}</figcaption>}

      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <tbody>
          {parts.map((p, i) => (
            <tr key={i}><th scope="row">{p.label}</th><td>{money(p.amount, UNKNOWN)}</td></tr>
          ))}
          <tr><th scope="row">One portion in all</th><td>{money(total, UNKNOWN)}</td></tr>
        </tbody>
      </table></div>
    </figure>
  )
}
