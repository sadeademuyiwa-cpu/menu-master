import Link from 'next/link'
import { LEGAL } from '@/lib/legal'

/**
 * The frame every public legal page shares: readable line length, a way back,
 * the date it last changed, and the other legal pages one tap away. No app
 * chrome -- a visitor reading this may have no account.
 */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="mm-tap underline">{LEGAL.productName}</Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
        Last updated {LEGAL.lastUpdated}
      </p>

      <div className="legal mt-8 space-y-6 text-[15px] leading-7">{children}</div>

      <footer className="mt-12 border-t pt-4 text-sm" style={{ borderColor: 'var(--mm-line)', color: 'var(--mm-muted)' }}>
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
          <Link href="/terms" className="mm-tap underline">Terms of service</Link>
          <Link href="/refunds" className="mm-tap underline">Refunds and cancellation</Link>
          <Link href="/login" className="mm-tap underline">Sign in</Link>
        </nav>
        <p className="mt-3">
          {LEGAL.legalEntity} · {LEGAL.address} · {LEGAL.supportEmail}
        </p>
      </footer>
    </main>
  )
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold">{children}</h2>
}
