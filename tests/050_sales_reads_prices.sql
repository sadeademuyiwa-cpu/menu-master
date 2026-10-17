-- ============================================================================
-- MENU MASTER NG -- tests/050_sales_reads_prices.sql
--
-- Acceptance test for 0064. Run on a database with 0064 applied.
-- Rolls everything back.
--
-- A sales member sees what each dish sells for, through fn_menu_prices, and
-- nothing it costs; recipe_prices itself stays closed to them. Kitchen sees
-- no price, as before. The owner's view is unchanged, and fn_menu_prices
-- gives the owner exactly the selling prices v_price_check gives. A member
-- of another business sees none of these prices. A sales member can take a
-- sale at that price and confirm it.
-- ============================================================================

begin;

create temp table t50 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000050-0000-4000-8000-000000000001', 'owner@t50.test'),
  ('00000050-0000-4000-8000-000000000002', 'manager@t50.test'),
  ('00000050-0000-4000-8000-000000000003', 'kitchen@t50.test'),
  ('00000050-0000-4000-8000-000000000004', 'sales@t50.test'),
  ('00000050-0000-4000-8000-000000000005', 'accountant@t50.test'),
  ('00000050-0000-4000-8000-000000000006', 'other-owner@t50.test'),
  ('00000050-0000-4000-8000-000000000007', 'stranger@t50.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $$;

-- ============================================ 0. fixture
-- Business A: a dish by the portion (priced, re-priced, and priced again for
-- next week), a dish sold in a size (the size priced), a dish with no price,
-- and a put-away dish that still has one. Business B: one priced dish.
create temp table fx50 on commit drop as
select (a->>'account_id')::uuid as acct_a, (a->>'business_id')::uuid as biz_a,
       (b->>'account_id')::uuid as acct_b, (b->>'business_id')::uuid as biz_b,
       (select id from units where account_id is null and code='g')  as g,
       (select id from units where account_id is null and code='kg') as kg,
       (select id from units where account_id is null and code='ml') as ml,
       (select id from units where account_id is null and code='l')  as l,
       gen_random_uuid() as rice, gen_random_uuid() as base,
       gen_random_uuid() as jollof, gen_random_uuid() as soup, gen_random_uuid() as bowl_fmt,
       gen_random_uuid() as bowl, gen_random_uuid() as moimoi, gen_random_uuid() as gone,
       gen_random_uuid() as dish_b
from fn_create_account_and_business('T50 A Foods','T50 A Kitchen','other',
       '00000050-0000-4000-8000-000000000001', p_idempotency_key => 't50-a') a,
     fn_create_account_and_business('T50 B Foods','T50 B Kitchen','other',
       '00000050-0000-4000-8000-000000000006', p_idempotency_key => 't50-b') b;

do $$
declare f record;
begin
  select * into f from fx50;
  insert into memberships (account_id, user_id, role) values
    (f.acct_a, '00000050-0000-4000-8000-000000000002', 'manager'),
    (f.acct_a, '00000050-0000-4000-8000-000000000003', 'kitchen'),
    (f.acct_a, '00000050-0000-4000-8000-000000000004', 'sales'),
    (f.acct_a, '00000050-0000-4000-8000-000000000005', 'accountant');

  insert into ingredients (id, account_id, kind, name, base_unit_id) values
    (f.rice, f.acct_a, 'ingredient', 'T50 Rice', f.g),
    (f.base, f.acct_a, 'ingredient', 'T50 Soup Base', f.ml);
  insert into ingredient_prices (account_id, ingredient_id, qty_base, amount, source) values
    (f.acct_a, f.rice, fn_resolve_qty_to_base(f.rice, 50, f.kg), 85000, 'purchase'),   -- N1.70/g
    (f.acct_a, f.base, fn_resolve_qty_to_base(f.base, 10, f.l), 20000, 'purchase');    -- N2.00/ml

  -- jollof by the portion: N850 a plate
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.jollof, f.acct_a, f.biz_a, 'T50 Jollof', 4500, f.g, 500, 'active');
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (f.acct_a, f.jollof, f.rice, 4500, f.g, true);

  -- soup sold only in a 2.5 L bowl
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.soup, f.acct_a, f.biz_a, 'T50 Egusi', 10000, f.ml, 2500, 'active');
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (f.acct_a, f.soup, f.base, 10000, f.ml, true);
  insert into serving_formats (id, account_id, business_id, name, capacity_qty, capacity_unit_id)
  values (f.bowl_fmt, f.acct_a, f.biz_a, 'T50 Family Bowl', 2.5, f.l);
  insert into recipe_variants (id, account_id, business_id, recipe_id, format_id, costing_basis)
  values (f.bowl, f.acct_a, f.biz_a, f.soup, f.bowl_fmt, 'capacity');

  -- moi moi has no price yet; the put-away dish keeps one
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status) values
    (f.moimoi, f.acct_a, f.biz_a, 'T50 Moi Moi', 1000, f.g, 100, 'active'),
    (f.gone,   f.acct_a, f.biz_a, 'T50 Old Dish', 1000, f.g, 100, 'active');

  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.dish_b, f.acct_b, f.biz_b, 'T50 Puff-puff', 1000, f.g, 50, 'active');

  insert into recipe_prices (account_id, recipe_id, variant_id, price, effective_from) values
    (f.acct_a, f.jollof, null,   1300, current_date - 30),
    (f.acct_a, f.jollof, null,   1500, current_date - 1),     -- the current price
    (f.acct_a, f.jollof, null,   9999, current_date + 7),     -- not yet
    (f.acct_a, f.soup,   null,   4000, current_date - 10),    -- the dish's own...
    (f.acct_a, f.soup,   f.bowl, 6000, current_date - 10),    -- ...loses to the size's
    (f.acct_a, f.gone,   null,   700,  current_date - 10),
    (f.acct_b, f.dish_b, null,   200,  current_date - 1);
  update recipes set deleted_at = now() where id = f.gone;

  perform fn_compute_recipe_cost_snapshot(f.jollof);
  perform fn_compute_recipe_cost_snapshot(f.soup);
  perform fn_compute_variant_cost_snapshot(f.bowl);
  perform fn_compute_recipe_cost_snapshot(f.dish_b);
end $$;

-- ============================================ 1. the function's shape
insert into t50 values (1,'fn_menu_prices is SECURITY DEFINER, STABLE, with search_path pinned to public',
  case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.fn_menu_prices()')
                      and p.prosecdef and p.provolatile = 's'
                      and 'search_path=public' = any(p.proconfig))
       then 'PASS' else 'FAIL' end, '');

insert into t50 values (2,'callable by a signed-in user, not by a logged-out caller or by PUBLIC',
  case when has_function_privilege('authenticated', 'fn_menu_prices()', 'execute')
        and not has_function_privilege('anon', 'fn_menu_prices()', 'execute')
        and not exists (select 1 from pg_proc p, unnest(p.proacl) a
                         where p.oid = to_regprocedure('public.fn_menu_prices()') and a::text like '=%')
       then 'PASS' else 'FAIL' end, '');

insert into t50
select 3, 'it returns five columns, none of them a cost, profit, margin or suggested price',
  case when v_cols = 'business_id,recipe_id,variant_id,channel_id,selling_price'
        and v_cols !~ '(cost|profit|margin|markup|recommend|target|floor)'
       then 'PASS' else 'FAIL' end, v_cols
from (select array_to_string(array_agg(n order by o), ',') as v_cols
        from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
       where p.oid = to_regprocedure('public.fn_menu_prices()') and m = 't') c;

-- ============================================ 2. who sees which prices
do $$
declare
  f record; ch uuid;
  s_jollof numeric; s_bowl numeric; s_soup_dish int; s_moimoi_rows int; s_moimoi numeric; s_gone int; s_b int;
  s_rows int; s_direct int; s_view_price int; s_view_cost int; s_err text;
  k_rows int; k_view_price int;
  o_rows int; o_diff int; o_direct int; o_cost int; o_chan int;
  m_rows int; ac_rows int;
  b_rows int; b_a int; b_own numeric;
  x_rows int; anon_err text;
begin
  select * into f from fx50;
  select id into ch from channels where business_id = f.biz_a and is_default;

  -- the sales member of A
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000004');
  set local role authenticated;
  s_err := 'OK';
  begin
    select count(*) into s_rows from fn_menu_prices();
    select selling_price into s_jollof from fn_menu_prices() where recipe_id = f.jollof and variant_id is null;
    select selling_price into s_bowl   from fn_menu_prices() where recipe_id = f.soup and variant_id = f.bowl;
    select count(*) into s_soup_dish   from fn_menu_prices() where recipe_id = f.soup and variant_id is null;
    select count(*), max(selling_price) into s_moimoi_rows, s_moimoi from fn_menu_prices() where recipe_id = f.moimoi;
    select count(*) into s_gone from fn_menu_prices() where recipe_id = f.gone;
    select count(*) into s_b    from fn_menu_prices() where business_id = f.biz_b or recipe_id = f.dish_b;
  exception when others then s_err := sqlstate || ' ' || sqlerrm; end;
  -- the table and the cost views are as closed to sales as they were
  select count(*) into s_direct from recipe_prices;
  select count(*) filter (where selling_price is not null),
         count(*) filter (where cost_per_portion is not null or profit is not null
                             or margin_pct is not null or recommended_price is not null)
    into s_view_price, s_view_cost
    from v_price_check;
  reset role;

  -- the kitchen of A
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000003');
  set local role authenticated;
  select count(*) into k_rows from fn_menu_prices();
  select count(*) filter (where selling_price is not null) into k_view_price from v_price_check;
  reset role;

  -- the owner of A
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000001');
  set local role authenticated;
  select count(*) into o_rows from fn_menu_prices();
  select count(*) into o_diff from (
    (select recipe_id, variant_id, channel_id, selling_price from fn_menu_prices()
     except
     select recipe_id, variant_id, channel_id, selling_price from v_price_check)
    union all
    (select recipe_id, variant_id, channel_id, selling_price from v_price_check
     except
     select recipe_id, variant_id, channel_id, selling_price from fn_menu_prices())) d;
  select count(*) into o_direct from recipe_prices;
  select count(*) filter (where cost_per_portion is not null) into o_cost from v_price_check;
  select count(*) into o_chan from fn_menu_prices() where channel_id is distinct from ch;
  reset role;

  -- the manager and the accountant of A
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000002');
  set local role authenticated;
  select count(*) into m_rows from fn_menu_prices() where selling_price is not null;
  reset role;
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000005');
  set local role authenticated;
  select count(*) into ac_rows from fn_menu_prices() where selling_price is not null;
  reset role;

  -- the owner of B
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000006');
  set local role authenticated;
  select count(*) into b_rows from fn_menu_prices();
  select count(*) into b_a from fn_menu_prices() where business_id = f.biz_a;
  select selling_price into b_own from fn_menu_prices() where recipe_id = f.dish_b;
  reset role;

  -- signed in, a member of nothing
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000007');
  set local role authenticated;
  select count(*) into x_rows from fn_menu_prices();
  reset role;

  -- nobody signed in
  perform pg_temp.as_user(null);
  set local role anon;
  anon_err := 'ANSWERED';
  begin perform * from fn_menu_prices();
  exception when others then anon_err := sqlstate; end;
  reset role;

  insert into t50 values (4,'a sales member can call fn_menu_prices',
    case when s_err = 'OK' then 'PASS' else 'FAIL' end, s_err);
  insert into t50 values (5,'and sees the current price of a dish sold by the portion (N1,500, not N1,300 or next week''s)',
    case when s_jollof = 1500 then 'PASS' else 'FAIL' end, coalesce(s_jollof::text, 'NULL'));
  insert into t50 values (6,'and the size''s own price for a dish sold in sizes (N6,000), once',
    case when s_bowl = 6000 and s_soup_dish = 0 then 'PASS' else 'FAIL' end,
    coalesce(s_bowl::text, 'NULL')||' / dish-level rows '||coalesce(s_soup_dish::text, '-'));
  insert into t50 values (7,'a dish with no price is listed with no price, never zero',
    case when s_moimoi_rows = 1 and s_moimoi is null then 'PASS' else 'FAIL' end,
    coalesce(s_moimoi_rows::text, '-')||' row(s), '||coalesce(s_moimoi::text, 'NULL'));
  insert into t50 values (8,'a put-away dish and the other business''s dish are not listed',
    case when s_gone = 0 and s_b = 0 then 'PASS' else 'FAIL' end, s_gone||' / '||s_b);
  insert into t50 values (9,'one row per sellable thing: jollof, the bowl, moi moi',
    case when s_rows = 3 and o_rows = 3 then 'PASS' else 'FAIL' end, 'sales '||s_rows||', owner '||o_rows);
  insert into t50 values (10,'recipe_prices itself stays closed to sales (no row: no history, no set_by)',
    case when s_direct = 0 and o_direct = 6 then 'PASS' else 'FAIL' end, 'sales '||s_direct||', owner '||o_direct);
  insert into t50 values (11,'and v_price_check still shows sales no price and no cost, profit, margin or suggestion',
    case when s_view_price = 0 and s_view_cost = 0 then 'PASS' else 'FAIL' end, s_view_price||' / '||s_view_cost);
  insert into t50 values (12,'the kitchen of A sees no price, through the function or the views',
    case when k_rows = 0 and k_view_price = 0 then 'PASS' else 'FAIL' end, k_rows||' / '||k_view_price);
  insert into t50 values (13,'for the owner, fn_menu_prices gives exactly the selling prices v_price_check gives',
    case when o_diff = 0 then 'PASS' else 'FAIL' end, o_diff||' differing row(s)');
  insert into t50 values (14,'and the owner still sees the costs (unchanged)',
    case when o_cost = 2 then 'PASS' else 'FAIL' end, o_cost||' costed row(s)');
  insert into t50 values (15,'the manager and the accountant of A see the same two prices',
    case when m_rows = 2 and ac_rows = 2 then 'PASS' else 'FAIL' end, m_rows||' / '||ac_rows);
  insert into t50 values (16,'the owner of B sees none of A''s prices, and B''s own (N200)',
    case when b_a = 0 and b_rows = 1 and b_own = 200 then 'PASS' else 'FAIL' end,
    b_a||' of A, '||b_rows||' row(s), '||coalesce(b_own::text, 'NULL'));
  insert into t50 values (17,'a signed-in non-member sees nothing',
    case when x_rows = 0 then 'PASS' else 'FAIL' end, x_rows::text);
  insert into t50 values (18,'a logged-out caller cannot call it (42501)',
    case when anon_err = '42501' then 'PASS' else 'FAIL' end, anon_err);
  insert into t50 values (19,'each row names the business''s own channel (Direct), as v_price_check does',
    case when ch is not null and o_chan = 0 then 'PASS' else 'FAIL' end,
    o_chan||' row(s) on another channel');
end $$;

-- ============================================ 3. the sales member takes the sale at that price
do $$
declare f record; v_price numeric; ord uuid; res jsonb; v_err text := 'OK';
begin
  select * into f from fx50;
  perform pg_temp.as_user('00000050-0000-4000-8000-000000000004');
  set local role authenticated;
  begin
    select selling_price into v_price from fn_menu_prices() where recipe_id = f.jollof and variant_id is null;
    insert into orders (account_id, business_id, order_no, order_date, created_by)
    values (f.acct_a, f.biz_a, 'S50-1', current_date, auth.uid()) returning id into ord;
    insert into order_lines (account_id, order_id, recipe_id, qty, unit_price)
    values (f.acct_a, ord, f.jollof, 2, v_price);
    res := fn_confirm_order(ord);
  exception when others then v_err := sqlstate || ' ' || sqlerrm; end;
  reset role;

  insert into t50 values (20,'a sales member records and confirms a sale at the menu price',
    case when v_err = 'OK' and (res->>'confirmed')::boolean
          and (select unit_price from order_lines where order_id = ord) = 1500
         then 'PASS' else 'FAIL' end, coalesce(res::text, v_err));
end $$;

-- ============================================ 4. nothing else moved
insert into t50 values (21,'118 public policies; recipe_prices keeps its four cost-gated policies',
  case when (select count(*) from pg_policies where schemaname='public')=118
        and (select count(*) from pg_policies where schemaname='public' and tablename='recipe_prices'
               and coalesce(qual,'')||coalesce(with_check,'') like '%fn_can_see_costs%')=4
       then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,60) as detail from t50 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t50;

rollback;
