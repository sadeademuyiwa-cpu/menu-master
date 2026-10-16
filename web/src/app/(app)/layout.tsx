import Link from 'next/link'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EntitlementBanner } from '@/components/entitlement-banner'
import { PrimaryNav } from '@/components/primary-nav'
import { QuickAdd } from '@/components/quick-add'
import { Toaster } from '@/components/toaster'
import { AppIcon } from '@/components/icons'
import { BrandMark } from '@/components/brand-mark'

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
    <div className="mm-shell min-h-dvh">
      {/* A sidebar from lg: the five destinations down the left, the business
          at the top, the account at the bottom. Below lg the header and the
          bottom bar carry the same five. */}
      <aside className="mm-sidebar">
        <Link href="/dashboard" className="mb-3 flex min-h-[44px] items-center gap-2.5 px-2 font-semibold tracking-tight" title="Menu Master NG">
          <BrandMark />
          <span className="truncate">{businessName ?? 'Menu Master'}</span>
        </Link>
        <PrimaryNav variant="sidebar" />
        <div className="mt-auto grid gap-1 border-t pt-3" style={{ borderColor: 'var(--mm-line)' }}>
          <Link href="/settings" className="mm-nav-side"><AppIcon name="settings" size={20} /><span>Settings</span></Link>
          <Link href="/account" className="mm-nav-side"><AppIcon name="account" size={20} /><span>Account</span></Link>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="mm-app-header">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Link
              href="/dashboard"
              className="flex min-h-[44px] min-w-0 items-center gap-2.5 font-semibold tracking-tight lg:invisible"
              title="Menu Master NG"
            >
              <BrandMark />
              <span className="truncate">{businessName ?? 'Menu Master'}</span>
            </Link>

            <div className="mm-shell-header-nav"><PrimaryNav variant="header" /></div>

            <Link
              href="/account"
              className="mm-account-chip lg:hidden"
              title="Your account"
              aria-label="Your account"
            >
              <AppIcon name="account" size={19} />
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
        <QuickAdd />

        <Suspense fallback={null}><Toaster /></Suspense>
      </div>
    </div>
  )
}
