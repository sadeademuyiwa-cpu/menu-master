-- ============================================================================
-- MENU MASTER NG
-- 0031: subscription change log -- GATE A
--
-- Authority: D-26 section 6 (the D-25 production updates must be recorded
-- through subscription_changes, not a single-use runbook format) and
-- GATE_A_EXECUTION_PLAN.md step 1.
--
-- Requires: 0001-0030 applied.
--
-- WHY THIS EXISTS
--   subscriptions has no history. Every change to it -- a customer's plan
--   move, a provider event, or an owner-authorised correction -- currently
--   leaves no trace. D-25 cannot extend five real trials auditably until
--   somewhere exists to record what the values were before.
--
-- DELIBERATELY NOT AN EVENT STORE
--   One row per change, with the old and new values of the fields that
--   changed. It does not replay, project or subscribe. If a future need wants
--   event sourcing, that is a different decision made on purpose.
--
-- ADDITIVE. One new table. No existing object is altered.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_class where relname = 'subscription_changes') then
    raise exception '0031 preflight FAILED: subscription_changes already exists.';
  end if;
  if not exists (select 1 from pg_class where relname = 'subscriptions') then
    raise exception '0031 preflight FAILED: subscriptions is missing.';
  end if;
end
$$;

create table subscription_changes (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references subscriptions(id) on delete cascade,
  account_id       uuid not null references accounts(id) on delete cascade,

  change_kind      text not null,          -- 'trial_extended' | 'plan_changed' | ...
  -- Only the fields that actually moved. Reconstructing "what did it look like
  -- before" must not depend on a full row copy that drifts as columns are added.
  previous_values  jsonb not null,
  new_values       jsonb not null,

  -- WHO caused it. An owner-authorised correction is not a customer action and
  -- not a provider event, and the three must stay distinguishable.
  change_source    text not null check (change_source in ('customer','provider','owner','system')),
  authorised_by    text,                   -- required when the source is an owner
  reason           text not null,

  effective_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  constraint ck_subscription_changes_owner_attributed
    check (change_source <> 'owner' or authorised_by is not null),

  -- Belt and braces against a re-run applying the same change twice.
  constraint ux_subscription_changes_event
    unique (subscription_id, effective_at, change_kind)
);

create index on subscription_changes (account_id, created_at desc);
create index on subscription_changes (subscription_id, effective_at desc);

comment on table subscription_changes is
  'Append-only history of subscription changes. UPDATE and DELETE are granted '
  'to no role: a correction is a new row, never a rewrite.';

-- ----------------------------------------------------------------------------
-- APPEND ONLY, ENFORCED TWICE
--   Grants stop the ordinary path; the trigger stops anything holding wider
--   privileges, including a future service-role script.
-- ----------------------------------------------------------------------------
create or replace function fn_guard_subscription_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'subscription_changes is append only. Record a new change instead.'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_subscription_changes_append_only
  before update or delete on subscription_changes
  for each row execute function fn_guard_subscription_changes();

alter table subscription_changes enable row level security;

-- Tenants read their own history. Nobody writes through the client: the rows
-- are written by service context, the same way billing events are.
create policy p_subscription_changes_select on subscription_changes
  for select using (fn_is_account_member(account_id));

revoke all on subscription_changes from anon, authenticated;
grant select on subscription_changes to authenticated;
revoke update, delete, truncate on subscription_changes from service_role;

-- ----------------------------------------------------------------------------
-- SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_priv text; v_pol int;
begin
  if not exists (select 1 from pg_class where relname = 'subscription_changes') then
    raise exception '0031 self-check FAILED: table missing.';
  end if;

  select string_agg(privilege_type, ',' order by privilege_type) into v_priv
    from information_schema.role_table_grants
   where table_name = 'subscription_changes' and grantee = 'authenticated';
  if coalesce(v_priv,'') <> 'SELECT' then
    raise exception '0031 self-check FAILED: authenticated holds % (expected SELECT).', coalesce(v_priv,'nothing');
  end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_name = 'subscription_changes'
                and privilege_type in ('UPDATE','DELETE','TRUNCATE')
                and grantee <> current_user) then
    raise exception '0031 self-check FAILED: a non-owner role can mutate the log.';
  end if;

  select count(*) into v_pol from pg_policies
   where schemaname='public' and tablename='subscription_changes';
  if v_pol <> 1 then
    raise exception '0031 self-check FAILED: expected 1 policy, found %.', v_pol;
  end if;

  raise notice '0031 OK: subscription_changes created, append-only, 1 policy.';
end
$$;
