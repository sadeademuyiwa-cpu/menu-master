import Link from 'next/link'
import { AppIcon, type IconName } from '@/components/icons'
import type { Attention } from '@/lib/admin/overview'

/**
 * The admin's building blocks (styles in ./admin.css). Server components:
 * nothing here needs the browser.
 */

export type Tone = 'critical' | 'warn' | 'good' | 'neutral'

/** Every page's header: what this page is, said in full, and its one or two actions. */
export function AdminPage({ title, description, meta, actions, up, children }: {
  title: string
  description?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  /** The page above this one, for a phone (a laptop has the trail in the top bar). */
  up?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <>
      {up && (
        <Link href={up.href} className="ad-up">
          <AppIcon name="arrow-left" size={16} />
          <span>{up.label}</span>
        </Link>
      )}
      <header className="ad-head">
        <div className="min-w-0">
          <h1 className="ad-title">{title}</h1>
          {description && <p className="ad-desc">{description}</p>}
          {meta && <p className="ad-meta">{meta}</p>}
        </div>
        {actions && <div className="ad-actions">{actions}</div>}
      </header>
      <div className="ad-stack">{children}</div>
    </>
  )
}

export function Panel({ title, description, action, id, children, flush = false, foot }: {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  id?: string
  /** No inner padding: for a table or a list that runs edge to edge. */
  flush?: boolean
  foot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="ad-panel" id={id}>
      {(title || action) && (
        <div className="ad-panel-head">
          <div className="min-w-0">
            {title && <h2 className="ad-panel-title">{title}</h2>}
            {description && <p className="ad-panel-desc">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {flush ? children : <div className="ad-panel-body">{children}</div>}
      {foot && <div className="ad-panel-foot">{foot}</div>}
    </section>
  )
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="ad-kpis">{children}</div>
}

export function Kpi({ label, value, sub, tone, href }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: Tone
  href?: string
}) {
  const body = (
    <>
      <span className="ad-kpi-label">{label}</span>
      <span className="ad-kpi-value">{value}</span>
      {sub && <span className="ad-kpi-sub">{sub}</span>}
    </>
  )
  return href
    ? <Link href={href} className="ad-kpi" data-tone={tone}>{body}</Link>
    : <div className="ad-kpi" data-tone={tone}>{body}</div>
}

/** A status in a word, with a dot: never colour alone. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className="ad-pill" data-tone={tone === 'neutral' ? undefined : tone}>{children}</span>
}

const ATTN_WORDS: Record<Attention['tone'], string> = { critical: 'Critical', warn: 'Needs action', info: 'Info' }
const ATTN_TONE: Record<Attention['tone'], Tone> = { critical: 'critical', warn: 'warn', info: 'neutral' }
/** Rows shown before "Show N more": enough for the urgent ones, short enough to read at a glance. */
const ATTN_SHOWN = 5

function AttentionRow({ a }: { a: Attention }) {
  return (
    <li>
      <Link href={a.href} className="ad-attn-row" data-tone={a.tone}>
        <span className="ad-attn-main">
          <span className="ad-attn-title">
            <Pill tone={ATTN_TONE[a.tone]}>{ATTN_WORDS[a.tone]}</Pill>
            <span>{a.title}</span>
          </span>
          <span className="ad-attn-detail">{a.detail}</span>
        </span>
        <span className="ad-attn-go">
          <span className="ad-attn-go-words">{a.action}</span>
          <AppIcon name="chevron-right" size={16} />
        </span>
      </Link>
    </li>
  )
}

/** "Needs attention": one row per thing, most urgent first; "All clear" when there is nothing. */
export function AttentionList({ items, checkedAt }: { items: Attention[]; checkedAt: string }) {
  if (items.length === 0) {
    return (
      <div className="ad-clear">
        <span className="ad-clear-icon" aria-hidden><AppIcon name="check" size={18} /></span>
        <div>
          <p className="font-semibold">All clear</p>
          <p className="ad-small ad-muted">Nothing open needs you. {checkedAt}. The alert scan runs every hour.</p>
        </div>
      </div>
    )
  }
  const rest = items.slice(ATTN_SHOWN)
  return (
    <>
      <ul className="ad-attn">
        {items.slice(0, ATTN_SHOWN).map((a) => <AttentionRow key={a.key} a={a} />)}
      </ul>
      {rest.length > 0 && (
        <details className="ad-attn-more">
          {/* The button stays where it was pressed, so focus stays on it and it folds the list back. */}
          <summary>
            <span className="ad-more-shut">Show {rest.length} more</span>
            <span className="ad-more-open">Show fewer</span>
          </summary>
          <ul className="ad-attn" style={{ borderTop: '1px solid var(--ad-line)' }}>
            {rest.map((a) => <AttentionRow key={a.key} a={a} />)}
          </ul>
        </details>
      )}
    </>
  )
}

export type Column<T> = {
  label: string
  cell: (r: T) => React.ReactNode
  /** Right-aligned, tabular figures. */
  num?: boolean
  nowrap?: boolean
  /** The cell that names the row: first on a phone, without a label. */
  primary?: boolean
  /** Only when the panel is wide (over 900px): header and cells both go below that. */
  wide?: boolean
}

/**
 * A real table in a wide panel; in a narrow one (a phone) each row becomes a
 * short block. One set of markup either way -- never a second copy for the
 * phone. The roles are spelled out because Safari drops a table's meaning
 * once its cells are display: block.
 */
export function DataTable<T>({ columns, rows, keyOf, empty, caption }: {
  columns: Column<T>[]
  rows: T[]
  keyOf: (r: T) => string
  empty: React.ReactNode
  caption?: string
}) {
  if (rows.length === 0) return <p className="ad-table-empty">{empty}</p>
  return (
    <div className="ad-table-wrap">
      <table className="ad-table" role="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((c) => (
              <th key={c.label} scope="col" role="columnheader" data-wide={c.wide || undefined} className={c.num ? 'ad-num' : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((r) => (
            <tr key={keyOf(r)} role="row">
              {columns.map((c) => (
                <td key={c.label} role="cell" data-label={c.label} data-primary={c.primary || undefined} data-wide={c.wide || undefined}
                    className={[c.num && 'ad-num', c.nowrap && 'ad-nowrap'].filter(Boolean).join(' ') || undefined}>
                  {/* One box, so a stacked phone row is exactly label + value. */}
                  <div className="ad-td-val">{c.cell(r)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** An owner's address to write to; a narrow column breaks it after the @, not mid-word. */
export function Email({ address }: { address: string | null }) {
  if (!address) return <>no owner email</>
  const at = address.indexOf('@')
  return (
    <a href={`mailto:${address}`}>
      {at > 0 ? <>{address.slice(0, at)}@<wbr />{address.slice(at + 1)}</> : address}
    </a>
  )
}

/** The name of a row and a quieter line under it. */
export function Cell({ main, sub }: { main: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <>
      <div className="ad-cell-main">{main}</div>
      {sub && <div className="ad-cell-sub">{sub}</div>}
    </>
  )
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="ad-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Shares of a whole as one bar, with a legend that carries the numbers. */
export function StackBar({ parts, label }: { parts: { label: string; n: number; colour: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.n, 0)
  return (
    <div>
      <div className="ad-stackbar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.n} ${p.label}`).join(', ')}`}>
        {total > 0 && parts.filter((p) => p.n > 0).map((p) => (
          <span key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.colour }} />
        ))}
      </div>
      <div className="ad-legend">
        {parts.map((p) => (
          <span key={p.label}><i style={{ background: p.colour }} aria-hidden /><b className="tabular-nums">{p.n}</b> {p.label}</span>
        ))}
      </div>
    </div>
  )
}

/** One bar a day, oldest on the left; an empty day is a flat line, not a gap. */
export function DayBars({ series, label, format }: {
  series: { day: string; n: number }[]
  label: string
  format: (day: string) => string
}) {
  const top = Math.max(1, ...series.map((p) => p.n))
  const last = series.length - 1
  return (
    <figure>
      <div className="ad-bars" aria-hidden>
        {series.map((p, i) => (
          <span key={p.day} className="ad-bar" title={`${format(p.day)}: ${p.n}`}
                data-zero={p.n === 0 || undefined} data-today={i === last || undefined}
                style={{ height: `${Math.max(4, (p.n / top) * 100)}%` }} />
        ))}
      </div>
      {series.length > 0 && (
        <div className="ad-bars-axis" aria-hidden>
          <span>{format(series[0].day)}</span>
          <span>Today</span>
        </div>
      )}
      {/* Wrapped: sr-only on a <table> itself does not shrink it, and the
          full-height table pushed the page 130px past its end. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>{series.map((p) => <tr key={p.day}><th scope="row">{format(p.day)}</th><td>{p.n}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  )
}

/** Tabs that are links: "Open | All", "7 | 30 | 90 days". */
export function Segmented({ options, label }: { options: { href: string; label: string; current: boolean }[]; label: string }) {
  return (
    <nav className="ad-seg" aria-label={label}>
      {options.map((o) => (
        <Link key={o.href} href={o.href} aria-current={o.current ? 'page' : undefined}>{o.label}</Link>
      ))}
    </nav>
  )
}

/**
 * A settings area: on the left what it is, where it shows and what visitors
 * see now; on the right the form. Stacks on a phone.
 */
export function SettingsSection({ title, description, appearsOn, now, id, children }: {
  title: string
  description?: React.ReactNode
  appearsOn?: { label: string; href: string }[]
  now?: React.ReactNode
  id?: string
  children: React.ReactNode
}) {
  return (
    <section className="ad-set" id={id}>
      <div>
        <h2 className="ad-set-title">{title}</h2>
        {description && <p className="ad-set-desc">{description}</p>}
        <div className="ad-set-meta">
          {now && (
            <div className="ad-now">
              <span className="ad-now-label">What visitors see now</span>
              {now}
            </div>
          )}
          {appearsOn && appearsOn.length > 0 && (
            <p className="ad-appears">
              Appears on{' '}
              {appearsOn.map((a, i) => (
                <span key={a.href + a.label}>
                  {i > 0 && ', '}
                  <Link href={a.href} target="_blank" rel="noopener">{a.label}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** A form's own panel, with the save bar that stays in reach at the bottom. */
export function FormPanel({ children, stamp, actions }: {
  children: React.ReactNode
  stamp?: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className="ad-form">
      <div className="ad-form-body">{children}</div>
      <div className="ad-savebar">
        <span className="ad-savebar-stamp">{stamp}</span>
        <span className="flex flex-wrap gap-2">{actions}</span>
      </div>
    </div>
  )
}

/** The save bar under a form made of several sections: one Save for the lot. */
export function SaveBar({ stamp, children }: { stamp?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ad-savebar" data-solo>
      <span className="ad-savebar-stamp">{stamp}</span>
      <span className="flex flex-wrap gap-2">{children}</span>
    </div>
  )
}

/** A form's fields in a panel, without a save bar of its own (see SaveBar). */
export function FieldPanel({ children }: { children: React.ReactNode }) {
  return <div className="ad-form"><div className="ad-form-body">{children}</div></div>
}

/** "Open the page on the website": always a new tab, so the form stays. */
export function ViewOnSite({ href, children = 'View on the website' }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className="mm-btn mm-btn-secondary">
      <span>{children}</span>
      <AppIcon name="arrow-right" size={16} />
    </Link>
  )
}

export function AreaIcon({ name }: { name: IconName }) {
  return <span className="ad-area-icon" aria-hidden><AppIcon name={name} size={19} /></span>
}
