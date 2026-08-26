-- ============================================================================
-- MENU MASTER NG -- tests/015_gate2_repoint.sql
--
-- Acceptance test for 0025 (Gate 2, Phase 5 -- the repoint).
-- Run on a database with 0021-0025 applied. Rolls everything back.
--
-- The compatibility property (a recipe with no variants produces exactly the
-- row it produced before) is proven separately by a byte-for-byte before/after
-- diff of v_price_check. This suite covers the variant path, the sale freeze
-- and the completeness constraint.
-- ============================================================================

begin;

create temp table t6_result (n int, check_name text, verdict text, detail text)
  on commit drop;

do $$
declare
  aA uuid := gen_random_uuid(); uA uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  u_l uuid; u_g uuid; u_pc uuid; ch uuid := gen_random_uuid();
  ing uuid := gen_random_uuid(); pkg uuid := gen_random_uuid();
  rV uuid := gen_random_uuid(); rNo uuid := gen_random_uuid();
  fSm uuid := gen_random_uuid(); fLg uuid := gen_random_uuid();
  vSm uuid := gen_random_uuid(); vLg uuid := gen_random_uuid();
  se uuid := gen_random_uuid(); se2 uuid := gen_random_uuid();
  s uuid; snapSm uuid; snapLg uuid;
  n int; num numeric; num2 numeric; txt text;
begin
  select id into u_l from units where account_id is null and code='l';
  select id into u_g from units where account_id is null and code='g';
  select id into u_pc from units where account_id is null and kind='count' limit 1;

  insert into auth.users (id,email) values (uA,'rp@t.test');
  insert into accounts (id,name) values (aA,'RP');
  insert into businesses (id,account_id,name,slug,type) values (b,aA,'RP Biz','rp','soup_seller');
  insert into memberships (account_id,business_id,user_id,role) values (aA,b,uA,'owner');
  insert into business_settings (business_id,account_id,overhead_enabled) values (b,aA,false);
  insert into channels (id,account_id,business_id,name,commission_pct,is_default)
    values (ch,aA,b,'Walk-in',0,true);
  insert into ingredients (id,account_id,kind,name,base_unit_id) values
    (ing,aA,'ingredient','Rice',u_g), (pkg,aA,'packaging','Bowl',u_pc);
  insert into ingredient_prices (account_id,ingredient_id,qty_base,amount,source) values
    (aA,ing,1000,5000,'manual'), (aA,pkg,10,1000,'manual');

  insert into recipes (id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty) values
    (rV ,aA,b,'Egusi'   ,10,u_l,1.5),
    (rNo,aA,b,'No variant',10,u_l,1.5);
  insert into recipe_lines (account_id,recipe_id,ingredient_id,qty,unit_id) values
    (aA,rV,ing,1000,u_g), (aA,rNo,ing,1000,u_g);
  s := fn_compute_recipe_cost_snapshot(rV);
  s := fn_compute_recipe_cost_snapshot(rNo);

  -- two sizes of the same dish: 1.5 L and 5 L
  insert into serving_formats (id,account_id,business_id,name) values
    (fSm,aA,b,'Small'), (fLg,aA,b,'Large');
  insert into recipe_variants (id,account_id,business_id,recipe_id,format_id,
                               costing_basis,sellable_qty,sellable_unit_id) values
    (vSm,aA,b,rV,fSm,'explicit_qty',1.5,u_l),
    (vLg,aA,b,rV,fLg,'explicit_qty',5  ,u_l);
  insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
    values (aA,b,fLg,pkg,1);      -- the large format ships in a bowl

  snapSm := fn_compute_variant_cost_snapshot(vSm);
  snapLg := fn_compute_variant_cost_snapshot(vLg);

  -- ================================================ 1. variant snapshots
  select resolved_qty into num from cost_snapshots where id=snapLg;
  insert into t6_result values (1,'a variant snapshot records what was sold',
    case when num = 5 then 'PASS' else 'FAIL' end,
    'resolved_qty = '||coalesce(num::text,'NULL')||' (expected 5)');

  select basis_used::text into txt from cost_snapshots where id=snapLg;
  insert into t6_result values (2,'and the basis it used',
    case when txt='explicit_qty' then 'PASS' else 'FAIL' end, coalesce(txt,'NULL'));

  select format_packaging_cost into num from cost_snapshots where id=snapLg;
  insert into t6_result values (3,'and its format packaging separately from recipe packaging',
    case when num = 100 then 'PASS' else 'FAIL' end,
    'format_packaging_cost = '||coalesce(num::text,'NULL')||' (expected 100)');

  select cost_per_portion into num  from cost_snapshots where id=snapSm;
  select cost_per_portion into num2 from cost_snapshots where id=snapLg;
  insert into t6_result values (4,'a larger format costs proportionally more',
    case when num is not null and num2 is not null
          and abs(num2 - (num/1.5*5 + 100)) <= 0.000001 then 'PASS' else 'FAIL' end,
    'small '||coalesce(num::text,'NULL')||' vs large '||coalesce(num2::text,'NULL'));

  -- ================================================ 2. v_price_check repointed
  select count(*) into n from v_price_check where recipe_id=rV and variant_id is not null;
  insert into t6_result values (5,'a recipe with variants yields one row per variant',
    case when n = 2 then 'PASS' else 'FAIL' end, n||' variant row(s)');

  select count(*) into n from v_price_check where recipe_id=rV and variant_id is null;
  insert into t6_result values (6,'and no orphan recipe-level row beside them',
    case when n = 0 then 'PASS' else 'FAIL' end, n||' recipe-level row(s)');

  select count(*) into n from v_price_check where recipe_id=rNo and variant_id is null;
  insert into t6_result values (7,'a recipe with no variants keeps its recipe-level row',
    case when n = 1 then 'PASS' else 'FAIL' end, n||' row(s)');

  -- a price attached to the variant must win over the legacy recipe price
  insert into recipe_prices (account_id,recipe_id,price,channel_id) values (aA,rV,3000,ch);
  insert into recipe_prices (account_id,recipe_id,variant_id,price,channel_id)
    values (aA,rV,vLg,12000,ch);
  select selling_price into num from v_price_check where variant_id=vLg;
  insert into t6_result values (8,'a variant price beats the legacy recipe price',
    case when num = 12000 then 'PASS' else 'FAIL' end,
    'selling_price = '||coalesce(num::text,'NULL')||' (expected 12000)');
  select selling_price into num from v_price_check where variant_id=vSm;
  insert into t6_result values (9,'a variant with no price of its own falls back',
    case when num = 3000 then 'PASS' else 'FAIL' end,
    'selling_price = '||coalesce(num::text,'NULL')||' (expected 3000)');

  -- ================================================ 3. the sale freeze
  insert into sales_entries (id,account_id,business_id,recipe_id,variant_id,qty,unit_price)
    values (se,aA,b,rV,vLg,1,12000);
  select unit_cost_at_sale, cost_snapshot_id into num, txt from sales_entries where id=se;
  select cost_per_portion into num2 from cost_snapshots where id=snapLg;
  insert into t6_result values (10,'a sale naming a variant freezes the VARIANT cost',
    case when num is not null and num = num2 then 'PASS' else 'FAIL' end,
    'froze '||coalesce(num::text,'NULL')||', variant cost '||coalesce(num2::text,'NULL'));

  insert into sales_entries (id,account_id,business_id,recipe_id,qty,unit_price)
    values (se2,aA,b,rNo,1,3500);
  select unit_cost_at_sale into num from sales_entries where id=se2;
  select cost_per_portion into num2 from cost_snapshots
   where recipe_id=rNo and variant_id is null order by computed_at desc limit 1;
  insert into t6_result values (11,'a sale with no variant freezes exactly as before',
    case when num is not null and num = num2 then 'PASS' else 'FAIL' end,
    'froze '||coalesce(num::text,'NULL')||', recipe cost '||coalesce(num2::text,'NULL'));

  -- ================================================ 4. the completeness gate
  begin
    insert into cost_snapshots (account_id,business_id,recipe_id,variant_id,costing_method,
                                is_complete,required_inputs,priced_inputs)
      values (aA,b,rV,vSm,'weighted_average',true,1,1);
    insert into t6_result values (12,'a complete VARIANT snapshot needs a resolved qty',
      'FAIL','completeness was claimed with no resolved quantity');
  exception when others then
    insert into t6_result values (12,'a complete VARIANT snapshot needs a resolved qty',
      'PASS', sqlerrm);
  end;

  begin
    insert into cost_snapshots (account_id,business_id,recipe_id,costing_method,
                                is_complete,required_inputs,priced_inputs)
      values (aA,b,rNo,'weighted_average',true,1,1);
    insert into t6_result values (13,'a recipe-level snapshot is NOT constrained by it',
      'PASS','sub-recipes have no sold quantity; the engine still works');
  exception when others then
    insert into t6_result values (13,'a recipe-level snapshot is NOT constrained by it',
      'FAIL','THE 0021 DEFECT HAS RETURNED: '||sqlerrm);
  end;
end
$$;

-- ================================================ 5. nothing else moved
do $$
declare n int; v_cols int;
begin
  select count(distinct table_name) into n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public';
  insert into t6_result values (14,'anon still reads exactly 5 reference tables',
    case when n=5 then 'PASS' else 'FAIL' end, n||' table(s)');

  select count(*) into n from pg_policies where schemaname='public';
  insert into t6_result values (15,'RLS policy count unchanged at 105',
    case when n=105 then 'PASS' else 'FAIL' end, n::text);

  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='v_price_check';
  insert into t6_result values (16,'v_price_check keeps its 20 columns and appends 3',
    case when v_cols=23 then 'PASS' else 'FAIL' end, v_cols||' columns');

  select count(*) into n from information_schema.columns
   where table_schema='public'
     and ((table_name='recipes' and column_name='portion_qty')
       or (table_name='business_settings' and column_name='expected_monthly_units'));
  insert into t6_result values (17,'both deprecated legacy columns retained',
    case when n=2 then 'PASS' else 'FAIL' end, n||' of 2 present');
end
$$;

select n, check_name, verdict, left(detail,64) as detail from t6_result order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t6_result;

rollback;
