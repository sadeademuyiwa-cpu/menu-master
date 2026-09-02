import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EntitlementBanner } from '@/components/entitlement-banner'

/**
 * Five primary destinations, not ten.
 *
 * Ten equally weighted items did not fit a 360px phone: the bar scrolled, and
 * the last entries sat off-screen behind a gesture most owners never make.
 * These five are the daily journey -- see, sell, buy, make, everything else --
 * and each remaining page is reached from the one it belongs to: Ingredients
 * from Purchases and Recipes, Customers from Sales, Suppliers from Purchases,
 * Formats from Recipes, Account from Settings.
 *
 * Sales took the fifth slot from Ingredients. Recording what you sold is a
 * daily act; opening the ingredient list is not, now that purchases are what
 * set prices.
 */
const NAV = [
  { href: '/dashboard', label: 'Home' },
  { href: '/sales', label: 'Sales' },
  { href: '/purchases', label: 'Purchases' },
  { href: '/recipes', label: 'Recipes' },
  { href: '/more', label: 'More' },
]

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
              it. Below `sm` this is display:none -- so it is out of the
              accessibility tree too -- and the fixed bar at the bottom takes
              over. Exactly one of the two is ever rendered to a given
              viewport; they are never both visible. */}
          <nav aria-label="Primary" className="hidden sm:block">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="mm-tap block whitespace-nowrap rounded px-3 py-1.5 text-sm"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* One element, always rendered, as before. It truncates rather than
              disappearing at any width, so there is no band where the signed-in
              address is silently absent. */}
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
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 border-t sm:hidden"
        style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-bg)' }}
      >
        <ul className="mx-auto flex max-w-5xl">
          {NAV.map((item) => (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                /* Five destinations at a legible size. Six at 11px ran into
                   each other on a 360px screen: "IngredientsPurchases". */
                className="mm-tap block w-full justify-center whitespace-nowrap px-1 text-center text-xs"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
