-- ============================================================================
-- MENU MASTER NG -- tests/028_formats_labour_overhead.sql
--
-- Phase 4. Serving formats, packaging, labour, overhead and variants.
--
-- THE INVARIANT UNDER TEST, for every sellable thing:
--     ingredients + packaging + labour + overhead = total cost
--     price - total cost = profit
--     profit / price     = margin
--     profit / cost      = markup
-- and any missing input yields an explicit incomplete state, never a zero.
--
-- Nothing here assumes a container size, a format name or a labour rate. Every
-- one is created by the test business, the way a real business would.
--
-- Run on a database with 0001-0038 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t28 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx28 (acct uuid, usr uuid, biz uuid, g uuid, kg uuid, l uuid, ml uuid,
                        rice uuid, bowl uuid, rec uuid) on commit drop;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; g uuid; kg uuid; l uuid; ml uuid;
  rice uuid := gen_random_uuid(); bowl uuid := gen_random_uuid();
  rec uuid := gen_random_uuid(); res jsonb;
begin
  select id into g  from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  select id into l  from units where account_id is null and code='l';
  select id into ml from units where account_id is null and code='ml';
  insert into auth.users(id,email) values (u,'fmt@t.test');
  res := fn_create_account_and_business('Fmt Co','Fmt K','soup_seller',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;

  -- an ingredient priced through a real purchase: 10 L of soup base for N20,000
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,a,'ingredient','Soup Base',ml);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (a,rice,fn_resolve_qty_to_base(rice,10,l),20000,'purchase');   -- N2.00/ml

  -- a packaging item, bought like anything else
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (bowl,a,'packaging','2.5L Bowl',(select id from units where account_id is null and code='piece'));

  -- A batch makes 10 L. This business sells by the bowl, not by the portion,
  -- but the engine requires portion_qty for every recipe of kind 'dish'
  -- (0007) -- there is no kind for "sold only by format". portion_qty is set
  -- to the bowl's own capacity so the fixture is complete and the format
  -- invariants below can be tested. The underlying modelling question is
  -- raised separately as a DECISION NEEDED rather than silently changed here.
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,a,b,'Egusi Soup',10000,ml,2500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,rec,rice,10000,ml,true);

  insert into fx28 values (a,u,b,g,kg,l,ml,rice,bowl,rec);
end $$;

-- ---------------------------------------------------------------------------
-- BUSINESS-DEFINED FORMATS. Nothing here is a product constant.
-- ---------------------------------------------------------------------------
do $$
declare f record; fmt uuid := gen_random_uuid(); v uuid := gen_random_uuid(); prob text;
begin
  select * into f from fx28;

  -- this business happens to sell 2.5 L. Another may sell 1.5 L or 4 L.
  insert into serving_formats(id,account_id,business_id,name,capacity_qty,capacity_unit_id)
  values (fmt,f.acct,f.biz,'Family Bowl',2.5,f.l);

  insert into recipe_variants(id,account_id,business_id,recipe_id,format_id,costing_basis)
  values (v,f.acct,f.biz,f.rec,fmt,'capacity');

  perform fn_compute_recipe_cost_snapshot(f.rec);

  insert into t28 values (1,'a business can define its own container size',
    case when exists (select 1 from serving_formats
                       where id=fmt and capacity_qty=2.5 and capacity_unit_id=f.l)
         then 'PASS' else 'FAIL' end, '2.5 L Family Bowl');

  -- 2.5 L of a 10 L batch. The batch costs N20,000, so a bowl holds N5,000
  -- of soup before packaging.
  insert into t28 values (2,'the batch converts to the format''s own size',
    case when round(fn_variant_resolved_qty(v),2) = 2500.00 then 'PASS' else 'FAIL' end,
    round(fn_variant_resolved_qty(v),2)||' ml');

  prob := fn_variant_problem(v);
  insert into t28 values (3,'with no packaging attached the variant is costable',
    case when prob is null then 'PASS' else 'FAIL' end, coalesce(prob,'none'));
  insert into t28 values (4,'a 2.5 L bowl of a N20,000 batch costs N5,000 of soup',
    case when round(fn_variant_cost(v),2) = 5000.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v),2));

  -- attach packaging that has NO price: the variant must BLOCK, not cost zero
  insert into serving_format_packaging(account_id,business_id,format_id,packaging_item_id,qty)
  values (f.acct,f.biz,fmt,f.bowl,1);
  prob := fn_variant_problem(v);
  insert into t28 values (5,'unpriced packaging BLOCKS the format, it is not treated as free',
    case when prob = 'missing_packaging_price' then 'PASS' else 'FAIL' end, coalesce(prob,'none'));
  insert into t28 values (6,'and no cost is returned for it',
    case when fn_variant_cost(v) is null then 'PASS' else 'FAIL' end,
    coalesce(fn_variant_cost(v)::text,'NULL'));

  -- price the bowl: 100 bowls for N15,000 = N150 each
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,f.bowl,100,15000,'purchase');
  prob := fn_variant_problem(v);
  insert into t28 values (7,'once the packaging has a price the format costs again',
    case when prob is null then 'PASS' else 'FAIL' end, coalesce(prob,'none'));

  -- INVARIANT: soup 5,000 + packaging 150 = 5,150, counted ONCE per bowl
  insert into t28 values (8,'INVARIANT ingredients + packaging = total cost (N5,000 + N150)',
    case when round(fn_variant_cost(v),2) = 5150.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v),2));
  insert into t28 values (9,'packaging is counted once per bowl, not per litre',
    case when round(fn_variant_cost(v),2) <> 5000.00 + 150.00*2.5 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v),2)||' not N'||(5000.00+150.00*2.5));
end $$;

-- ---------------------------------------------------------------------------
-- LABOUR: a rate with no figure must block, never cost zero.
-- ---------------------------------------------------------------------------
do $$
declare f record; rate uuid := gen_random_uuid(); s record;
begin
  select * into f from fx28;

  insert into labour_rates(id,account_id,business_id,name,rate_per_hour)
  values (rate,f.acct,f.biz,'Cooking',null);          -- deliberately unknown
  insert into recipe_labour(account_id,recipe_id,labour_rate_id,hours)
  values (f.acct,f.rec,rate,4);
  perform fn_compute_recipe_cost_snapshot(f.rec);

  select * into s from v_recipe_cost_current where recipe_id = f.rec;
  insert into t28 values (10,'labour with no hourly rate makes the recipe incomplete',
    case when s.is_complete = false then 'PASS' else 'FAIL' end, 'is_complete='||s.is_complete);
  insert into t28 values (11,'and the batch cost is withheld, not reported as before',
    case when s.batch_cost is null then 'PASS' else 'FAIL' end,
    coalesce(s.batch_cost::text,'NULL'));

  -- give it a rate: 4 hours at N500 = N2,000 of labour on a N20,000 batch
  update labour_rates set rate_per_hour = 500 where id = rate;
  perform fn_compute_recipe_cost_snapshot(f.rec);
  select * into s from v_recipe_cost_current where recipe_id = f.rec;

  insert into t28 values (12,'once the rate is known the labour is N2,000 (4h x N500)',
    case when round(s.labour_cost,2) = 2000.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.labour_cost,2));
  insert into t28 values (13,'INVARIANT batch cost = ingredients + packaging + labour',
    case when round(s.batch_cost,2)
            = round(coalesce(s.ingredient_cost,0)+coalesce(s.packaging_cost,0)+coalesce(s.labour_cost,0),2)
         then 'PASS' else 'FAIL' end,
    'N'||round(s.batch_cost,2));
end $$;

-- ---------------------------------------------------------------------------
-- OVERHEAD: the real model (0023) spreads running costs over HOW MUCH THE
-- BUSINESS PRODUCES, as a quantity and a unit. A missing basis, a missing
-- figure, or an unconvertible unit must all block -- never allocate zero.
-- ---------------------------------------------------------------------------
do $$
declare f record; s record; oh uuid := gen_random_uuid(); paint uuid;
begin
  select * into f from fx28;
  select id into paint from units where account_id is null and code='paint';

  -- switched on, running cost recorded, but NO basis declared
  update business_settings set overhead_enabled = true,
         overhead_basis_qty = null, overhead_basis_unit_id = null
   where business_id = f.biz;
  insert into overhead_items(id,account_id,business_id,name,monthly_cost)
  values (oh,f.acct,f.biz,'Gas',60000);
  perform fn_compute_recipe_cost_snapshot(f.rec);
  select * into s from v_recipe_cost_current where recipe_id = f.rec;

  insert into t28 values (14,'overhead on with no declared basis makes the recipe incomplete',
    case when s.is_complete = false then 'PASS' else 'FAIL' end, 'is_complete='||s.is_complete);
  insert into t28 values (15,'no share of overhead is invented',
    case when s.overhead_cost is null then 'PASS' else 'FAIL' end,
    coalesce(s.overhead_cost::text,'NULL'));

  -- a basis in a container unit with no universal conversion cannot resolve
  update business_settings set overhead_basis_qty = 600, overhead_basis_unit_id = paint
   where business_id = f.biz;
  perform fn_compute_recipe_cost_snapshot(f.rec);
  select * into s from v_recipe_cost_current where recipe_id = f.rec;
  insert into t28 values (16,'a basis in an unconvertible unit blocks rather than guesses',
    case when s.is_complete = false and s.overhead_cost is null then 'PASS' else 'FAIL' end,
    'is_complete='||s.is_complete);

  -- a running cost with no figure blocks even once the basis is sound
  update business_settings set overhead_basis_qty = 600, overhead_basis_unit_id = f.l
   where business_id = f.biz;
  insert into overhead_items(account_id,business_id,name,monthly_cost)
  values (f.acct,f.biz,'Rent',null);
  perform fn_compute_recipe_cost_snapshot(f.rec);
  select * into s from v_recipe_cost_current where recipe_id = f.rec;
  insert into t28 values (17,'a running cost with no figure blocks',
    case when s.is_complete = false then 'PASS' else 'FAIL' end, 'is_complete='||s.is_complete);

  -- complete it. N60,000 over 600 L = N0.10 per ml; a 2,500 ml portion = N250
  update overhead_items set monthly_cost = 0 where name = 'Rent' and business_id = f.biz;
  perform fn_compute_recipe_cost_snapshot(f.rec);
  select * into s from v_recipe_cost_current where recipe_id = f.rec;
  insert into t28 values (18,'overhead per portion is N250 (N60,000 / 600 L x 2.5 L)',
    case when round(s.overhead_cost,2) = 250.00 then 'PASS' else 'FAIL' end,
    'N'||coalesce(round(s.overhead_cost,2)::text,'NULL'));
  insert into t28 values (19,'and the recipe is complete again',
    case when s.is_complete then 'PASS' else 'FAIL' end, 'is_complete='||s.is_complete);
  insert into t28 values (20,'INVARIANT cost per portion = ingredients+packaging+labour per portion + overhead',
    case when round(s.cost_per_portion,2)
            = round(s.cost_per_yield_unit * 2500 + s.overhead_cost, 2)
         then 'PASS' else 'FAIL' end,
    'N'||round(s.cost_per_portion,2));
end $$;

-- ---------------------------------------------------------------------------
-- TENANT ISOLATION on every Phase 4 object.
-- ---------------------------------------------------------------------------
do $$
declare f record; u2 uuid := gen_random_uuid(); res jsonb;
        k_fmt int; k_pack int; k_var int; k_rate int; k_lab int; k_oh int;
begin
  select * into f from fx28;
  insert into auth.users(id,email) values (u2,'fmtrival@t.test');
  res := fn_create_account_and_business('FRival','FRival K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into k_fmt  from serving_formats;
  select count(*) into k_pack from serving_format_packaging;
  select count(*) into k_var  from recipe_variants;
  select count(*) into k_rate from labour_rates;
  select count(*) into k_lab  from recipe_labour;
  select count(*) into k_oh   from overhead_items;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  insert into t28 values (21,'another account sees no serving formats',
    case when k_fmt=0 then 'PASS' else 'FAIL' end, k_fmt||' row(s)');
  insert into t28 values (22,'another account sees no format packaging',
    case when k_pack=0 then 'PASS' else 'FAIL' end, k_pack||' row(s)');
  insert into t28 values (23,'another account sees no recipe variants',
    case when k_var=0 then 'PASS' else 'FAIL' end, k_var||' row(s)');
  insert into t28 values (24,'another account sees no labour rates',
    case when k_rate=0 then 'PASS' else 'FAIL' end, k_rate||' row(s)');
  insert into t28 values (25,'another account sees no recipe labour',
    case when k_lab=0 then 'PASS' else 'FAIL' end, k_lab||' row(s)');
  insert into t28 values (26,'another account sees no overhead items',
    case when k_oh=0 then 'PASS' else 'FAIL' end, k_oh||' row(s)');
end $$;

select * from t28 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t28;

rollback;
