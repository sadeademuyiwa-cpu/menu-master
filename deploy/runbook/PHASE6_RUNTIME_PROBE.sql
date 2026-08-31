-- STEP 3, Query 3.7 -- RUNTIME PROBE. Leaves nothing behind: it rolls back.
-- Every other check inspects the catalogue. This one actually confirms a sale,
-- because a function body can reference a column that does not exist and still
-- be created successfully -- which is exactly how the first attempt would have
-- committed a database that could not record a sale.
begin;
do $$
declare a uuid; b uuid; dish uuid; o uuid; res jsonb; cost numeric;
begin
  select account_id, id into a, b from businesses limit 1;
  select id into dish from recipes where deleted_at is null limit 1;
  if a is null or dish is null then
    raise notice 'RUNTIME PROBE SKIPPED: no business or recipe to test with';
    return;
  end if;
  insert into orders(account_id,business_id,order_no,order_date)
  values (a,b,'__runtime_probe__',current_date) returning id into o;
  insert into order_lines(account_id,order_id,recipe_id,qty,unit_price)
  values (a,o,dish,1,1000);
  res := fn_confirm_order(o);
  select unit_cost_at_sale into cost from order_lines where order_id = o;
  raise notice 'RUNTIME PROBE PASS: a sale can be confirmed. lines_frozen=%, cost=%',
    res->>'lines_frozen', coalesce(cost::text,'not known (valid)');
end $$;
rollback;
