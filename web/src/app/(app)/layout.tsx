import Link from 'next/link'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EntitlementBanner } from '@/components/entitlement-banner'
import { PrimaryNav } from '@/components/primary-nav'
import { Toaster } from '@/components/toaster'
import { AppIcon } from '@/components/icons'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // The header names the BUSINESS, not the login. The owner's email address
  // was shown on every page: it wrapped on a 360px phone, and it is the one
  // thing on the screen the owner did not need to be told. One small read,
  // the same the pages make; a login with no business yet sees the app's name.
  const { data: business } = await supabase
    .from('businesses').select('name').is('deleted_at', null)
    .order('created_at').limit(1).maybeSingle<{ name: string }>()
  const businessName = business?.name?.trim() || null

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="mm-app-header">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link
            href="/dashboard"
            className="flex min-h-[44px] min-w-0 items-center gap-2.5 font-semibold tracking-tight"
            title="Menu Master NG"
          >
            <span className="mm-brand-mark" aria-hidden>MM</span>
            <span className="truncate">{businessName ?? 'Menu Master'}</span>
          </Link>

          <PrimaryNav variant="header" />

          <Link
            href="/account"
            className="mm-account-chip"
            title="Your account"
            aria-label="Your account"
          >
            <AppIcon name="account" size={19} />
            <span className="hidden text-xs lg:inline">Account</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-5 pb-28 sm:py-7 md:pb-8">
        <EntitlementBanner />
        {children}
      </main>

      <div className="mm-bottom-nav md:hidden">
        <PrimaryNav variant="bottom" />
      </div>

      <Suspense fallback={null}><Toaster /></Suspense>
    </div>
  )
}
