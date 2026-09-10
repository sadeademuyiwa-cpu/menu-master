/**
 * Words for the people screen. Pure -- no React, Next or Supabase -- so the
 * rules are testable alone. The database decides who may do what; this only
 * chooses how to say it and what to offer.
 */

export const ROLES = ['manager', 'kitchen', 'sales', 'accountant'] as const
export type InviteRole = typeof ROLES[number]
export type Role = InviteRole | 'owner'

export const ROLE_WORDS: Record<Role, { label: string; hint: string }> = {
  owner:      { label: 'Owner',      hint: 'Everything, including billing and who is on the account.' },
  manager:    { label: 'Manager',    hint: 'Costs, prices, purchases and sales. Cannot invite or bill.' },
  accountant: { label: 'Accountant', hint: 'Sees costs and reports. Cannot change recipes or record sales.' },
  kitchen:    { label: 'Kitchen',    hint: 'Recipes and purchases. Sees no costs, prices or margins.' },
  sales:      { label: 'Sales',      hint: 'Records sales and customers. Sees no costs or margins.' },
}

export function roleLabel(role: string): string {
  return (ROLE_WORDS as Record<string, { label: string }>)[role]?.label ?? role
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export function statusWords(status: InvitationStatus): { label: string; tone: 'good' | 'warn' | 'muted' | 'plain' } {
  switch (status) {
    case 'pending':  return { label: 'Waiting for them to sign up', tone: 'plain' }
    case 'accepted': return { label: 'Joined', tone: 'good' }
    case 'expired':  return { label: 'Expired', tone: 'warn' }
    case 'revoked':  return { label: 'Withdrawn', tone: 'muted' }
  }
}

/**
 * What the owner sends until a mailer exists. Acceptance is by EMAIL, not by
 * token: the person signs up with the invited address and is in. The link
 * only saves them typing it.
 */
export function inviteLink(siteUrl: string, email: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  return `${base}/signup?email=${encodeURIComponent(email)}`
}

export function inviteMessage(businessName: string, email: string, siteUrl: string): string {
  return `You have been invited to ${businessName} on Menu Master NG. ` +
    `Sign up with ${email} at ${inviteLink(siteUrl, email)} and you will be in.`
}

/** Whether a member row may be changed by the viewer: owners may change anyone but themselves here. */
export function canManage(viewerRole: string | undefined, isSelf: boolean): boolean {
  return viewerRole === 'owner' && !isSelf
}
