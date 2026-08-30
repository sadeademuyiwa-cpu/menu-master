-- ============================================================================
-- MENU MASTER NG
-- 0048: the function grant surface, restored and kept restored
--
-- Requires: 0001-0047 applied.
--
-- 0018 removed EXECUTE on every fn_* from PUBLIC and from anon. It did that
-- once, in a loop, over the functions that existed that day. It was never an
-- invariant -- nothing re-applied it -- so every migration since has added
-- functions that arrive with PostgreSQL's default of EXECUTE to PUBLIC, and
-- PUBLIC includes anon.
--
-- Found during Phase 6 by asking a question the tests had never asked: which
-- functions can a logged-out caller execute? Eleven, of which nine were added
-- after the sweep:
--
--   fn_ingredient_cost_basis     0034
--   fn_overhead_breakdown        0041
--   fn_overhead_problem          0041
--   fn_allocate_order_discount   0044
--   fn_guard_order_discount      0044
--   fn_order_line_scope          0043
--   fn_confirm_order             0045   (already narrowed in 0045)
--   fn_frozen_sale_cost          0045   (already narrowed in 0045)
--   fn_variant_cost_components   0046
--   plus fn_guard_subscription_changes and fn_payment_failure_grace
--
-- Most were harmless in practice: a trigger function cannot be usefully called
-- by hand, and the invoker-rights ones still meet row level security. The ones
-- that mattered were SECURITY DEFINER, and the one that mattered most --
-- fn_frozen_sale_cost -- took an account id it did not check, which made it a
-- cost-reading service for anybody able to guess one. That is fixed in 0045,
-- where it was introduced.
--
-- This migration repairs the surface and, more importantly, ends the pattern:
-- tests/034 now asserts the rule on every function, so the next one added
-- without a grant line fails the suite instead of shipping.
--
-- Nothing about what an authenticated user may do changes. Only what an
-- unauthenticated one may reach.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'v_sale_lines') then
    raise exception '0048 preflight FAILED: 0047 has not been applied.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0048 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Remove PUBLIC and anon from every Menu Master function
--
-- Restricted to fn_* and to functions not owned by an extension, exactly as
-- 0018 was: pgcrypto's helpers and PostgREST's own pre-request hook are not
-- ours to re-privilege, and local_pre_request must stay reachable or every
-- request in the local harness stops.
-- ---------------------------------------------------------------------------

do $$
declare f record; v_n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname like 'fn\_%'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    v_n := v_n + 1;
  end loop;
  raise notice '0048: EXECUTE removed from public and anon on % function(s).', v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Restore what an authenticated user must be able to call
--
-- Revoking from PUBLIC removes the privilege an authenticated caller was
-- relying on wherever it was never granted to the role directly. These are the
-- functions added since 0018 that the application, or a security_invoker view,
-- actually calls. Everything else on that list is a trigger function, which the
-- trigger mechanism invokes regardless of EXECUTE.
-- ---------------------------------------------------------------------------

grant execute on function fn_ingredient_cost_basis(uuid, uuid, date)          to authenticated;
grant execute on function fn_overhead_breakdown(uuid, uuid)                   to authenticated;
grant execute on function fn_overhead_problem(uuid, uuid)                     to authenticated;
grant execute on function fn_allocate_order_discount(uuid)                    to authenticated;
grant execute on function fn_confirm_order(uuid)                              to authenticated;
grant execute on function fn_frozen_sale_cost(uuid, uuid, uuid)               to authenticated;
grant execute on function fn_variant_cost_components(uuid)                    to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
declare v_pol int; v_left text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'fn\_%'
     and (p.proacl is null or '=X/postgres' = any(p.proacl::text[]));
  if v_left is not null then
    raise exception '0048 self-check FAILED: still executable by public: %', v_left;
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'fn\_%'
     and 'anon=X/postgres' = any(p.proacl::text[]);
  if v_left is not null then
    raise exception '0048 self-check FAILED: still executable by anon: %', v_left;
  end if;

  -- PostgREST calls this on every request. If it stops being executable the
  -- whole API stops, so it is asserted rather than assumed.
  if not has_function_privilege('authenticator', 'local_pre_request()', 'execute')
     and exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise exception '0048 self-check FAILED: the pre-request hook is no longer callable.';
  end if;

  -- The functions the application and the security_invoker views call.
  select string_agg(f, ', ') into v_left
    from unnest(array[
      'fn_ingredient_cost_basis(uuid,uuid,date)', 'fn_overhead_breakdown(uuid,uuid)',
      'fn_overhead_problem(uuid,uuid)', 'fn_allocate_order_discount(uuid)',
      'fn_confirm_order(uuid)', 'fn_frozen_sale_cost(uuid,uuid,uuid)',
      'fn_variant_cost_components(uuid)']) f
   where not has_function_privilege('authenticated', f, 'execute');
  if v_left is not null then
    raise exception '0048 self-check FAILED: authenticated lost access to: %', v_left;
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0048 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0048 OK: no function is executable by public or anon, 116 policies unchanged.';
end
$$;
