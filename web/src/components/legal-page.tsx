import Link from 'next/link'
import { LEGAL } from '@/lib/legal'
import { loadSiteSettings } from '@/lib/data/site'
import { legalFooterParts } from '@/lib/site/settings'

/**
 * The frame every public legal page shares: readable line length, a way back,
 * the date it last changed, and the other legal pages one tap away. No app
 * chrome -- a visitor reading this may have no account. The footer states
 * the company details the admin has entered (Admin -> Website), and only
 * those: a missing one is left out, never shown as a placeholder.
 */
export async function LegalPage({ title, updated = LEGAL.lastUpdated, children }: {
  title: string
  /** When this page last changed; the terms' date unless the page has its own. */
  updated?: string
  children: React.ReactNode
}) {
  const { company } = await loadSiteSettings()
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="mm-tap underline">{LEGAL.productName}</Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
        Last updated {updated}
      </p>

      <div className="legal mt-8 space-y-6 text-[15px] leading-7">{children}</div>

      <footer className="mt-12 border-t pt-4 text-sm" style={{ borderColor: 'var(--mm-line)', color: 'var(--mm-muted)' }}>
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
          <Link href="/terms" className="mm-tap underline">Terms of service</Link>
          <Link href="/refunds" className="mm-tap underline">Refunds and cancellation</Link>
          <Link href="/privacy" className="mm-tap underline">Privacy policy</Link>
          <Link href="/login" className="mm-tap underline">Sign in</Link>
        </nav>
        <p className="mt-3">{legalFooterParts(company).join(' · ')}</p>
      </footer>
    </main>
  )
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold">{children}</h2>
}

/**
 * How to reach us, as a link: the support email when the admin has given
 * one, otherwise the WhatsApp number on the landing page, otherwise plain
 * words. Every sentence that uses it reads correctly with any of the three.
 */
export async function SupportContact() {
  const { company, landing } = await loadSiteSettings()
  if (company.supportEmail) {
    return <a href={`mailto:${company.supportEmail}`} className="underline">{company.supportEmail}</a>
  }
  if (landing.whatsapp) {
    return <a href={`https://wa.me/${landing.whatsapp}`} className="underline" target="_blank" rel="noopener noreferrer">us on WhatsApp (+{landing.whatsapp})</a>
  }
  return <>our support team</>
}
