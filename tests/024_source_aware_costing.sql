-- ============================================================================
-- MENU MASTER NG -- tests/024_source_aware_costing.sql
--
-- Owner decision (Option A): real purchases are authoritative for ingredient
-- costing and are NEVER blended with manual estimates.
--
-- Run on a database with 0001-0034 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t24 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx24 (acct uuid, usr uuid, biz uuid, g uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); b uuid; g uuid; res jsonb;
begin
  select id into g from units where account_id is null and code='g';
  insert into auth.users(id,email) values (u,'sac@t.test');
  res := fn_create_account_and_business('SAC Co','SAC K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  insert into fx24 values (a,u,b,g);
end $$;

-- helper: build an ingredient with a given set of price rows
create or replace function pg_temp.mk(p_name text, p_rows jsonb) returns uuid
language plpgsql as $$
declare f record; ing uuid := gen_random_uuid(); r jsonb;
begin
  select * into f from fx24;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (ing,f.acct,'ingredient',p_name,f.g);
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source,effective_date)
    values (f.acct, ing, (r->>'q')::numeric, (r->>'a')::numeric,
            (r->>'s')::price_source, current_date - (r->>'d')::int);
  end loop;
  return ing;
end $$;

-- ---------------------------------------------------------------------------
-- THE DEFECT ITSELF: a manual estimate must not move a purchase-derived cost.
-- Two real purchases: 1,000 g at N1,000 and 1,000 g at N3,000 -> N2.00/g.
-- Add a manual estimate of N50.00/g. Before 0034 the average moved. It must
-- now stay at exactly N2.00.
-- ---------------------------------------------------------------------------
do $$
declare f record; ing uuid; c numeric; bas ingredient_cost_basis;
begin
  select * into f from fx24;
  ing := pg_temp.mk('Blend Rice', '[{"q":1000,"a":1000,"s":"purchase","d":10},
                                    {"q":1000,"a":3000,"s":"purchase","d":1}]'::jsonb);
  c := fn_ingredient_unit_cost(ing, f.biz);
  insert into t24 values (1,'two real purchases average to N2.00/g',
    case when round(c,4)=2.0000 then 'PASS' else 'FAIL' end, round(c,4)::text);

  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source,effective_date)
  values (f.acct, ing, 1, 50, 'manual', current_date);
  c := fn_ingredient_unit_cost(ing, f.biz);
  insert into t24 values (2,'a manual estimate does NOT move the purchase average',
    case when round(c,4)=2.0000 then 'PASS' else 'FAIL' end, round(c,4)::text);

  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (3,'basis reports purchase_window and counts only purchases',
    case when bas.basis='purchase_window' and bas.purchase_count=2 then 'PASS' else 'FAIL' end,
    bas.basis||', '||bas.purchase_count||' purchase(s)');
  insert into t24 values (4,'the evidence shown reconstructs the cost exactly',
    case when round(bas.amount/bas.qty_base,6)=round(bas.unit_cost,6) then 'PASS' else 'FAIL' end,
    bas.amount||'/'||bas.qty_base||' = '||round(bas.amount/bas.qty_base,4));
end $$;

-- ---------------------------------------------------------------------------
-- FALLBACK ORDER
-- ---------------------------------------------------------------------------
do $$
declare f record; ing uuid; bas ingredient_cost_basis;
begin
  select * into f from fx24;

  -- manual only -> estimate, clearly labelled
  ing := pg_temp.mk('Manual Only', '[{"q":1,"a":7,"s":"manual","d":1}]'::jsonb);
  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (5,'manual estimate is used when no purchase exists',
    case when bas.basis='manual' and round(bas.unit_cost,4)=7.0000 then 'PASS' else 'FAIL' end,
    bas.basis||' N'||round(bas.unit_cost,2));
  insert into t24 values (6,'an estimate never reports a purchase count',
    case when bas.purchase_count=0 then 'PASS' else 'FAIL' end, bas.purchase_count::text);

  -- a real purchase older than the 90-day window, plus a recent manual
  ing := pg_temp.mk('Stale Purchase', '[{"q":100,"a":500,"s":"purchase","d":400},
                                        {"q":1,"a":99,"s":"manual","d":1}]'::jsonb);
  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (7,'a real purchase outside the window beats a guess',
    case when bas.basis='purchase_latest' and round(bas.unit_cost,4)=5.0000 then 'PASS' else 'FAIL' end,
    bas.basis||' N'||round(bas.unit_cost,2));

  -- nothing at all
  ing := pg_temp.mk('Nothing Known', '[]'::jsonb);
  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (8,'no price at all stays UNKNOWN, never zero',
    case when bas.unit_cost is null and bas.basis='none' then 'PASS' else 'FAIL' end,
    coalesce(bas.unit_cost::text,'NULL')||' / '||bas.basis);

  -- reversed purchases are excluded, and a reversal can expose the estimate
  ing := pg_temp.mk('Reversed', '[{"q":1000,"a":2000,"s":"purchase","d":2},
                                  {"q":1,"a":9,"s":"manual","d":1}]'::jsonb);
  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (9,'purchase wins while it stands',
    case when bas.basis='purchase_window' and round(bas.unit_cost,4)=2.0000 then 'PASS' else 'FAIL' end,
    bas.basis||' N'||round(bas.unit_cost,2));
  update ingredient_prices set reversed_at = now()
   where ingredient_id = ing and source='purchase';
  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (10,'reversing the purchase falls back to the estimate, labelled',
    case when bas.basis='manual' and round(bas.unit_cost,4)=9.0000 then 'PASS' else 'FAIL' end,
    bas.basis||' N'||round(bas.unit_cost,2));

  -- benchmark_accepted is an estimate, not a purchase
  ing := pg_temp.mk('Benchmark', '[{"q":1,"a":4,"s":"benchmark_accepted","d":1}]'::jsonb);
  bas := fn_ingredient_cost_basis(ing, f.biz);
  insert into t24 values (11,'benchmark prices are treated as estimates',
    case when bas.basis='manual' then 'PASS' else 'FAIL' end, bas.basis);
end $$;

-- ---------------------------------------------------------------------------
-- THE CHANGE REACHES THE RECIPE ENGINE AND THE VIEW
-- ---------------------------------------------------------------------------
do $$
declare f record; ing uuid; rec uuid := gen_random_uuid(); snap uuid; cpp numeric; v record;
begin
  select * into f from fx24;
  ing := pg_temp.mk('Engine Rice', '[{"q":1000,"a":1000,"s":"purchase","d":10},
                                     {"q":1000,"a":3000,"s":"purchase","d":1},
                                     {"q":1,"a":500,"s":"manual","d":0}]'::jsonb);
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,f.acct,f.biz,'Engine Recipe',1000,f.g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,rec,ing,1000,f.g,true);

  snap := fn_compute_recipe_cost_snapshot(rec);
  select cost_per_portion into cpp from cost_snapshots where id = snap;
  -- 1000 g x N2.00 = N2,000 batch; 1,000 g yield -> N2.00/g; 500 g portion = N1,000
  insert into t24 values (12,'the recipe engine uses the purchase-only cost',
    case when round(cpp,2)=1000.00 then 'PASS' else 'FAIL' end, 'N'||round(cpp,2));

  select * into v from v_recipe_line_costs where recipe_id = rec;
  insert into t24 values (13,'the line view agrees with the engine',
    case when round(v.unit_cost,4)=2.0000 and round(v.line_cost,2)=2000.00 then 'PASS' else 'FAIL' end,
    'unit '||round(v.unit_cost,4)||', line '||round(v.line_cost,2));
  insert into t24 values (14,'the view exposes provenance to the page',
    case when v.cost_basis='purchase_window' and v.purchase_count=2 then 'PASS' else 'FAIL' end,
    v.cost_basis||', '||v.purchase_count);
  insert into t24 values (15,'view evidence reconstructs the view unit cost',
    case when round(v.purchase_amount/v.purchase_qty_base,6)=round(v.unit_cost,6) then 'PASS' else 'FAIL' end,
    v.purchase_amount||'/'||v.purchase_qty_base);
end $$;

-- ---------------------------------------------------------------------------
-- REGRESSION: purchase yield, and tenant isolation of the new function
-- ---------------------------------------------------------------------------
do $$
declare f record; ing uuid; usable numeric;
begin
  select * into f from fx24;
  ing := pg_temp.mk('Yield Rice', '[{"q":1000,"a":2000,"s":"purchase","d":1}]'::jsonb);
  update ingredients set purchase_yield_pct = 50 where id = ing;
  usable := fn_ingredient_usable_unit_cost(ing, f.biz);
  insert into t24 values (16,'purchase yield still applies on top of the new basis',
    case when round(usable,4)=4.0000 then 'PASS' else 'FAIL' end, round(usable,4)::text);
end $$;

do $$
declare f record; a2 uuid; u2 uuid := gen_random_uuid(); b2 uuid; res jsonb;
        ing uuid; ok boolean := false;
begin
  select * into f from fx24;
  insert into auth.users(id,email) values (u2,'sacrival@t.test');
  res := fn_create_account_and_business('Rival','Rival K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);
  b2 := (res->>'business_id')::uuid;
  select id into ing from ingredients where account_id = f.acct limit 1;
  begin
    perform fn_ingredient_cost_basis(ing, b2);     -- other account's business
  exception when others then ok := true;
  end;
  insert into t24 values (17,'the basis function refuses a cross-account ingredient',
    case when ok then 'PASS' else 'FAIL' end, case when ok then 'refused' else 'ALLOWED' end);
end $$;

select * from t24 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t24;

rollback;
