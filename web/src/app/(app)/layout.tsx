import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EntitlementBanner } from '@/components/entitlement-banner'
import { PrimaryNav } from '@/components/primary-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-dvh flex flex-col">
      <header
        className="sticky top-0 z-10 border-b px-4 py-3"
        style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-bg)' }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Menu Master NG
          </Link>

          {/* DESKTOP NAVIGATION, in the header where a desktop user looks for
              it. Below `sm` it is display:none -- so it leaves the
              accessibility tree too -- and the fixed bar at the bottom takes
              over. Exactly one of the two is ever shown to a given viewport. */}
          <PrimaryNav variant="header" />

          {/* One element, always rendered. It truncates rather than
              disappearing at any width, so there is no band where the
              signed-in address is silently absent. */}
          <span className="min-w-0 truncate text-xs" style={{ color: 'var(--mm-muted)' }}>
            {user.email}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 pb-24 sm:pb-6">
        <EntitlementBanner />
        {children}
      </main>

      {/* MOBILE NAVIGATION, thumb-reachable at the bottom. Hidden from `sm`
          upward, where the header carries the same five destinations.
          Previously this was `sm:static`, which did not move the bar into the
          header on a desktop -- it simply left it below the page content, so a
          desktop read as a stretched phone. */}
      <div
        className="fixed inset-x-0 bottom-0 border-t sm:hidden"
        style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-bg)' }}
      >
        <PrimaryNav variant="bottom" />
      </div>
    </div>
  )
}
