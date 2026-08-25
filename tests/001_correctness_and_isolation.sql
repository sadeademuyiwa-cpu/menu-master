-- ============================================================================
-- MENU MASTER NG
-- Test suite 001: correctness and data isolation
--
-- Run against a freshly migrated database. Every test must PASS before any
-- frontend work begins. This is a financial application: a silent zero is
-- worse than a crash.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

create table if not exists _test_results (
  seq serial primary key,
  name text,
  passed boolean,
  detail text
);
truncate _test_results restart identity;

create or replace function t_assert(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _test_results (name, passed, detail) values (p_name, coalesce(p_ok,false), p_detail);
end; $$;

-- ============================================================================
-- FIXTURES: two accounts buying the same goods at different prices
-- ============================================================================

do $fixture$
declare
  uA uuid; uB uuid; uM uuid;
  accA uuid; accB uuid; bizA uuid; bizB uuid;
  onboardA jsonb; onboardB jsonb;
  u_paint uuid; u_kg uuid; u_g uuid; u_basket uuid; u_l uuid; u_ml uuid;
  riceA uuid; riceB uuid; beansA uuid; tomA uuid; oilA uuid; packA uuid;
  purA uuid; purB uuid; plineA uuid;
begin
  insert into auth.users (id, email) values
    (gen_random_uuid(), 'sade@lagos.test') returning id into uA;
  insert into auth.users (id, email) values
    (gen_random_uuid(), 'owner@abuja.test') returning id into uB;
  insert into auth.users (id, email) values
    (gen_random_uuid(), 'manager@abuja.test') returning id into uM;

  onboardA := fn_create_account_and_business('Slim Olobe Group','Slim Olobe Kitchen','soup_seller', uA, p_idempotency_key => gen_random_uuid()::text);
  onboardB := fn_create_account_and_business('Abuja Foods','Abuja Kitchen','restaurant', uB, p_idempotency_key => gen_random_uuid()::text);

  accA := (onboardA->>'account_id')::uuid;  bizA := (onboardA->>'business_id')::uuid;
  accB := (onboardB->>'account_id')::uuid;  bizB := (onboardB->>'business_id')::uuid;

  -- A manager in account B, and ONLY in account B
  insert into memberships (account_id, business_id, user_id, role)
  values (accB, null, uM, 'manager');

  select id into u_paint  from units where account_id is null and code='paint';
  select id into u_kg     from units where account_id is null and code='kg';
  select id into u_g      from units where account_id is null and code='g';
  select id into u_basket from units where account_id is null and code='basket';
  select id into u_l      from units where account_id is null and code='l';
  select id into u_ml     from units where account_id is null and code='ml';

  select id into riceA  from ingredients where account_id=accA and name='Rice (local)';
  select id into riceB  from ingredients where account_id=accB and name='Rice (local)';
  select id into beansA from ingredients where account_id=accA and name='Brown beans';
  select id into tomA   from ingredients where account_id=accA and name='Tomato';
  select id into oilA   from ingredients where account_id=accA and name='Palm oil';
  select id into packA  from ingredients where account_id=accA and name='Takeaway pack (medium)';

  -- Account A's OWN conversion: one paint of rice is 4 kg in her experience.
  -- Deliberately NOT set for beans, and never set for account B.
  insert into ingredient_unit_conversions (account_id, ingredient_id, unit_id, qty_in_base)
  values (accA, riceA, u_paint, 4000);

  -- Account A buys 1 paint of rice for 60,000
  insert into purchases (account_id, business_id, purchase_date, reference)
  values (accA, bizA, current_date, 'TEST-A-1') returning id into purA;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (accA, purA, riceA, 1, u_paint, 60000);
  perform fn_post_purchase(purA);

  create temp table _fx as select
    uA, uB, uM, accA, accB, bizA, bizB,
    u_paint, u_kg, u_g, u_basket, u_l, u_ml,
    riceA, riceB, beansA, tomA, oilA, packA, purA;
end $fixture$;

-- ============================================================================
-- TEST 1: Account A's price cannot affect Account B's costing
-- ============================================================================
do $$
declare vA numeric; vB numeric;
begin
  select fn_ingredient_unit_cost(riceA, bizA) into vA from _fx;
  select fn_ingredient_unit_cost(riceB, bizB) into vB from _fx;
  perform t_assert('T01 account A price does not reach account B',
    vA is not null and vB is null,
    format('A=%s (expected 15), B=%s (expected NULL)', vA, vB));
end $$;

-- ============================================================================
-- TEST 2: Rice paint conversion must not apply to beans
-- ============================================================================
do $$
declare v_rice numeric; v_beans numeric;
begin
  select fn_resolve_qty_to_base(riceA, 1, u_paint) into v_rice from _fx;
  select fn_resolve_qty_to_base(beansA, 1, u_paint) into v_beans from _fx;
  perform t_assert('T02 rice paint conversion does not leak to beans',
    v_rice = 4000 and v_beans is null,
    format('rice=%s (expected 4000), beans=%s (expected NULL)', v_rice, v_beans));
end $$;

-- ============================================================================
-- TEST 3: Missing price returns NULL, never zero
-- ============================================================================
do $$
declare v numeric;
begin
  select fn_ingredient_unit_cost(tomA, bizA) into v from _fx;
  perform t_assert('T03 missing price is NULL not zero',
    v is null, format('got %s', coalesce(v::text,'NULL')));
end $$;

-- ============================================================================
-- TEST 4: Missing conversion returns NULL, never zero
-- ============================================================================
do $$
declare v numeric;
begin
  select fn_resolve_qty_to_base(tomA, 1, u_basket) into v from _fx;
  perform t_assert('T04 missing conversion is NULL not zero',
    v is null, format('got %s', coalesce(v::text,'NULL')));
end $$;

-- ============================================================================
-- Build one complete recipe and one incomplete recipe
-- ============================================================================
do $$
declare
  f record; rid_ok uuid; rid_bad uuid; snap uuid;
begin
  select * into f from _fx;

  -- COMPLETE: jollof, rice only, priced and convertible
  insert into recipes (account_id, business_id, kind, name,
                       batch_yield_qty, yield_unit_id, cooking_yield_pct,
                       portion_qty, status)
  values (f.accA, f.bizA, 'dish', 'Jollof Rice', 5000, f.u_g, 100, 500, 'active')
  returning id into rid_ok;

  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id)
  values (f.accA, rid_ok, f.riceA, 1000, f.u_g);

  -- INCOMPLETE: stew, tomato has no price at all
  insert into recipes (account_id, business_id, kind, name,
                       batch_yield_qty, yield_unit_id, cooking_yield_pct,
                       portion_qty, status)
  values (f.accA, f.bizA, 'dish', 'Tomato Stew', 4000, f.u_g, 92, 400, 'active')
  returning id into rid_bad;

  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id)
  values (f.accA, rid_bad, f.tomA, 2000, f.u_g);

  perform fn_compute_recipe_cost_snapshot(rid_ok);
  perform fn_compute_recipe_cost_snapshot(rid_bad);

  insert into recipe_prices (account_id, recipe_id, price)
  values (f.accA, rid_ok, 3500), (f.accA, rid_bad, 2000);

  create temp table _fx2 as select rid_ok, rid_bad;
end $$;

-- ============================================================================
-- TEST 5 and 6: incomplete recipe yields no margin and no recommended price
-- ============================================================================
do $$
declare v record;
begin
  select pc.* into v
  from v_price_check pc, _fx2 f
  where pc.recipe_id = f.rid_bad limit 1;

  perform t_assert('T05 incomplete recipe produces no margin',
    v.margin_pct is null and v.cost_per_portion is null,
    format('margin=%s cost_per_portion=%s is_complete=%s',
           coalesce(v.margin_pct::text,'NULL'),
           coalesce(v.cost_per_portion::text,'NULL'), v.is_complete));

  perform t_assert('T06 incomplete recipe produces no recommended price',
    v.recommended_price is null,
    format('recommended=%s', coalesce(v.recommended_price::text,'NULL')));

  perform t_assert('T06b incomplete recipe still shows a labelled floor',
    v.cost_floor_per_portion is not null or v.unpriced_items <> '[]'::jsonb,
    format('floor=%s unpriced=%s',
           coalesce(v.cost_floor_per_portion::text,'NULL'), v.unpriced_items));
end $$;

-- Sanity: the complete recipe DOES produce a margin
do $$
declare v record;
begin
  select pc.* into v from v_price_check pc, _fx2 f where pc.recipe_id = f.rid_ok limit 1;
  perform t_assert('T06c complete recipe produces margin and recommended price',
    v.is_complete and v.margin_pct is not null and v.recommended_price is not null
      and v.cost_per_portion = 1500,
    format('cost=%s margin=%s recommended=%s',
           v.cost_per_portion, v.margin_pct, v.recommended_price));
end $$;

-- ============================================================================
-- TEST 7 and 8: cost snapshots cannot be updated or deleted
-- ============================================================================
do $$
declare ok boolean := false;
begin
  begin
    update cost_snapshots set cost_per_portion = 1 where id in (select id from cost_snapshots limit 1);
  exception when others then ok := true;
  end;
  perform t_assert('T07 cost snapshot cannot be UPDATEd', ok);
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from cost_snapshots where id in (select id from cost_snapshots limit 1);
  exception when others then ok := true;
  end;
  perform t_assert('T08 cost snapshot cannot be DELETEd', ok);
end $$;

-- ============================================================================
-- TEST 9: a price change creates a NEW snapshot, never rewrites the old one
-- ============================================================================
do $$
declare
  f record; f2 record;
  old_id uuid; old_cost numeric; new_cost numeric;
  n_before int; n_after int; pur2 uuid;
begin
  select * into f from _fx; select * into f2 from _fx2;

  select id, cost_per_portion into old_id, old_cost
  from cost_snapshots where recipe_id = f2.rid_ok
  order by computed_at desc limit 1;

  select count(*) into n_before from cost_snapshots where recipe_id = f2.rid_ok;

  -- Rice doubles in price
  insert into purchases (account_id, business_id, purchase_date, reference)
  values (f.accA, f.bizA, current_date, 'TEST-A-2') returning id into pur2;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (f.accA, pur2, f.riceA, 1, f.u_paint, 120000);
  perform fn_post_purchase(pur2);

  select count(*) into n_after from cost_snapshots where recipe_id = f2.rid_ok;
  select cost_per_portion into new_cost from cost_snapshots where id = old_id;

  perform t_assert('T09 price change writes a new snapshot and leaves the old one intact',
    n_after > n_before and new_cost = old_cost,
    format('snapshots %s -> %s, old snapshot cost %s -> %s',
           n_before, n_after, old_cost, new_cost));
end $$;

-- ============================================================================
-- TEST 10 and 11: sales freeze cost; incomplete costing means no COGS
-- ============================================================================
do $$
declare
  f record; f2 record; ord uuid; ol_ok uuid; ol_bad uuid;
  frozen numeric; latest numeric; pur3 uuid;
begin
  select * into f from _fx; select * into f2 from _fx2;

  insert into orders (account_id, business_id, order_no, order_date)
  values (f.accA, f.bizA, 'ORD-1', current_date) returning id into ord;

  -- Sale of the complete dish
  insert into order_lines (account_id, order_id, recipe_id, qty, unit_price)
  values (f.accA, ord, f2.rid_ok, 1, 3500) returning id into ol_ok;

  -- Sale of the incomplete dish
  insert into order_lines (account_id, order_id, recipe_id, qty, unit_price)
  values (f.accA, ord, f2.rid_bad, 1, 3500) returning id into ol_bad;

  select unit_cost_at_sale into frozen from order_lines where id = ol_ok;

  -- Price moves again AFTER the sale
  insert into purchases (account_id, business_id, purchase_date, reference)
  values (f.accA, f.bizA, current_date, 'TEST-A-3') returning id into pur3;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (f.accA, pur3, f.riceA, 1, f.u_paint, 300000);
  perform fn_post_purchase(pur3);

  select unit_cost_at_sale into latest from order_lines where id = ol_ok;

  perform t_assert('T10 sale retains its historical unit_cost_at_sale',
    frozen is not null and frozen = latest,
    format('frozen=%s after later price change=%s', frozen, latest));

  perform t_assert('T11 sale with incomplete costing has revenue but no COGS',
    (select unit_cost_at_sale is null and cost_snapshot_id is null
       from order_lines where id = ol_bad)
    and (select line_total from order_lines where id = ol_bad) = 3500,
    'incomplete line must carry revenue and no cost');

  create temp table _fx3 as select ord, ol_ok, ol_bad;
end $$;

-- ============================================================================
-- TEST 11b: the frozen cost cannot be edited afterwards
-- ============================================================================
do $$
declare ok boolean := false;
begin
  begin
    update order_lines set unit_cost_at_sale = 1 where id = (select ol_ok from _fx3);
  exception when others then ok := true;
  end;
  perform t_assert('T11b frozen sale cost is immutable', ok);
end $$;

-- ============================================================================
-- TEST 12: cost coverage reports the share of revenue with trustworthy cost
-- ============================================================================
do $$
declare v record;
begin
  select * into v from v_profit_by_period p, _fx f
  where p.business_id = f.bizA limit 1;

  perform t_assert('T12 cost_coverage_pct reports revenue backed by real cost',
    v.revenue = 7000 and v.cost_coverage_pct = 50.00 and v.revenue_without_cost = 3500,
    format('revenue=%s coverage=%s uncovered=%s cogs=%s',
           v.revenue, v.cost_coverage_pct, v.revenue_without_cost, v.cogs));
end $$;

-- ============================================================================
-- TEST 13: a role in account B must not grant cost access to account A
-- ============================================================================
do $$
declare f record; sees_A boolean; sees_B boolean;
begin
  select * into f from _fx;
  perform set_config('request.jwt.claim.sub', f.uM::text, true);
  sees_A := fn_can_see_costs(f.accA);
  sees_B := fn_can_see_costs(f.accB);
  perform set_config('request.jwt.claim.sub', '', true);

  perform t_assert('T13 manager of account B cannot see account A costs',
    sees_A = false and sees_B = true,
    format('sees A=%s (must be false), sees B=%s (must be true)', sees_A, sees_B));
end $$;

-- ============================================================================
-- TEST 14: a container unit can never carry a universal factor
-- ============================================================================
do $$
declare n int;
begin
  select count(*) into n from units where kind = 'container' and factor_to_base is not null;
  perform t_assert('T14 no container unit has an assumed universal weight',
    n = 0, format('%s offending units', n));
end $$;

-- ============================================================================
-- TEST 15: a purchase cannot post with an unresolved conversion
-- ============================================================================
do $$
declare f record; pur uuid; res jsonb; still_draft boolean; price_rows int;
begin
  select * into f from _fx;
  insert into purchases (account_id, business_id, purchase_date, reference)
  values (f.accA, f.bizA, current_date, 'TEST-BLOCKED')
  returning id into pur;

  -- Tomato by the basket, with no conversion entered
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (f.accA, pur, f.tomA, 1, f.u_basket, 60000);

  res := fn_post_purchase(pur);
  select status = 'draft' into still_draft from purchases where id = pur;
  select count(*) into price_rows from ingredient_prices where ingredient_id = f.tomA;

  perform t_assert('T15 purchase refuses to post with an unresolved conversion',
    (res->>'posted')::boolean = false
    and res->>'reason' = 'unresolved_conversions'
    and still_draft and price_rows = 0,
    format('result=%s', res));
end $$;

-- ============================================================================
-- TEST 16: purchase yield changes usable cost correctly
-- ============================================================================
do $$
declare
  f record; chick uuid; pur uuid; raw_cost numeric; usable numeric; u_kg2 uuid;
begin
  select * into f from _fx;
  select id into chick from ingredients where account_id=f.accA and name='Chicken (whole)';

  -- 1 kg for 5,000
  insert into purchases (account_id, business_id, purchase_date, reference)
  values (f.accA, f.bizA, current_date, 'TEST-YIELD') returning id into pur;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (f.accA, pur, chick, 1, f.u_kg, 5000);
  perform fn_post_purchase(pur);

  -- Owner records her own yield: 70 percent usable after boning
  update ingredients set purchase_yield_pct = 70 where id = chick;

  raw_cost := fn_ingredient_unit_cost(chick, f.bizA);
  usable   := fn_ingredient_usable_unit_cost(chick, f.bizA);

  perform t_assert('T16 purchase yield raises usable cost per gram',
    round(raw_cost, 6) = 5.000000
    and round(usable, 4) = round(5.0/0.7, 4),
    format('raw=%s usable=%s expected_usable=%s',
           round(raw_cost,6), round(usable,4), round(5.0/0.7,4)));
end $$;

-- ============================================================================
-- TEST 17: an incomplete sub recipe makes its parent incomplete
-- ============================================================================
do $$
declare
  f record; sub uuid; parent uuid; snap uuid; v record;
begin
  select * into f from _fx;

  -- Sub recipe using tomato, which has no price
  insert into recipes (account_id, business_id, kind, name,
                       batch_yield_qty, yield_unit_id, cooking_yield_pct, status)
  values (f.accA, f.bizA, 'sub_recipe', 'Pepper Base', 2000, f.u_g, 100, 'active')
  returning id into sub;
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id)
  values (f.accA, sub, f.tomA, 1500, f.u_g);

  -- Parent uses the sub recipe plus fully priced rice
  insert into recipes (account_id, business_id, kind, name,
                       batch_yield_qty, yield_unit_id, cooking_yield_pct,
                       portion_qty, status)
  values (f.accA, f.bizA, 'dish', 'Egusi Soup', 5000, f.u_g, 95, 500, 'active')
  returning id into parent;
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id)
  values (f.accA, parent, f.riceA, 500, f.u_g);
  insert into recipe_lines (account_id, recipe_id, sub_recipe_id, qty, unit_id)
  values (f.accA, parent, sub, 800, f.u_g);

  snap := fn_compute_recipe_cost_snapshot(parent);
  select * into v from cost_snapshots where id = snap;

  perform t_assert('T17 incomplete sub recipe makes the parent incomplete',
    v.is_complete = false
    and v.cost_per_portion is null
    and v.unpriced_items::text like '%missing_price%',
    format('complete=%s cost=%s unpriced=%s',
           v.is_complete, coalesce(v.cost_per_portion::text,'NULL'), v.unpriced_items));
end $$;

-- ============================================================================
-- TEST 18: circular sub recipes are rejected
-- ============================================================================
do $$
declare
  f record; r1 uuid; r2 uuid; ok boolean := false; ok_self boolean := false;
begin
  select * into f from _fx;

  insert into recipes (account_id, business_id, kind, name, batch_yield_qty, yield_unit_id, status)
  values (f.accA, f.bizA, 'sub_recipe', 'Cycle A', 1000, f.u_g, 'active') returning id into r1;
  insert into recipes (account_id, business_id, kind, name, batch_yield_qty, yield_unit_id, status)
  values (f.accA, f.bizA, 'sub_recipe', 'Cycle B', 1000, f.u_g, 'active') returning id into r2;

  -- A contains B, legal
  insert into recipe_lines (account_id, recipe_id, sub_recipe_id, qty, unit_id)
  values (f.accA, r1, r2, 100, f.u_g);

  -- B contains A, must be rejected
  begin
    insert into recipe_lines (account_id, recipe_id, sub_recipe_id, qty, unit_id)
    values (f.accA, r2, r1, 100, f.u_g);
  exception when others then ok := true;
  end;

  -- A contains A, must be rejected
  begin
    insert into recipe_lines (account_id, recipe_id, sub_recipe_id, qty, unit_id)
    values (f.accA, r1, r1, 100, f.u_g);
  exception when others then ok_self := true;
  end;

  perform t_assert('T18 circular sub recipes are rejected', ok and ok_self,
    format('indirect_cycle_blocked=%s self_reference_blocked=%s', ok, ok_self));
end $$;

-- ============================================================================
-- TEST 19: cross account foreign key cannot be created
-- ============================================================================
do $$
declare f record; ok boolean := false; r uuid;
begin
  select * into f from _fx;
  select id into r from recipes where business_id = f.bizA limit 1;
  begin
    -- Account A recipe line pointing at account B's rice
    insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id)
    values (f.accA, r, f.riceB, 100, f.u_g);
  exception when others then ok := true;
  end;
  perform t_assert('T19 a recipe cannot reference another account''s ingredient', ok);
end $$;

-- ============================================================================
-- TEST 20: a posted purchase is immutable and reversal supersedes its prices
-- ============================================================================
do $$
declare
  f record; ok boolean := false; res jsonb; cost_before numeric; cost_after numeric;
  pur uuid; oil_price_rows int;
begin
  select * into f from _fx;

  insert into purchases (account_id, business_id, purchase_date, reference)
  values (f.accA, f.bizA, current_date, 'TEST-REV') returning id into pur;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (f.accA, pur, f.oilA, 5, f.u_l, 40000);
  perform fn_post_purchase(pur);

  cost_before := fn_ingredient_unit_cost(f.oilA, f.bizA);

  begin
    update purchase_lines set amount = 1 where purchase_id = pur;
  exception when others then ok := true;
  end;

  res := fn_reverse_purchase(pur, 'wrong supplier');
  cost_after := fn_ingredient_unit_cost(f.oilA, f.bizA);
  select count(*) into oil_price_rows from ingredient_prices where ingredient_id = f.oilA;

  perform t_assert('T20 posted purchase is immutable and reversal supersedes its price',
    ok and cost_before = 8 and cost_after is null and oil_price_rows = 1,
    format('edit_blocked=%s cost_before=%s cost_after=%s price_rows_retained=%s',
           ok, cost_before, coalesce(cost_after::text,'NULL'), oil_price_rows));
end $$;

-- ============================================================================
-- RESULTS
-- ============================================================================
\echo ''
\echo '================ TEST RESULTS ================'
select seq, case when passed then 'PASS' else 'FAIL' end as result, name, detail
from _test_results order by seq;

select count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed,
       count(*) as total
from _test_results;

-- ============================================================================
-- ADDENDUM: tests added after the first run exposed two gaps
-- ============================================================================

-- TEST 21: a floor of zero is not shown when nothing at all is priced
do $$
declare v record;
begin
  select cs.* into v
  from cost_snapshots cs, _fx2 f
  where cs.recipe_id = f.rid_bad order by cs.computed_at desc limit 1;

  -- No ingredient or labour input resolved, so there is no floor to state.
  -- priced_inputs is 1 here because portion size IS a resolved required input.
  perform t_assert('T21 no false zero floor when no cost input is priced',
    v.is_complete = false
      and v.floor_cost_per_portion is null
      and v.floor_batch_cost is null
      and v.floor_cost_per_yield_unit is null,
    format('complete=%s priced=%s/%s floor_portion=%s floor_batch=%s',
           v.is_complete, v.priced_inputs, v.required_inputs,
           coalesce(v.floor_cost_per_portion::text,'NULL'),
           coalesce(v.floor_batch_cost::text,'NULL')));
end $$;

-- TEST 22: RLS genuinely blocks a cross account read for a real API role
do $$
declare f record; n_a int; n_b int; n_prices int;
begin
  select * into f from _fx;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.uB::text, true);

  select count(*) into n_a from ingredients where account_id = f.accA;
  select count(*) into n_b from ingredients where account_id = f.accB;
  select count(*) into n_prices from ingredient_prices where account_id = f.accA;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  perform t_assert('T22 RLS blocks account B user from reading account A data',
    n_a = 0 and n_b > 0 and n_prices = 0,
    format('A ingredients visible=%s (must be 0), own=%s (must be >0), A prices visible=%s (must be 0)',
           n_a, n_b, n_prices));
end $$;

-- TEST 23: an anonymous caller sees no tenant data at all
do $$
declare f record; n int; blocked boolean := false;
begin
  select * into f from _fx;
  set local role anon;
  begin
    select count(*) into n from ingredients;
    if n = 0 then blocked := true; end if;
  exception when insufficient_privilege then blocked := true;
  end;
  reset role;
  perform t_assert('T23 anonymous callers see no tenant data', blocked,
    'anon must have neither grant nor visible rows');
end $$;

\echo ''
\echo '================ FINAL RESULTS ================'
select seq, case when passed then 'PASS' else 'FAIL' end as result, name
from _test_results order by seq;
select count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed,
       count(*) as total
from _test_results;
