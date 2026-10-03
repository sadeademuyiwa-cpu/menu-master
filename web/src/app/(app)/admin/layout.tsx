import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/data/admin'
import { AdminNav } from './admin-nav'

export const dynamic = 'force-dynamic'

/**
 * The platform administrator's pages.
 *
 * A courtesy gate: a customer who types /admin is sent home rather than shown
 * an empty shell. The lock is in the database -- every fn_admin_* function
 * refuses a non-admin with 42501 before it reads -- so this check protects
 * nothing and may be generous.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformAdmin())) redirect('/dashboard')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Platform</h1>
        <Link href="/more" className="mm-tap text-sm underline" style={{ color: 'var(--mm-muted)' }}>
          ← Back to the app
        </Link>
      </div>
      <AdminNav />
      {children}
    </div>
  )
}
