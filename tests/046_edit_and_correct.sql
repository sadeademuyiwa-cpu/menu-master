-- ============================================================================
-- MENU MASTER NG -- tests/046_edit_and_correct.sql
--
-- Acceptance test for 0060. Run on a database with 0060 applied.
-- Rolls everything back.
--
-- A posted purchase is corrected in one step and nothing is written when a
-- line cannot be measured; a cancelled sale comes back with its lines; every
-- dish of a business can be recomputed in one call; an ingredient's measure
-- is locked once something is recorded in it.
-- ============================================================================

begin;

create temp table t46 (n int, check_name text, verdict text, detail text) on commit drop;
-- The checks run as role authenticated (so RLS and grants are the real ones);
-- the scoreboard and fixture must still be reachable from there.
grant all on t46 to authenticated;

insert into auth.users (id, email) values
  ('00000046-0000-4000-8000-000000000001', 'owner@t46.test'),
  ('00000046-0000-4000-8000-000000000002', 'kitchen@t46.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $$;

-- ============================================ 0. fixture
create temp table fx46 on commit drop as
select (r->>'account_id')::uuid as acct, (r->>'business_id')::uuid as biz,
       (select id from units where account_id is null and code='g')     as g,
       (select id from units where account_id is null and code='kg')    as kg,
       (select id from units where account_id is null and code='paint') as paint,
       (select id from units where account_id is null and code='bag')   as bag,
       gen_random_uuid() as rice, gen_random_uuid() as dish, gen_random_uuid() as cust
from fn_create_account_and_business('T46 Foods','T46 Kitchen','other',
       '00000046-0000-4000-8000-000000000001', p_idempotency_key => 't46-owner') r;
grant select on fx46 to authenticated;

do $$
declare f record;
begin
  select * into f from fx46;
  insert into memberships (account_id, user_id, role)
  values (f.acct, '00000046-0000-4000-8000-000000000002', 'kitchen');
  insert into ingredients (id, account_id, kind, name, base_unit_id)
  values (f.rice, f.acct, 'ingredient', 'T46 Rice', f.g);
  -- one paint of THIS rice is 4,000 g; a bag is left unmeasured on purpose
  insert into ingredient_unit_conversions (account_id, ingredient_id, unit_id, qty_in_base)
  values (f.acct, f.rice, f.paint, 4000);
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.dish, f.acct, f.biz, 'T46 Jollof', 4500, f.g, 500, 'active');
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (f.acct, f.dish, f.rice, 4500, f.g, true);
  insert into customers (id, account_id, business_id, name) values (f.cust, f.acct, f.biz, 'Mrs T46');
end $$;

-- ============================================ 1. correcting a purchase
do $$
declare
  f record; p1 uuid; res jsonb; p_new uuid; v_state text; n_before int; n_after int;
  v_err text; v_orig_status text; v_rev_count int; v_active_amount numeric; v_old_reversed boolean;
begin
  select * into f from fx46;
  perform pg_temp.as_user('00000046-0000-4000-8000-000000000001');
  set local role authenticated;

  -- a draft purchase: 50 kg for N85,000
  insert into purchases (account_id, business_id, purchase_date, reference, created_by)
  values (f.acct, f.biz, current_date - 3, 'INV-1', auth.uid()) returning id into p1;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (f.acct, p1, f.rice, 50, f.kg, 85000);

  -- 1. a draft cannot be "corrected": it is simply edited
  v_err := 'ALLOWED';
  begin
    perform fn_correct_purchase(p1, current_date, null, null, null,
      jsonb_build_array(jsonb_build_object('ingredient_id', f.rice, 'qty', 50, 'unit_id', f.kg, 'amount', 90000)));
  exception when others then v_err := sqlstate; end;
  insert into t46 values (1, 'a draft purchase is refused by fn_correct_purchase (edit it instead)',
    case when v_err = '23514' then 'PASS' else 'FAIL' end, v_err);

  res := fn_post_purchase(p1);
  insert into t46 values (2, 'fixture: the purchase posts',
    case when (res->>'posted')::boolean then 'PASS' else 'FAIL' end, res::text);
  perform fn_compute_recipe_cost_snapshot(f.dish);

  -- 2. a line in an unmeasured unit: refused, and nothing written
  select count(*) into n_before from purchases where account_id = f.acct;
  res := fn_correct_purchase(p1, current_date - 3, null, 'INV-1', null,
    jsonb_build_array(jsonb_build_object('ingredient_id', f.rice, 'qty', 1, 'unit_id', f.bag, 'amount', 95000)));
  select count(*) into n_after from purchases where account_id = f.acct;
  select status::text into v_orig_status from purchases where id = p1;
  insert into t46 values (3, 'an unmeasured unit is reported as a blocker, by name',
    case when (res->>'corrected')::boolean = false and res->>'reason' = 'unresolved_conversions'
          and res->'blockers'->0->>'unit_code' = 'bag'
          and res->'blockers'->0->>'ingredient_name' = 'T46 Rice' then 'PASS' else 'FAIL' end, res::text);
  insert into t46 values (4, 'and nothing was written: same purchase count, original still posted',
    case when n_before = n_after and v_orig_status = 'posted' then 'PASS' else 'FAIL' end,
    n_before||' -> '||n_after||', original '||v_orig_status);

  -- 3. the correction itself: it was N95,000, not N85,000
  res := fn_correct_purchase(p1, current_date - 3, null, 'INV-1 ', '  ',
    jsonb_build_array(jsonb_build_object('ingredient_id', f.rice, 'qty', 50, 'unit_id', f.kg, 'amount', 95000)));
  p_new := (res->>'new_purchase_id')::uuid;
  insert into t46 values (5, 'a posted purchase is corrected in one call',
    case when (res->>'corrected')::boolean and (res->>'lines')::int = 1
          and (res->>'price_rows_written')::int = 1 and (res->>'price_rows_reversed')::int = 1
         then 'PASS' else 'FAIL' end, res::text);

  select status::text into v_orig_status from purchases where id = p1;
  insert into t46 values (6, 'the original is reversed and points at its replacement',
    case when v_orig_status = 'reversed'
          and (select replaced_by from purchases where id = p1) = p_new then 'PASS' else 'FAIL' end,
    v_orig_status);

  insert into t46 values (7, 'the corrected purchase is posted, dated as given, trimmed, with its one line',
    case when (select status::text = 'posted' and purchase_date = current_date - 3
                 and reference = 'INV-1' and note is null
               from purchases where id = p_new)
          and (select count(*) = 1 and sum(amount) = 95000 and bool_and(qty_base = 50000)
               from purchase_lines where purchase_id = p_new) then 'PASS' else 'FAIL' end, '');

  select bool_and(reversed_at is not null) into v_old_reversed
    from ingredient_prices where purchase_line_id in (select id from purchase_lines where purchase_id = p1);
  select sum(amount) into v_active_amount
    from ingredient_prices where ingredient_id = f.rice and reversed_at is null;
  insert into t46 values (8, 'the old price is reversed; the only live price is the corrected one',
    case when v_old_reversed and v_active_amount = 95000 then 'PASS' else 'FAIL' end,
    'live amount '||coalesce(v_active_amount::text,'NULL'));

  select count(*) into v_rev_count from purchases where reverses = p1 and status = 'reversed';
  insert into t46 values (9, 'fn_reverse_purchase was used unchanged (its reversal record exists)',
    case when v_rev_count = 1 then 'PASS' else 'FAIL' end, v_rev_count||' reversal row(s)');

  insert into t46 values (10, 'the dish now costs from the corrected price (N1.90/g, N950 a portion)',
    case when (select cost_per_portion from v_recipe_cost_current where recipe_id = f.dish) = 950
         then 'PASS' else 'FAIL' end,
    coalesce((select cost_per_portion::text from v_recipe_cost_current where recipe_id = f.dish), 'NULL'));

  -- 4. twice is refused: the original is no longer posted
  v_err := 'ALLOWED';
  begin
    perform fn_correct_purchase(p1, current_date, null, null, null,
      jsonb_build_array(jsonb_build_object('ingredient_id', f.rice, 'qty', 50, 'unit_id', f.kg, 'amount', 1)));
  exception when others then v_err := sqlstate; end;
  insert into t46 values (11, 'a purchase cannot be corrected twice',
    case when v_err = '23514' then 'PASS' else 'FAIL' end, v_err);

  -- 5. a kitchen member may not correct purchases
  perform pg_temp.as_user('00000046-0000-4000-8000-000000000002');
  v_err := 'ALLOWED';
  begin
    perform fn_correct_purchase(p_new, current_date, null, null, null,
      jsonb_build_array(jsonb_build_object('ingredient_id', f.rice, 'qty', 50, 'unit_id', f.kg, 'amount', 1)));
  exception when others then v_err := sqlstate; end;
  insert into t46 values (12, 'a kitchen member is refused',
    case when v_err = '42501' then 'PASS' else 'FAIL' end, v_err);
  reset role;
end $$;

-- ============================================ 2. the measure is locked
do $$
declare f record; v_err text; fresh uuid := gen_random_uuid(); v_unit uuid;
begin
  select * into f from fx46;
  perform pg_temp.as_user('00000046-0000-4000-8000-000000000001');
  set local role authenticated;

  v_err := 'ALLOWED';
  begin
    update ingredients set base_unit_id = f.kg where id = f.rice;
  exception when others then v_err := sqlstate; end;
  insert into t46 values (13, 'an ingredient with purchases cannot change its measure',
    case when v_err = '23514' then 'PASS' else 'FAIL' end, v_err);

  insert into ingredients (id, account_id, kind, name, base_unit_id)
  values (fresh, f.acct, 'ingredient', 'T46 Pepper', f.g);
  update ingredients set base_unit_id = f.kg, name = 'T46 Pepper (kg)' where id = fresh;
  select base_unit_id into v_unit from ingredients where id = fresh;
  insert into t46 values (14, 'one with nothing recorded can, and its name edits in place',
    case when v_unit = f.kg and (select name from ingredients where id = fresh) = 'T46 Pepper (kg)'
         then 'PASS' else 'FAIL' end, '');
  reset role;
end $$;

-- ============================================ 3. a replacement sale carries its lines
do $$
declare
  f record; ord uuid; rep uuid; rep2 uuid; res jsonb; v_err text;
begin
  select * into f from fx46;
  perform pg_temp.as_user('00000046-0000-4000-8000-000000000001');
  set local role authenticated;

  insert into orders (account_id, business_id, customer_id, order_no, order_date, order_discount, created_by)
  values (f.acct, f.biz, f.cust, 'S46-1', current_date - 2, 500, auth.uid()) returning id into ord;
  insert into order_lines (account_id, order_id, recipe_id, qty, unit_price, discount_amount)
  values (f.acct, ord, f.dish, 10, 1500, 0),
         (f.acct, ord, null, 1, 2000, 200);
  update order_lines set description = 'Delivery' where order_id = ord and recipe_id is null;
  perform fn_confirm_order(ord);
  perform fn_void_order(ord, 'wrong quantity');

  res := fn_reissue_order(ord);
  rep := (res->>'new_order_id')::uuid;
  insert into t46 values (15, 'the replacement carries both lines',
    case when (res->>'lines_copied')::int = 2 and res->>'order_no' = 'S46-1-R'
          and (select count(*) from order_lines where order_id = rep) = 2 then 'PASS' else 'FAIL' end, res::text);

  insert into t46 values (16, 'with the quantities, prices, discounts and description of the original',
    case when (select count(*) from order_lines where order_id = rep
                 and ((recipe_id = f.dish and qty = 10 and unit_price = 1500 and discount_amount = 0)
                   or (recipe_id is null and description = 'Delivery' and qty = 1 and unit_price = 2000 and discount_amount = 200))) = 2
         then 'PASS' else 'FAIL' end, '');

  insert into t46 values (17, 'as a draft, on the original date, with the original discount and customer, costs not yet frozen',
    case when (select status::text = 'draft' and order_date = current_date - 2 and order_discount = 500
                 and customer_id = f.cust and replaces = ord from orders where id = rep)
          and (select bool_and(cost_snapshot_id is null and unit_cost_at_sale is null) from order_lines where order_id = rep)
         then 'PASS' else 'FAIL' end, '');

  v_err := 'ALLOWED';
  begin
    perform fn_reissue_order(ord);
  exception when others then v_err := sqlstate; end;
  insert into t46 values (18, 'a second replacement is refused while the first is live',
    case when v_err = '23514' then 'PASS' else 'FAIL' end, v_err);

  -- the draft replacement is discarded; the sale can be reissued again
  delete from orders where id = rep;
  res := fn_reissue_order(ord);
  rep2 := (res->>'new_order_id')::uuid;
  insert into t46 values (19, 'after the draft is discarded, it can be reissued again',
    case when rep2 is not null and res->>'order_no' = 'S46-1-R' then 'PASS' else 'FAIL' end, res::text);
  reset role;
end $$;

-- ============================================ 4. recompute a whole business
do $$
declare f record; before_n int; after_n int; v_n int; v_err text;
begin
  select * into f from fx46;
  perform pg_temp.as_user('00000046-0000-4000-8000-000000000001');
  set local role authenticated;
  select count(*) into before_n from cost_snapshots where recipe_id = f.dish and variant_id is null;
  v_n := fn_recompute_business_recipes(f.biz);
  select count(*) into after_n from cost_snapshots where recipe_id = f.dish and variant_id is null;
  insert into t46 values (20, 'one call recomputes every dish of the business, one snapshot each',
    case when v_n = 1 and after_n = before_n + 1 then 'PASS' else 'FAIL' end,
    v_n||' dish(es), snapshots '||before_n||' -> '||after_n);
  reset role;

  perform pg_temp.as_user('00000046-0000-4000-8000-000000000002');
  set local role authenticated;
  v_err := 'ALLOWED';
  begin
    perform fn_recompute_business_recipes(f.biz);
  exception when others then v_err := sqlstate; end;
  insert into t46 values (21, 'a kitchen member (no cost access) is refused',
    case when v_err = '42501' then 'PASS' else 'FAIL' end, v_err);
  reset role;
end $$;

-- ============================================ 5. a customer is put away, not deleted
do $$
declare f record;
begin
  select * into f from fx46;
  perform pg_temp.as_user('00000046-0000-4000-8000-000000000001');
  set local role authenticated;
  update customers set deleted_at = now() where id = f.cust;
  insert into t46 values (22, 'a customer with sales can be put away and their sales keep pointing at them',
    case when (select deleted_at is not null from customers where id = f.cust)
          and (select count(*) from orders where customer_id = f.cust) >= 1 then 'PASS' else 'FAIL' end, '');
  update customers set deleted_at = null where id = f.cust;
  insert into t46 values (23, 'and brought back',
    case when (select deleted_at is null from customers where id = f.cust) then 'PASS' else 'FAIL' end, '');
  reset role;
end $$;

-- ============================================ 6. nothing else moved
insert into t46 values (24,'118 public policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));
insert into t46 values (25,'98 fn_* functions',
  case when (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')=98
       then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%'));

select n, check_name, verdict, left(detail,60) as detail from t46 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t46;

rollback;
