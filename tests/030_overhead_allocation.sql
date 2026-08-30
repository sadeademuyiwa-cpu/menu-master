-- ============================================================================
-- MENU MASTER NG -- tests/030_overhead_allocation.sql
--
-- Overhead allocated across more than one measurement dimension, without ever
-- allocating the same naira twice.
--
-- THE ACCOUNTING INVARIANT:
--     sum of every active item's monthly_cost = the configured overhead
-- and each item allocates through exactly ONE basis, so no configuration can
-- spread the same money over two dimensions.
--
-- Run on a database with 0001-0041 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t30 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx30 (acct uuid, usr uuid, biz uuid,
                        g uuid, kg uuid, l uuid, ml uuid, piece uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb;
        g uuid; kg uuid; l uuid; ml uuid; piece uuid;
begin
  select id into g     from units where account_id is null and code='g';
  select id into kg    from units where account_id is null and code='kg';
  select id into l     from units where account_id is null and code='l';
  select id into ml    from units where account_id is null and code='ml';
  select id into piece from units where account_id is null and code='piece';
  insert into auth.users(id,email) values (u,'oh30@t.test');
  res := fn_create_account_and_business('OH Co','OH K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  -- overhead on, and NO business-wide default: every item declares its own
  update business_settings set overhead_enabled = true,
         overhead_basis_qty = null, overhead_basis_unit_id = null
   where business_id = b;
  insert into fx30 values (a,u,b,g,kg,l,ml,piece);
end $$;

create or replace function pg_temp.recipe(p_name text, p_yield numeric, p_unit uuid,
                                          p_portion numeric, p_amount numeric)
returns uuid language plpgsql as $$
declare f record; i uuid := gen_random_uuid(); r uuid := gen_random_uuid();
begin
  select * into f from fx30;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (i,f.acct,'ingredient',p_name||' input',p_unit);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,i,p_yield,p_amount,'purchase');
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (r,f.acct,f.biz,p_name,p_yield,p_unit,p_portion,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,r,i,p_yield,p_unit,true);
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- ONE BUSINESS, THREE DIMENSIONS. N600,000 of overhead SPLIT, not duplicated.
--   Soup pool   N300,000 over 600 L      -> N0.50 per ml
--   Bread pool  N200,000 over 400 kg     -> N0.50 per g
--   Pack pool   N100,000 over 20,000 pcs -> N5.00 per piece
-- ---------------------------------------------------------------------------
do $$
declare f record; soup uuid; bread uuid; packs uuid; s record;
begin
  select * into f from fx30;

  insert into overhead_items(account_id,business_id,name,monthly_cost,basis_qty,basis_unit_id)
  values (f.acct,f.biz,'Kitchen rent (soup line)',300000,600,f.l),
         (f.acct,f.biz,'Bakery rent',            200000,400,f.kg),
         (f.acct,f.biz,'Packing bench',          100000,20000,f.piece);

  soup  := pg_temp.recipe('Soup',  10000, f.ml,    2500, 20000);
  bread := pg_temp.recipe('Bread', 10000, f.g,      500, 12000);
  packs := pg_temp.recipe('Packs',   100, f.piece,    6,  7500);
  perform fn_compute_recipe_cost_snapshot(soup);
  perform fn_compute_recipe_cost_snapshot(bread);
  perform fn_compute_recipe_cost_snapshot(packs);

  insert into t30 values (1,'VOLUME recipe: N300,000 over 600 L = N0.50/ml',
    case when round(fn_overhead_rate(f.biz, f.ml),4)=0.5000 then 'PASS' else 'FAIL' end,
    'N'||round(fn_overhead_rate(f.biz, f.ml),4)||'/ml');
  insert into t30 values (2,'MASS recipe: N200,000 over 400 kg = N0.50/g',
    case when round(fn_overhead_rate(f.biz, f.g),4)=0.5000 then 'PASS' else 'FAIL' end,
    'N'||round(fn_overhead_rate(f.biz, f.g),4)||'/g');
  insert into t30 values (3,'COUNT recipe: N100,000 over 20,000 pieces = N5.00/piece',
    case when round(fn_overhead_rate(f.biz, f.piece),4)=5.0000 then 'PASS' else 'FAIL' end,
    'N'||round(fn_overhead_rate(f.biz, f.piece),4)||'/piece');

  insert into t30 values (4,'ONE BUSINESS operates all three dimensions at once',
    case when (select count(*) from v_recipe_cost_current
                where recipe_id in (soup,bread,packs) and is_complete) = 3
         then 'PASS' else 'FAIL' end,
    (select count(*) from v_recipe_cost_current
      where recipe_id in (soup,bread,packs) and is_complete)||' of 3 complete');

  -- PORTION-BASED allocation: 2,500 ml x N0.50 = N1,250 a portion
  select * into s from v_recipe_cost_current where recipe_id = soup;
  insert into t30 values (5,'PORTION-BASED overhead: 2,500 ml x N0.50 = N1,250',
    case when round(s.overhead_cost,2)=1250.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.overhead_cost,2));
  select * into s from v_recipe_cost_current where recipe_id = bread;
  insert into t30 values (6,'MASS portion overhead: 500 g x N0.50 = N250',
    case when round(s.overhead_cost,2)=250.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.overhead_cost,2));
  select * into s from v_recipe_cost_current where recipe_id = packs;
  insert into t30 values (7,'COUNT portion overhead: 6 pieces x N5.00 = N30',
    case when round(s.overhead_cost,2)=30.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.overhead_cost,2));
end $$;

-- ---------------------------------------------------------------------------
-- NO DOUBLE COUNTING, AND RECONCILIATION BACK TO THE POOL
-- ---------------------------------------------------------------------------
do $$
declare f record; total numeric; vol numeric; mass numeric; cnt numeric;
begin
  select * into f from fx30;
  select sum(monthly_cost) into total from overhead_items
   where business_id=f.biz and is_active;

  insert into t30 values (8,'RECONCILIATION: the configured pool is N600,000',
    case when total = 600000 then 'PASS' else 'FAIL' end, 'N'||total);

  -- each dimension draws only its OWN items, never the whole pool
  select sum(monthly_cost) filter (where applies) into vol
    from fn_overhead_breakdown(f.biz, f.ml);
  select sum(monthly_cost) filter (where applies) into mass
    from fn_overhead_breakdown(f.biz, f.g);
  select sum(monthly_cost) filter (where applies) into cnt
    from fn_overhead_breakdown(f.biz, f.piece);

  insert into t30 values (9,'NO DOUBLE COUNTING: the volume dimension draws only N300,000',
    case when vol = 300000 then 'PASS' else 'FAIL' end, 'N'||vol);
  insert into t30 values (10,'the mass dimension draws only N200,000',
    case when mass = 200000 then 'PASS' else 'FAIL' end, 'N'||mass);
  insert into t30 values (11,'the count dimension draws only N100,000',
    case when cnt = 100000 then 'PASS' else 'FAIL' end, 'N'||cnt);
  insert into t30 values (12,'RECONCILIATION: the pools sum back to the configured pool',
    case when vol + mass + cnt = total then 'PASS' else 'FAIL' end,
    'N'||vol||' + N'||mass||' + N'||cnt||' = N'||total);
  insert into t30 values (13,'and no dimension ever sees the whole N600,000',
    case when vol < total and mass < total and cnt < total then 'PASS' else 'FAIL' end,
    'largest pool N'||greatest(vol,mass,cnt));

  -- PROVENANCE: the owner can see item by item what applied and what did not
  insert into t30
  select 14, 'PROVENANCE names each item, its basis, its rate and why it did not apply',
         case when count(*) = 3
               and count(*) filter (where applies) = 1
               and count(*) filter (where reason is not null) = 2
              then 'PASS' else 'FAIL' end,
         string_agg(item_name||': '||coalesce(reason,'applied at N'||round(rate,4)), ' | ')
  from fn_overhead_breakdown(f.biz, f.ml);
end $$;

-- ---------------------------------------------------------------------------
-- BLOCKING: never zero, never a guess
-- ---------------------------------------------------------------------------
do $$
declare f record; rec uuid; s record; bad uuid;
begin
  select * into f from fx30;

  -- an item with no monthly cost blocks everything
  insert into overhead_items(id,account_id,business_id,name,monthly_cost,basis_qty,basis_unit_id)
  values (gen_random_uuid(),f.acct,f.biz,'Unknown bill',null,600,f.l) returning id into bad;
  select id into rec from recipes where name='Soup';
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t30 values (15,'MISSING COST blocks, and overhead is not zero',
    case when s.is_complete = false and s.overhead_cost is null then 'PASS' else 'FAIL' end,
    'complete='||s.is_complete||', overhead='||coalesce(s.overhead_cost::text,'NULL'));

  -- an INACTIVE item is excluded entirely
  update overhead_items set is_active = false where id = bad;
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t30 values (16,'INACTIVE item is excluded and costing resumes',
    case when s.is_complete and round(s.overhead_cost,2)=1250.00 then 'PASS' else 'FAIL' end,
    'overhead N'||coalesce(round(s.overhead_cost,2)::text,'NULL'));

  -- an item with NO basis and no business default blocks
  insert into overhead_items(id,account_id,business_id,name,monthly_cost)
  values (gen_random_uuid(),f.acct,f.biz,'Unallocated bill',50000) returning id into bad;
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t30 values (17,'NO ALLOCATION CONFIGURED blocks rather than allocating zero',
    case when s.is_complete = false then 'PASS' else 'FAIL' end, 'complete='||s.is_complete);
  insert into t30 values (18,'and the reason is reported by name',
    case when fn_overhead_problem(f.biz, f.ml) = 'missing_overhead_basis'
         then 'PASS' else 'FAIL' end, coalesce(fn_overhead_problem(f.biz,f.ml),'none'));
  update overhead_items set is_active = false where id = bad;

  -- INHERITING a business default into a dimension it cannot express blocks:
  -- the business has not decided, so the engine refuses.
  update business_settings set overhead_basis_qty = 600, overhead_basis_unit_id = f.l
   where business_id = f.biz;
  insert into overhead_items(id,account_id,business_id,name,monthly_cost)
  values (gen_random_uuid(),f.acct,f.biz,'Inherited bill',50000) returning id into bad;
  insert into t30 values (19,'INCOMPATIBLE INHERITED basis blocks, it is not silently skipped',
    case when fn_overhead_problem(f.biz, f.g) = 'overhead_basis_incompatible'
         then 'PASS' else 'FAIL' end, coalesce(fn_overhead_problem(f.biz,f.g),'none'));
  insert into t30 values (20,'but the dimension it CAN express still works',
    case when fn_overhead_problem(f.biz, f.ml) is null then 'PASS' else 'FAIL' end,
    coalesce(fn_overhead_problem(f.biz,f.ml),'none'));
  update overhead_items set is_active = false where id = bad;
  update business_settings set overhead_basis_qty = null, overhead_basis_unit_id = null
   where business_id = f.biz;
end $$;

-- ---------------------------------------------------------------------------
-- FORMAT-BASED allocation, rate changes, frozen history, isolation
-- ---------------------------------------------------------------------------
do $$
declare f record; rec uuid; fm uuid := gen_random_uuid(); v uuid := gen_random_uuid();
        before_rate numeric; after_rate numeric; s record; k int;
        u2 uuid := gen_random_uuid(); res jsonb;
begin
  select * into f from fx30;
  select id into rec from recipes where name='Soup';

  insert into serving_formats(id,account_id,business_id,name,capacity_qty,capacity_unit_id)
  values (fm,f.acct,f.biz,'2.5L Bowl',2.5,f.l);
  insert into recipe_variants(id,account_id,business_id,recipe_id,format_id,costing_basis)
  values (v,f.acct,f.biz,rec,fm,'capacity');
  perform fn_compute_recipe_cost_snapshot(rec);

  -- soup base N20,000 over 10,000 ml = N2.00/ml; 2,500 ml = N5,000
  -- overhead N0.50/ml x 2,500 = N1,250 -> N6,250, counted ONCE
  insert into t30 values (21,'FORMAT-BASED overhead applied ONCE: N5,000 + N1,250 = N6,250',
    case when round(fn_variant_cost(v),2)=6250.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v),2));

  -- changing the basis changes the current rate
  before_rate := fn_overhead_rate(f.biz, f.ml);
  update overhead_items set basis_qty = 300
   where business_id=f.biz and name='Kitchen rent (soup line)';
  after_rate := fn_overhead_rate(f.biz, f.ml);
  insert into t30 values (22,'CHANGING THE BASIS recomputes the rate: halving output doubles it',
    case when round(after_rate,4) = round(before_rate*2,4) then 'PASS' else 'FAIL' end,
    'N'||round(before_rate,4)||' -> N'||round(after_rate,4));
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t30 values (23,'and the recipe cost follows it',
    case when round(s.overhead_cost,2)=2500.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.overhead_cost,2));
  update overhead_items set basis_qty = 600
   where business_id=f.biz and name='Kitchen rent (soup line)';

  -- FROZEN HISTORY: earlier snapshots are not rewritten by later changes
  insert into t30
  select 24, 'HISTORICAL snapshots are preserved unchanged after overhead changes',
         case when count(distinct overhead_cost) > 1 then 'PASS' else 'FAIL' end,
         count(*)||' snapshot(s), '||count(distinct overhead_cost)||' distinct overhead value(s)'
  from cost_snapshots where recipe_id = rec and overhead_cost is not null;

  -- CROSS-TENANT
  insert into auth.users(id,email) values (u2,'ohrival@t.test');
  res := fn_create_account_and_business('OHR','OHR K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);
  declare k2 int; begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', u2::text, true);
    select count(*) into k from overhead_items;
    begin
      select count(*) into k2 from fn_overhead_breakdown(f.biz, f.ml);
    exception when others then k2 := -1;   -- refused is the right answer
    end;
    reset role;
    perform set_config('request.jwt.claim.sub','',true);
    insert into t30 values (25,'CROSS-TENANT another account sees no overhead items',
      case when k = 0 then 'PASS' else 'FAIL' end, k||' row(s)');
    insert into t30 values (26,'CROSS-TENANT another account cannot read this breakdown',
      case when k2 <= 0 then 'PASS' else 'FAIL' end,
      case when k2 = -1 then 'refused' else k2||' row(s)' end);
  end;
end $$;

select * from t30 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t30;

rollback;
