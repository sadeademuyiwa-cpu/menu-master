-- ============================================================================
-- MENU MASTER NG -- tests/033_discounts.sql
--
-- A discount is money the owner gave away. It has to be visible as that, and
-- it has to add up.
--
-- Two levels: a discount on one line, and a discount on the whole order that
-- is spread across the lines pro rata so that per-product margin still means
-- something. Spreading involves division, division involves rounding, and
-- rounding is where a kobo goes missing. It does not go missing here: the
-- residual is assigned deterministically, so the allocations sum to the order
-- discount exactly, every time, and the same order always splits the same way.
--
-- Run on a database with 0001-0047 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t33 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx33 (acct uuid, usr uuid, biz uuid, g uuid, kg uuid,
                        rice uuid, jollof uuid, cust uuid) on commit drop;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb; g uuid; kg uuid;
  rice uuid := gen_random_uuid(); jollof uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
begin
  select id into g  from units where account_id is null and code = 'g';
  select id into kg from units where account_id is null and code = 'kg';
  insert into auth.users(id, email) values (u, 'disc33@t.test');
  res := fn_create_account_and_business('Disc Co','Disc Kitchen','caterer', u,
           p_idempotency_key => gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;

  insert into ingredients(id, account_id, kind, name, base_unit_id)
  values (rice, a, 'ingredient', 'D33 Rice', g);
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (a, rice, fn_resolve_qty_to_base(rice, 50, kg), 85000, 'purchase');

  insert into recipes(id, account_id, business_id, name, batch_yield_qty, yield_unit_id,
                      portion_qty, status)
  values (jollof, a, b, 'D33 Jollof', 4500, g, 500, 'active');
  insert into recipe_lines(account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (a, jollof, rice, 4500, g, true);
  perform fn_compute_recipe_cost_snapshot(jollof);

  insert into customers(id, account_id, business_id, name)
  values (cust, a, b, 'D33 Customer');

  insert into fx33 values (a, u, b, g, kg, rice, jollof, cust);
end $$;

-- ---------------------------------------------------------------------------
-- 1. A LINE DISCOUNT
-- ---------------------------------------------------------------------------
do $$
declare f record; ord uuid; ln uuid; v record; ok boolean;
begin
  select * into f from fx33;
  insert into orders(account_id, business_id, customer_id, order_no, order_date)
  values (f.acct, f.biz, f.cust, 'D33-LINE', current_date) returning id into ord;
  -- 25 plates at N1,500, with N100 a plate taken off
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price, discount_amount)
  values (f.acct, ord, f.jollof, 25, 1500, 2500) returning id into ln;

  select * into v from v_sale_lines where line_id = ln;
  insert into t33 values (1, 'the original price survives the discount',
    case when v.gross_revenue = 37500 and v.line_discount = 2500 and v.net_revenue = 35000
         then 'PASS' else 'FAIL' end,
    'gross='||v.gross_revenue||' discount='||v.line_discount||' net='||v.net_revenue);

  ok := false;
  begin
    update order_lines set discount_amount = 40000 where id = ln;
  exception when others then ok := true; end;
  insert into t33 values (2, 'a line cannot be discounted by more than it is worth',
    case when ok then 'PASS' else 'FAIL' end,
    'giving away more than the line is worth is a refund, not a discount');

  perform fn_confirm_order(ord);
  select * into v from v_sale_lines where line_id = ln;
  insert into t33 values (3, 'margin is measured on what was actually taken, not the list price',
    case when v.cogs = 21250
              and v.gross_profit = 13750
              and v.gross_margin_pct = round(100.0 * 13750 / 35000, 2)
         then 'PASS' else 'FAIL' end,
    'net='||v.net_revenue||' cogs='||v.cogs||' profit='||v.gross_profit
    ||' margin='||v.gross_margin_pct||'%');

  ok := false;
  begin update order_lines set discount_amount = 0 where id = ln;
  exception when others then ok := true; end;
  insert into t33 values (4, 'a discount on a confirmed sale is history and cannot move',
    case when ok then 'PASS' else 'FAIL' end, '');
end $$;

-- ---------------------------------------------------------------------------
-- 2. AN ORDER DISCOUNT, SPREAD PRO RATA
-- ---------------------------------------------------------------------------
do $$
declare
  f record; ord uuid; big uuid; small uuid; total numeric; v record;
begin
  select * into f from fx33;
  insert into orders(account_id, business_id, customer_id, order_no, order_date, order_discount)
  values (f.acct, f.biz, f.cust, 'D33-ORDER', current_date, 0) returning id into ord;
  -- N30,000 and N10,000: a 3:1 split
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 20, 1500) returning id into big;
  insert into order_lines(account_id, order_id, recipe_id, description, qty, unit_price)
  values (f.acct, ord, null, 'Service', 1, 10000) returning id into small;

  update orders set order_discount = 4000 where id = ord;

  select round(sum(allocated_order_discount), 2) into total
    from fn_allocate_order_discount(ord);

  insert into t33 values (5, 'the whole discount is allocated, to the kobo',
    case when total = 4000 then 'PASS' else 'FAIL' end, 'allocated total = '||total);

  insert into t33
  select 6, 'and it is split in proportion to what each line is worth',
         case when (select allocated_order_discount from fn_allocate_order_discount(ord)
                     where order_line_id = big)   = 3000
               and (select allocated_order_discount from fn_allocate_order_discount(ord)
                     where order_line_id = small) = 1000
              then 'PASS' else 'FAIL' end,
         (select 'N30,000 line -> '||allocated_order_discount from fn_allocate_order_discount(ord)
           where order_line_id = big)
         ||', '||
         (select 'N10,000 line -> '||allocated_order_discount from fn_allocate_order_discount(ord)
           where order_line_id = small);

  select * into v from v_sale_lines where line_id = big;
  insert into t33 values (7, 'the line keeps all three figures: gross, allocated, net',
    case when v.gross_revenue = 30000 and v.line_discount = 0
              and v.allocated_order_discount = 3000 and v.net_revenue = 27000
         then 'PASS' else 'FAIL' end,
    'gross='||v.gross_revenue||' line discount='||v.line_discount
    ||' allocated='||v.allocated_order_discount||' net='||v.net_revenue);
end $$;

-- ---------------------------------------------------------------------------
-- 3. THE KOBO THAT DOES NOT DIVIDE
--
-- N100 across three equal lines is 33.333... each. Rounded independently that
-- is 99.99, and a kobo is missing. It must not be.
-- ---------------------------------------------------------------------------
do $$
declare
  f record; ord uuid; a1 uuid; a2 uuid; a3 uuid;
  total numeric; shares numeric[]; first_run numeric[]; second_run numeric[];
begin
  select * into f from fx33;
  insert into orders(account_id, business_id, order_no, order_date)
  values (f.acct, f.biz, 'D33-KOBO', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, description, qty, unit_price)
  values (f.acct, ord, null, 'A', 1, 1000) returning id into a1;
  insert into order_lines(account_id, order_id, recipe_id, description, qty, unit_price)
  values (f.acct, ord, null, 'B', 1, 1000) returning id into a2;
  insert into order_lines(account_id, order_id, recipe_id, description, qty, unit_price)
  values (f.acct, ord, null, 'C', 1, 1000) returning id into a3;
  update orders set order_discount = 100 where id = ord;

  select round(sum(allocated_order_discount), 2),
         array_agg(allocated_order_discount order by allocated_order_discount, order_line_id)
    into total, shares
    from fn_allocate_order_discount(ord);

  insert into t33 values (8, 'a discount that will not divide still adds up exactly',
    case when total = 100 then 'PASS' else 'FAIL' end,
    'allocated '||array_to_string(shares, ' + ')||' = '||total);

  insert into t33 values (9, 'the residual lands on one line, not smeared or dropped',
    case when shares = array[33.33, 33.33, 33.34]::numeric[] then 'PASS' else 'FAIL' end,
    array_to_string(shares, ', '));

  select array_agg(allocated_order_discount order by order_line_id) into first_run
    from fn_allocate_order_discount(ord);
  select array_agg(allocated_order_discount order by order_line_id) into second_run
    from fn_allocate_order_discount(ord);
  insert into t33 values (10, 'and the same order always splits the same way',
    case when first_run = second_run then 'PASS' else 'FAIL' end,
    array_to_string(first_run, ', ')||' vs '||array_to_string(second_run, ', '));

  -- The residual goes to the largest line by revenue. Make one line larger and
  -- it must move there.
  update order_lines set unit_price = 1000.01 where id = a2;
  insert into t33 values (11, 'the residual follows the largest line',
    case when (select allocated_order_discount from fn_allocate_order_discount(ord)
                where order_line_id = a2)
              = (select max(allocated_order_discount) from fn_allocate_order_discount(ord))
         then 'PASS' else 'FAIL' end,
    (select string_agg(coalesce(description,'?')||'='||allocated_order_discount, ' ' order by description)
       from fn_allocate_order_discount() a join order_lines ol on ol.id = a.order_line_id
      where ol.order_id = ord));
end $$;

-- ---------------------------------------------------------------------------
-- 4. A DISCOUNT CANNOT EXCEED THE ORDER
-- ---------------------------------------------------------------------------
do $$
declare f record; ord uuid; l1 uuid; l2 uuid; ok boolean;
begin
  select * into f from fx33;
  insert into orders(account_id, business_id, order_no, order_date)
  values (f.acct, f.biz, 'D33-TOOBIG', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, description, qty, unit_price)
  values (f.acct, ord, null, 'One', 1, 5000) returning id into l1;
  insert into order_lines(account_id, order_id, recipe_id, description, qty, unit_price)
  values (f.acct, ord, null, 'Two', 1, 5000) returning id into l2;

  ok := false;
  begin update orders set order_discount = 12000 where id = ord;
  exception when others then ok := true; end;
  insert into t33 values (12, 'an order cannot be discounted by more than it is worth',
    case when ok then 'PASS' else 'FAIL' end, '');

  update orders set order_discount = 9000 where id = ord;

  -- Removing a line is allowed even though it leaves the discount too large:
  -- the owner is between two edits they are both entitled to make. What must
  -- not happen is confirming in that state.
  delete from order_lines where id = l2;
  insert into t33 values (13, 'removing a line from a draft is not blocked by the discount',
    case when (select count(*) from order_lines where order_id = ord) = 1
         then 'PASS' else 'FAIL' end, '');

  ok := false;
  begin perform fn_confirm_order(ord);
  exception when others then ok := true; end;
  insert into t33 values (14, 'but the sale cannot be confirmed while the discount exceeds it',
    case when ok and (select finalised_at is null from orders where id = ord)
         then 'PASS' else 'FAIL' end,
    'order must still be a draft: '
    ||(select coalesce(finalised_at::text,'draft') from orders where id = ord));

  update orders set order_discount = 1000 where id = ord;
  perform fn_confirm_order(ord);
  insert into t33 values (15, 'lower the discount and it confirms',
    case when (select finalised_at is not null from orders where id = ord)
         then 'PASS' else 'FAIL' end, '');

  ok := false;
  begin update orders set order_discount = 0 where id = ord;
  exception when others then ok := true; end;
  insert into t33 values (16, 'and the order discount is then history too',
    case when ok then 'PASS' else 'FAIL' end, '');
end $$;

-- ---------------------------------------------------------------------------
-- 5. THE REVENUE IDENTITY, AND WHAT THE REPORTS SAY
-- ---------------------------------------------------------------------------
do $$
declare f record; s record; identity numeric;
begin
  select * into f from fx33;

  -- revenue = SUM(qty x unit_price - line discount) - order discount, over
  -- confirmed, unvoided orders.
  select round(sum(q.line_sum - q.order_discount), 2) into identity
    from (
      select o.order_discount,
             (select sum(ol.qty * ol.unit_price - ol.discount_amount)
                from order_lines ol where ol.order_id = o.id) as line_sum
        from orders o
       where o.business_id = f.biz and o.finalised_at is not null
         and o.voided_at is null and o.status <> 'cancelled'
    ) q;

  select round(sum(revenue), 2) as revenue,
         round(sum(gross_revenue), 2) as gross,
         round(sum(line_discount + allocated_order_discount), 2) as given
    into s
    from v_sales_unified where business_id = f.biz and source = 'order';

  insert into t33 values (17, 'reported revenue is gross less every discount given',
    case when s.revenue = round(s.gross - s.given, 2) then 'PASS' else 'FAIL' end,
    'gross='||s.gross||' - given away='||s.given||' = '||s.revenue);

  insert into t33 values (18, 'and that matches the identity computed from the raw rows',
    case when s.revenue = identity then 'PASS' else 'FAIL' end,
    'view says '||s.revenue||', raw arithmetic says '||coalesce(identity::text,'NULL'));

  select * into s from v_sales_summary
   where business_id = f.biz and sale_date = current_date;
  insert into t33 values (19, 'the day''s summary shows what was given away',
    case when s.discount_given > 0
              and s.revenue = round(s.gross_revenue - s.discount_given, 2)
         then 'PASS' else 'FAIL' end,
    'gross='||s.gross_revenue||' discounts='||s.discount_given||' revenue='||s.revenue);
end $$;

-- ---------------------------------------------------------------------------
-- 6. NO DISCOUNT MEANS NO DISCOUNT
-- ---------------------------------------------------------------------------
do $$
declare f record; ord uuid; ln uuid;
begin
  select * into f from fx33;
  insert into orders(account_id, business_id, order_no, order_date)
  values (f.acct, f.biz, 'D33-NONE', current_date) returning id into ord;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (f.acct, ord, f.jollof, 2, 1500) returning id into ln;

  insert into t33
  select 20, 'an order with no discount allocates nothing and loses nothing',
         case when allocated_order_discount = 0 and line_discount = 0
                   and net_revenue = gross_revenue and net_revenue = 3000
              then 'PASS' else 'FAIL' end,
         'gross='||gross_revenue||' allocated='||allocated_order_discount||' net='||net_revenue
    from fn_allocate_order_discount(ord) where order_line_id = ln;
end $$;

select * from t33 order by n;
select count(*) filter (where verdict = 'PASS') as pass,
       count(*) filter (where verdict <> 'PASS') as fail from t33;

rollback;
