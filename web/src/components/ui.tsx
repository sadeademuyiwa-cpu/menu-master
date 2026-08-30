import Link from 'next/link'

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header>
      <h1 className="text-xl font-semibold">{title}</h1>
      {sub && <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{sub}</p>}
    </header>
  )
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--mm-line)' }}>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mm-absent text-sm">{children}</p>
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm">{label}</span>
      {children}
    </label>
  )
}

export const inputClass = 'mt-1 w-full rounded border px-3 py-2 text-base'
export const inputStyle = { borderColor: 'var(--mm-line)', background: 'transparent' }

export function Submit({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="rounded px-3 py-2.5 text-base font-medium text-white"
      style={{ background: 'var(--mm-accent)' }}
    >
      {children}
    </button>
  )
}

/**
 * Wide numeric tables collapse to labelled cards on mobile rather than
 * scrolling horizontally: a horizontally scrolled margin column is a
 * misreading risk, not merely inconvenient (frontend blueprint section 5).
 */
export function DataList<T>({
  rows, keyOf, render, empty,
}: {
  rows: T[]
  keyOf: (r: T) => string
  render: (r: T) => { label: string; value: React.ReactNode }[]
  empty: string
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={keyOf(r)}>
          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              {render(r).map((f, i) => (
                <div key={i} className="contents">
                  <dt style={{ color: 'var(--mm-muted)' }}>{f.label}</dt>
                  <dd className="tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </li>
      ))}
    </ul>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-sm underline">{children}</Link>
}

/**
 * A refusal the customer can act on. Used wherever the database declined to
 * produce a truthful answer -- a missing price, a missing conversion, a write
 * the entitlement gate refused. Never used to dress up a value we guessed.
 */
export function Notice({ children, tone = 'warn' }: {
  children: React.ReactNode
  tone?: 'warn' | 'info'
}) {
  return (
    <div
      role="status"
      className="rounded border px-3 py-2 text-sm"
      style={{
        borderColor: tone === 'warn' ? 'var(--mm-warn)' : 'var(--mm-line)',
        color: tone === 'warn' ? 'var(--mm-warn)' : 'inherit',
      }}
    >
      {children}
    </div>
  )
}

/** A single figure with its label. Wraps to one column on a phone. */
export function Stat({ label, value, sub }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--mm-line)' }}>
      <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>{label}</div>
      <div className="mt-1 text-lg font-medium tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>{sub}</div>}
    </div>
  )
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">{children}</div>
}

/** Destructive-ish inline action inside a list row. */
export function InlineSubmit({ children }: { children: React.ReactNode }) {
  return (
    <button type="submit" className="text-sm underline" style={{ color: 'var(--mm-muted)' }}>
      {children}
    </button>
  )
}

export function SectionHeading({ children, sub }: {
  children: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-base font-medium">{children}</h2>
      {sub && <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{sub}</p>}
    </div>
  )
}

/** The one number a customer came for. Larger than everything around it. */
export function HeroStat({ label, value, sub, tone = 'plain' }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'plain' | 'good' | 'bad' | 'warn'
}) {
  const colour =
    tone === 'good' ? 'var(--mm-accent)' :
    tone === 'bad' ? 'var(--mm-warn)' :
    tone === 'warn' ? 'var(--mm-warn)' : 'inherit'
  return (
    <div className="rounded border p-4" style={{ borderColor: 'var(--mm-line)' }}>
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--mm-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums" style={{ color: colour }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{sub}</div>}
    </div>
  )
}

/** A proportional bar. Rendered only for costs that are actually tracked. */
export function CostBar({ parts }: {
  parts: { label: string; amount: number; pct: number }[]
}) {
  if (parts.length === 0) return null
  const shade = ['var(--mm-accent)', 'var(--mm-warn)', 'var(--mm-muted)', 'var(--mm-line)']
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded" style={{ background: 'var(--mm-line)' }}>
        {parts.map((p, i) => (
          <div key={p.label} style={{ width: `${p.pct}%`, background: shade[i % shade.length] }} />
        ))}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full"
              style={{ background: shade[i % shade.length] }} />
            <span className="flex-1">{p.label}</span>
            <span className="tabular-nums">{p.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Collapsible on a phone, open on a wide screen. No JavaScript required. */
export function Disclosure({ summary, children, open = false }: {
  summary: React.ReactNode
  children: React.ReactNode
  open?: boolean
}) {
  return (
    <details open={open} className="rounded border" style={{ borderColor: 'var(--mm-line)' }}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{summary}</summary>
      <div className="border-t px-3 py-3" style={{ borderColor: 'var(--mm-line)' }}>
        {children}
      </div>
    </details>
  )
}

/**
 * A short state word with a colour. Used for per-ingredient status on the
 * costing worksheet and for the recipe's pricing verdict, so the same state
 * always looks the same wherever it appears.
 */
export function Badge({ tone = 'plain', children }: {
  tone?: 'plain' | 'good' | 'warn' | 'bad' | 'muted'
  children: React.ReactNode
}) {
  const colour =
    tone === 'good' ? 'var(--mm-accent)' :
    tone === 'bad' || tone === 'warn' ? 'var(--mm-warn)' :
    tone === 'muted' ? 'var(--mm-muted)' : 'inherit'
  return (
    <span
      className="inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: colour, color: colour }}
    >
      {children}
    </span>
  )
}
