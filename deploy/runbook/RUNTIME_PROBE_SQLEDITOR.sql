-- ============================================================================
-- RUNTIME PROBE -- SAFE FOR THE SUPABASE SQL EDITOR
--
-- The other probe, RUNTIME_PROBE.sql, wraps its work in BEGIN ... ROLLBACK and
-- is therefore only safe in a client that honours transaction control. The SQL
-- Editor does not: on 2026-08-31 it committed every statement of a bundle
-- individually and simply halted at the first error. Run there, that probe
-- would COMMIT an account, business, ingredient, price, recipe, order and
-- order lines into production.
--
-- This version needs no client transaction at all. Everything happens inside a
-- single DO block, and the block ENDS BY RAISING AN EXCEPTION that carries the
-- verdict in its message. A DO block is one statement; when a statement raises,
-- everything it did is undone, whatever the client is doing about transactions.
--
-- SO: THE RESULT COMES BACK AS A RED ERROR MESSAGE. That is correct and
-- expected. The error text IS the result. Read it.
--
-- EXPECTED (as an error message):
--   PROBE RESULT: PASS
--     lines_frozen=1, cost frozen at 850.0000 (expect 850.0000),
--     net revenue 4000.00 (expect 4000.00), auth.users 7 -> 7 (must be equal)
--
-- Then run DIAGNOSE_LIVE_STATE.sql, or the short cleanup query at the bottom of
-- this file, to confirm nothing survived.
-- ============================================================================

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  g uuid; kg uuid; rice uuid := gen_random_uuid(); dish uuid := gen_random_uuid();
  o uuid; res jsonb; cost numeric; net numeric; n_before bigint; n_after bigint;
  v_verdict text; v_detail text;
begin
  select count(*) into n_before from auth.users;

  select id into g  from units where account_id is null and code = 'g';
  select id into kg from units where account_id is null and code = 'kg';

  insert into accounts(id, name) values (a, '__probe__account');
  insert into businesses(id, account_id, name, slug, type)
  values (b, a, '__probe__business', '__probe__business', 'caterer');
  insert into business_settings(business_id, account_id) values (b, a);

  insert into ingredients(id, account_id, kind, name, base_unit_id)
  values (rice, a, 'ingredient', '__probe__rice', g);
  -- 50 kg for N85,000 is N1.70 a gram
  insert into ingredient_prices(account_id, ingredient_id, qty_base, amount, source)
  values (a, rice, fn_resolve_qty_to_base(rice, 50, kg), 85000, 'purchase');

  -- 4,500 g batch, 500 g portion -> N850 a plate
  insert into recipes(id, account_id, business_id, name, batch_yield_qty,
                      yield_unit_id, portion_qty, status)
  values (dish, a, b, '__probe__dish', 4500, g, 500, 'active');
  insert into recipe_lines(account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
  values (a, dish, rice, 4500, g, true);
  perform fn_compute_recipe_cost_snapshot(dish);

  insert into orders(account_id, business_id, order_no, order_date)
  values (a, b, '__probe__order', current_date) returning id into o;
  insert into order_lines(account_id, order_id, recipe_id, qty, unit_price)
  values (a, o, dish, 2, 2000);

  -- the whole point
  res := fn_confirm_order(o);

  select unit_cost_at_sale into cost from order_lines where order_id = o;
  select sum(net_revenue) into net from v_sale_lines where order_id = o;

  select count(*) into n_after from auth.users;

  v_verdict := case
           when (res->>'lines_frozen')::int = 1
            and cost = 850.0000
            and net = 4000.00
            and n_after = n_before
           then 'PASS' else '*** FAIL ***' end;
  v_detail := 'lines_frozen=' || (res->>'lines_frozen')
         || ', cost frozen at ' || coalesce(cost::text,'NULL') || ' (expect 850.0000)'
         || ', net revenue ' || coalesce(net::text,'NULL') || ' (expect 4000.00)'
         || ', auth.users ' || n_before || ' -> ' || n_after || ' (must be equal)';

  -- THE POINT OF THIS FILE. Raising here undoes everything the block did.
  -- A DO block is ONE statement, so this works even when the client commits
  -- every statement on its own -- which is what the Supabase SQL Editor does.
  raise exception E'PROBE RESULT: %\n  %\n  (This error is DELIBERATE. It is how the probe discards its test data. Nothing was saved.)',
        v_verdict, v_detail;
end $$;

-- ============================================================================
-- CLEANUP CHECK -- run this SECOND, as its own query. READ ONLY.
-- Expected: one row, PASS, "0 __probe__ row(s) survived (must be 0)".
-- ============================================================================
-- select case when count(*) = 0 then 'PASS' else '*** FAIL ***' end as cleanup_verdict,
--        count(*) || ' __probe__ row(s) survived (must be 0)' as detail
--   from (select 1 from accounts    where name     like '__probe__%'
--         union all select 1 from businesses  where name     like '__probe__%'
--         union all select 1 from ingredients where name     like '__probe__%'
--         union all select 1 from recipes     where name     like '__probe__%'
--         union all select 1 from customers   where name     like '__probe__%'
--         union all select 1 from orders      where order_no like '__probe__%'
--         union all select 1 from cost_snapshots cs
--                    join recipes r on r.id = cs.recipe_id
--                   where r.name like '__probe__%') x;
