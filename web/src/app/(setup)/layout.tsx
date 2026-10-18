import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Toaster } from '@/components/toaster'
import { Button } from '@/components/button'
import { signOut } from '@/lib/auth-actions'
import { BrandLockup } from '@/components/brand-mark'
import { HelpVideoButton } from '@/components/help-video'
import { loadSiteSettings } from '@/lib/data/site'

/**
 * First-run setup has no app navigation on purpose: every destination would
 * only send the owner back here until one dish is costed and priced.
 */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const site = await loadSiteSettings()

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="mm-app-header">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-3 px-4">
          <BrandLockup size={44} />
          <div className="flex items-center gap-2">
            <HelpVideoButton videos={site.help} />
            <form action={signOut}>
              <Button variant="quiet" busyLabel="Signing out…">Sign out</Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-6 sm:py-8">
        {children}
      </main>

      <Suspense fallback={null}><Toaster /></Suspense>
    </div>
  )
}
