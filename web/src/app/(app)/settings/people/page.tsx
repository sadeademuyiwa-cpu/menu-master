import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, contextRedirect, describeWriteError, withNotice } from '@/lib/data/context'
import { listMembers, listInvitations } from '@/lib/data/people'
import {
  PageHeader, Card, Field, Submit, InlineSubmit, Notice, Empty, SectionHeading, Badge, BackLink,
} from '@/components/ui'
import { ROLES, ROLE_WORDS, roleLabel, statusWords, inviteLink, inviteMessage, canManage } from '@/lib/people/format'
import { NOT_ENTERED } from '@/lib/format'

export const dynamic = 'force-dynamic'

const here = '/settings/people'
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? 'https://menumasterng.com'

async function invite(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))
  const email = String(formData.get('email') ?? '').trim()
  const role = String(formData.get('role') ?? '')
  if (!email) redirect(withNotice(here, 'Give their email address.'))
  if (!(ROLES as readonly string[]).includes(role)) redirect(withNotice(here, 'Choose a role.'))
  const { error } = await supabase.rpc('fn_invite_member', { p_account_id: accountId, p_email: email, p_role: role })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? `${email} invited. Send them the link below.`))
}

async function revoke(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))
  const { error } = await supabase.rpc('fn_revoke_invitation', { p_invitation_id: String(formData.get('id') ?? '') })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Invitation withdrawn.'))
}

async function setRole(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))
  const { error } = await supabase.rpc('fn_set_member_role', {
    p_account_id: accountId, p_user_id: String(formData.get('user_id') ?? ''), p_role: String(formData.get('role') ?? ''),
  })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Role changed.'))
}

async function remove(formData: FormData) {
  'use server'
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))
  const { error } = await supabase.rpc('fn_remove_member', {
    p_account_id: accountId, p_user_id: String(formData.get('user_id') ?? ''),
  })
  revalidatePath(here)
  redirect(withNotice(here, describeWriteError(error) ?? 'Removed from the account.'))
}

export default async function PeoplePage(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const ctx = await currentContext()
  const { accountId, role, businessName } = ctx
  if (!accountId) redirect(contextRedirect(ctx, here))
  const isOwner = role === 'owner'

  const [members, invitations] = await Promise.all([
    listMembers(accountId),
    isOwner ? listInvitations(accountId) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-8">
      <BackLink href="/settings">← Settings</BackLink>
      <PageHeader title="People" sub="Who works in this business on Menu Master, and what each of them can see." />
      {notice && <Notice tone={/could not|cannot|only an owner|give |choose |already|not an email/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {members === null ? (
        <Notice>Staff management is not available on this database yet (migration 0056).</Notice>
      ) : (
        <section className="space-y-3">
          <SectionHeading>On the account</SectionHeading>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.user_id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{m.email ?? NOT_ENTERED}</span>
                      <Badge tone={m.role === 'owner' ? 'good' : 'plain'}>{roleLabel(m.role)}</Badge>
                      {m.is_you && <span className="text-xs" style={{ color: 'var(--mm-muted)' }}>you</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--mm-muted)' }}>{ROLE_WORDS[m.role]?.hint}</p>
                  {canManage(role, m.is_you) && (
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <form action={setRole} className="flex items-end gap-2">
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <Field label="Change role">
                          <select name="role" defaultValue={m.role} className="mm-input mt-1">
                            {(['owner', ...ROLES] as const).map((r) => (
                              <option key={r} value={r}>{ROLE_WORDS[r].label}</option>
                            ))}
                          </select>
                        </Field>
                        <InlineSubmit>Change</InlineSubmit>
                      </form>
                      <form action={remove}>
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <InlineSubmit>Remove</InlineSubmit>
                      </form>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
          {!isOwner && (
            <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
              Only an owner can invite people or change roles.
            </p>
          )}
        </section>
      )}

      {isOwner && invitations !== null && (
        <>
          <section className="space-y-3">
            <SectionHeading sub="They sign up with this email address and are in — no code to type. Owners are promoted from the list above, never invited.">
              Invite someone
            </SectionHeading>
            <Card>
              <form action={invite} className="grid gap-3 sm:grid-cols-3 sm:items-end">
                <Field label="Their email">
                  <input name="email" type="email" required className="mm-input mt-1" placeholder="cook@example.com" />
                </Field>
                <Field label="Role">
                  <select name="role" defaultValue="sales" className="mm-input mt-1">
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_WORDS[r].label}</option>)}
                  </select>
                </Field>
                <Submit>Invite</Submit>
              </form>
              <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--mm-muted)' }}>
                {ROLES.map((r) => <li key={r}><strong>{ROLE_WORDS[r].label}</strong> — {ROLE_WORDS[r].hint}</li>)}
              </ul>
            </Card>
          </section>

          <section className="space-y-3">
            <SectionHeading sub="Until invitations are emailed automatically, copy the message and send it yourself. A link stops working after seven days.">
              Invitations
            </SectionHeading>
            {invitations.length === 0 ? (
              <Empty>Nobody invited yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {invitations.map((i) => {
                  const s = statusWords(i.status)
                  return (
                    <li key={i.invitation_id}>
                      <Card>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            <span className="truncate">{i.email}</span>
                            <Badge tone="plain">{roleLabel(i.role)}</Badge>
                            <Badge tone={s.tone}>{s.label}</Badge>
                          </span>
                        </div>
                        {i.status === 'pending' && (
                          <>
                            <p className="mt-2 break-all text-xs" style={{ color: 'var(--mm-muted)' }}>
                              {inviteMessage(businessName ?? 'your business', i.email, siteUrl())}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <Link href={inviteLink(siteUrl(), i.email)} className="mm-tap text-sm underline">Open the link</Link>
                              <form action={invite}>
                                <input type="hidden" name="email" value={i.email} />
                                <input type="hidden" name="role" value={i.role} />
                                <InlineSubmit>Renew for 7 days</InlineSubmit>
                              </form>
                              <form action={revoke}>
                                <input type="hidden" name="id" value={i.invitation_id} />
                                <InlineSubmit>Withdraw</InlineSubmit>
                              </form>
                            </div>
                          </>
                        )}
                        {i.status === 'expired' && (
                          <form action={invite} className="mt-2">
                            <input type="hidden" name="email" value={i.email} />
                            <input type="hidden" name="role" value={i.role} />
                            <InlineSubmit>Invite again</InlineSubmit>
                          </form>
                        )}
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
