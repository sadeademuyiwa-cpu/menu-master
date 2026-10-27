import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { adminAlerts, adminCheckins, adminHelp, adminLive, adminSubscriptions, isPlatformAdmin } from '@/lib/data/admin'
import { paidRows, payState } from '@/lib/admin/overview'
import { Toaster } from '@/components/toaster'
import { AdminNav, AdminTopbar, type NavCounts } from './_ui/shell'
import './_ui/admin.css'

export const dynamic = 'force-dynamic'

/**
 * The platform administrator's own shell -- not the customer app's. The
 * customer sidebar, trial banner, "+" button and bottom bar belong to a
 * restaurant owner's day and are left behind with app/(app)/layout.tsx;
 * here a dark sidebar says "you are in admin" and the pages get the width.
 *
 * A courtesy gate: a customer who types /admin is sent home rather than shown
 * an empty shell. The lock is in the database -- every fn_admin_* function
 * refuses a non-admin with 42501 before it reads -- so this check protects
 * nothing and may be generous.
 *
 * The sidebar's counts are awaited here, not streamed: a Suspense boundary
 * in this layout would sit above every admin form that redirects back to
 * itself, and those stall (components/skeleton.tsx). Both reads are
 * cache()d, so a page asking the same question does not ask twice.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await isPlatformAdmin())) redirect('/dashboard')

  const counts = await navCounts()
  const email = user.email ?? null

  return (
    <div className="mm-admin">
      <div className="ad-shell">
        <aside className="ad-side">
          <AdminNav counts={counts} email={email} />
        </aside>
        <div className="ad-main">
          <AdminTopbar counts={counts} email={email} />
          <main className="ad-content">{children}</main>
        </div>
      </div>
      <Suspense fallback={null}><Toaster /></Suspense>
    </div>
  )
}

/**
 * Badges only where there is something to do -- open alerts, paying accounts
 * in trouble, owners to check in with, help waiting for an answer -- and how
 * many people are in the app this minute.
 */
async function navCounts(): Promise<NavCounts> {
  const [alerts, subs, checkins, live, help] = await Promise.all([
    adminAlerts(true), adminSubscriptions(), adminCheckins(), adminLive(), adminHelp(),
  ])
  const counts: NavCounts = {}
  if (live && live.live > 0) counts.live = { n: live.live, tone: 'neutral', label: 'people in the app now' }
  const waiting = help?.open_count ?? 0
  if (waiting > 0) counts.feedback = { n: waiting, tone: 'warn', label: 'help requests waiting' }
  const owners = new Set((checkins?.due ?? []).map((d) => d.account_id)).size
  if (owners > 0) counts.signups = { n: owners, tone: 'neutral', label: 'owners to check in with' }
  if (alerts && alerts.open > 0) {
    counts.alerts = {
      n: alerts.open,
      tone: alerts.critical > 0 ? 'critical' : 'warn',
      label: alerts.critical > 0 ? `open alerts, ${alerts.critical} critical` : 'open alerts',
    }
  }
  if (subs) {
    const now = new Date()
    const trouble = paidRows(subs.rows).filter((r) => ['locked', 'past_due', 'overdue'].includes(payState(r, now))).length
    if (trouble > 0) counts.subscriptions = { n: trouble, tone: 'warn', label: 'paying accounts need a look' }
  }
  return counts
}
