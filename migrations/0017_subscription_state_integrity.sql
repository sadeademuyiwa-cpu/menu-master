-- ============================================================================
-- MENU MASTER NG
-- 0017: subscription state integrity
--
-- Closes two defects found while preparing the service-context test (S13):
--
--   1. fn_set_subscription_plan returned success when its UPDATE matched no
--      rows. A billing webhook would record a customer as upgraded while the
--      database still said 'trialing'. Money taken, no entitlement, no error.
--
--   2. subscriptions.status was free text with no CHECK. Any string could be
--      persisted as an entitlement state, including Paystack's own vocabulary
--      or a typo, permanently corrupting the state machine.
--
-- And closes one gap: the one-subscription-per-account rule was enforced by
-- trigger for CLIENTS only, leaving service_role free to create duplicates.
--
-- The canonical states and their transition semantics are documented in
-- docs/SUBSCRIPTION_STATE_MACHINE.md. This migration constrains the SET of
-- values; it deliberately does not enforce transitions between them.
--
-- ADDITIVE. Migrations 0001-0016 are not modified. Idempotent: re-running is
-- a no-op.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PREFLIGHT
--
-- Refuses to apply rather than damaging data. Neither branch deletes, merges
-- nor coerces anything: choosing which duplicate subscription survives, or
-- what an unrecognised status "really meant", is a commercial decision and
-- not one a migration may take on the operator's behalf.
-- ----------------------------------------------------------------------------

do $$
declare
  v_bad     integer;
  v_values  text;
  v_dupes   text;
begin
  select count(*), string_agg(distinct status, ', ' order by status)
    into v_bad, v_values
    from subscriptions
   where status not in ('trialing','active','past_due','cancelled');

  if v_bad > 0 then
    raise exception
      '0017 preflight FAILED: % subscription row(s) hold a status outside the '
      'approved set. Offending values: %. Approved: trialing, active, past_due, '
      'cancelled. Correct these rows deliberately, then re-run. See '
      'docs/SUBSCRIPTION_STATE_MACHINE.md.', v_bad, v_values;
  end if;

  select string_agg(account_id::text || ' (' || n || ' rows)', ', ')
    into v_dupes
    from (select account_id, count(*) as n
            from subscriptions group by account_id having count(*) > 1) d;

  if v_dupes is not null then
    raise exception
      '0017 preflight FAILED: account(s) hold more than one subscription: %. '
      'The unique index cannot be created until exactly one row per account '
      'remains. Decide which survives before re-running.', v_dupes;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. PROTECTION 2a: the closed set, enforced by the database
--
-- The backstop. Even a direct service_role write cannot persist an
-- unrecognised value.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'subscriptions'::regclass
                    and conname  = 'ck_subscriptions_status') then
    alter table subscriptions
      add constraint ck_subscriptions_status
      check (status in ('trialing','active','past_due','cancelled'));
  end if;
end
$$;

comment on constraint ck_subscriptions_status on subscriptions is
  'Menu Master NG internal entitlement states. Paystack statuses are mapped at '
  'the boundary, never persisted. See docs/SUBSCRIPTION_STATE_MACHINE.md.';

-- ----------------------------------------------------------------------------
-- 3. PROTECTION 3: one subscription per account, at the database level
--
-- fn_guard_subscription_writes already refuses a client's second subscription,
-- but it returns early for service context. This closes that asymmetry, and is
-- what makes the multi-row branch in section 4 an assertion rather than a hope.
-- ----------------------------------------------------------------------------

create unique index if not exists ux_subscriptions_account
  on subscriptions (account_id);

-- ----------------------------------------------------------------------------
-- 4. PROTECTION 1 + 2b: the billing path fails loudly
--
-- Signature unchanged, so no second overload is created and 0012's REVOKEs
-- continue to apply. Re-stated at the end regardless.
-- ----------------------------------------------------------------------------

create or replace function fn_set_subscription_plan(
  p_account_id uuid,
  p_plan_id    text,
  p_status     text default 'active',
  p_period_end timestamptz default null,
  p_provider_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if not fn_is_service_context() then
    raise exception 'Only the billing system may change a subscription'
      using errcode = '42501';
  end if;

  if not exists (select 1 from plans where id = p_plan_id and is_active) then
    raise exception 'Unknown or inactive plan %', p_plan_id
      using errcode = '22023';
  end if;

  -- Explicit validation ahead of the CHECK constraint, so the caller gets a
  -- message that says what to do rather than a raw constraint violation.
  -- An unrecognised external status leaves the row EXACTLY as it was: a
  -- guessed write is worse than no write, and neither 'cancelled' (cuts off a
  -- paying customer) nor 'active' (gives away the product) is a safe default.
  if p_status is null or p_status not in ('trialing','active','past_due','cancelled') then
    raise exception
      'Unknown subscription status %. Map external statuses to one of: '
      'trialing, active, past_due, cancelled.', coalesce(quote_literal(p_status),'NULL')
      using errcode = '22023';
  end if;

  update subscriptions
     set plan_id            = p_plan_id,
         status             = p_status,
         current_period_end = coalesce(p_period_end, current_period_end),
         provider_ref       = coalesce(p_provider_ref, provider_ref)
   where account_id = p_account_id;

  get diagnostics v_rows = row_count;

  -- A billing call that changed nothing must fail, not report success.
  if v_rows = 0 then
    raise exception
      'No subscription exists for account %. Nothing was changed.', p_account_id
      using errcode = 'P0002';
  elsif v_rows > 1 then
    raise exception
      'Account % holds % subscription rows; refusing an ambiguous update.',
      p_account_id, v_rows
      using errcode = '21000';
  end if;

  -- Report what actually happened rather than echoing the arguments back.
  return jsonb_build_object(
    'account_id',   p_account_id,
    'plan_id',      p_plan_id,
    'status',       p_status,
    'rows_updated', v_rows);
end;
$$;

comment on function fn_set_subscription_plan(uuid, text, text, timestamptz, text) is
  'The billing system''s only sanctioned path to change a subscription. Raises '
  'P0002 when no row matched and 21000 when more than one did. Rejects any '
  'status outside the four canonical states.';

revoke execute on function fn_set_subscription_plan(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
