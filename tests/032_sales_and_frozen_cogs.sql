-- ============================================================================
-- MENU MASTER NG -- tests/032_sales_and_frozen_cogs.sql
--
-- Phase 6: what a sale is worth, what it cost, and the fact that neither
-- answer may ever change afterwards.
--
-- The rule the whole suite exists to defend: once a sale is confirmed, nothing
-- an owner does later -- reprice an ingredient, buy more of it, change a
-- recipe, change a yield, change packaging, change labour, change overhead,
-- change a serving format, change the menu price -- may move that sale's
-- revenue, its cost, its profit or its margin. And a cost that is not known is
-- reported as not known, never as zero.
--
-- Run on a database with 0001-0047 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t32 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx32 (
  acct uuid, usr uuid, biz uuid, g uuid, kg uuid, ml uuid, l uuid, pc uuid,
  rice uuid, bowl uuid, tub uuid, jollof uuid, soup uuid, mystery uuid,
  cust uuid, f1l uuid, f25l uuid, v1l uuid, v25l uuid
) on commit drop;

-- ---------------------------------------------------------------------------
-- FIXTURES
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb;
  g uuid; kg uuid; ml uuid; l uuid; pc uuid;
  rice uuid := gen_random_uuid(); bowl uuid := gen_random_uuid(); tub uuid := gen_random_uuid();
  jollof uuid := gen_random_uuid(); soup uuid := gen_random_uuid(); mystery uuid := gen_random_uuid();
  cust uuid := gen_random_uuid();
  f1l uuid := gen_random_uuid(); f25l uuid := gen_random_uuid();
  v1l uuid; v25l uuid;
begin
  select id into g  from units where account_id is null and code = 'g';
  select id into kg from units where account_id is null and code = 'kg';
  select id into ml from units where account_id is null and code = 'ml';
  select id into l  from units where account_id is null and code = 'l';
  select id into pc from units where account_id is null and code = 'piece';

  insert into auth.users(id, email) values (u, 'sales32@t.test');
  res := fn_create_account_and_business('Sales Co','Sales Kitchen','caterer', u,
           p_idempotency_key => gen_random_uuid()::text);
  a := (res->>'account_id')::uuid;
  b := (res->>'business_id')::uuid;

  insert into ingredients(id, account_id, kind, name, base_unit_id) values
    (rice, a, 'ingredient', 'S32 Rice',       g),
    (bowl, a, 'packaging',  'S32 1L bowl',    pc),
    (tub,  a, 'packaging',  'S32 2.5L tub',   pc);

  -- 50 kg for N85,000 -> N1.70/g
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (a, rice, fn_resolve_qty_to_base(rice, 50, kg), 85000, 'purchase'),
         (a, bowl, 1, 150, 'purchase'),
         (a, tub,  1, 400, 'purchase');

  -- MODEL 1, portion-based: 4,500 g batch, 500 g portion -> N850 a portion
  insert into recipes(id, account_id, business_id, name, batch_yield_qty, yield_unit_id,
                      portion_qty, status)
  values (jollof, a, b, 'S32 Jollof', 4500, g, 500, 'active');
  insert into recipe_lines(account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (a, jollof, rice, 4500, g, true);
  perform fn_compute_recipe_cost_snapshot(jollof);

  -- MODEL 2, format-based: a soup sold by the litre, two formats with
  -- different packaging on each. 5,000 g of stock at N1.70/g over a 5,000 ml
  -- batch is N1.70/ml.
  --
  -- The formats are created BEFORE the recipe is costed, deliberately: a
  -- format-based recipe has no portion size, and until it has a format the
  -- engine is right to call it incomplete rather than invent one.
  insert into recipes(id, account_id, business_id, name, batch_yield_qty, yield_unit_id, status)
  values (soup, a, b, 'S32 Soup', 5000, ml, 'active');
  insert into recipe_lines(account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (a, soup, rice, 5000, g, true);

  insert into serving_formats(id, account_id, business_id, name, capacity_qty, capacity_unit_id)
  values (f1l,  a, b, 'S32 1 litre',   1,   l),
         (f25l, a, b, 'S32 2.5 litre', 2.5, l);
  insert into serving_format_packaging(account_id, business_id, format_id, packaging_item_id, qty, is_cost_bearing)
  values (a, b, f1l,  bowl, 1, true),
         (a, b, f25l, tub,  1, true);

  insert into recipe_variants(account_id, business_id, recipe_id, format_id, costing_basis)
  values (a, b, soup, f1l,  'capacity') returning id into v1l;
  insert into recipe_variants(account_id, business_id, recipe_id, format_id, costing_basis)
  values (a, b, soup, f25l, 'capacity') returning id into v25l;
  perform fn_compute_recipe_cost_snapshot(soup);
  perform fn_compute_variant_cost_snapshot(v1l);
  perform fn_compute_variant_cost_snapshot(v25l);

  -- A product nobody has priced the inputs for. Its cost is unknown and must
  -- stay unknown.
  insert into recipes(id, account_id, business_id, name, batch_yield_qty, yield_unit_id,
                      portion_qty, status)
  values (mystery, a, b, 'S32 Mystery Stew', 4000, g, 400, 'active');
  insert into ingredients(id, account_id, kind, name, base_unit_id)
  values (gen_random_uuid(), a, 'ingredient', 'S32 Unpriced Thing', g);
  insert into recipe_lines(account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  select a, mystery, id, 4000, g, true from ingredients
   where account_id = a and name = 'S32 Unpriced Thing';
  perform fn_compute_recipe_cost_snapshot(mystery);

  insert into customers(id, account_id, business_id, name, company, notes)
  values (cust, a, b, 'Mrs Adeyemi', 'Adeyemi Events', 'Prefers less pepper');

  insert into fx32 values (a,u,b,g,kg,ml,l,pc,rice,bowl,tub,jollof,soup,mystery,
                           cust,f1l,f25l,v1l,v25l);
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE COSTING FIXTURES ARE WHAT THIS SUITE THINKS THEY ARE
-- ---------------------------------------------------------------------------
do $$
declare f record; cpp numeric; c1 numeric; c25 numeric;
begin
  select * into f from fx32;
  select cost_per_portion into cpp from cost_snapshots
   where recipe_id = f.jollof and variant_id is null order by computed_at desc, seq desc limit 1;
  insert into t32 values (1, 'a portion of jollof costs N850',
    case when cpp = 850 then 'PASS' else 'FAIL' end, 'cost_per_portion = '||coalesce(cpp::text,'NULL'));

  c1  := fn_variant_cost(f.v1l);
  c25 := fn_variant_cost(f.v25l);
  -- 1 L  = 1,000 ml x N1.70/ml + N150 bowl = N1,850
  -- 2.5 L = 2,500 ml x N1.70/ml + N400 tub = N4,650
  -- The two are not proportional, because packaging is consumed once per
  -- container and is not multiplied by what is in it.
  insert into t32 values (2, 'each serving format costs its own money, packaging included',
    case when c1 = 1850 and c25 = 4650 then 'PASS' else 'FAIL' end,
    '1L='||coalesce(c1::text,'NULL')||' 2.5L='||coalesce(c25::text,'NULL'));

  insert into t32 values (3, 'an unpriced product has no cost, not a zero cost',
    case when (select cost_per_portion is null and not is_complete from cost_snapshots
                where recipe_id = f.mystery order by computed_at desc, seq desc limit 1)
         then 'PASS' else 'FAIL' end,
    (select coalesce(cost_per_portion::text,'NULL') from cost_snapshots
      where recipe_id = f.mystery order by computed_at desc, seq desc limit 1));
end $$;

-- ---------------------------------------------------------------------------
-- 2. A DRAFT IS NOT A SALE
-- ---------------------------------------------------------------------------
do $$
declare f record; ord uuid; ln uuid; st text;
begin
  select * into f from fx32;
  insert into orders(account_id, business_id, customer_id, order_no, order_date)
  values (f.acct, f.biz, f.cust, 'S32-DRAFT', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 10, 1500) returning id into ln;

  select status::text into st from orders where id = ord;
  insert into t32 values (4, 'an order is born a draft',
    case when st = 'draft' then 'PASS' else 'FAIL' end, 'status = '||st);

  insert into t32 values (5, 'a draft line carries no frozen cost',
    case when (select cost_snapshot_id is null and unit_cost_at_sale is null
                 from order_lines where id = ln) then 'PASS' else 'FAIL' end,
    (select coalesce(unit_cost_at_sale::text,'NULL') from order_lines where id = ln));

  insert into t32
  select 6, 'a draft is not counted as money taken',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)||' row(s) in v_sales_unified'
    from v_sales_unified where order_id = ord;

  insert into t32
  select 7, 'but the owner can still see the draft, marked as unconfirmed',
         case when count(*) = 1 and bool_and(not is_confirmed) then 'PASS' else 'FAIL' end,
         count(*)||' row(s) in v_sale_lines'
    from v_sale_lines where order_id = ord;

  insert into t32
  select 8, 'and is told plainly that it is not confirmed',
         case when attention = 'draft_not_confirmed'
               and what_to_do like '%draft%' then 'PASS' else 'FAIL' end,
         attention||' / '||what_to_do
    from v_orders_attention where order_id = ord;
end $$;

-- ---------------------------------------------------------------------------
-- 3. CONFIRMATION-TIME ECONOMICS
--
-- A line typed on Monday and a line typed on Wednesday both freeze at the
-- economics of Wednesday's confirmation. This is the whole point of 0045.
-- ---------------------------------------------------------------------------
do $$
declare f record; ord uuid; mon uuid; wed uuid; c_mon numeric; c_wed numeric; res jsonb;
begin
  select * into f from fx32;
  insert into orders(account_id, business_id, customer_id, order_no, order_date)
  values (f.acct, f.biz, f.cust, 'S32-MONWED', current_date) returning id into ord;

  -- Monday: rice is still N1.70/g, a portion costs N850
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 1, 1500) returning id into mon;

  -- Tuesday: rice doubles. A second buy of 50 kg at N170,000 against the first
  -- at N85,000 is a weighted average of N2.55/g over the window, so a 500 g
  -- portion now costs N1,275. The engine averages what was actually paid; it
  -- does not jump to the newest price.
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (f.acct, f.rice, fn_resolve_qty_to_base(f.rice, 50, f.kg), 170000, 'purchase');
  perform fn_compute_recipe_cost_snapshot(f.jollof);

  -- Wednesday: a second line, then the order is confirmed
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 1, 1500) returning id into wed;

  res := fn_confirm_order(ord);

  select unit_cost_at_sale into c_mon from order_lines where id = mon;
  select unit_cost_at_sale into c_wed from order_lines where id = wed;

  insert into t32 values (9, 'every line freezes at the confirmation, not at the typing',
    case when c_mon = 1275 and c_wed = 1275 then 'PASS' else 'FAIL' end,
    'monday line='||coalesce(c_mon::text,'NULL')||' wednesday line='||coalesce(c_wed::text,'NULL')
    ||' (both must be 1275, the cost at confirmation -- not 850, the cost when '
    ||'the Monday line was typed)');

  insert into t32 values (10, 'confirmation reports what it froze',
    case when (res->>'lines_frozen')::int = 2 and (res->>'lines_without_cost')::int = 0
         then 'PASS' else 'FAIL' end, res::text);

  insert into t32 values (11, 'and sets status and finalised_at together',
    case when (select status::text = 'confirmed' and finalised_at is not null
                 from orders where id = ord) then 'PASS' else 'FAIL' end,
    (select status::text||' / '||coalesce(finalised_at::text,'NULL') from orders where id = ord));

  declare ok boolean := false; msg text := '';
  begin
    begin
      perform fn_confirm_order(ord);
    exception when others then ok := true; msg := sqlerrm;
    end;
    insert into t32 values (12, 'a confirmed order cannot be confirmed again',
      case when ok then 'PASS' else 'FAIL' end, msg);
  end;

  create temp table monwed on commit drop as select ord, mon, wed;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE FROZEN COST IS WRITABLE EXACTLY ONCE, BY EXACTLY ONE OPERATION
-- ---------------------------------------------------------------------------
do $$
declare f record; m record; ord2 uuid; ln uuid; ok boolean;
begin
  select * into f from fx32; select * into m from monwed;

  ok := false;
  begin update order_lines set unit_cost_at_sale = 1 where id = m.mon;
  exception when others then ok := true; end;
  insert into t32 values (13, 'a frozen cost cannot be changed to another value',
    case when ok then 'PASS' else 'FAIL' end, '');

  ok := false;
  begin update order_lines set unit_cost_at_sale = null, cost_snapshot_id = null where id = m.mon;
  exception when others then ok := true; end;
  insert into t32 values (14, 'a frozen cost cannot be erased back to unknown',
    case when ok then 'PASS' else 'FAIL' end, '');

  -- a fresh draft, so old is NULL: the transition confirmation is allowed to
  -- make. Nobody else may make it.
  insert into orders(account_id, business_id, order_no, order_date)
  values (f.acct, f.biz, 'S32-FORGE', current_date) returning id into ord2;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord2, f.jollof, 1, 1500) returning id into ln;

  ok := false;
  begin update order_lines set unit_cost_at_sale = 1 where id = ln;
  exception when others then ok := true; end;
  insert into t32 values (15, 'nobody but the confirmation may write a cost onto a draft line',
    case when ok then 'PASS' else 'FAIL' end, '');

  ok := false;
  begin
    insert into order_lines(account_id, order_id, recipe_id, qty, unit_price, unit_cost_at_sale)
    values (f.acct, ord2, f.jollof, 1, 1500, 1);
  exception when others then ok := true; end;
  insert into t32 values (16, 'a line cannot be inserted with a cost of its own choosing',
    case when ok then 'PASS' else 'FAIL' end, '');
end $$;

-- ---------------------------------------------------------------------------
-- 5. HISTORY DOES NOT MOVE
--
-- One confirmed sale, then every lever an owner has is pulled. Revenue, COGS,
-- profit and margin must read identically afterwards.
-- ---------------------------------------------------------------------------
do $$
declare
  f record; ord uuid; ln uuid;
  rev0 numeric; cogs0 numeric; gp0 numeric; mg0 numeric;
  rev1 numeric; cogs1 numeric; gp1 numeric; mg1 numeric;
  lr uuid; oi uuid; n int := 17;
begin
  select * into f from fx32;

  insert into orders(account_id, business_id, customer_id, order_no, order_date)
  values (f.acct, f.biz, f.cust, 'S32-HISTORY', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 10, 2000) returning id into ln;
  perform fn_confirm_order(ord);

  select net_revenue, cogs, gross_profit, gross_margin_pct
    into rev0, cogs0, gp0, mg0 from v_sale_lines where line_id = ln;

  insert into t32 values (17, 'the sale reads as expected before anything is disturbed',
    case when rev0 = 20000 and cogs0 = 12750 and gp0 = 7250 then 'PASS' else 'FAIL' end,
    'revenue='||rev0||' cogs='||cogs0||' profit='||gp0||' margin='||mg0);

  -- Every lever, one after another.
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (f.acct, f.rice, fn_resolve_qty_to_base(f.rice, 50, f.kg), 500000, 'manual');

  declare pur uuid;
  begin
    insert into purchases(account_id, business_id, purchase_date, reference)
    values (f.acct, f.biz, current_date, 'S32-LATER') returning id into pur;
    insert into purchase_lines(account_id, purchase_id, ingredient_id, qty, unit_id, amount)
    values (f.acct, pur, f.rice, 50, f.kg, 900000);
    perform fn_post_purchase(pur);
  end;

  update recipe_lines set qty = 9000 where recipe_id = f.jollof;
  update recipes set batch_yield_qty = 9000, portion_qty = 250 where id = f.jollof;

  -- A price is never edited in place, so packaging is "changed" the only way
  -- the product allows: a newer price wins from here on.
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (f.acct, f.bowl, 1, 999, 'manual');

  insert into labour_rates(id, account_id, business_id, name, rate_per_hour, is_active)
  values (gen_random_uuid(), f.acct, f.biz, 'S32 Cook', 5000, true) returning id into lr;
  insert into recipe_labour(account_id, recipe_id, labour_rate_id, hours)
  values (f.acct, f.jollof, lr, 4);

  update business_settings set overhead_enabled = true,
         overhead_basis_qty = 100000, overhead_basis_unit_id = f.g
   where business_id = f.biz;
  insert into overhead_items(id, account_id, business_id, name, monthly_cost, is_active,
                             basis_qty, basis_unit_id)
  values (gen_random_uuid(), f.acct, f.biz, 'S32 Rent', 600000, true, 100000, f.g)
  returning id into oi;

  update serving_formats set capacity_qty = 9 where id = f.f1l;

  insert into recipe_prices(account_id, recipe_id, price, effective_from)
  values (f.acct, f.jollof, 9999, current_date);

  perform fn_compute_recipe_cost_snapshot(f.jollof);

  select net_revenue, cogs, gross_profit, gross_margin_pct
    into rev1, cogs1, gp1, mg1 from v_sale_lines where line_id = ln;

  insert into t32 values (18, 'nine later changes leave the confirmed sale untouched',
    case when (rev1, cogs1, gp1, mg1) is not distinct from (rev0, cogs0, gp0, mg0)
         then 'PASS' else 'FAIL' end,
    'before revenue='||rev0||' cogs='||cogs0||' profit='||gp0||' margin='||mg0
    ||' | after revenue='||rev1||' cogs='||cogs1||' profit='||gp1||' margin='||mg1);

  insert into t32
  select 19, 'and the reporting views say the same thing',
         case when round(sum(revenue),2) = rev0 and round(sum(cogs),2) = cogs0
              then 'PASS' else 'FAIL' end,
         'revenue='||round(sum(revenue),2)||' cogs='||round(sum(cogs),2)
    from v_sales_unified where record_id = ln;

  insert into t32
  select 20, 'the current cost of the dish did move -- it is the SALE that is frozen',
         case when cost_per_portion is distinct from 1275 then 'PASS' else 'FAIL' end,
         'current cost_per_portion = '||coalesce(cost_per_portion::text,'NULL')
    from cost_snapshots where recipe_id = f.jollof and variant_id is null
    order by computed_at desc, seq desc limit 1;

  create temp table hist on commit drop as select ord, ln;
end $$;

-- ---------------------------------------------------------------------------
-- 6. AN ORDER WHERE SOME LINES HAVE A COST AND SOME DO NOT
--
-- The failure mode being defended against: reporting revenue - cogs would
-- credit the uncosted revenue as pure profit, so the margin would look BEST
-- exactly where the least is known.
-- ---------------------------------------------------------------------------
do $$
declare
  f record; ord uuid; good uuid; bad uuid; res jsonb; v record;
begin
  select * into f from fx32;
  insert into orders(account_id, business_id, customer_id, order_no, order_date)
  values (f.acct, f.biz, f.cust, 'S32-MIXED', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof,  1, 3000) returning id into good;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.mystery, 1, 1000) returning id into bad;
  res := fn_confirm_order(ord);

  insert into t32 values (21, 'a sale of something uncosted still confirms, and says so',
    case when (res->>'lines_frozen')::int = 2 and (res->>'lines_without_cost')::int = 1
         then 'PASS' else 'FAIL' end, res::text);

  insert into t32 values (22, 'the uncosted line has no cost, no profit and no margin -- not zeroes',
    case when (select cogs is null and gross_profit is null and gross_margin_pct is null
                 and cost_status = 'sold_without_cost'
                 from v_sale_lines where line_id = bad) then 'PASS' else 'FAIL' end,
    (select coalesce(cogs::text,'NULL')||' / '||coalesce(gross_profit::text,'NULL')
            ||' / '||coalesce(gross_margin_pct::text,'NULL')||' / '||cost_status
       from v_sale_lines where line_id = bad));

  insert into t32 values (23, 'but it still counts as revenue -- the sale did happen',
    case when (select net_revenue = 1000 from v_sale_lines where line_id = bad)
         then 'PASS' else 'FAIL' end,
    (select net_revenue::text from v_sale_lines where line_id = bad));

  select * into v from v_orders_attention where order_id = ord;
  insert into t32 values (24, 'and the owner is told, in plain words, what is missing',
    case when v.lines_without_cost = 1 and v.attention = 'sold_without_cost'
              and v.what_to_do like '%do not know what%'
         then 'PASS' else 'FAIL' end, v.attention||' / '||v.what_to_do);
end $$;

do $$
declare f record; s record; exp_gp numeric;
begin
  select * into f from fx32;
  select * into s from v_sales_summary
   where business_id = f.biz and sale_date = current_date;

  -- gross_profit must be costed_revenue - cogs. Anything that uses total
  -- revenue would report a larger number.
  insert into t32 values (25, 'profit is measured only over the sales whose cost is known',
    case when s.gross_profit = round(s.costed_revenue - s.cogs, 2)
         then 'PASS' else 'FAIL' end,
    'costed_revenue='||s.costed_revenue||' - cogs='||s.cogs||' = '||s.gross_profit);

  insert into t32 values (26, 'and it is NOT revenue minus cost, which would flatter it',
    case when s.gross_profit < round(s.revenue - s.cogs, 2) then 'PASS' else 'FAIL' end,
    'reported='||s.gross_profit||' vs the flattering figure '||round(s.revenue - s.cogs, 2));

  insert into t32 values (27, 'coverage says how much of the picture is trustworthy',
    case when s.cost_coverage_pct < 100 and s.cost_coverage_pct > 0
              and s.revenue_without_cost = round(s.revenue - s.costed_revenue, 2)
         then 'PASS' else 'FAIL' end,
    'coverage='||s.cost_coverage_pct||'% revenue without cost='||s.revenue_without_cost);

  insert into t32 values (28, 'margin is over costed revenue, so it cannot exceed reality',
    case when s.gross_margin_pct = round(100.0 * s.gross_profit / s.costed_revenue, 2)
         then 'PASS' else 'FAIL' end, 'margin = '||s.gross_margin_pct||'%');
end $$;

-- ---------------------------------------------------------------------------
-- 7. COGS IS THE FROZEN COST, MULTIPLIED BY WHAT WAS SOLD
-- ---------------------------------------------------------------------------
do $$
declare f record; expect numeric; got numeric;
begin
  select * into f from fx32;
  select sum(qty * unit_cost_at_sale) into expect
    from order_lines ol join orders o on o.id = ol.order_id
   where o.business_id = f.biz and o.finalised_at is not null and o.voided_at is null
     and o.status <> 'cancelled' and ol.unit_cost_at_sale is not null;
  select round(sum(cogs), 2) into got from v_sales_unified
   where business_id = f.biz and source = 'order';
  insert into t32 values (29, 'reported COGS is exactly qty x the cost frozen at sale',
    case when round(expect, 2) = got then 'PASS' else 'FAIL' end,
    'expected '||round(expect,2)||' reported '||got);
end $$;

-- ---------------------------------------------------------------------------
-- 8. A FORMAT SALE FREEZES THAT FORMAT'S OWN ECONOMICS
-- ---------------------------------------------------------------------------
do $$
declare f record; ord uuid; l1 uuid; l25 uuid; c1 numeric; c25 numeric; b record;
begin
  select * into f from fx32;
  insert into orders(account_id, business_id, customer_id, order_no, order_date)
  values (f.acct, f.biz, f.cust, 'S32-FORMATS', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, variant_id, qty, unit_price)
  values (f.acct, ord, f.soup, f.v1l,  1, 3500) returning id into l1;
  insert into order_lines(account_id, order_id, recipe_id, variant_id, qty, unit_price)
  values (f.acct, ord, f.soup, f.v25l, 1, 8000) returning id into l25;
  perform fn_confirm_order(ord);

  select unit_cost_at_sale into c1  from order_lines where id = l1;
  select unit_cost_at_sale into c25 from order_lines where id = l25;

  insert into t32 values (30, 'the 1 litre and the 2.5 litre freeze different costs',
    case when c1 = 1850 and c25 = 4650 then 'PASS' else 'FAIL' end,
    '1L='||coalesce(c1::text,'NULL')||' 2.5L='||coalesce(c25::text,'NULL'));

  select * into b from v_sale_cost_breakdown where line_id = l25;
  insert into t32 values (31, 'the 2.5 litre carries its own packaging, not the 1 litre''s',
    case when b.packaging_cost = 400 then 'PASS' else 'FAIL' end,
    'packaging on the frozen 2.5L snapshot = '||coalesce(b.packaging_cost::text,'NULL'));

  insert into t32 values (32, 'and the frozen components add up to the frozen total',
    case when round(b.ingredients_and_labour + b.packaging_cost + b.overhead_cost, 2)
              = round(b.unit_cost_at_sale, 2) then 'PASS' else 'FAIL' end,
    coalesce(b.ingredients_and_labour::text,'NULL')||' + '||coalesce(b.packaging_cost::text,'NULL')
    ||' + '||coalesce(b.overhead_cost::text,'NULL')||' = '||coalesce(b.unit_cost_at_sale::text,'NULL'));

  create temp table fmt on commit drop as select ord, l1, l25;
end $$;

-- ---------------------------------------------------------------------------
-- 9. CANCELLATION AND VOID + REISSUE
-- ---------------------------------------------------------------------------
do $$
declare
  f record; h record; res jsonb; newid uuid; rev_before numeric; rev_after numeric;
  froze numeric;
begin
  select * into f from fx32; select * into h from hist;

  select round(sum(revenue), 2) into rev_before from v_sales_unified where business_id = f.biz;
  select unit_cost_at_sale into froze from order_lines where id = h.ln;

  res := fn_void_order(h.ord, 'customer cancelled the event');
  insert into t32 values (33, 'a confirmed sale is voided, not edited',
    case when (res->>'voided')::boolean then 'PASS' else 'FAIL' end, res::text);

  select round(sum(revenue), 2) into rev_after from v_sales_unified where business_id = f.biz;
  insert into t32 values (34, 'a voided sale leaves active reporting',
    case when rev_after = rev_before - 20000 then 'PASS' else 'FAIL' end,
    'revenue '||rev_before||' -> '||rev_after);

  insert into t32 values (35, 'but its frozen cost remains readable as evidence',
    case when (select unit_cost_at_sale from order_lines where id = h.ln) = froze
         then 'PASS' else 'FAIL' end,
    'still '||coalesce((select unit_cost_at_sale::text from order_lines where id = h.ln),'NULL'));

  insert into t32
  select 36, 'and it is inspectable, with the reason it was voided',
         case when count(*) = 1 and bool_and(void_reason = 'customer cancelled the event')
              then 'PASS' else 'FAIL' end, count(*)||' row(s)'
    from v_voided_sales where record_id = h.ord;

  res := fn_reissue_order(h.ord);
  newid := (res->>'new_order_id')::uuid;
  insert into t32 values (37, 'the correction is a new order that points back at the original',
    case when (select replaces = h.ord and status::text = 'draft' and finalised_at is null
                 from orders where id = newid) then 'PASS' else 'FAIL' end, res::text);

  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, newid, f.jollof, 5, 2000);
  perform fn_confirm_order(newid);

  select round(sum(revenue), 2) into rev_after from v_sales_unified where business_id = f.biz;
  insert into t32 values (38, 'only the correction counts; the original stays voided',
    case when rev_after = rev_before - 20000 + 10000 then 'PASS' else 'FAIL' end,
    'revenue now '||rev_after);
end $$;

-- ---------------------------------------------------------------------------
-- 10. CROSS-TENANT ISOLATION, ASSERTED BY IDENTITY
--
-- Not "account B sees zero rows" -- B has its own data and should see it. The
-- assertion is that no specific row belonging to A is visible to B.
-- ---------------------------------------------------------------------------
do $$
declare
  f record; a2 uuid; u2 uuid := gen_random_uuid(); b2 uuid; res jsonb;
  leaked text; ordA uuid; lineA uuid; seA uuid; snapA uuid; custA uuid;
begin
  select * into f from fx32;

  select o.id, ol.id into ordA, lineA
    from orders o join order_lines ol on ol.order_id = o.id
   where o.account_id = f.acct and o.finalised_at is not null and o.voided_at is null
   limit 1;
  select id into snapA from cost_snapshots where account_id = f.acct limit 1;
  custA := f.cust;

  insert into sales_entries(account_id, business_id, sale_date, recipe_id, qty, unit_price)
  values (f.acct, f.biz, current_date, f.jollof, 3, 1800) returning id into seA;

  insert into auth.users(id, email) values (u2, 'other32@t.test');
  res := fn_create_account_and_business('Other Co','Other Kitchen','baker', u2,
           p_idempotency_key => gen_random_uuid()::text);
  a2 := (res->>'account_id')::uuid; b2 := (res->>'business_id')::uuid;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);

  leaked := '';
  if exists (select 1 from customers      where id = custA) then leaked := leaked||'customers '; end if;
  if exists (select 1 from orders         where id = ordA)  then leaked := leaked||'orders '; end if;
  if exists (select 1 from order_lines    where id = lineA) then leaked := leaked||'order_lines '; end if;
  if exists (select 1 from sales_entries  where id = seA)   then leaked := leaked||'sales_entries '; end if;
  if exists (select 1 from cost_snapshots where id = snapA) then leaked := leaked||'cost_snapshots '; end if;
  if exists (select 1 from v_sale_lines           where line_id = lineA)  then leaked := leaked||'v_sale_lines '; end if;
  if exists (select 1 from v_sales_unified        where record_id = lineA) then leaked := leaked||'v_sales_unified '; end if;
  if exists (select 1 from v_orders_attention     where order_id = ordA)  then leaked := leaked||'v_orders_attention '; end if;
  if exists (select 1 from v_sale_cost_breakdown  where line_id = lineA)  then leaked := leaked||'v_sale_cost_breakdown '; end if;
  if exists (select 1 from v_sales_summary        where business_id = f.biz) then leaked := leaked||'v_sales_summary '; end if;
  if exists (select 1 from v_product_performance  where business_id = f.biz) then leaked := leaked||'v_product_performance '; end if;
  if exists (select 1 from fn_allocate_order_discount() where order_line_id = lineA) then leaked := leaked||'fn_allocate_order_discount '; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  insert into t32 values (39, 'another account cannot see one identified row of this one''s sales',
    case when leaked = '' then 'PASS' else 'FAIL' end,
    case when leaked = '' then 'no leak on 12 surfaces' else 'LEAKED VIA: '||leaked end);
end $$;

-- ---------------------------------------------------------------------------
-- 11. A QUICK SALE STILL FREEZES ON ARRIVAL
-- ---------------------------------------------------------------------------
do $$
declare f record; se uuid; c numeric;
begin
  select * into f from fx32;
  insert into sales_entries(account_id, business_id, sale_date, recipe_id, variant_id, qty, unit_price)
  values (f.acct, f.biz, current_date, f.soup, f.v25l, 2, 8000) returning id into se;
  select unit_cost_at_sale into c from sales_entries where id = se;
  insert into t32 values (40, 'a daily total has no draft state and freezes as it is recorded',
    case when c = 4650 then 'PASS' else 'FAIL' end,
    'frozen at '||coalesce(c::text,'NULL')||' (the 2.5 litre cost)');
end $$;

-- ---------------------------------------------------------------------------
-- 12. AN ORDER CANNOT BE TALKED INTO BEING A SALE
--
-- Every guard keys on finalised_at. With status now meaning something, an
-- ordinary write that set status to 'confirmed' and left finalised_at null
-- would produce an order that reads as a sale and is treated as a draft by
-- every guard, with no frozen cost behind it.
-- ---------------------------------------------------------------------------
do $$
declare
  f record; ord uuid; ok_insert boolean := false; ok_update boolean := false;
  st text; fin text; froze boolean;
begin
  select * into f from fx32;

  -- Run as an ordinary authenticated user. The harness itself is service
  -- context and deliberately exempt -- an operator repairing data is not the
  -- normal application -- so testing as the harness would prove nothing.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);

  begin
    insert into orders(account_id, business_id, order_no, order_date, status)
    values (f.acct, f.biz, 'S32-BORNSOLD', current_date, 'confirmed');
  exception when others then ok_insert := true; end;

  insert into orders(account_id, business_id, order_no, order_date)
  values (f.acct, f.biz, 'S32-TALKED', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 1, 1500);

  begin update orders set status = 'confirmed' where id = ord;
  exception when others then ok_update := true; end;

  select o.status::text, coalesce(o.finalised_at::text, 'not finalised')
    into st, fin from orders o where o.id = ord;

  perform fn_confirm_order(ord);
  select o.status::text = 'confirmed' and o.finalised_at is not null
         and ol.unit_cost_at_sale is not null
    into froze
    from orders o join order_lines ol on ol.order_id = o.id where o.id = ord;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  insert into t32 values (41, 'an order cannot be inserted already confirmed',
    case when ok_insert then 'PASS' else 'FAIL' end, '');
  insert into t32 values (42, 'and a draft cannot be relabelled as one either',
    case when ok_update and st = 'draft' then 'PASS' else 'FAIL' end, st||' / '||fin);
  insert into t32 values (43, 'only confirming it does both, together',
    case when froze then 'PASS' else 'FAIL' end, '');
end $$;

select * from t32 order by n;
select count(*) filter (where verdict = 'PASS') as pass,
       count(*) filter (where verdict <> 'PASS') as fail from t32;

rollback;
