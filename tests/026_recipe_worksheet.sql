-- ============================================================================
-- MENU MASTER NG -- tests/026_recipe_worksheet.sql
--
-- Phase 3. Every figure the recipe worksheet displays must come from
-- PostgreSQL and reconcile with the others. Margin and markup are different
-- numbers for the same dish and must never be interchanged.
--
-- Run on a database with 0001-0036 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t26 (n int, check_name text, verdict text, detail text) on commit drop;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; g uuid; kg uuid;
  rice uuid := gen_random_uuid(); salt uuid := gen_random_uuid();
  rec uuid := gen_random_uuid(); res jsonb; v record; s record;
begin
  select id into g  from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  insert into auth.users(id,email) values (u,'worksheet@t.test');
  res := fn_create_account_and_business('WS Co','WS K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;

  -- 50 kg of rice for N85,000 -> N1.70/g
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,a,'ingredient','WS Rice',g), (salt,a,'ingredient','WS Salt',g);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (a,rice,fn_resolve_qty_to_base(rice,50,kg),85000,'purchase');

  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,a,b,'WS Jollof',4500,g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,rec,rice,4500,g,true);
  perform fn_compute_recipe_cost_snapshot(rec);
  insert into recipe_prices(account_id,recipe_id,price,effective_from)
  values (a,rec,1500,current_date);

  select * into v from v_price_check where recipe_id = rec;

  insert into t26 values (1,'cost per portion is N850.00',
    case when round(v.cost_per_portion,2)=850.00 then 'PASS' else 'FAIL' end,
    'N'||round(v.cost_per_portion,2));
  insert into t26 values (2,'profit is N650.00 at a N1,500 price',
    case when round(v.profit,2)=650.00 then 'PASS' else 'FAIL' end, 'N'||round(v.profit,2));
  insert into t26 values (3,'margin is 43.33% -- profit as a share of the PRICE',
    case when round(v.margin_pct,2)=43.33 then 'PASS' else 'FAIL' end, v.margin_pct||'%');
  insert into t26 values (4,'markup is 76.47% -- the same profit over the COST',
    case when round(v.markup_pct,2)=76.47 then 'PASS' else 'FAIL' end, v.markup_pct||'%');
  insert into t26 values (5,'margin and markup are never the same number',
    case when v.margin_pct <> v.markup_pct then 'PASS' else 'FAIL' end,
    v.margin_pct||' vs '||v.markup_pct);
  insert into t26 values (6,'markup reconciles: profit / cost x 100',
    case when round(v.markup_pct,2) = round(100.0*v.profit/v.cost_per_portion,2)
         then 'PASS' else 'FAIL' end,
    round(100.0*v.profit/v.cost_per_portion,2)::text);
  insert into t26 values (7,'margin reconciles: profit / price x 100',
    case when round(v.margin_pct,2) = round(100.0*v.profit/v.selling_price,2)
         then 'PASS' else 'FAIL' end,
    round(100.0*v.profit/v.selling_price,2)::text);
  insert into t26 values (8,'the target price reaches the target margin',
    case when v.recommended_price is not null
          and round(100.0*(v.recommended_price - v.cost_per_portion)/v.recommended_price, 0)
              >= round(v.target_margin, 0)
         then 'PASS' else 'FAIL' end,
    'N'||v.recommended_price||' for '||v.target_margin||'%');

  -- the batch figures the worksheet's summary panel shows
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t26 values (9,'batch cost is ingredients + packaging + labour',
    case when round(s.batch_cost,2)
            = round(coalesce(s.ingredient_cost,0)+coalesce(s.packaging_cost,0)+coalesce(s.labour_cost,0),2)
         then 'PASS' else 'FAIL' end,
    'N'||round(s.batch_cost,2));
  insert into t26 values (10,'cost per portion follows the batch cost and the yield',
    case when round(s.cost_per_yield_unit * 4500, 2) = round(s.batch_cost, 2)
         then 'PASS' else 'FAIL' end,
    round(s.cost_per_yield_unit,4)||' x 4500');

  -- INCOMPLETE: no profit, no margin, no markup. Unknown stays unknown.
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,rec,salt,100,g,true);              -- salt has no price
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into v from v_price_check where recipe_id = rec;

  insert into t26 values (11,'an incomplete recipe reports no profit',
    case when v.profit is null then 'PASS' else 'FAIL' end, coalesce(v.profit::text,'NULL'));
  insert into t26 values (12,'an incomplete recipe reports no margin',
    case when v.margin_pct is null then 'PASS' else 'FAIL' end, coalesce(v.margin_pct::text,'NULL'));
  insert into t26 values (13,'an incomplete recipe reports no MARKUP either',
    case when v.markup_pct is null then 'PASS' else 'FAIL' end, coalesce(v.markup_pct::text,'NULL'));
  insert into t26 values (14,'and none of them is zero',
    case when coalesce(v.profit,-1) <> 0 and coalesce(v.margin_pct,-1) <> 0
          and coalesce(v.markup_pct,-1) <> 0 then 'PASS' else 'FAIL' end, 'no zeros');

  -- per-line status drives the worksheet badges
  insert into t26
  select 15, 'every line reports a status the worksheet can render',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)||' line(s) with an unknown status'
  from v_recipe_line_costs
  where recipe_id = rec
    and problem not in ('ok','missing_price','missing_conversion','excluded','sub_recipe');

  insert into t26
  select 16, 'a line without a price is never marked costed',
         case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)||' row(s)'
  from v_recipe_line_costs
  where recipe_id = rec and problem = 'missing_price' and line_cost is null;
end $$;

-- ---------------------------------------------------------------------------
-- 17-19. THE TIE. computed_at is now(), which is transaction start, so two
-- snapshots written in one transaction share a timestamp. Before 0037 the
-- "latest" ordering was a tie and the view could return the OLD, complete
-- snapshot -- reporting a profit and a margin for a recipe the engine had
-- just refused to cost. fn_post_purchase makes this reachable in normal use.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; g uuid; kg uuid;
  rice uuid := gen_random_uuid(); salt uuid := gen_random_uuid();
  rec uuid := gen_random_uuid(); res jsonb; v record; n_tied int;
begin
  select id into g  from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  insert into auth.users(id,email) values (u,'tie26@t.test');
  res := fn_create_account_and_business('Tie Co','Tie K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,a,'ingredient','Tie Rice',g), (salt,a,'ingredient','Tie Salt',g);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (a,rice,fn_resolve_qty_to_base(rice,50,kg),85000,'purchase');
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,a,b,'Tie Jollof',4500,g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,rec,rice,4500,g,true);
  perform fn_compute_recipe_cost_snapshot(rec);
  insert into recipe_prices(account_id,recipe_id,price,effective_from)
  values (a,rec,1500,current_date);

  -- second snapshot, same transaction, now incomplete
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,rec,salt,100,g,true);
  perform fn_compute_recipe_cost_snapshot(rec);

  select count(*) into n_tied from cost_snapshots
   where recipe_id = rec
     and computed_at = (select max(computed_at) from cost_snapshots where recipe_id = rec);
  insert into t26 values (17,'the timestamps really do tie inside one transaction',
    case when n_tied > 1 then 'PASS' else 'FAIL' end, n_tied||' snapshot(s) share the newest timestamp');

  select * into v from v_recipe_cost_current where recipe_id = rec;
  insert into t26 values (18,'the view still resolves to the NEWEST snapshot, which is incomplete',
    case when v.is_complete = false then 'PASS' else 'FAIL' end,
    'is_complete='||v.is_complete);

  select * into v from v_price_check where recipe_id = rec;
  insert into t26 values (19,'so no profit, margin or markup is reported for it',
    case when v.profit is null and v.margin_pct is null and v.markup_pct is null
         then 'PASS' else 'FAIL' end,
    'profit='||coalesce(v.profit::text,'NULL')||
    ' margin='||coalesce(v.margin_pct::text,'NULL')||
    ' markup='||coalesce(v.markup_pct::text,'NULL'));
end $$;

select * from t26 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t26;

rollback;
