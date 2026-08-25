-- ============================================================================
-- MENU MASTER NG -- tests/013_gate2_overhead_basis.sql
--
-- Acceptance test for 0023 (Gate 2, Phase 3 -- overhead basis, D1 option a).
-- Run on a database with 0021, 0022 and 0023 applied. Rolls everything back.
--
-- Uses the worked example from GATE2_FINAL_DESIGN section 5:
--   monthly overhead 1,000,000 / declared output 10,000 L = 100 per litre.
-- ============================================================================

begin;

create temp table t4_result (n int, check_name text, verdict text, detail text)
  on commit drop;

do $$
declare
  aA uuid := gen_random_uuid(); uA uuid := gen_random_uuid();
  bL uuid := gen_random_uuid();   -- litre business, basis compatible
  bC uuid := gen_random_uuid();   -- count business, basis incompatible
  bN uuid := gen_random_uuid();   -- overhead on, NO basis declared
  bOff uuid := gen_random_uuid(); -- overhead off
  u_l uuid; u_g uuid; u_pc uuid;
  ing uuid := gen_random_uuid();
  rL uuid := gen_random_uuid(); rC uuid := gen_random_uuid();
  rN uuid := gen_random_uuid(); rOff uuid := gen_random_uuid();
  s uuid; v numeric; n int; probs text;
begin
  select id into u_l  from units where account_id is null and code='l';
  select id into u_g  from units where account_id is null and code='g';
  select id into u_pc from units where account_id is null and kind='count' limit 1;

  insert into auth.users (id,email) values (uA,'oh@t.test');
  insert into accounts (id,name) values (aA,'OH Acct');
  insert into businesses (id,account_id,name,slug,type) values
    (bL,aA,'Litre Biz','oh-l','soup_seller'),
    (bC,aA,'Count Biz','oh-c','small_chops'),
    (bN,aA,'No Basis Biz','oh-n','soup_seller'),
    (bOff,aA,'Overhead Off','oh-off','soup_seller');
  insert into memberships (account_id,business_id,user_id,role) values (aA,bL,uA,'owner');

  insert into business_settings (business_id,account_id,overhead_enabled,
                                 overhead_basis_qty,overhead_basis_unit_id) values
    (bL,aA,true,10000,u_l),
    (bC,aA,true,10000,u_l),        -- litre basis, but its recipe is sold by count
    (bN,aA,true,null,null),        -- enabled, no basis
    (bOff,aA,false,null,null);

  insert into overhead_items (account_id,business_id,name,monthly_cost,is_active) values
    (aA,bL,'Rent',1000000,true),
    (aA,bC,'Rent',1000000,true),
    (aA,bN,'Rent',1000000,true),
    (aA,bOff,'Rent',1000000,true);

  -- one priced ingredient so the recipes are otherwise complete
  insert into ingredients (id,account_id,kind,name,base_unit_id)
    values (ing,aA,'ingredient','Rice',u_g);
  insert into ingredient_prices (account_id,ingredient_id,qty_base,amount,source)
    values (aA,ing,1000,5000,'manual');

  insert into recipes (id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty) values
    (rL,aA,bL,'Egusi',10,u_l,1.5),
    (rC,aA,bC,'Puff Puff',100,u_pc,1),
    (rN,aA,bN,'Efo',10,u_l,1.5),
    (rOff,aA,bOff,'Ogbono',10,u_l,1.5);
  insert into recipe_lines (account_id,recipe_id,ingredient_id,qty,unit_id) values
    (aA,rL,ing,1000,u_g), (aA,rC,ing,1000,u_g),
    (aA,rN,ing,1000,u_g), (aA,rOff,ing,1000,u_g);

  -- ============================================ 1. the rate itself
  v := fn_overhead_rate(bL, u_l);
  insert into t4_result values (1,'rate = monthly total / declared output',
    case when v = 100 then 'PASS' else 'FAIL' end,
    'got '||coalesce(v::text,'NULL')||', expected 100 per litre');

  v := fn_overhead_rate(bC, u_pc);
  insert into t4_result values (2,'a litre basis yields NO rate for a count recipe',
    case when v is null then 'PASS' else 'FAIL' end,
    'got '||coalesce(v::text,'NULL')||' — cross-kind conversion must never be invented');

  v := fn_overhead_rate(bN, u_l);
  insert into t4_result values (3,'no declared basis yields NO rate, not zero',
    case when v is null then 'PASS' else 'FAIL' end,
    'got '||coalesce(v::text,'NULL'));

  -- ============================================ 2. the engine
  s := fn_compute_recipe_cost_snapshot(rL);
  select overhead_cost into v from cost_snapshots where recipe_id=rL
   order by computed_at desc limit 1;
  insert into t4_result values (4,'overhead per portion = rate x portion_qty',
    case when v = 150 then 'PASS' else 'FAIL' end,
    'got '||coalesce(v::text,'NULL')||', expected 150 (100/L x 1.5 L)');

  s := fn_compute_recipe_cost_snapshot(rN);
  select string_agg(i->>'problem',',') into probs
    from cost_snapshots cs, jsonb_array_elements(cs.unpriced_items) i
   where cs.recipe_id=rN order by 1;
  insert into t4_result values (5,'overhead enabled with no basis reports missing_overhead_basis',
    case when probs like '%missing_overhead_basis%' then 'PASS' else 'FAIL' end,
    coalesce(probs,'no problems recorded'));
  select overhead_cost into v from cost_snapshots
   where recipe_id=rN order by computed_at desc limit 1;
  insert into t4_result values (6,'and overhead is NULL, never zero',
    case when v is null then 'PASS' else 'FAIL' end,
    'overhead_cost = '||coalesce(v::text,'NULL'));

  s := fn_compute_recipe_cost_snapshot(rC);
  select string_agg(i->>'problem',',') into probs
    from cost_snapshots cs, jsonb_array_elements(cs.unpriced_items) i
   where cs.recipe_id=rC;
  insert into t4_result values (7,'an incompatible basis reports overhead_basis_incompatible',
    case when probs like '%overhead_basis_incompatible%' then 'PASS' else 'FAIL' end,
    coalesce(probs,'no problems recorded'));

  s := fn_compute_recipe_cost_snapshot(rOff);
  select string_agg(i->>'problem',',') into probs
    from cost_snapshots cs, jsonb_array_elements(cs.unpriced_items) i
   where cs.recipe_id=rOff;
  insert into t4_result values (8,'overhead disabled raises no overhead problem',
    case when coalesce(probs,'') not like '%overhead%' then 'PASS' else 'FAIL' end,
    coalesce(probs,'none'));

  -- ============================================ 3. constraints
  begin
    update business_settings set overhead_basis_qty = 500 where business_id = bN;
    insert into t4_result values (9,'half a basis is refused',
      'FAIL','a quantity was stored with no unit');
  exception when others then
    insert into t4_result values (9,'half a basis is refused','PASS', sqlerrm);
  end;

  begin
    update business_settings set overhead_basis_qty = 0, overhead_basis_unit_id = u_l
     where business_id = bN;
    insert into t4_result values (10,'a zero basis is refused',
      'FAIL','a zero denominator was accepted');
  exception when others then
    insert into t4_result values (10,'a zero basis is refused','PASS', sqlerrm);
  end;

  -- ============================================ 4. the pre-flight
  select would_resolve into n from fn_overhead_basis_preflight(bL, 10000, u_l);
  insert into t4_result values (11,'pre-flight counts what a basis would resolve',
    case when n = 1 then 'PASS' else 'FAIL' end,
    'would_resolve='||n);
  select would_block into n from fn_overhead_basis_preflight(bC, 10000, u_l);
  insert into t4_result values (12,'pre-flight counts what a basis would block',
    case when n = 1 then 'PASS' else 'FAIL' end,
    'would_block='||n||' — the owner sees the cost of the choice first');
end
$$;

-- ============================================ 5. grant surface
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  insert into t4_result values (13,'anon executes no fn_* function',
    case when n=0 then 'PASS' else 'FAIL' end, n||' executable');

  select count(*) into n from pg_proc p
   where p.proname='fn_overhead_rate'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  insert into t4_result values (14,'fn_overhead_rate stays internal',
    case when n=0 then 'PASS' else 'FAIL' end,
    'authenticated EXECUTE grants: '||n);

  select count(*) into n from pg_proc p
   where p.proname='fn_overhead_basis_preflight'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  insert into t4_result values (15,'the pre-flight is callable by the app',
    case when n=1 then 'PASS' else 'FAIL' end,
    'authenticated EXECUTE grants: '||n);
end
$$;

select n, check_name, verdict, left(detail,66) as detail from t4_result order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t4_result;

rollback;
