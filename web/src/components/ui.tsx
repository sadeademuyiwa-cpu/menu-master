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
