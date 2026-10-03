import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { InvitationStatus, Role } from '@/lib/people/format'

/**
 * The people on an account. Every function here is a SECURITY DEFINER
 * function in the database (0056) that decides for itself who may call it:
 * an owner for invitations and changes, any member for the list. The page
 * offers only what the caller's role allows; the database refuses the rest.
 * Null when 0056 is not applied.
 */
export type Member = { user_id: string; email: string | null; role: Role; since: string; is_you: boolean }
export type Invitation = {
  invitation_id: string; email: string; role: Role; created_at: string; expires_at: string
  accepted_at: string | null; revoked_at: string | null; status: InvitationStatus; token: string | null
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(fn, args)
  if (error || data === null || data === undefined) return null
  return data as T
}

export const listMembers = (accountId: string) => rpc<Member[]>('fn_list_members', { p_account_id: accountId })
export const listInvitations = (accountId: string) => rpc<Invitation[]>('fn_list_invitations', { p_account_id: accountId })

/**
 * Every open invitation addressed to the signed-in user's own email becomes
 * a membership. Returns how many, or null when the function is absent.
 */
export async function acceptInvitations(): Promise<number | null> {
  const r = await rpc<{ accepted: number }>('fn_accept_invitations')
  return r ? r.accepted : null
}
