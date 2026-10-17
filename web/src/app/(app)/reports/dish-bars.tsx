import { money } from '@/lib/format'
import type { DishBar } from './report-data'

const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * Dishes as horizontal bars, longest first: what each one kept (the roles
 * that see costs), what it brought in (sales), or how many were sold
 * (kitchen, who sees no money). One scale for all of them.
 *
 * A dish whose kept figure is not known yet gets a hatched track and the
 * words "not known yet" -- never an empty bar, which would read as nothing
 * kept. A loss is a grey bar with its minus sign; a chart is not a warning,
 * so there is no red here.
 *
 * The names and figures are ordinary text in a list, so a screen reader reads
 * them as they are; the bars themselves are hidden from it.
 */
export function DishBars({ bars, kind, ariaLabel }: {
  bars: DishBar[]
  kind: 'kept' | 'sold' | 'units'
  /** "What each dish kept, since you started." */
  ariaLabel: string
}) {
  if (bars.length === 0) return null
  const most = Math.max(0, ...bars.map((b) => (known(b.value) ? Math.abs(b.value) : 0))) || 1
  const say = (v: number) => (kind === 'units' ? `${v.toLocaleString('en-NG')} sold` : money(v))

  return (
    <figure className="mm-chart">
      <ul className="mm-hbars" aria-label={ariaLabel}>
        {bars.map((b) => (
          <li key={b.id}>
            <div className="mm-hbar-head">
              <span>{b.name}</span>
              {known(b.value) ? <span>{say(b.value)}</span> : <span className="mm-absent font-normal">not known yet</span>}
            </div>
            <div className="mm-hbar-track" data-unknown={known(b.value) ? undefined : 'true'} aria-hidden="true">
              {known(b.value) && b.value !== 0 && (
                <div
                  className="mm-hbar-fill"
                  data-kind={b.value < 0 ? 'loss' : kind === 'kept' ? undefined : 'sold'}
                  style={{ width: `${(Math.abs(b.value) / most) * 100}%` }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </figure>
  )
}
