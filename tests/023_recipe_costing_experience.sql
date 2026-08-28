-- ============================================================================
-- MENU MASTER NG -- tests/023_recipe_costing_experience.sql
--
-- Acceptance test for the Recipe Costing Experience (0033 + the recipe page).
-- Run on a database with 0001-0033 applied. Rolls everything back.
--
-- THE WORKED EXAMPLE, reconciled by hand against PostgreSQL:
--
--   Purchase   50 kg of rice for N85,000
--              base unit is g, so 50 kg = 50,000 g
--              unit cost = 85,000 / 50,000            = N1.70 per g
--   Recipe     uses 4.5 kg  = 4,500 g
--              line cost    = 4,500 x 1.70            = N7,650.00
--   Batch      4,500 g yield, no cooking loss
--              cost per g   = 7,650 / 4,500           = N1.70
--   Portion    500 g
--              cost/portion = 1.70 x 500              = N850.00
--   Sold at    N1,500
--              profit       = 1,500 - 850             = N650.00
--              margin       = 650 / 1500              = 43.33%
--
-- Every one of those figures is asserted below against what the database
-- actually returns. If the engine and this arithmetic ever disagree, the engine
-- is right and this test is the alarm.
-- ============================================================================

begin;

create temp table t23 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx23 (acct uuid, usr uuid, biz uuid, rice uuid, salt uuid,
                        rec uuid, g uuid, kg uuid, paint uuid, usr2 uuid) on commit drop;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; u2 uuid := gen_random_uuid();
  rice uuid := gen_random_uuid(); salt uuid := gen_random_uuid();
  rec uuid := gen_random_uuid(); g uuid; kg uuid; paint uuid; res jsonb;
begin
  select id into g     from units where account_id is null and code='g';
  select id into kg    from units where account_id is null and code='kg';
  select id into paint from units where account_id is null and code='paint';

  insert into auth.users(id,email) values (u,'exp@t.test'), (u2,'rival@t.test');
  res := fn_create_account_and_business('Exp Co','Exp Kitchen','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  res := fn_create_account_and_business('Rival','Rival K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);

  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,a,'ingredient','Worked Rice',g),
         (salt,a,'ingredient','Worked Salt',g);

  -- 50 kg for N85,000. kg has a universal factor, so no per-item conversion
  -- is needed and the resolver handles it.
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (a, rice, fn_resolve_qty_to_base(rice, 50, kg), 85000, 'manual');

  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,a,b,'Worked Jollof',4500,g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
  values (a,rec,rice,4.5,kg);
  perform fn_compute_recipe_cost_snapshot(rec);
  insert into recipe_prices(account_id,recipe_id,price) values (a,rec,1500);

  insert into fx23 values (a,u,b,rice,salt,rec,g,kg,paint,u2);
end $$;

-- A. FULLY COSTED RECIPE, reconciled figure by figure --------------------
insert into t23
select 1, 'purchase resolves: 50 kg = 50,000 g',
       case when v.purchase_qty_base = 50000 then 'PASS' else 'FAIL' end,
       coalesce(v.purchase_qty_base::text,'NULL')
from v_recipe_line_costs v, fx23 f where v.recipe_id = f.rec;

insert into t23
select 2, 'unit cost: 85,000 / 50,000 = 1.70 per g',
       case when round(v.unit_cost, 4) = 1.7000 then 'PASS' else 'FAIL' end,
       coalesce(round(v.unit_cost,4)::text,'NULL')
from v_recipe_line_costs v, fx23 f where v.recipe_id = f.rec;

insert into t23
select 3, 'recipe quantity resolves: 4.5 kg = 4,500 g',
       case when v.base_qty = 4500 then 'PASS' else 'FAIL' end,
       coalesce(v.base_qty::text,'NULL')
from v_recipe_line_costs v, fx23 f where v.recipe_id = f.rec;

insert into t23
select 4, 'line cost: 4,500 x 1.70 = 7,650.00',
       case when round(v.line_cost, 2) = 7650.00 then 'PASS' else 'FAIL' end,
       coalesce(round(v.line_cost,2)::text,'NULL')
from v_recipe_line_costs v, fx23 f where v.recipe_id = f.rec;

insert into t23
select 5, 'the view agrees with the engine''s batch total',
       case when round(v.line_cost,2) = round(c.batch_cost,2) then 'PASS' else 'FAIL' end,
       'line='||round(v.line_cost,2)||' batch='||round(c.batch_cost,2)
from v_recipe_line_costs v
join fx23 f on v.recipe_id = f.rec
join v_recipe_cost_current c on c.recipe_id = f.rec;

insert into t23
select 6, 'cost per portion: 1.70 x 500 = 850.00',
       case when round(c.cost_per_portion,2) = 850.00 then 'PASS' else 'FAIL' end,
       coalesce(round(c.cost_per_portion,2)::text,'NULL')
from v_recipe_cost_current c, fx23 f where c.recipe_id = f.rec;

insert into t23
select 7, 'profit at 1,500: 1,500 - 850 = 650.00',
       case when round(pc.profit,2) = 650.00 then 'PASS' else 'FAIL' end,
       coalesce(round(pc.profit,2)::text,'NULL')
from v_price_check pc, fx23 f where pc.recipe_id = f.rec;

insert into t23
select 8, 'margin: 650 / 1,500 = 43.33%',
       case when round(pc.margin_pct,2) = 43.33 then 'PASS' else 'FAIL' end,
       coalesce(round(pc.margin_pct,2)::text,'NULL')
from v_price_check pc, fx23 f where pc.recipe_id = f.rec;

-- B. MISSING PURCHASE PRICE ---------------------------------------------
do $$
declare f record;
begin
  select * into f from fx23;
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
  values (f.acct,f.rec,f.salt,50,f.g);
  perform fn_compute_recipe_cost_snapshot(f.rec);
end $$;

insert into t23
select 9, 'B: an unpriced item reports missing_price and NO line cost',
       case when v.problem = 'missing_price' and v.line_cost is null then 'PASS' else 'FAIL' end,
       'problem='||v.problem||' line_cost='||coalesce(v.line_cost::text,'NULL')
from v_recipe_line_costs v, fx23 f
where v.recipe_id = f.rec and v.ingredient_id = f.salt;

insert into t23
select 10, 'B: a priced sibling still reports its own cost',
       case when v.problem = 'ok' and round(v.line_cost,2) = 7650.00 then 'PASS' else 'FAIL' end,
       'problem='||v.problem||' line_cost='||coalesce(round(v.line_cost,2)::text,'NULL')
from v_recipe_line_costs v, fx23 f
where v.recipe_id = f.rec and v.ingredient_id = f.rice;

-- C. MISSING UNIT CONVERSION --------------------------------------------
do $$
declare f record; rec2 uuid := gen_random_uuid();
begin
  select * into f from fx23;
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec2,f.acct,f.biz,'Worked Paint',4000,f.g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
  values (f.acct,rec2,f.rice,2,f.paint);        -- no paint conversion for this rice
  perform fn_compute_recipe_cost_snapshot(rec2);
  create temp table rec2_23 on commit drop as select rec2 as id;
end $$;

insert into t23
select 11, 'C: an unconvertible unit reports missing_conversion and NO cost',
       case when v.problem = 'missing_conversion'
             and v.line_cost is null and v.base_qty is null then 'PASS' else 'FAIL' end,
       'problem='||v.problem||' base_qty='||coalesce(v.base_qty::text,'NULL')
from v_recipe_line_costs v, rec2_23 r where v.recipe_id = r.id;

insert into t23
select 12, 'C: the recipe is incomplete and shows no cost at all',
       case when c.is_complete = false and c.batch_cost is null
             and c.cost_per_portion is null then 'PASS' else 'FAIL' end,
       'complete='||c.is_complete||' batch='||coalesce(c.batch_cost::text,'NULL')
from v_recipe_cost_current c, rec2_23 r where c.recipe_id = r.id;

-- D. EDIT THE QUANTITY, RECOMPUTE ---------------------------------------
do $$
declare f record; snap uuid; before_ numeric; after_ numeric; v_line numeric;
begin
  select * into f from fx23;
  delete from recipe_lines where recipe_id = f.rec and ingredient_id = f.salt;
  snap := fn_compute_recipe_cost_snapshot(f.rec);
  select batch_cost into before_ from cost_snapshots where id = snap;

  update recipe_lines set qty = 9 where recipe_id = f.rec and ingredient_id = f.rice;
  snap := fn_compute_recipe_cost_snapshot(f.rec);
  select batch_cost into after_ from cost_snapshots where id = snap;
  select line_cost into v_line from v_recipe_line_costs
   where recipe_id = f.rec and ingredient_id = f.rice;

  insert into t23 values (13,'D: doubling 4.5 kg to 9 kg doubles the cost to 15,300',
    case when round(before_,2) = 7650.00 and round(after_,2) = 15300.00
         then 'PASS' else 'FAIL' end,
    'before='||round(before_,2)||' after='||round(after_,2));
  insert into t23 values (14,'D: the per-line view moves with it -- no stale figure',
    case when round(v_line,2) = 15300.00 then 'PASS' else 'FAIL' end,
    coalesce(round(v_line,2)::text,'NULL'));
  create temp table last_snap_23 on commit drop as select snap as id;
end $$;

-- E. SELLING BELOW COST --------------------------------------------------
--    Its own recipe with a single snapshot and a single price, for the same
--    reason as F below.
do $$
declare f record; rec4 uuid := gen_random_uuid(); m numeric; p numeric; cpp numeric;
begin
  select * into f from fx23;
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec4,f.acct,f.biz,'Worked Underpriced',1000,f.g,1000,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
  values (f.acct,rec4,f.rice,1,f.kg);              -- portion costs 1,700
  perform fn_compute_recipe_cost_snapshot(rec4);
  insert into recipe_prices(account_id,recipe_id,price) values (f.acct,rec4,1500);

  select cost_per_portion into cpp from v_recipe_cost_current where recipe_id = rec4;
  select margin_pct, profit into m, p from v_price_check where recipe_id = rec4;
  insert into t23 values (15,'E: at 1,500 against a 1,700 portion cost the margin is NEGATIVE',
    case when round(cpp,2) = 1700.00 and m < 0 and p < 0 then 'PASS' else 'FAIL' end,
    'portion_cost='||round(cpp,2)||' margin='||round(m,2)||' profit='||round(p,2));
end $$;

-- F. SELLING ABOVE COST --------------------------------------------------
--    A SEPARATE recipe with exactly ONE price row. Two prices written in the
--    same transaction share both effective_from (current_date) and created_at
--    (transaction start), and v_price_check's "latest" is then ambiguous
--    between them -- the same shape as the snapshot tie in 021 check 20, and
--    equally unreachable in production, where each save is its own transaction.
do $$
declare f record; rec3 uuid := gen_random_uuid(); m numeric; p numeric; cpp numeric;
begin
  select * into f from fx23;
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec3,f.acct,f.biz,'Worked Profitable',1000,f.g,1000,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
  values (f.acct,rec3,f.rice,1,f.kg);              -- 1,000 g x 1.70 = 1,700
  perform fn_compute_recipe_cost_snapshot(rec3);
  insert into recipe_prices(account_id,recipe_id,price) values (f.acct,rec3,3400);

  select cost_per_portion into cpp from v_recipe_cost_current where recipe_id = rec3;
  select margin_pct, profit into m, p from v_price_check where recipe_id = rec3;
  insert into t23 values (16,'F: portion costs 1,700; at 3,400 the margin is exactly 50%',
    case when round(cpp,2) = 1700.00 and round(m,2) = 50.00 and round(p,2) = 1700.00
         then 'PASS' else 'FAIL' end,
    'portion_cost='||round(cpp,2)||' margin='||round(m,2)||' profit='||round(p,2));
end $$;

-- G. PERSISTENCE ---------------------------------------------------------
--    Asserted against the snapshot the recompute actually returned, so the
--    check measures persistence rather than the same-transaction tie.
insert into t23
select 17, 'G: re-reading returns the stored snapshot, not a recomputation',
       case when round(c.batch_cost,2) = 15300.00 then 'PASS' else 'FAIL' end,
       coalesce(round(c.batch_cost,2)::text,'NULL')
from cost_snapshots c, last_snap_23 l where c.id = l.id;

-- I. CROSS-TENANT ---------------------------------------------------------
do $$
declare f record; n_lines int; n_cost int;
begin
  select * into f from fx23;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr2::text, true);
  select count(*) into n_lines from v_recipe_line_costs where recipe_id = f.rec;
  select count(*) into n_cost  from v_recipe_cost_current where recipe_id = f.rec;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t23 values
    (18,'I: another account reads 0 rows from v_recipe_line_costs',
        case when n_lines = 0 then 'PASS' else 'FAIL' end, n_lines||' row(s)'),
    (19,'I: another account reads 0 rows from the cost view',
        case when n_cost = 0 then 'PASS' else 'FAIL' end, n_cost||' row(s)');
end $$;

-- 20. The owner sees their own, as a real client
do $$
declare f record; k int;
begin
  select * into f from fx23;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  select count(*) into k from v_recipe_line_costs where recipe_id = f.rec;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t23 values (20,'the owner reads their own lines as authenticated',
    case when k = 1 then 'PASS' else 'FAIL' end, k||' row(s)');
end $$;

-- 21. The view invents no costing rule: it never returns a zero for an unknown
insert into t23
select 21, 'no line ever reports a cost of exactly 0 where an input is unknown',
       case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)||' offending row(s)'
from v_recipe_line_costs
where problem in ('missing_price','missing_conversion') and line_cost is not null;

-- ---------------------------------------------------------------------------
-- 22-24. THE PURCHASE EVIDENCE MUST RECONSTRUCT THE COST IT SITS BESIDE.
--
-- fn_ingredient_unit_cost computes a WEIGHTED AVERAGE over wavg_window_days
-- (default 90) and only falls back to the latest price when that window is
-- empty. An earlier draft of the view showed the newest purchase instead, so a
-- customer with two purchases saw "1,000 g for N3,000" beside a cost of
-- N2.00/g -- a division that does not come out. These checks pin the evidence
-- to the engine so the two cannot drift apart again.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; rice uuid := gen_random_uuid();
  rec uuid := gen_random_uuid(); g uuid; res jsonb; v record;
begin
  select id into g from units where account_id is null and code='g';
  insert into auth.users(id,email) values (u,'evidence23@t.test');
  res := fn_create_account_and_business('Ev Co','Ev K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,a,'ingredient','Evidence Rice',g);

  -- Two purchases inside the window: 1,000 g at N1,000 then 1,000 g at N3,000.
  -- The engine charges the weighted average, N2.00/g -- not the newest N3.00/g.
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source,effective_date)
  values (a,rice,1000,1000,'manual',current_date - 10),
         (a,rice,1000,3000,'manual',current_date - 1);

  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,a,b,'Evidence Recipe',1000,g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,rec,rice,1000,g,true);

  select * into v from v_recipe_line_costs where recipe_id = rec;

  insert into t23 values (22,
    'averaged evidence reconstructs the unit cost the engine charges',
    case when round(v.purchase_amount / v.purchase_qty_base, 6) = round(v.unit_cost, 6)
         then 'PASS' else 'FAIL' end,
    format('evidence %s/%s = %s vs engine %s',
           v.purchase_amount, v.purchase_qty_base,
           round(v.purchase_amount / v.purchase_qty_base, 4), round(v.unit_cost, 4)));

  insert into t23 values (23,
    'the page is told how many purchases the average covers',
    case when v.purchase_count = 2 then 'PASS' else 'FAIL' end,
    coalesce(v.purchase_count::text,'null')||' purchase(s)');

  -- A reversed purchase is excluded by the engine and must be excluded here.
  update ingredient_prices set reversed_at = now()
   where ingredient_id = rice and amount = 3000;

  select * into v from v_recipe_line_costs where recipe_id = rec;
  insert into t23 values (24,
    'a reversed purchase leaves the evidence exactly as it leaves the cost',
    case when v.purchase_count = 1
          and round(v.purchase_amount / v.purchase_qty_base, 6) = round(v.unit_cost, 6)
         then 'PASS' else 'FAIL' end,
    format('%s purchase(s), evidence %s vs engine %s', v.purchase_count,
           round(v.purchase_amount / v.purchase_qty_base, 4), round(v.unit_cost, 4)));
end $$;

-- 25. The invariant, stated once over every costed line in the database.
insert into t23
select 25, 'every costed line''s evidence reconstructs its unit cost',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*)||' line(s) whose evidence contradicts the engine'
from v_recipe_line_costs v
join ingredients ing on ing.id = v.ingredient_id
where v.problem = 'ok'
  and v.purchase_qty_base > 0
  and round(v.purchase_amount / v.purchase_qty_base
            / (ing.purchase_yield_pct / 100.0), 6) <> round(v.unit_cost, 6);

select * from t23 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail
from t23;

rollback;
