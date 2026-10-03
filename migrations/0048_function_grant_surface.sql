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
-- ours to re-privilege and must stay exactly as they are.
--
-- The hook is NOT named here. It is called local_pre_request in the local test
-- harness and something else on the hosted platform, and naming either one
-- turns a self-check into an environment assumption. Instead the ACL of every
-- function in the schema is snapshotted first, and section 3 asserts that the
-- only ACLs that moved belong to functions we intended to touch. That covers
-- the hook whatever it is called, and covers anything else in the schema too.
-- ---------------------------------------------------------------------------

-- NOT "on commit drop": inside the bundle this file runs in one transaction,
-- but applied on its own psql commits every statement, and the snapshot would
-- be gone before the revoke loop could read it. Session-scoped, dropped by
-- hand at the end of section 3.
drop table if exists _acl_before;
create temp table _acl_before as
select p.oid, p.oid::regprocedure::text as sig, p.proacl::text as acl
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace;

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
declare v_pol int; v_left text; v_hook text; v_hook_oid oid;
begin
  -- Read through aclexplode rather than matching ACL text. An entry reads
  -- '=X/postgres' only when the owner happens to be postgres; comparing the
  -- literal silently stops detecting anything the moment the owner differs.
  -- grantee = 0 is PUBLIC.
  select string_agg(p.proname, ', ' order by p.proname) into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'fn\_%'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_left is not null then
    raise exception '0048 self-check FAILED: still executable by public: %', v_left;
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'fn\_%'
     and exists (select 1 from aclexplode(p.proacl) a
                   join pg_roles r on r.oid = a.grantee
                  where r.rolname = 'anon' and a.privilege_type = 'EXECUTE');
  if v_left is not null then
    raise exception '0048 self-check FAILED: still executable by anon: %', v_left;
  end if;

  -- COLLATERAL DAMAGE. The revoke loop must have touched fn_* functions and
  -- nothing else. PostgREST's pre-request hook, pgcrypto's helpers and every
  -- other function in the schema must come out with the ACL they went in with.
  -- This is the property the old hardcoded local_pre_request() check was
  -- reaching for, asserted without naming any environment's function.
  select string_agg(b.sig, ', ' order by b.sig) into v_left
    from _acl_before b
    join pg_proc p on p.oid = b.oid
   where p.proacl::text is distinct from b.acl
     and p.proname not like 'fn\_%';
  if v_left is not null then
    raise exception '0048 self-check FAILED: privileges changed on functions that are not ours: %', v_left;
  end if;
  select string_agg(b.sig, ', ' order by b.sig) into v_left
    from _acl_before b where not exists (select 1 from pg_proc p where p.oid = b.oid);
  if v_left is not null then
    raise exception '0048 self-check FAILED: functions disappeared during the grant pass: %', v_left;
  end if;

  -- Whatever pre-request hook THIS database actually configures must still be
  -- callable. The name is read from the PostgREST role setting, never assumed,
  -- and resolved with to_regprocedure, which returns NULL for a function that
  -- does not exist instead of raising 42883 the way has_function_privilege
  -- does on a text signature.
  select replace(replace(split_part(cfg, '=', 2), '"', ''), '''', '')
    into v_hook
    from pg_db_role_setting r
    cross join lateral unnest(r.setconfig) as cfg
   where cfg like 'pgrst.db\_pre\_request=%'
   limit 1;
  if v_hook is not null and v_hook <> '' then
    v_hook_oid := to_regprocedure(v_hook || '()');
    if v_hook_oid is not null
       and exists (select 1 from pg_roles where rolname = 'authenticator')
       and not has_function_privilege('authenticator', v_hook_oid, 'execute') then
      raise exception '0048 self-check FAILED: configured pre-request hook % is no longer callable by authenticator.', v_hook;
    end if;
  end if;

  -- The functions the application and the security_invoker views call.
  select string_agg(f, ', ') into v_left
    from unnest(array[
      'fn_ingredient_cost_basis(uuid,uuid,date)', 'fn_overhead_breakdown(uuid,uuid)',
      'fn_overhead_problem(uuid,uuid)', 'fn_allocate_order_discount(uuid)',
      'fn_confirm_order(uuid)', 'fn_frozen_sale_cost(uuid,uuid,uuid)',
      'fn_variant_cost_components(uuid)']) f
   where to_regprocedure(f) is null
      or not has_function_privilege('authenticated', to_regprocedure(f), 'execute');
  if v_left is not null then
    raise exception '0048 self-check FAILED: authenticated cannot call (or we cannot find): %', v_left;
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0048 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0048 OK: no function is executable by public or anon, 116 policies unchanged.';
end
$$;

-- The ACL snapshot has served its purpose.
drop table _acl_before;
