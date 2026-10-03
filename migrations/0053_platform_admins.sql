-- ============================================================================
-- MENU MASTER NG
-- 0053: who may look at the platform as a whole
--
-- Requires: 0001-0052 applied.
--
-- WHY
--   Every read in this schema is scoped to the caller's own account. Nothing
--   lets the person who runs the service see billing health, subscriptions or
--   signups across accounts without opening a SQL editor. Part A of
--   docs/PLAN_LAUNCH_PLUS.md adds that view; this migration adds the ONE fact
--   it rests on: a short list of user ids that are platform administrators.
--
-- WHAT IT IS NOT
--   Not a role on an account. A platform admin has no membership by virtue of
--   this table and sees nothing a customer entered -- the admin reads in 0054
--   return billing and subscription facts, never recipes, prices or sales.
--   Not writable by any client role: the table has RLS on and NO policy, like
--   billing_events, so the only way in is the service context (an operator
--   with psql, or deploy/runbook/GRANT_PLATFORM_ADMIN.sql).
--
--   The first admin is NOT inserted here. This file carries no email address:
--   the owner grants the first one at deploy time from the runbook, so the
--   repository never states who administers production.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0053 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_my_has_sales'
                   and pronamespace='public'::regnamespace) then
    raise exception '0053 preflight FAILED: fn_my_has_sales is missing. Apply 0051 first.';
  end if;
  if not exists (select 1 from pg_class where relname='ix_fk_subscriptions_plan_id' and relkind='i') then
    raise exception '0053 preflight FAILED: 0052 is not applied (ix_fk_subscriptions_plan_id missing).';
  end if;
  if exists (select 1 from pg_class where relname='platform_admins' and relnamespace='public'::regnamespace) then
    raise exception '0053 preflight FAILED: platform_admins already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0053 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 77 then
    raise exception '0053 preflight FAILED: fn_* count is %, expected 77.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The list
--
-- Revocation is a timestamp, not a delete: who was an administrator and when
-- is itself a fact worth keeping. DELETE and TRUNCATE are granted to no role.
-- ---------------------------------------------------------------------------
create table platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  reason      text not null,
  revoked_at  timestamptz,
  constraint ck_platform_admins_reason check (length(trim(reason)) > 0)
);

comment on table platform_admins is
  'Who may read platform-wide billing, subscription and signup facts through '
  'the fn_admin_* functions. Service context only: RLS on, no policy, no client '
  'grant. Revoke with revoked_at; rows are never deleted.';

-- every foreign key covered, as 0052 made the rule
create index ix_fk_platform_admins_granted_by on platform_admins (granted_by);

alter table platform_admins enable row level security;
revoke all on platform_admins from public, anon, authenticated;
revoke delete, truncate on platform_admins from service_role;

-- ---------------------------------------------------------------------------
-- 2. The two questions the rest of Part A asks
--
-- fn_is_platform_admin is SECURITY DEFINER because authenticated holds no
-- privilege on the table: the function is the only way a client learns the
-- answer, and it answers only about the caller.
-- ---------------------------------------------------------------------------
create or replace function fn_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from platform_admins a
     where a.user_id = auth.uid()
       and a.revoked_at is null);
$fn$;

revoke all on function fn_is_platform_admin() from public, anon;
grant execute on function fn_is_platform_admin() to authenticated, service_role;

comment on function fn_is_platform_admin() is
  'Whether the signed-in user is an unrevoked platform administrator. Answers '
  'only about the caller. The page uses it to decide whether to offer /admin; '
  'the fn_admin_* functions enforce it themselves and do not rely on the page.';

-- Raising 42501, like fn_require_member: a refusal must be distinguishable
-- from an empty result, or the screen cannot tell a locked door from an empty
-- room. The service context passes, so an operator with psql and a scheduled
-- job can read the same facts.
create or replace function fn_require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if fn_is_service_context() then return; end if;
  if not fn_is_platform_admin() then
    raise exception 'Platform administrator access is required'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function fn_require_platform_admin() from public, anon;
grant execute on function fn_require_platform_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0053 self-check FAILED: 0053 must add no policy (platform_admins has none by design).';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 79 then
    raise exception '0053 self-check FAILED: fn_* count is %, expected 79.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not (select relrowsecurity from pg_class where relname='platform_admins') then
    raise exception '0053 self-check FAILED: RLS is not enabled on platform_admins.';
  end if;
  if has_table_privilege('authenticated','platform_admins','select')
     or has_table_privilege('anon','platform_admins','select') then
    raise exception '0053 self-check FAILED: a client role can read platform_admins.';
  end if;
  if has_table_privilege('service_role','platform_admins','delete') then
    raise exception '0053 self-check FAILED: service_role can delete from platform_admins.';
  end if;
  if has_function_privilege('anon','fn_is_platform_admin()','execute')
     or has_function_privilege('anon','fn_require_platform_admin()','execute') then
    raise exception '0053 self-check FAILED: anon can call an admin helper.';
  end if;
  if (select count(*) from platform_admins) <> 0 then
    raise exception '0053 self-check FAILED: the migration must grant nobody.';
  end if;
  if (select count(*) from founder_slots) <> 100 then
    raise exception '0053 self-check FAILED: founder_slots is no longer 100 rows.';
  end if;
  raise notice '0053 OK: platform_admins (RLS, no policy, no client grant), '
               'fn_is_platform_admin and fn_require_platform_admin added; nobody granted; '
               '117 policies unchanged.';
end
$$;
