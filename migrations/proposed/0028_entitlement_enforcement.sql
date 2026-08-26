-- ============================================================================
-- MENU MASTER NG
-- 0028: server-side entitlement enforcement -- CLOSES GATE 1 CONDITION C4
--
-- Authority: docs/GATE1_VERDICT.md section 4 (C4), owner ruling D2 of 25 Aug
-- ("hard gate on paid write operations; server-side; preserve legitimate read
-- access to historical data"), and docs/SUBSCRIPTION_STATE_MACHINE.md section 1,
-- which already specifies the entitlement rule. Nothing here is invented.
--
-- Requires: 0021-0027 applied (54 fn_* / 51 relations / 105 policies).
--
-- THE DEFECT C4 NAMES
--   "Nothing in 0001-0018 reads subscriptions.status. fn_account_is_entitled()
--   does not exist, so a cancelled account is not actually denied anything."
--   Paid plans are unenforceable while that is true.
--
-- THE RULE, quoted from the approved state machine
--   entitled == status IN ('trialing','active','past_due')
--           OR  (status = 'cancelled' AND current_period_end > now())
--
--   past_due is deliberately inside the entitled set: a failed card should not
--   lock an owner out of her own costing data the same afternoon. cancelled
--   keeps what was paid for until the period actually ends.
--
-- WHAT IS GATED, AND WHAT IS DELIBERATELY NOT
--   GATED: INSERT, UPDATE and DELETE on the operational tables.
--   NOT GATED: every SELECT. A lapsed customer can still read and export every
--   figure they entered. Their data is theirs; the subscription buys the right
--   to keep working, not the right to see what they already own.
--   NOT GATED: memberships. It is 0012's authority table, and locking it would
--   strand an owner who needs to add a manager to sort the billing out.
--   NOT GATED: serving_format_changes and costing_method_changes. Both are
--   append-only audit logs written by triggers as a side effect of a parent
--   write that IS gated, so gating them again would add a failure mode without
--   adding a control.
--
-- ADDITIVE. No policy is dropped or created -- 23 tables' existing write
-- policies are ALTERED to carry one more conjunct. The policy count does not
-- move, and no SELECT policy is touched.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 54 then
    raise exception '0028 preflight FAILED: expected 54 fn_* functions, found %.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if exists (select 1 from pg_proc where pronamespace='public'::regnamespace
              and proname='fn_account_is_entitled') then
    raise exception '0028 preflight FAILED: fn_account_is_entitled already exists.';
  end if;
  raise notice '0028 preflight OK. % account(s) currently without any '
               'subscription row would be unentitled.',
    (select count(*) from accounts a
      where not exists (select 1 from subscriptions s where s.account_id = a.id));
end
$$;

-- ----------------------------------------------------------------------------
-- 1. The entitlement predicate
--
--    Date-aware, exactly as the state machine requires: nothing expires a row
--    on a timer, so a subscription can legitimately sit at 'active' with a
--    current_period_end in the past. A status-only rule would give the wrong
--    answer; this one does not.
--
--    An account with NO subscription row is NOT entitled. That is not a
--    missing-data guess -- onboarding always creates one, so its absence is a
--    real signal, not an unknown.
-- ----------------------------------------------------------------------------
create or replace function fn_account_is_entitled(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
     where s.account_id = p_account_id
       and ( s.status in ('trialing','active','past_due')
          or (s.status = 'cancelled' and s.current_period_end > now()) )
  );
$$;

revoke execute on function fn_account_is_entitled(uuid) from public, anon;
grant  execute on function fn_account_is_entitled(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Add the conjunct to every operational write policy
--
--    Each policy is ALTERed, not replaced, so the role matrix 0015 established
--    survives untouched underneath. The entitlement test is appended, never
--    substituted.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_excluded text[] := array['memberships','serving_format_changes',
                             'costing_method_changes'];
  v_qual text; v_check text; v_n int := 0;
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and policyname ~ '^p_.*_(insert|update|delete)$'
       and not (tablename = any(v_excluded))
     order by tablename, policyname
  loop
    -- never double-apply
    if coalesce(r.qual,'') like '%fn_account_is_entitled%'
       or coalesce(r.with_check,'') like '%fn_account_is_entitled%' then
      continue;
    end if;

    v_qual  := case when r.qual is null then null
                    else '(' || r.qual || ') and fn_account_is_entitled(account_id)' end;
    v_check := case when r.with_check is null then null
                    else '(' || r.with_check || ') and fn_account_is_entitled(account_id)' end;

    if v_qual is not null and v_check is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)',
                     r.policyname, r.tablename, v_qual, v_check);
    elsif v_qual is not null then
      execute format('alter policy %I on public.%I using (%s)',
                     r.policyname, r.tablename, v_qual);
    else
      execute format('alter policy %I on public.%I with check (%s)',
                     r.policyname, r.tablename, v_check);
    end if;
    v_n := v_n + 1;
  end loop;

  raise notice '0028: entitlement conjunct added to % write policy(ies).', v_n;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int; v_gated int; v_select int; v_memb int; v_ungated text;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 55 then
    raise exception '0028 self-check FAILED: fn_* is %, expected 55.', v_fns;
  end if;

  select count(*) into v_pols from pg_policies where schemaname='public';
  if v_pols <> 105 then
    raise exception '0028 self-check FAILED: policies is %, expected 105. This '
                    'migration alters policies; it must not add or remove one.', v_pols;
  end if;

  -- every operational write policy must now carry the conjunct
  select string_agg(tablename||'.'||policyname, ', ') into v_ungated
    from pg_policies
   where schemaname='public'
     and policyname ~ '^p_.*_(insert|update|delete)$'
     and tablename not in ('memberships','serving_format_changes','costing_method_changes')
     and coalesce(qual,'')||coalesce(with_check,'') not like '%fn_account_is_entitled%';
  if v_ungated is not null then
    raise exception '0028 self-check FAILED: write policy(ies) without the '
                    'entitlement gate: %', v_ungated;
  end if;

  select count(*) into v_gated from pg_policies
   where schemaname='public'
     and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%';

  -- NO read path may be gated: a lapsed customer keeps their own data
  select count(*) into v_select from pg_policies
   where schemaname='public' and cmd='SELECT'
     and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%';
  if v_select <> 0 then
    raise exception '0028 self-check FAILED: % SELECT policy(ies) were gated. '
                    'Read access to a customer''s own data must never depend on '
                    'their subscription.', v_select;
  end if;

  -- the authority table must stay open, or an owner can be stranded
  select count(*) into v_memb from pg_policies
   where schemaname='public' and tablename='memberships'
     and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%';
  if v_memb <> 0 then
    raise exception '0028 self-check FAILED: memberships was gated.';
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
         and has_function_privilege('anon', p.oid, 'EXECUTE')) <> 0 then
    raise exception '0028 self-check FAILED: anon gained EXECUTE on a function.';
  end if;

  raise notice '0028 OK: 55 fn_* / 105 policies unchanged. % write policy(ies) '
               'now require entitlement; 0 read policies gated; memberships '
               'left open. C4 is closed.', v_gated;
end
$$;
