import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { hasSalesEntitlement, recordingOpen } from '@/lib/data/context'
import { QuickAddMenu } from '@/app/(app)/dashboard/quick-add-menu'
import { quickActions } from '@/app/(app)/dashboard/roles'

/**
 * The raised "+" on a phone, offering only what this person can record:
 * a sale (owner, manager, sales, on a plan with Sales), a purchase (owner,
 * manager, accountant), a dish or an item (owner, manager, kitchen). The
 * roles are the database's own (migrations/0015); app/(app)/dashboard/roles.ts
 * holds them.
 *
 * Decided here on the server, so a phone is never sent a button its role
 * cannot use. Streamed in its own Suspense boundary: the role read never holds
 * up the page, and the "+" appears a moment after it.
 */
export function QuickAdd() {
  return (
    <Suspense fallback={null}>
      <QuickAddForRole />
    </Suspense>
  )
}

async function QuickAddForRole() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // The caller's OWN membership: RLS lets a member read every membership of
  // the account, so the user filter matters (see lib/data/context.ts).
  const [{ data: member }, salesPlan, open] = await Promise.all([
    supabase.from('memberships').select('role').eq('user_id', user.id)
      .order('created_at').limit(1).maybeSingle<{ role: string }>(),
    hasSalesEntitlement(),
    recordingOpen(),
  ])
  if (!member) return null
  return <QuickAddMenu actions={quickActions(member.role, salesPlan, open)} />
}
