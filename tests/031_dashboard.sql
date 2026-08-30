-- ============================================================================
-- MENU MASTER NG -- tests/031_dashboard.sql
--
-- The dashboard answers five questions, and every answer is decided here so
-- the page cannot invent a different one:
--   what does it cost, what should I charge, what am I making, which products
--   make or lose money, and is anything incomplete or out of date.
--
-- Run on a database with 0001-0042 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t31 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx31 (acct uuid, usr uuid, biz uuid, g uuid, kg uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb; g uuid; kg uuid;
begin
  select id into g  from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  insert into auth.users(id,email) values (u,'dash@t.test');
  res := fn_create_account_and_business('Dash Co','Dash K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  insert into fx31 values (a,u,b,g,kg);
end $$;

-- ---------------------------------------------------------------------------
-- A BRAND NEW BUSINESS: the guide has something to say, and nothing is a zero
-- pretending to be a fact.
-- ---------------------------------------------------------------------------
do $$
declare f record; s record;
begin
  select * into f from fx31;
  select * into s from v_onboarding_status where business_id = f.biz;
  -- A new business is seeded with the starter catalogue, so it already has
  -- ingredients. What it has NOT done is price anything, make anything or
  -- cost anything, and that is what the guide must reflect.
  insert into t31 values (1,'a new business reports the work it has not yet done',
    case when s.prices_entered=0 and s.recipes=0 and s.complete_costings=0
          and s.serving_formats=0 and s.labour_rates=0 and s.overhead_items=0
         then 'PASS' else 'FAIL' end,
    'priced='||s.prices_entered||' recipes='||s.recipes||' costed='||s.complete_costings);
  insert into t31
  select 2, 'and it has no products to show, rather than products worth N0',
         case when count(*)=0 then 'PASS' else 'FAIL' end, count(*)||' row(s)'
  from v_product_attention where business_id = f.biz;
end $$;

-- ---------------------------------------------------------------------------
-- THE FIVE STATES a product can be in.
-- ---------------------------------------------------------------------------
do $$
declare
  f record; rice uuid := gen_random_uuid(); salt uuid := gen_random_uuid();
  healthy uuid := gen_random_uuid(); low uuid := gen_random_uuid();
  loss uuid := gen_random_uuid(); nopr uuid := gen_random_uuid();
  broke uuid := gen_random_uuid(); st text;
begin
  select * into f from fx31;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,f.acct,'ingredient','Dash Rice',f.g),
         (salt,f.acct,'ingredient','Dash Salt',f.g);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,rice,fn_resolve_qty_to_base(rice,50,f.kg),85000,'purchase');

  -- four costed products at N850 a portion, priced differently
  for st, healthy in select * from (values ('Healthy',healthy),('Low',low),('Loss',loss),('NoPrice',nopr)) v loop
    insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
    values (healthy,f.acct,f.biz,st||' Jollof',4500,f.g,500,'active');
    insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
    values (f.acct,healthy,rice,4500,f.g,true);
    perform fn_compute_recipe_cost_snapshot(healthy);
  end loop;

  insert into recipe_prices(account_id,recipe_id,price,effective_from) values
    (f.acct,(select id from recipes where name='Healthy Jollof'),1500,current_date),
    (f.acct,(select id from recipes where name='Low Jollof'),    1000,current_date),
    (f.acct,(select id from recipes where name='Loss Jollof'),    700,current_date);

  -- a fifth with an unpriced ingredient: incomplete
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (broke,f.acct,f.biz,'Broken Jollof',4500,f.g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,broke,rice,4000,f.g,true),(f.acct,broke,salt,100,f.g,true);
  perform fn_compute_recipe_cost_snapshot(broke);

  insert into t31
  select 3, 'HEALTHY: at or above the target margin', case when state='healthy' then 'PASS' else 'FAIL' end, state
  from v_product_attention where product_name='Healthy Jollof';
  insert into t31
  select 4, 'BELOW TARGET: profitable, but under what was asked for',
         case when state='below_target' then 'PASS' else 'FAIL' end, state
  from v_product_attention where product_name='Low Jollof';
  insert into t31
  select 5, 'UNDERCHARGING: sells for less than it costs',
         case when state='losing_money' then 'PASS' else 'FAIL' end, state
  from v_product_attention where product_name='Loss Jollof';
  insert into t31
  select 6, 'READY TO SELL: costed, but no price set yet',
         case when state='no_price_yet' then 'PASS' else 'FAIL' end, state
  from v_product_attention where product_name='NoPrice Jollof';
  insert into t31
  select 7, 'COSTING INCOMPLETE: a figure is still missing',
         case when state='costing_incomplete' then 'PASS' else 'FAIL' end, state
  from v_product_attention where product_name='Broken Jollof';

  -- an incomplete product must not carry a cost, profit or margin
  insert into t31
  select 8, 'an incomplete product shows no cost, profit or margin -- and no zero',
         case when true_cost is null and profit is null and margin_pct is null
              then 'PASS' else 'FAIL' end,
         'cost='||coalesce(true_cost::text,'NULL')||' profit='||coalesce(profit::text,'NULL')
  from v_product_attention where product_name='Broken Jollof';

  -- what needs attention comes first
  insert into t31
  select 9, 'the losing product is ranked ahead of everything else',
         case when min(attention_rank) filter (where state='losing_money')
                < min(attention_rank) filter (where state='healthy')
              then 'PASS' else 'FAIL' end,
         'loss rank '||min(attention_rank) filter (where state='losing_money')
         ||' vs healthy '||min(attention_rank) filter (where state='healthy')
  from v_product_attention where business_id=(select biz from fx31);

  -- and the figures reconcile: N850 cost, N1,500 price
  insert into t31
  select 10, 'the dashboard figures reconcile: N850 cost, N650 profit, 43.33%',
         case when round(true_cost,2)=850.00 and round(profit,2)=650.00
               and round(margin_pct,2)=43.33 then 'PASS' else 'FAIL' end,
         'N'||round(true_cost,2)||' / N'||round(profit,2)||' / '||round(margin_pct,2)||'%'
  from v_product_attention where product_name='Healthy Jollof';
end $$;

-- ---------------------------------------------------------------------------
-- INGREDIENT PRICES: needed, estimated, or out of date.
-- ---------------------------------------------------------------------------
do $$
declare f record; old uuid := gen_random_uuid(); est uuid := gen_random_uuid();
begin
  select * into f from fx31;

  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (old,f.acct,'ingredient','Old Price Item',f.g),
         (est,f.acct,'ingredient','Estimated Item',f.g);
  -- a purchase older than the 90-day costing window
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source,effective_date)
  values (f.acct,old,1000,2000,'purchase',current_date - 200);
  -- an estimate, never a purchase
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,est,1,5,'manual');

  insert into t31
  select 11, 'an ingredient never bought is reported as needing a price',
         case when price_state='never_priced' then 'PASS' else 'FAIL' end, price_state
  from v_ingredient_price_status where ingredient_name='Dash Salt';
  insert into t31
  select 12, 'a purchase older than the costing window is reported as out of date',
         case when price_state='out_of_date' then 'PASS' else 'FAIL' end, price_state
  from v_ingredient_price_status where ingredient_name='Old Price Item';
  insert into t31
  select 13, 'an estimate is reported as an estimate, not as a real price',
         case when price_state='estimate_only' then 'PASS' else 'FAIL' end, price_state
  from v_ingredient_price_status where ingredient_name='Estimated Item';
  insert into t31
  select 14, 'a recent purchase is reported as up to date',
         case when price_state='current' then 'PASS' else 'FAIL' end, price_state
  from v_ingredient_price_status where ingredient_name='Dash Rice';
  insert into t31
  select 15, 'and it says how many recipes depend on it',
         case when used_in_recipes >= 4 then 'PASS' else 'FAIL' end, used_in_recipes||' recipe(s)'
  from v_ingredient_price_status where ingredient_name='Dash Rice';
end $$;

-- ---------------------------------------------------------------------------
-- SETUP PROGRESS advances as the business actually does the work.
-- ---------------------------------------------------------------------------
do $$
declare f record; s record; fm uuid := gen_random_uuid();
begin
  select * into f from fx31;
  select * into s from v_onboarding_status where business_id = f.biz;
  insert into t31 values (16,'setup progress reflects real work done',
    case when s.ingredients >= 4 and s.recipes = 5 and s.complete_costings > 0
         then 'PASS' else 'FAIL' end,
    'ingredients='||s.ingredients||' recipes='||s.recipes||' costed='||s.complete_costings);

  insert into serving_formats(id,account_id,business_id,name,capacity_qty,capacity_unit_id)
  values (fm,f.acct,f.biz,'Takeaway',500,f.g);
  select * into s from v_onboarding_status where business_id = f.biz;
  insert into t31 values (17,'adding a size you sell advances the guide',
    case when s.serving_formats = 1 then 'PASS' else 'FAIL' end,
    s.serving_formats||' format(s)');
  insert into t31 values (18,'and it counts the products already ready to sell',
    case when s.products_ready >= 1 then 'PASS' else 'FAIL' end,
    s.products_ready||' ready');
end $$;

-- ---------------------------------------------------------------------------
-- TENANT ISOLATION on every dashboard view.
-- ---------------------------------------------------------------------------
do $$
declare f record; u2 uuid := gen_random_uuid(); res jsonb; k1 int; k2 int; k3 int;
begin
  select * into f from fx31;
  insert into auth.users(id,email) values (u2,'dashrival@t.test');
  res := fn_create_account_and_business('DRival','DRival K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into k1 from v_product_attention;
  -- Every account is seeded with the starter catalogue, so a row count is not
  -- the test. What matters is that NO row belongs to another account, and that
  -- this account's own named item is invisible.
  select count(*) into k2 from v_ingredient_price_status
   where account_id <> (select account_id from memberships limit 1)
      or ingredient_name = 'Dash Rice';
  select count(*) into k3 from v_onboarding_status where business_id = f.biz;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  insert into t31 values (19,'another account sees none of these products',
    case when k1=0 then 'PASS' else 'FAIL' end, k1||' row(s)');
  insert into t31 values (20,'another account sees no ingredient belonging to this one',
    case when k2=0 then 'PASS' else 'FAIL' end,
    k2||' foreign or named row(s) visible');
  insert into t31 values (21,'another account cannot read this business''s setup progress',
    case when k3=0 then 'PASS' else 'FAIL' end, k3||' row(s)');
end $$;

select * from t31 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t31;

rollback;
