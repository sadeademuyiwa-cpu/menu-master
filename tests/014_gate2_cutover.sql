-- ============================================================================
-- MENU MASTER NG -- tests/014_gate2_cutover.sql
--
-- Acceptance test for 0024 (Gate 2, Phase 4 -- variant costing and cutover).
-- Run on a database with 0021-0024 applied. Rolls everything back.
--
-- Variants are created here exactly as 0022 creates them (sellable_qty =
-- portion_qty in the recipe's own yield unit) rather than by re-running the
-- backfill, because 0022's preflight is phase-scoped to 47 fn_*.
-- ============================================================================

begin;

create temp table t5_result (n int, check_name text, verdict text, detail text)
  on commit drop;

do $$
declare
  aA uuid := gen_random_uuid(); uA uuid := gen_random_uuid();
  bOff uuid := gen_random_uuid(); bOn uuid := gen_random_uuid();
  u_l uuid; u_g uuid; u_bowl uuid; u_pc uuid;
  ing uuid := gen_random_uuid(); pkg uuid := gen_random_uuid(); pkg2 uuid := gen_random_uuid();
  rOff uuid := gen_random_uuid(); rOn uuid := gen_random_uuid();
  fDef uuid := gen_random_uuid(); fCapNull uuid := gen_random_uuid(); fBowl uuid := gen_random_uuid();
  vDef uuid := gen_random_uuid(); vCapNull uuid := gen_random_uuid(); vBowl uuid := gen_random_uuid();
  vOn uuid := gen_random_uuid(); fOn uuid := gen_random_uuid();
  legacy numeric; vcost numeric; prob text; q numeric; s uuid;
begin
  select id into u_l from units where account_id is null and code='l';
  select id into u_g from units where account_id is null and code='g';
  select id into u_pc from units where account_id is null and kind='count' limit 1;
  select id into u_bowl from units where account_id is null and kind='container'
     and factor_to_base is null limit 1;

  insert into auth.users (id,email) values (uA,'cut@t.test');
  insert into accounts (id,name) values (aA,'Cutover Acct');
  insert into businesses (id,account_id,name,slug,type) values
    (bOff,aA,'OH Off','cut-off','soup_seller'),
    (bOn ,aA,'OH On' ,'cut-on' ,'soup_seller');
  insert into memberships (account_id,business_id,user_id,role) values (aA,bOff,uA,'owner');
  insert into business_settings (business_id,account_id,overhead_enabled,
                                 overhead_basis_qty,overhead_basis_unit_id) values
    (bOff,aA,false,null,null),
    (bOn ,aA,true ,10000,u_l);
  insert into overhead_items (account_id,business_id,name,monthly_cost,is_active)
    values (aA,bOn,'Rent',1000000,true);

  insert into ingredients (id,account_id,kind,name,base_unit_id) values
    (ing ,aA,'ingredient','Rice',u_g),
    (pkg ,aA,'packaging' ,'Bowl',u_pc),
    (pkg2,aA,'packaging' ,'Lid' ,u_pc);
  insert into ingredient_prices (account_id,ingredient_id,qty_base,amount,source) values
    (aA,ing,1000,5000,'manual'),        -- 5 per g
    (aA,pkg,10,1000,'manual');          -- 100 per piece; Lid deliberately unpriced

  insert into recipes (id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty) values
    (rOff,aA,bOff,'Egusi',10,u_l,1.5),
    (rOn ,aA,bOn ,'Efo'  ,10,u_l,1.5);
  insert into recipe_lines (account_id,recipe_id,ingredient_id,qty,unit_id) values
    (aA,rOff,ing,1000,u_g), (aA,rOn,ing,1000,u_g);

  -- the legacy figure, from the existing engine
  s := fn_compute_recipe_cost_snapshot(rOff);
  select cost_per_portion into legacy from cost_snapshots
   where recipe_id=rOff order by computed_at desc limit 1;

  -- formats and variants, exactly as 0022 would create them
  insert into serving_formats (id,account_id,business_id,name) values
    (fDef,aA,bOff,'Default'), (fCapNull,aA,bOff,'Bowl no capacity');
  insert into serving_formats (id,account_id,business_id,name,capacity_qty,capacity_unit_id)
    values (fBowl,aA,bOff,'One bowl',1,u_bowl);
  insert into recipe_variants (id,account_id,business_id,recipe_id,format_id,
                               costing_basis,sellable_qty,sellable_unit_id) values
    (vDef,aA,bOff,rOff,fDef,'explicit_qty',1.5,u_l);
  insert into recipe_variants (id,account_id,business_id,recipe_id,format_id,costing_basis) values
    (vCapNull,aA,bOff,rOff,fCapNull,'capacity'),
    (vBowl   ,aA,bOff,rOff,fBowl   ,'capacity');

  -- ================================================= 1. the cutover property
  vcost := fn_variant_cost(vDef);
  insert into t5_result values (1,'variant cost equals the legacy cost exactly',
    case when legacy is not null and vcost is not null
          and abs(legacy - vcost) <= 0.000001 then 'PASS' else 'FAIL' end,
    'legacy '||coalesce(legacy::text,'NULL')||' vs variant '||coalesce(vcost::text,'NULL'));

  select verdict into prob from v_gate2_cutover where variant_id=vDef;
  insert into t5_result values (2,'the cutover view reports MATCH',
    case when prob='MATCH' then 'PASS' else 'FAIL' end, coalesce(prob,'no row'));

  q := fn_variant_resolved_qty(vDef);
  insert into t5_result values (3,'resolved qty is the portion, in the yield unit',
    case when q = 1.5 then 'PASS' else 'FAIL' end, coalesce(q::text,'NULL'));

  -- ================================================= 2. named problem codes
  prob := fn_variant_problem(vCapNull);
  insert into t5_result values (4,'a capacity basis with no capacity is named',
    case when prob='format_missing_capacity' then 'PASS' else 'FAIL' end, coalesce(prob,'NULL'));
  insert into t5_result values (5,'and its cost is NULL, never zero',
    case when fn_variant_cost(vCapNull) is null then 'PASS' else 'FAIL' end,
    coalesce(fn_variant_cost(vCapNull)::text,'NULL'));

  prob := fn_variant_problem(vBowl);
  insert into t5_result values (6,'a container unit cannot resolve, and says so',
    case when prob in ('capacity_unit_unconvertible','capacity_unit_incompatible')
         then 'PASS' else 'FAIL' end, coalesce(prob,'NULL'));

  -- ================================================= 3. D4 packaging
  insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
    values (aA,bOff,fDef,pkg,1);
  vcost := fn_variant_cost(vDef);
  insert into t5_result values (7,'format packaging adds ONCE per sold unit',
    case when vcost is not null and abs(vcost - (legacy + 100)) <= 0.000001
         then 'PASS' else 'FAIL' end,
    'expected '||(legacy+100)::text||', got '||coalesce(vcost::text,'NULL')
    ||' — must not be multiplied by the 1.5 L resolved qty');

  insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
    values (aA,bOff,fDef,pkg2,1);       -- Lid has no price
  prob := fn_variant_problem(vDef);
  insert into t5_result values (8,'an unpriced packaging item blocks the variant',
    case when prob='missing_packaging_price' then 'PASS' else 'FAIL' end, coalesce(prob,'NULL'));
  insert into t5_result values (9,'and the cost becomes NULL, not a partial figure',
    case when fn_variant_cost(vDef) is null then 'PASS' else 'FAIL' end,
    coalesce(fn_variant_cost(vDef)::text,'NULL'));
  delete from serving_format_packaging where format_id=fDef and packaging_item_id=pkg2;

  -- ================================================= 4. overhead flows through
  insert into serving_formats (id,account_id,business_id,name) values (fOn,aA,bOn,'Default');
  insert into recipe_variants (id,account_id,business_id,recipe_id,format_id,
                               costing_basis,sellable_qty,sellable_unit_id)
    values (vOn,aA,bOn,rOn,fOn,'explicit_qty',1.5,u_l);
  s := fn_compute_recipe_cost_snapshot(rOn);
  select cost_per_portion into legacy from cost_snapshots
   where recipe_id=rOn order by computed_at desc limit 1;
  vcost := fn_variant_cost(vOn);
  insert into t5_result values (10,'overhead is included and matches the engine',
    case when legacy is not null and vcost is not null
          and abs(legacy - vcost) <= 0.000001 then 'PASS' else 'FAIL' end,
    'legacy '||coalesce(legacy::text,'NULL')||' vs variant '||coalesce(vcost::text,'NULL')
    ||' (both carry 150 of overhead)');

  -- ================================================= 5. no MISMATCH anywhere
  select count(*)::text into prob from v_gate2_cutover where verdict='MISMATCH';
  insert into t5_result values (11,'the cutover gate reports no MISMATCH',
    case when prob='0' then 'PASS' else 'FAIL' end, prob||' mismatch(es)');
end
$$;

-- ================================================= 6. grant surface
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  insert into t5_result values (12,'anon executes no fn_* function',
    case when n=0 then 'PASS' else 'FAIL' end, n||' executable');

  select count(*) into n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public' and table_name='v_gate2_cutover';
  insert into t5_result values (13,'anon cannot read the cutover view',
    case when n=0 then 'PASS' else 'FAIL' end, n||' grant(s)');
end
$$;

select n, check_name, verdict, left(detail,70) as detail from t5_result order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t5_result;

rollback;
