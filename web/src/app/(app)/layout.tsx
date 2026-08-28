import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EntitlementBanner } from '@/components/entitlement-banner'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/ingredients', label: 'Ingredients' },
  { href: '/recipes', label: 'Recipes' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/reports', label: 'Reports' },
  { href: '/account', label: 'Account' },
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
          <span className="truncate text-xs" style={{ color: 'var(--mm-muted)' }}>
            {user.email}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 pb-24 sm:pb-6">
        <EntitlementBanner />
        {children}
      </main>

      {/* Mobile: bottom nav. Desktop: the same links inline. Built together,
          not retrofitted. */}
      <nav
        className="fixed inset-x-0 bottom-0 border-t sm:static sm:border-t-0"
        style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-bg)' }}
      >
        <ul className="mx-auto flex max-w-5xl overflow-x-auto">
          {NAV.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className="block whitespace-nowrap px-3 py-3 text-center text-xs sm:text-sm"
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
