-- ============================================================================
-- MENU MASTER NG -- tests/047_extras_cost.sql
--
-- Acceptance test for 0061. Run on a database with 0061 applied.
-- Rolls everything back.
--
-- A non-dish line (delivery, staff, drinks bought in) carries the cost the
-- owner typed; confirmation freezes it; reports count it; a dish line ignores
-- it; nothing but confirmation can write a frozen cost; a replacement sale
-- carries it.
-- ============================================================================

begin;

create temp table t47 (n int, check_name text, verdict text, detail text) on commit drop;
grant all on t47 to authenticated;

insert into auth.users (id, email) values
  ('00000047-0000-4000-8000-000000000001', 'owner@t47.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $$;

create temp table fx47 on commit drop as
select (r->>'account_id')::uuid as acct, (r->>'business_id')::uuid as biz,
       (select id from units where account_id is null and code='g')  as g,
       (select id from units where account_id is null and code='kg') as kg,
       gen_random_uuid() as rice, gen_random_uuid() as dish
from fn_create_account_and_business('T47 Foods','T47 Kitchen','caterer',
       '00000047-0000-4000-8000-000000000001', p_idempotency_key => 't47-owner') r;
grant select on fx47 to authenticated;

do $$
declare f record;
begin
  select * into f from fx47;
  insert into ingredients (id, account_id, kind, name, base_unit_id) values (f.rice, f.acct, 'ingredient', 'T47 Rice', f.g);
  insert into ingredient_prices (account_id, ingredient_id, qty_base, amount, source)
  values (f.acct, f.rice, fn_resolve_qty_to_base(f.rice, 50, f.kg), 85000, 'purchase');
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.dish, f.acct, f.biz, 'T47 Jollof', 4500, f.g, 500, 'active');
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (f.acct, f.dish, f.rice, 4500, f.g, true);
  perform fn_compute_recipe_cost_snapshot(f.dish);   -- 850 a portion
end $$;

do $$
declare
  f record; ord uuid; dish_line uuid; delivery uuid; staff uuid; v_err text; res jsonb;
  v_cost numeric; v_status text; v_cogs numeric; v_profit numeric; rep uuid;
begin
  select * into f from fx47;
  perform pg_temp.as_user('00000047-0000-4000-8000-000000000001');
  set local role authenticated;

  insert into orders (account_id, business_id, order_no, order_date, created_by)
  values (f.acct, f.biz, 'S47-1', current_date, auth.uid()) returning id into ord;
  -- a dish, delivery with a cost, serving staff with no cost
  insert into order_lines (account_id, order_id, recipe_id, qty, unit_price, extra_unit_cost)
  values (f.acct, ord, f.dish, 10, 1500, 999) returning id into dish_line;
  insert into order_lines (account_id, order_id, description, qty, unit_price, extra_unit_cost)
  values (f.acct, ord, 'Delivery', 2, 1500, 1000) returning id into delivery;
  insert into order_lines (account_id, order_id, description, qty, unit_price)
  values (f.acct, ord, 'Serving staff', 3, 5000) returning id into staff;

  -- 1. a draft line's typed cost can still change
  update order_lines set extra_unit_cost = 1100 where id = delivery;
  insert into t47 values (1, 'a draft extra''s cost can be edited',
    case when (select extra_unit_cost from order_lines where id = delivery) = 1100 then 'PASS' else 'FAIL' end, '');

  -- 2. a negative cost is refused
  v_err := 'ALLOWED';
  begin
    update order_lines set extra_unit_cost = -5 where id = delivery;
  exception when others then v_err := sqlstate; end;
  insert into t47 values (2, 'a negative extra cost is refused',
    case when v_err = '23514' then 'PASS' else 'FAIL' end, v_err);

  -- 3. nothing but confirmation writes a frozen cost
  v_err := 'ALLOWED';
  begin
    update order_lines set unit_cost_at_sale = 1 where id = delivery;
  exception when others then v_err := sqlstate; end;
  insert into t47 values (3, 'the frozen cost still cannot be written directly',
    case when v_err = '23514' then 'PASS' else 'FAIL' end, v_err);

  select cost_status into v_status from v_sale_lines where line_id = delivery;
  insert into t47 values (4, 'before confirmation an extra reads "no_product" as before',
    case when v_status = 'no_product' then 'PASS' else 'FAIL' end, v_status);

  res := fn_confirm_order(ord);
  insert into t47 values (5, 'confirmation reports one line without a known cost (the staff)',
    case when (res->>'lines_frozen')::int = 3 and (res->>'lines_without_cost')::int = 1 then 'PASS' else 'FAIL' end, res::text);

  select unit_cost_at_sale into v_cost from order_lines where id = delivery;
  insert into t47 values (6, 'the delivery froze the cost the owner typed',
    case when v_cost = 1100 then 'PASS' else 'FAIL' end, coalesce(v_cost::text, 'NULL'));

  select unit_cost_at_sale into v_cost from order_lines where id = dish_line;
  insert into t47 values (7, 'the dish froze its snapshot, not the typed figure',
    case when v_cost = 850 then 'PASS' else 'FAIL' end, coalesce(v_cost::text, 'NULL'));

  select unit_cost_at_sale into v_cost from order_lines where id = staff;
  insert into t47 values (8, 'an extra with no typed cost stays without a cost',
    case when v_cost is null then 'PASS' else 'FAIL' end, coalesce(v_cost::text, 'NULL'));

  select cost_status, cogs, gross_profit into v_status, v_cogs, v_profit from v_sale_lines where line_id = delivery;
  insert into t47 values (9, 'a costed extra reads "costed", with its cost of goods and profit',
    case when v_status = 'costed' and v_cogs = 2200 and v_profit = 800 then 'PASS' else 'FAIL' end,
    v_status||' cogs='||coalesce(v_cogs::text,'NULL')||' profit='||coalesce(v_profit::text,'NULL'));

  select cost_status into v_status from v_sale_lines where line_id = staff;
  insert into t47 values (10, 'an uncosted extra still reads "no_product"',
    case when v_status = 'no_product' then 'PASS' else 'FAIL' end, v_status);

  -- the day's profit counts the delivery's cost
  select cogs into v_cogs from v_sales_summary where business_id = f.biz and sale_date = current_date;
  insert into t47 values (11, 'the day''s cost of goods includes the extra (10 x 850 + 2 x 1100)',
    case when v_cogs = 10700 then 'PASS' else 'FAIL' end, coalesce(v_cogs::text, 'NULL'));

  -- a replacement carries the extra cost
  perform fn_void_order(ord, 'wrong staff count');
  res := fn_reissue_order(ord);
  rep := (res->>'new_order_id')::uuid;
  insert into t47 values (12, 'the replacement carries the extra''s cost',
    case when (select extra_unit_cost from order_lines where order_id = rep and description = 'Delivery') = 1100
         then 'PASS' else 'FAIL' end, '');
  reset role;
end $$;

insert into t47 values (13,'118 public policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));
insert into t47 values (14,'98 fn_* functions, unchanged',
  case when (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')=98
       then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%'));

select n, check_name, verdict, left(detail,60) as detail from t47 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t47;

rollback;
