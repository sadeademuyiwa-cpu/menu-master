-- ============================================================================
-- MENU MASTER NG
-- 0056: staff -- an owner invites a person by email, and they land in the
--       right account when they sign up
--
-- Requires: 0001-0055 applied.
--
-- WHY
--   An account has exactly one user: the one who created it. memberships and
--   member_role have existed since 0001 and RLS already distinguishes an
--   owner from a sales member (fn_can_see_costs), but nothing lets a second
--   person in. Part B of docs/PLAN_LAUNCH_PLUS.md.
--
-- HOW
--   invitations         one row per invitation: account, email, role, token,
--                       expiry, and when it was accepted or revoked. Rows are
--                       never deleted: who was invited and what happened is a
--                       fact worth keeping.
--   RLS on, NO policy   like billing_events. The token is a credential; no
--                       client role may read the table. Every read and write
--                       goes through the functions below, each of which
--                       decides for itself who may call it.
--
--   fn_invite_member(account, email, role)   owner only; never an owner role
--   fn_list_invitations(account)             owner only; token shown only
--                                            while pending, so the owner can
--                                            send the link until a mailer exists
--   fn_revoke_invitation(id)                 owner only
--   fn_accept_invitations()                  the SIGNED-IN user: every open,
--                                            unexpired, unrevoked invitation
--                                            whose email is theirs becomes a
--                                            membership. Called once per
--                                            session by the app.
--   fn_list_members(account)                 any member of the account
--   fn_set_member_role(account, user, role)  owner only; the last-owner
--                                            trigger from 0012 still guards
--   fn_remove_member(account, user)          owner only; same guard
--
-- WHAT DOES NOT CHANGE
--   No policy. 117 before and after. Owners are made by promotion
--   (fn_set_member_role), never by invitation -- an invitation is a link in
--   an inbox, and an inbox is not a strong enough credential to hand over an
--   account. A manager may not invite (owner decision, default kept).
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0056 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_admin_scan'
                   and pronamespace='public'::regnamespace) then
    raise exception '0056 preflight FAILED: fn_admin_scan is missing. Apply 0055 first.';
  end if;
  if exists (select 1 from pg_class where relname='invitations' and relnamespace='public'::regnamespace) then
    raise exception '0056 preflight FAILED: invitations already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0056 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 85 then
    raise exception '0056 preflight FAILED: fn_* count is %, expected 85.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_memberships_last_owner') then
    raise exception '0056 preflight FAILED: the last-owner guard (0012) is missing.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  email        text not null,
  role         member_role not null,
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz,
  constraint ck_invitations_email_lower check (email = lower(email) and email like '%_@_%'),
  constraint ck_invitations_not_owner   check (role <> 'owner'),
  constraint ck_invitations_accept_by   check (accepted_at is null or accepted_by is not null)
);

-- at most ONE open invitation per address per account; a revoked or accepted
-- one may be followed by another
create unique index ux_invitations_open on invitations (account_id, email)
  where accepted_at is null and revoked_at is null;
create index ix_invitations_email_open on invitations (email) where accepted_at is null and revoked_at is null;
create index ix_fk_invitations_account_id on invitations (account_id);
create index ix_fk_invitations_invited_by on invitations (invited_by);
create index ix_fk_invitations_accepted_by on invitations (accepted_by);

comment on table invitations is
  'Who an owner invited, with what role, and what became of it. RLS on, no '
  'policy: the token is a credential, so no client role reads this table. '
  'Rows are never deleted.';

alter table invitations enable row level security;
revoke all on invitations from public, anon, authenticated;
revoke delete, truncate on invitations from service_role;

-- ---------------------------------------------------------------------------
-- 2. What an owner may do
-- ---------------------------------------------------------------------------
create or replace function fn_invite_member(p_account_id uuid, p_email text, p_role member_role)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_email text; r invitations%rowtype;
begin
  -- the 0012 primitive: member first, then the role; 42501 either way
  perform fn_require_account_role(p_account_id, array['owner']::member_role[], 'inviting people');
  if p_role = 'owner' then
    raise exception 'An owner cannot be invited. Invite them with another role, then promote them once they are in.'
      using errcode = '22023';
  end if;
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email not like '%_@_%' then
    raise exception 'That is not an email address' using errcode = '22023';
  end if;
  if exists (select 1 from memberships m join auth.users u on u.id = m.user_id
              where m.account_id = p_account_id and lower(u.email) = v_email) then
    raise exception 'That person is already on this account' using errcode = '22023';
  end if;

  -- an open invitation to the same address is renewed, not duplicated
  select * into r from invitations
   where account_id = p_account_id and email = v_email
     and accepted_at is null and revoked_at is null;
  if found then
    update invitations
       set role = p_role, expires_at = now() + interval '7 days', invited_by = auth.uid()
     where id = r.id
     returning * into r;
  else
    insert into invitations (account_id, email, role, invited_by)
    values (p_account_id, v_email, p_role, auth.uid())
    returning * into r;
  end if;

  return jsonb_build_object('invitation_id', r.id, 'email', r.email, 'role', r.role,
                            'token', r.token, 'expires_at', r.expires_at);
end;
$fn$;

revoke all on function fn_invite_member(uuid, text, member_role) from public, anon;
grant execute on function fn_invite_member(uuid, text, member_role) to authenticated, service_role;

create or replace function fn_list_invitations(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  perform fn_require_account_role(p_account_id, array['owner']::member_role[], 'seeing invitations');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'invitation_id', i.id, 'email', i.email, 'role', i.role,
             'created_at', i.created_at, 'expires_at', i.expires_at,
             'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at,
             'status', case when i.accepted_at is not null then 'accepted'
                            when i.revoked_at is not null then 'revoked'
                            when i.expires_at < now() then 'expired'
                            else 'pending' end,
             -- the link is shown only while it can still be used
             'token', case when i.accepted_at is null and i.revoked_at is null and i.expires_at >= now()
                           then i.token end
           ) order by i.created_at desc)
      from invitations i where i.account_id = p_account_id), '[]'::jsonb);
end;
$fn$;

revoke all on function fn_list_invitations(uuid) from public, anon;
grant execute on function fn_list_invitations(uuid) to authenticated, service_role;

create or replace function fn_revoke_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r invitations%rowtype;
begin
  select * into r from invitations where id = p_invitation_id;
  if r.id is null then
    raise exception 'Only an owner can revoke an invitation' using errcode = '42501';
  end if;
  perform fn_require_account_role(r.account_id, array['owner']::member_role[], 'withdrawing an invitation');
  if r.accepted_at is not null then
    raise exception 'That invitation was already accepted. Remove the member instead.' using errcode = '22023';
  end if;
  update invitations set revoked_at = coalesce(revoked_at, now()) where id = r.id returning * into r;
  return jsonb_build_object('invitation_id', r.id, 'email', r.email, 'revoked_at', r.revoked_at);
end;
$fn$;

revoke all on function fn_revoke_invitation(uuid) from public, anon;
grant execute on function fn_revoke_invitation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. What the invited person does: nothing. Signing in is enough.
--
-- The app calls this once per session. Every open invitation addressed to
-- the caller's own login email becomes a membership. The email is read from
-- auth.users, never from the caller -- a client cannot accept someone else's
-- invitation by claiming their address.
-- ---------------------------------------------------------------------------
create or replace function fn_accept_invitations()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_user uuid := auth.uid(); v_email text; v_n int := 0; i record; v_accounts jsonb := '[]'::jsonb;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = v_user;
  if v_email is null then
    return jsonb_build_object('accepted', 0, 'accounts', '[]'::jsonb);
  end if;

  for i in
    select * from invitations
     where email = v_email and accepted_at is null and revoked_at is null and expires_at >= now()
     order by created_at
     for update
  loop
    insert into memberships (account_id, user_id, role)
    values (i.account_id, v_user, i.role)
    on conflict (account_id, business_id, user_id) do nothing;
    update invitations set accepted_at = now(), accepted_by = v_user where id = i.id;
    v_n := v_n + 1;
    v_accounts := v_accounts || jsonb_build_object('account_id', i.account_id, 'role', i.role);
  end loop;
  return jsonb_build_object('accepted', v_n, 'accounts', v_accounts);
end;
$fn$;

revoke all on function fn_accept_invitations() from public, anon;
grant execute on function fn_accept_invitations() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The people on an account
-- ---------------------------------------------------------------------------
create or replace function fn_list_members(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'email', u.email, 'role', m.role,
             'since', m.created_at, 'is_you', m.user_id = auth.uid())
           order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, m.created_at)
      from memberships m join auth.users u on u.id = m.user_id
     where m.account_id = p_account_id and m.business_id is null), '[]'::jsonb);
end;
$fn$;

revoke all on function fn_list_members(uuid) from public, anon;
grant execute on function fn_list_members(uuid) to authenticated, service_role;

create or replace function fn_set_member_role(p_account_id uuid, p_user_id uuid, p_role member_role)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r memberships%rowtype;
begin
  perform fn_require_account_role(p_account_id, array['owner']::member_role[], 'changing a role');
  -- the 0012 trigger refuses to demote the last owner; its message is kept
  update memberships set role = p_role
   where account_id = p_account_id and user_id = p_user_id and business_id is null
   returning * into r;
  if r.id is null then
    raise exception 'That person is not on this account' using errcode = 'P0002';
  end if;
  return jsonb_build_object('user_id', r.user_id, 'role', r.role);
end;
$fn$;

revoke all on function fn_set_member_role(uuid, uuid, member_role) from public, anon;
grant execute on function fn_set_member_role(uuid, uuid, member_role) to authenticated, service_role;

create or replace function fn_remove_member(p_account_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n int;
begin
  perform fn_require_account_role(p_account_id, array['owner']::member_role[], 'removing someone');
  -- the 0012 trigger refuses to delete the last owner
  delete from memberships
   where account_id = p_account_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'That person is not on this account' using errcode = 'P0002';
  end if;
  return jsonb_build_object('user_id', p_user_id, 'removed', true);
end;
$fn$;

revoke all on function fn_remove_member(uuid, uuid) from public, anon;
grant execute on function fn_remove_member(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0056 self-check FAILED: 0056 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 92 then
    raise exception '0056 self-check FAILED: fn_* count is %, expected 92.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not (select relrowsecurity from pg_class where relname='invitations') then
    raise exception '0056 self-check FAILED: RLS is not enabled on invitations.';
  end if;
  if has_table_privilege('authenticated','invitations','select')
     or has_table_privilege('anon','invitations','select') then
    raise exception '0056 self-check FAILED: a client role can read invitations (and its tokens).';
  end if;
  foreach f in array array['fn_invite_member','fn_list_invitations','fn_revoke_invitation',
                           'fn_accept_invitations','fn_list_members','fn_set_member_role','fn_remove_member'] loop
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and has_function_privilege('anon', p.oid, 'execute')) <> 0 then
      raise exception '0056 self-check FAILED: anon can call %.', f;
    end if;
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')) <> 0 then
      raise exception '0056 self-check FAILED: % does not pin search_path.', f;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conname='ck_invitations_not_owner') is false then
    raise exception '0056 self-check FAILED: an owner could be invited.';
  end if;
  raise notice '0056 OK: invitations (RLS, no policy, no client grant) and seven member functions; '
               '117 policies unchanged; owners are promoted, never invited.';
end
$$;
