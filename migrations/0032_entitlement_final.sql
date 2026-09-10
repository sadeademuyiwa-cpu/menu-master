-- ============================================================================
-- MENU MASTER NG
-- 0032: final entitlement definition -- GATE A
--
-- Authority: D-3 (missing boundary), R4/D-11 (payment-failure grace, 7 days
-- uniform), D-26 (trial expiry) and the owner's final Case 11 ruling of
-- 27 Aug 2026. Reconciled into ONE replacement so the function that 60 write
-- policies depend on is replaced once, not three times.
--
-- Requires: 0001-0031 applied.
--
-- THE DEFECT THIS CLOSES
--   `trialing` is matched on status alone. No date is consulted, and nothing
--   performs the trialing -> cancelled transition, so an expired trial is
--   entitled indefinitely. The advertised 14-day trial does not end.
--
-- THE DEFINITION BEING REPLACED, captured verbatim before replacement:
--     select exists (
--       select 1 from subscriptions s
--        where s.account_id = p_account_id
--          and ( s.status in ('trialing','active','past_due')
--             or (s.status = 'cancelled' and s.current_period_end > now()) )
--     );
--   Rollback restores exactly this. The signature never changes, so no policy
--   is touched in either direction.
--
-- CASE 11, AS RULED
--   trialing  + NULL boundary -> DENIED  (nothing was ever paid; failing open
--                                         would recreate the unlimited trial)
--   active    + NULL boundary -> allowed (status means a charge succeeded)
--   past_due  + NULL boundary -> allowed ("paid previously; a renewal failed")
--   cancelled + NULL boundary -> DENIED  (terminal for current entitlement)
--   unknown status            -> DENIED  by construction, not by a rule
--   provider_ref is NOT an access-control primitive and is not consulted.
--
-- ADDITIVE except for the function body and three policy splits. No policy is
-- dropped without an equivalent-or-narrower replacement, and no SELECT
-- predicate changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT
-- ----------------------------------------------------------------------------
do $$
declare v_null int; v_pol int;
begin
  if not exists (select 1 from pg_proc where proname = 'fn_account_is_entitled') then
    raise exception '0032 preflight FAILED: fn_account_is_entitled is missing. Is 0028 applied?';
  end if;

  select count(*) into v_pol from pg_policies
   where schemaname='public'
     and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_is_entitled%';
  if v_pol <> 60 then
    raise exception '0032 preflight FAILED: expected 60 policies to reference the '
                    'entitlement function, found %. STOP and investigate.', v_pol;
  end if;

  select count(*) into v_null from subscriptions where current_period_end is null;
  if v_null > 0 then
    raise exception '0032 preflight FAILED: % subscription row(s) have a NULL '
                    'current_period_end. Resolve them from evidence FIRST. This '
                    'migration will not invent a boundary and will not rewrite '
                    'anomalous production data.', v_null;
  end if;

  raise notice '0032 preflight OK: 60 gated policies, 0 NULL boundaries.';
end
$$;

-- ----------------------------------------------------------------------------
-- 1. CONFIGURATION -- append-only, effective-dated
--
--    The grace duration must be changeable without replacing a function that
--    60 policies depend on. One table, typed columns, INSERT-only: the history
--    is the audit trail, so no second mechanism appears.
-- ----------------------------------------------------------------------------
create table billing_config (
  effective_from         timestamptz primary key default now(),
  payment_failure_grace  interval    not null,
  authorised_by          text        not null,
  reason                 text        not null,
  created_at             timestamptz not null default now(),
  constraint ck_billing_config_grace_positive check (payment_failure_grace > interval '0')
);

comment on table billing_config is
  'Append-only. Changing a value is an INSERT with a later effective_from; the '
  'previous value, who changed it and why are preserved by construction. '
  'Trial expiry draws NOTHING from here -- it has no grace, by ruling.';

insert into billing_config (payment_failure_grace, authorised_by, reason)
values (interval '7 days', 'owner ruling D-11, 27 Aug 2026',
        'Uniform across every billing interval. An annual subscriber does not '
        'stay active longer because their invoice is larger.');

alter table billing_config enable row level security;
create policy p_billing_config_select on billing_config for select using (true);
revoke all on billing_config from anon, authenticated;
grant select on billing_config to authenticated, anon;
revoke insert, update, delete, truncate on billing_config from anon, authenticated;
revoke update, delete, truncate on billing_config from service_role;

create or replace function fn_payment_failure_grace()
returns interval
language sql stable security definer set search_path = public
as $$
  select payment_failure_grace
    from billing_config
   where effective_from <= now()
   order by effective_from desc
   limit 1;
$$;

grant execute on function fn_payment_failure_grace() to authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- 2. THE ENTITLEMENT DEFINITION
--
--    A whitelist of four named statuses. An unrecognised status matches
--    nothing and is denied BY CONSTRUCTION -- not by a rule someone must
--    remember to add when ck_subscriptions_status is next widened.
-- ----------------------------------------------------------------------------
create or replace function fn_account_is_entitled(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
     where s.account_id = p_account_id
       and (
         -- TRIAL. Exactly the advertised days. No grace: nobody attempted a
         -- payment, so there is nothing to recover. A NULL boundary is DENIED.
            (s.status = 'trialing' and s.current_period_end > now())

         -- PAID AND EXPECTED TO RENEW. Status-only, deliberately: a stale row
         -- is OUR gap, and withdrawing here would cut off every customer whose
         -- renewal webhook runs late. J6 reconciles it.
         or  s.status = 'active'

         -- DUNNING GRACE. current_period_end is NOT advanced on a failed
         -- renewal, so this runs from the last paid-through date. A NULL
         -- boundary is allowed: they have paid, so the gap is the anomaly.
         or (s.status = 'past_due'
             and (s.current_period_end is null
                  or s.current_period_end + fn_payment_failure_grace() > now()))

         -- CANCELLED BUT PAID THROUGH. Terminal for current entitlement once
         -- the date passes, and a NULL boundary is DENIED.
         or (s.status = 'cancelled' and s.current_period_end > now())
       )
  );
$$;

revoke execute on function fn_account_is_entitled(uuid) from public, anon;
grant  execute on function fn_account_is_entitled(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. ENTITLEMENT MUST BE QUERYABLE, NOT ONLY ENFORCED
--
--    Without this the UI discovers an ended trial by a write failing with a
--    bare RLS error. It derives from the SAME function, so a second
--    implementation cannot drift from the first.
-- ----------------------------------------------------------------------------
create or replace function fn_my_entitlement_status()
returns table (
  entitled     boolean,
  status       text,
  boundary     timestamptz,
  reason       text
)
language sql stable security definer set search_path = public
as $$
  select
    fn_account_is_entitled(s.account_id),
    s.status,
    s.current_period_end,
    case
      when fn_account_is_entitled(s.account_id) and s.status = 'trialing' then 'trial_active'
      when fn_account_is_entitled(s.account_id) and s.status = 'past_due' then 'payment_failed_in_grace'
      when fn_account_is_entitled(s.account_id)                           then 'active'
      when s.status = 'trialing'                                          then 'trial_ended'
      when s.status = 'past_due'                                          then 'payment_failed'
      when s.status = 'cancelled'                                         then 'subscription_ended'
      else 'not_entitled'
    end
  from subscriptions s
  join memberships m on m.account_id = s.account_id and m.user_id = auth.uid()
  limit 1;
$$;

revoke execute on function fn_my_entitlement_status() from public, anon;
grant  execute on function fn_my_entitlement_status() to authenticated;

comment on function fn_my_entitlement_status() is
  'The caller''s own entitlement, derived from fn_account_is_entitled so the '
  'client never reimplements the rule. Reads only the caller''s row and grants '
  'no access of its own.';

-- ----------------------------------------------------------------------------
-- 4. V-7 -- the three cost tables were never entitlement-gated
--
--    0004 gave ingredient_prices, cost_snapshots and recipe_prices a single
--    `for all` policy each. 0028 selected policies by the name pattern
--    ^p_.*_(insert|update|delete)$, which a blanket policy cannot match, so
--    the gate never reached them. Once trials genuinely expire, a lapsed
--    account could still write prices while unable to add an ingredient.
--
--    Fixed the way 0015 fixed the same shape: split the blanket policy into
--    named per-verb policies. THE SELECT PREDICATE IS UNCHANGED, character for
--    character -- reads are never gated, and a lapsed customer keeps reading
--    and exporting every price they entered.
-- ----------------------------------------------------------------------------
do $$
declare t text; v_n int := 0;
begin
  foreach t in array array['ingredient_prices','cost_snapshots','recipe_prices']
  loop
    execute format('drop policy if exists p_%I on %I', t, t);

    -- READ: identical to the predicate 0004 installed.
    execute format($f$
      create policy p_%1$I_select on %1$I for select
        using (fn_is_account_member(account_id) and fn_can_see_costs(account_id))
    $f$, t);

    -- WRITE: the same predicate plus the entitlement conjunct 0028 applies
    -- everywhere else.
    execute format($f$
      create policy p_%1$I_insert on %1$I for insert
        with check (fn_is_account_member(account_id)
                    and fn_can_see_costs(account_id)
                    and fn_account_is_entitled(account_id))
    $f$, t);
    execute format($f$
      create policy p_%1$I_update on %1$I for update
        using (fn_is_account_member(account_id)
               and fn_can_see_costs(account_id)
               and fn_account_is_entitled(account_id))
        with check (fn_is_account_member(account_id)
                    and fn_can_see_costs(account_id)
                    and fn_account_is_entitled(account_id))
    $f$, t);
    execute format($f$
      create policy p_%1$I_delete on %1$I for delete
        using (fn_is_account_member(account_id)
               and fn_can_see_costs(account_id)
               and fn_account_is_entitled(account_id))
    $f$, t);
    v_n := v_n + 4;
  end loop;
  raise notice '0032: % policies created across the three cost tables.', v_n;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. NEW ROWS MUST CARRY A BOUNDARY
--
--    D-3's original proposal exempted `trialing`, which is exactly the case
--    D-26 requires. Every status needs a boundary; no exemption remains.
--    Added only because the preflight proved there is nothing to break.
-- ----------------------------------------------------------------------------
alter table subscriptions
  add constraint ck_subscriptions_period_present
  check (current_period_end is not null);

comment on constraint ck_subscriptions_period_present on subscriptions is
  'Entitlement is derived from this date, so a row without one cannot be '
  'evaluated. NULL is a data-integrity anomaly, never an unlimited trial. '
  'Binds service_role, support fixes, webhooks and jobs identically.';

-- ----------------------------------------------------------------------------
-- 6. ANOMALY VISIBILITY
--    reconciliation_items belongs to the scheduler migration. A view needs no
--    table, no writer and no job, and makes the count observable today.
-- ----------------------------------------------------------------------------
create or replace view v_billing_anomalies with (security_invoker = on) as
select s.id as subscription_id, s.account_id, s.status,
       s.trial_ends_at, s.current_period_end,
       'null_period_end'::text as anomaly
  from subscriptions s
 where s.current_period_end is null;

grant select on v_billing_anomalies to authenticated;

-- ----------------------------------------------------------------------------
-- 7. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_pol int; v_read int; v_def text; v_grace interval;
begin
  select count(*) into v_pol from pg_policies
   where schemaname='public'
     and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_is_entitled%';
  if v_pol <> 69 then
    raise exception '0032 self-check FAILED: expected 69 gated write policies '
                    '(60 + 9 new), found %.', v_pol;
  end if;

  select count(*) into v_read from pg_policies
   where schemaname='public' and cmd = 'SELECT'
     and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_is_entitled%';
  if v_read <> 0 then
    raise exception '0032 self-check FAILED: % SELECT policy(ies) became gated. '
                    'Reads must never be gated.', v_read;
  end if;

  select pg_get_functiondef(oid) into v_def from pg_proc where proname='fn_account_is_entitled';
  if v_def not like '%fn_payment_failure_grace()%' or v_def not like '%trialing%current_period_end%' then
    raise exception '0032 self-check FAILED: the entitlement definition is not the intended one.';
  end if;

  select fn_payment_failure_grace() into v_grace;
  if v_grace <> interval '7 days' then
    raise exception '0032 self-check FAILED: grace is %, expected 7 days.', v_grace;
  end if;

  if not exists (select 1 from pg_constraint where conname='ck_subscriptions_period_present') then
    raise exception '0032 self-check FAILED: the boundary constraint is missing.';
  end if;

  raise notice '0032 OK: 69 gated write policies, 0 gated reads, grace 7 days, boundary constraint present.';
end
$$;
