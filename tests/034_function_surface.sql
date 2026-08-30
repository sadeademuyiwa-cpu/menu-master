-- ============================================================================
-- MENU MASTER NG -- tests/034_function_surface.sql
--
-- WHO CAN CALL WHAT.
--
-- Why this exists, and why it is permanent:
--
--   0018 removed EXECUTE on every fn_* from PUBLIC and from anon. It did that
--   once, over the functions that existed that day. Nothing re-applied it, so
--   every function added afterwards arrived with PostgreSQL's default -- EXECUTE
--   to PUBLIC, and PUBLIC includes anon -- and nine had accumulated by Phase 6
--   without anyone noticing, because no test asked.
--
--   One of them was SECURITY DEFINER and took an account id it did not check,
--   which made it a cost-reading service for anybody able to guess one.
--
-- A sweep that is not asserted decays. This suite turns the sweep into a rule:
-- add a function without a grant line and the suite fails here, not in
-- production.
--
-- Run on a database with 0001-0048 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t34 (n int, check_name text, verdict text, detail text) on commit drop;

-- ---------------------------------------------------------------------------
-- 1. THE RULE
-- ---------------------------------------------------------------------------
insert into t34
select 1, 'no Menu Master function is executable by everybody',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname like 'fn\_%'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and (p.proacl is null or '=X/postgres' = any(p.proacl::text[]));

insert into t34
select 2, 'and none is executable by a logged-out caller',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname like 'fn\_%'
  and p.proacl is not null
  and 'anon=X/postgres' = any(p.proacl::text[]);

-- ---------------------------------------------------------------------------
-- 2. AND THE PRODUCT STILL WORKS
--
-- Revoking from PUBLIC removes a privilege an authenticated caller may have
-- been relying on. Everything the application or a security_invoker view calls
-- has to be granted to the role by name.
-- ---------------------------------------------------------------------------
insert into t34
select 3, 'an authenticated user can still call everything the product needs',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(f, ', '), 'all present')
from unnest(array[
  'fn_ingredient_cost_basis(uuid,uuid,date)', 'fn_ingredient_unit_cost(uuid,uuid,date)',
  'fn_overhead_breakdown(uuid,uuid)', 'fn_overhead_problem(uuid,uuid)',
  -- fn_overhead_rate is deliberately absent: authenticated has never been able
  -- to call it directly, and does not need to. It is reached only through
  -- SECURITY DEFINER callers, which run it with the owner's rights.
  'fn_variant_cost(uuid)',
  'fn_variant_cost_components(uuid)', 'fn_allocate_order_discount(uuid)',
  'fn_confirm_order(uuid)', 'fn_finalise_order(uuid)', 'fn_void_order(uuid,text)',
  'fn_reissue_order(uuid)', 'fn_post_purchase(uuid)',
  'fn_compute_recipe_cost_snapshot(uuid,date,uuid)']) f
where not has_function_privilege('authenticated', f, 'execute');

-- ---------------------------------------------------------------------------
-- 3. THE ONE THAT MATTERED
--
-- A SECURITY DEFINER function that accepts an account id must refuse a caller
-- who is not a member of it. Otherwise the parameter is the only thing standing
-- between one business's costs and another's.
--
-- The authorization primitives are excluded by name: they are the check. Asking
-- fn_is_account_member to call a membership check is circular, and they are
-- deliberately answerable about any account -- answering "no" is their job.
-- ---------------------------------------------------------------------------
insert into t34
select 4, 'every definer function taking an account id checks membership',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'none unchecked')
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname like 'fn\_%'
  and p.prosecdef
  and p.proname not in ('fn_is_account_member', 'fn_has_account_role',
                        'fn_can_see_costs', 'fn_account_is_entitled',
                        'fn_require_member', 'fn_require_cost_access',
                        'fn_require_account_role')
  and pg_get_function_identity_arguments(p.oid) like '%account_id%'
  and pg_get_functiondef(p.oid) !~ 'fn_require_member|fn_require_cost_access|fn_require_account_role|fn_is_account_member|fn_is_service_context';

-- And proven by calling it, not only by reading it.
do $$
declare
  a1 uuid; u1 uuid := gen_random_uuid(); b1 uuid;
  a2 uuid; u2 uuid := gen_random_uuid();
  res jsonb; g uuid; kg uuid; rice uuid := gen_random_uuid(); dish uuid := gen_random_uuid();
  refused boolean := false; answer text := null;
begin
  select id into g  from units where account_id is null and code = 'g';
  select id into kg from units where account_id is null and code = 'kg';

  insert into auth.users(id, email) values (u1, 'own34@t.test');
  res := fn_create_account_and_business('Own Co','Own K','caterer', u1,
           p_idempotency_key => gen_random_uuid()::text);
  a1 := (res->>'account_id')::uuid; b1 := (res->>'business_id')::uuid;

  insert into ingredients(id, account_id, kind, name, base_unit_id)
  values (rice, a1, 'ingredient', 'T34 Rice', g);
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (a1, rice, fn_resolve_qty_to_base(rice, 50, kg), 85000, 'purchase');
  insert into recipes(id, account_id, business_id, name, batch_yield_qty, yield_unit_id,
                      portion_qty, status)
  values (dish, a1, b1, 'T34 Dish', 4500, g, 500, 'active');
  insert into recipe_lines(account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (a1, dish, rice, 4500, g, true);
  perform fn_compute_recipe_cost_snapshot(dish);

  insert into auth.users(id, email) values (u2, 'other34@t.test');
  res := fn_create_account_and_business('Other Co','Other K','baker', u2,
           p_idempotency_key => gen_random_uuid()::text);
  a2 := (res->>'account_id')::uuid;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  begin
    select coalesce(unit_cost_at_sale::text, 'null') into answer
      from fn_frozen_sale_cost(a1, dish, null);
  exception when others then refused := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  insert into t34 values (5,
    'passing another account''s id to the cost freezer is refused, not answered',
    case when refused then 'PASS' else 'FAIL' end,
    case when refused then 'refused' else 'ANSWERED with ' || coalesce(answer, '(no row)') end);
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE HOOK POSTGREST NEEDS ON EVERY REQUEST
-- ---------------------------------------------------------------------------
insert into t34
select 6, 'the pre-request hook is still callable, so the API still answers',
       case when not exists (select 1 from pg_roles where rolname = 'authenticator')
             or has_function_privilege('authenticator', 'local_pre_request()', 'execute')
            then 'PASS' else 'FAIL' end, '';

select * from t34 order by n;
select count(*) filter (where verdict = 'PASS') as pass,
       count(*) filter (where verdict <> 'PASS') as fail from t34;

rollback;
