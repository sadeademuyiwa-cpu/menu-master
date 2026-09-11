import Link from 'next/link'
import { Button } from '@/components/button'
import { AppIcon, type IconName } from '@/components/icons'

function titleIcon(title: string): IconName {
  const t = title.toLowerCase()
  if (t.includes('sale')) return 'sales'
  if (t.includes('purchase')) return 'purchases'
  if (t.includes('recipe')) return 'recipes'
  if (t.includes('ingredient')) return 'ingredients'
  if (t.includes('customer')) return 'customers'
  if (t.includes('price')) return 'pricing'
  if (t.includes('format') || t.includes('size')) return 'formats'
  if (t.includes('report')) return 'reports'
  if (t.includes('people') || t.includes('team')) return 'people'
  if (t.includes('account') || t.includes('plan')) return 'account'
  if (t.includes('setting') || t.includes('cost')) return 'settings'
  if (t.includes('admin')) return 'admin'
  return 'store'
}

function InfoHint({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <details className="mm-info relative shrink-0">
      <summary className="mm-icon-btn" aria-label={label} title={label}>
        <AppIcon name="info" size={18} />
      </summary>
      <div className="mm-info-popover">{children}</div>
    </details>
  )
}

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="mm-page-icon" aria-hidden>
          <AppIcon name={titleIcon(title)} size={21} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        </div>
      </div>
      {sub && <InfoHint label={`About ${title}`}>{sub}</InfoHint>}
    </header>
  )
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="mm-card">{children}</div>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mm-empty">
      <span className="mm-empty-icon"><AppIcon name="info" size={18} /></span>
      <p>{children}</p>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

export const inputClass = 'mm-input mt-1'
export const inputStyle = undefined

export function Submit({ children }: { children: React.ReactNode }) {
  return <Button>{children}</Button>
}

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
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={keyOf(r)}>
          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              {render(r).map((f, i) => (
                <div key={i}>
                  <dt className="text-xs" style={{ color: 'var(--mm-muted)' }}>{f.label}</dt>
                  <dd className="mt-0.5 tabular-nums font-medium">{f.value}</dd>
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
  return (
    <Link href={href} className="mm-back-link">
      <AppIcon name="arrow-left" size={17} />
      <span>{children}</span>
    </Link>
  )
}

export function Notice({ children, tone = 'warn' }: {
  children: React.ReactNode
  tone?: 'warn' | 'info'
}) {
  return (
    <div role="status" className="mm-notice" data-tone={tone}>
      <span className="mt-0.5 shrink-0" aria-hidden>
        <AppIcon name={tone === 'warn' ? 'alert' : 'info'} size={19} />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Stat({ label, value, sub }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="mm-stat">
      <div className="text-xs font-medium" style={{ color: 'var(--mm-muted)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>{sub}</div>}
    </div>
  )
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
}

export function InlineSubmit({ children }: { children: React.ReactNode }) {
  return <Button variant="quiet">{children}</Button>
}

export function SectionHeading({ children, sub }: {
  children: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {sub && <InfoHint label="More information">{sub}</InfoHint>}
    </div>
  )
}

export function HeroStat({ label, value, sub, tone = 'plain' }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'plain' | 'good' | 'bad' | 'warn'
}) {
  const colour =
    tone === 'good' ? 'var(--mm-accent)' :
    tone === 'bad' || tone === 'warn' ? 'var(--mm-warn)' : 'inherit'

  return (
    <div className="mm-hero-stat">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
        {label}
      </div>
      <div className="mm-num mt-1 text-xl font-semibold sm:text-2xl" style={{ color: colour }}>{value}</div>
      {sub && <div className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--mm-muted)' }}>{sub}</div>}
    </div>
  )
}

export function CostBar({ parts }: {
  parts: { label: string; amount: number; pct: number }[]
}) {
  if (parts.length === 0) return null
  const shade = ['var(--mm-accent)', 'var(--mm-warn)', 'var(--mm-muted)', 'var(--mm-line)']
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--mm-line)' }}>
        {parts.map((p, i) => (
          <div key={p.label} style={{ width: `${p.pct}%`, background: shade[i % shade.length] }} />
        ))}
      </div>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: shade[i % shade.length] }} />
            <span className="flex-1 truncate">{p.label}</span>
            <span className="tabular-nums">{p.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Disclosure({ summary, children, open = false }: {
  summary: React.ReactNode
  children: React.ReactNode
  open?: boolean
}) {
  return (
    <details open={open} className="mm-disclosure">
      <summary className="mm-tap cursor-pointer list-none px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <AppIcon name="chevron-right" size={16} className="mr-2 transition-transform [details[open]_&]:rotate-90" />
        {summary}
      </summary>
      <div className="border-t px-3 py-3" style={{ borderColor: 'var(--mm-line)' }}>{children}</div>
    </details>
  )
}

export function Badge({ tone = 'plain', children }: {
  tone?: 'plain' | 'good' | 'warn' | 'bad' | 'muted'
  children: React.ReactNode
}) {
  return <span className="mm-badge" data-tone={tone}>{children}</span>
}

export function ActionTile({
  href, icon, label, meta,
}: {
  href: string
  icon: IconName
  label: string
  meta?: React.ReactNode
}) {
  return (
    <Link href={href} className="mm-action-tile">
      <span className="mm-action-icon"><AppIcon name={icon} size={21} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        {meta && <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--mm-muted)' }}>{meta}</span>}
      </span>
      <AppIcon name="chevron-right" size={17} className="shrink-0" style={{ color: 'var(--mm-muted)' }} />
    </Link>
  )
}
