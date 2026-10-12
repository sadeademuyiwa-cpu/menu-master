-- ============================================================================
-- MENU MASTER NG -- tests/048_sub_recipe_lines.sql
--
-- Acceptance test for 0062. Run on a database with 0062 applied.
-- Rolls everything back.
--
-- A dish made from another dish keeps its whole ingredient list in the
-- per-line view, and the sub-recipe line is costed from the other dish's
-- batch -- the same figure the engine already put in the batch total.
-- ============================================================================

begin;

create temp table t48 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values ('00000048-0000-4000-8000-000000000001', 'owner@t48.test');

create temp table fx48 on commit drop as
select (r->>'account_id')::uuid as acct, (r->>'business_id')::uuid as biz,
       (select id from units where account_id is null and code='g')  as g,
       (select id from units where account_id is null and code='kg') as kg,
       gen_random_uuid() as rice, gen_random_uuid() as pepper,
       gen_random_uuid() as stew, gen_random_uuid() as jollof
from fn_create_account_and_business('T48 Foods','T48 Kitchen','other',
       '00000048-0000-4000-8000-000000000001', p_idempotency_key => 't48-owner') r;

do $$
declare f record; v_err text; n_lines int; v_sub record; v_batch numeric; v_ing numeric;
begin
  select * into f from fx48;
  perform set_config('request.jwt.claim.sub', '00000048-0000-4000-8000-000000000001', true);

  insert into ingredients (id, account_id, kind, name, base_unit_id) values
    (f.rice, f.acct, 'ingredient', 'T48 Rice', f.g),
    (f.pepper, f.acct, 'ingredient', 'T48 Pepper', f.g);
  insert into ingredient_prices (account_id, ingredient_id, qty_base, amount, source) values
    (f.acct, f.rice, 50000, 85000, 'purchase'),      -- N1.70/g
    (f.acct, f.pepper, 1000, 2000, 'purchase');      -- N2.00/g

  -- the stew: 1000 g of pepper -> 1000 g, N2,000 a batch, N2.00/g
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.stew, f.acct, f.biz, 'T48 Stew', 1000, f.g, 100, 'active');
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id) values (f.acct, f.stew, f.pepper, 1000, f.g);
  perform fn_compute_recipe_cost_snapshot(f.stew);

  -- the jollof: 1 kg rice + 500 g of the stew
  insert into recipes (id, account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
  values (f.jollof, f.acct, f.biz, 'T48 Jollof', 2000, f.g, 200, 'active');
  insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id) values (f.acct, f.jollof, f.rice, 1, f.kg);
  insert into recipe_lines (account_id, recipe_id, sub_recipe_id, qty, unit_id) values (f.acct, f.jollof, f.stew, 500, f.g);
  perform fn_compute_recipe_cost_snapshot(f.jollof);

  -- 1. the view answers for a recipe with a sub-recipe line (it used to raise)
  v_err := 'OK';
  begin
    select count(*) into n_lines from v_recipe_line_costs where recipe_id = f.jollof;
  exception when others then v_err := sqlstate || ' ' || sqlerrm; n_lines := -1; end;
  insert into t48 values (1, 'the per-line view answers for a dish made from another dish',
    case when v_err = 'OK' and n_lines = 2 then 'PASS' else 'FAIL' end, v_err || ' lines=' || n_lines);

  -- 2. the sub-recipe line: named, marked, costed
  select item_name, problem, line_cost, base_qty, unit_cost, base_unit into v_sub
    from v_recipe_line_costs where recipe_id = f.jollof and sub_recipe_id = f.stew;
  insert into t48 values (2, 'it carries the other dish''s name and reads "sub_recipe"',
    case when v_sub.item_name = 'T48 Stew' and v_sub.problem = 'sub_recipe' then 'PASS' else 'FAIL' end,
    coalesce(v_sub.item_name,'NULL') || ' / ' || coalesce(v_sub.problem,'NULL'));
  insert into t48 values (3, 'and is costed from the other dish: 500 g x N2.00/g = N1,000',
    case when v_sub.line_cost = 1000 and v_sub.base_qty = 500 and v_sub.unit_cost = 2 and v_sub.base_unit = 'g'
         then 'PASS' else 'FAIL' end,
    'cost=' || coalesce(v_sub.line_cost::text,'NULL') || ' qty=' || coalesce(v_sub.base_qty::text,'NULL'));

  -- 3. the ingredient line is unchanged
  select line_cost, problem into v_sub from v_recipe_line_costs where recipe_id = f.jollof and ingredient_id = f.rice;
  insert into t48 values (4, 'the ordinary ingredient line is unchanged (1 kg x N1.70/g = N1,700, ok)',
    case when v_sub.line_cost = 1700 and v_sub.problem = 'ok' then 'PASS' else 'FAIL' end,
    coalesce(v_sub.line_cost::text,'NULL') || ' / ' || coalesce(v_sub.problem,'NULL'));

  -- 4. the view agrees with the engine
  select ingredient_cost into v_batch from v_recipe_cost_current where recipe_id = f.jollof;
  select sum(line_cost) into v_ing from v_recipe_line_costs where recipe_id = f.jollof;
  insert into t48 values (5, 'the lines add up to the engine''s ingredient cost for the batch',
    case when v_batch = 2700 and v_ing = 2700 then 'PASS' else 'FAIL' end,
    'engine=' || coalesce(v_batch::text,'NULL') || ' lines=' || coalesce(v_ing::text,'NULL'));

  -- 5. a sub-recipe in the wrong kind of unit is unknown, never zero
  update recipe_lines set unit_id = (select id from units where account_id is null and code='ml')
   where recipe_id = f.jollof and sub_recipe_id = f.stew;
  select line_cost, base_qty into v_sub from v_recipe_line_costs where recipe_id = f.jollof and sub_recipe_id = f.stew;
  insert into t48 values (6, 'a sub-recipe measured in the wrong kind of unit has no line cost (not zero)',
    case when v_sub.line_cost is null and v_sub.base_qty is null then 'PASS' else 'FAIL' end,
    coalesce(v_sub.line_cost::text,'NULL'));
end $$;

insert into t48 values (7,'22 view columns, 118 policies, 98 fn_*, unchanged',
  case when (select count(*) from information_schema.columns where table_name='v_recipe_line_costs')=22
        and (select count(*) from pg_policies where schemaname='public')=118
        and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')=98
       then 'PASS' else 'FAIL' end, '');

select n, check_name, verdict, left(detail,60) as detail from t48 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t48;

rollback;
