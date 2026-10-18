import { Suspense } from 'react'
import { Toaster } from '@/components/toaster'
import { BrandLockup } from '@/components/brand-mark'
import { HelpVideoButton } from '@/components/help-video'
import { loadSiteSettings } from '@/lib/data/site'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const site = await loadSiteSettings()
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <h1><BrandLockup size={60} /></h1>
          <HelpVideoButton videos={site.help} />
        </div>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          Know your cost. Know your price. Know your profit.
        </p>
        <div className="mt-8">{children}</div>
      </div>
      {/* "Your session expired — sign in again." arrives here as ?notice=
          and was never shown: the login page reads no search params. */}
      <Suspense fallback={null}><Toaster /></Suspense>
    </main>
  )
}
