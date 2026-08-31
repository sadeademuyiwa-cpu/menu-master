-- ============================================================================
-- RUNTIME PROBE  -- run as STEP 4, after POST_VERIFY, before the frontend.
--
-- Every other check reads the catalogue. This one exercises the real path:
-- it builds a throwaway business, prices an ingredient, costs a dish, records
-- a sale and confirms it -- then throws all of it away.
--
-- Why it is necessary: a PL/pgSQL function body is NOT resolved against the
-- catalogue when the function is created. A function can reference a column
-- that does not exist, be created successfully, pass every schema check, and
-- fail only when a customer tries to record a sale. That is exactly what would
-- have happened had the first deployment attempt not failed on a GRANT.
--
-- ############################################################################
-- ##  DO NOT RUN THIS IN THE SUPABASE SQL EDITOR.                           ##
-- ##                                                                        ##
-- ##  On 2026-08-31 the SQL Editor did not honour the begin;/commit; in     ##
-- ##  MIGRATE_0034_TO_0048.sql: every statement committed on its own and    ##
-- ##  execution simply halted at the first error. This file's safety rests  ##
-- ##  ENTIRELY on its closing rollback;. Under that executor the rollback   ##
-- ##  would not undo anything and this probe would COMMIT a __probe__       ##
-- ##  account, business, ingredient, price, recipe, order and order lines   ##
-- ##  into production -- destroying an empty-baseline database.             ##
-- ##                                                                        ##
-- ##  Run it only through psql on a single connection, where begin; really  ##
-- ##  opens a transaction.                                                  ##
-- ############################################################################
--
-- SAFETY (given a client that honours transactions)
--   * It runs inside BEGIN ... ROLLBACK. Nothing it creates survives.
--   * It NEVER touches auth.users. accounts, businesses, ingredients, recipes,
--     customers and order_lines have no foreign key to auth.users, and
--     orders.created_by / finalised_by are nullable, so no login is needed.
--   * Every identifier it creates is prefixed __probe__ so that if a rollback
--     were somehow missed, the rows are unmistakable.
--   * It asserts its own cleanup before finishing.
--
-- EXPECTED OUTPUT: one row, verdict = PASS, with a frozen cost of 850.0000.
-- ============================================================================
begin;

create temp table probe_result (verdict text, detail text) on commit drop;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  g uuid; kg uuid; rice uuid := gen_random_uuid(); dish uuid := gen_random_uuid();
  o uuid; res jsonb; cost numeric; net numeric; n_before bigint; n_after bigint;
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

  insert into probe_result
  select case
           when (res->>'lines_frozen')::int = 1
            and cost = 850.0000
            and net = 4000.00
            and n_after = n_before
           then 'PASS' else '*** FAIL ***' end,
         'lines_frozen=' || (res->>'lines_frozen')
         || ', cost frozen at ' || coalesce(cost::text,'NULL') || ' (expect 850.0000)'
         || ', net revenue ' || coalesce(net::text,'NULL') || ' (expect 4000.00)'
         || ', auth.users ' || n_before || ' -> ' || n_after || ' (must be equal)';
end $$;

select * from probe_result;

rollback;

-- ---------------------------------------------------------------------------
-- AFTER the rollback. Nothing the probe created may survive. This runs outside
-- the transaction, so it is a real check rather than a look at uncommitted
-- rows -- the reason the first version of this check was wrong.
-- ---------------------------------------------------------------------------
select case when count(*) = 0 then 'PASS' else '*** FAIL ***' end as cleanup_verdict,
       count(*) || ' __probe__ row(s) survived the rollback (must be 0)' as detail
  from (select 1 from accounts    where name     like '__probe__%'
        union all select 1 from businesses  where name     like '__probe__%'
        union all select 1 from ingredients where name     like '__probe__%'
        union all select 1 from recipes     where name     like '__probe__%'
        union all select 1 from customers   where name     like '__probe__%'
        union all select 1 from orders      where order_no like '__probe__%'
        union all select 1 from cost_snapshots cs
                   join recipes r on r.id = cs.recipe_id
                  where r.name like '__probe__%') x;
