-- ============================================================================
-- 0028 ROLLBACK -- removes the entitlement gate
--
-- WARNING: this reopens Gate 1 condition C4. A cancelled account is denied
-- nothing again, and paid plans become unenforceable. Roll back only to
-- unblock a specific incident, and re-apply as soon as it is resolved.
--
-- Strips the conjunct from every write policy that carries it, then drops the
-- predicate. No policy is created or dropped; the 0015 role matrix underneath
-- is untouched throughout.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                  and proname='fn_account_is_entitled') then
    raise exception '0028 rollback FAILED: fn_account_is_entitled does not exist.';
  end if;
  raise warning '0028 rollback: removing the entitlement gate. A cancelled '
                'account will be denied nothing again (Gate 1 condition C4).';
end
$$;

do $$
declare r record; v_qual text; v_check text; v_n int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname='public'
       and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%'
  loop
    -- PostgreSQL flattens the appended conjunct into the existing AND chain and
    -- stores it verbatim as ` AND fn_account_is_entitled(account_id)`. A plain
    -- string removal is therefore exact. An earlier draft used an anchored
    -- regexp and silently matched nothing, leaving every policy still gated --
    -- the DROP FUNCTION at the end is what caught it.
    v_qual  := replace(r.qual,       ' AND fn_account_is_entitled(account_id)', '');
    v_check := replace(r.with_check, ' AND fn_account_is_entitled(account_id)', '');

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

  -- count what actually happened, not how many times the loop ran
  if exists (select 1 from pg_policies where schemaname='public'
              and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%') then
    raise exception '0028 rollback FAILED: % policy(ies) still reference the '
                    'predicate after stripping.',
      (select count(*) from pg_policies where schemaname='public'
        and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%');
  end if;
  raise notice '0028 rollback: conjunct stripped from % policy(ies), none remain.', v_n;
end
$$;

drop function if exists fn_account_is_entitled(uuid);

do $$
declare v_fns int; v_pols int; v_left int;
begin
  select count(*) into v_fns  from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_pols from pg_policies where schemaname='public';
  select count(*) into v_left from pg_policies where schemaname='public'
    and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%';

  if v_fns <> 54 or v_pols <> 105 or v_left <> 0 then
    raise exception '0028 rollback self-check FAILED: % fn_* / % policies / % '
                    'still gated; expected 54 / 105 / 0.', v_fns, v_pols, v_left;
  end if;
  raise notice '0028 ROLLBACK OK: back to 54 fn_* / 105 policies, none gated. '
               'C4 is OPEN again.';
end
$$;
