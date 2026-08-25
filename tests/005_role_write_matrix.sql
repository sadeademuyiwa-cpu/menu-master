-- ============================================================================
-- MENU MASTER NG
-- Test suite 005: WRITE-SIDE ROLE MATRIX (migration 0015)
--
-- One probe per meaningful cell of the approved matrix: every role attempts
-- both what it must be able to do and what it must not.
--
-- How RLS denies, and why the assertions differ by operation:
--   INSERT  -> raises 42501 "new row violates row-level security policy"
--   UPDATE  -> no matching policy means the row is simply not visible to the
--              statement, so it affects 0 rows rather than raising
--   DELETE  -> same as UPDATE
-- A silent 0-row UPDATE is therefore a PASS for a denied cell, and a FAIL for
-- an allowed one.
-- ============================================================================

set client_min_messages = warning;

create table if not exists _m1 (
  seq serial primary key, role_name text, tbl text, op text,
  expected text, actual text, passed boolean);
truncate _m1 restart identity;

create or replace function perm(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare n int; v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    v := case when n = 0 then 'DENIED' else 'ALLOWED' end;
  exception when others then
    v := 'DENIED';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create or replace function m(p_role text, p_tbl text, p_op text, p_expected text, p_actual text)
returns void language plpgsql as $$
begin
  insert into _m1 (role_name, tbl, op, expected, actual, passed)
  values (p_role, p_tbl, p_op, p_expected, p_actual, p_expected = p_actual);
end $$;

-- ============================================================================
-- FIXTURES: one account, one user per role, plus rows to aim at
-- ============================================================================
do $$
declare
  own uuid; mgr uuid; kit uuid; sal uuid; acc_u uuid;
  onboard jsonb; acc uuid; biz uuid;
  rice uuid; u_kg uuid; u_g uuid; rid uuid; cust uuid; sup uuid; ch uuid; lr uuid;
begin
  insert into auth.users (id,email) values (gen_random_uuid(),'m_owner@t.local')      returning id into own;
  insert into auth.users (id,email) values (gen_random_uuid(),'m_manager@t.local')    returning id into mgr;
  insert into auth.users (id,email) values (gen_random_uuid(),'m_kitchen@t.local')    returning id into kit;
  insert into auth.users (id,email) values (gen_random_uuid(),'m_sales@t.local')      returning id into sal;
  insert into auth.users (id,email) values (gen_random_uuid(),'m_accountant@t.local') returning id into acc_u;

  onboard := fn_create_account_and_business('Matrix Group','Matrix Kitchen','restaurant', own, p_idempotency_key => gen_random_uuid()::text);
  acc := (onboard->>'account_id')::uuid;  biz := (onboard->>'business_id')::uuid;

  insert into memberships (account_id,business_id,user_id,role) values
    (acc,null,mgr,'manager'), (acc,null,kit,'kitchen'),
    (acc,null,sal,'sales'),   (acc,null,acc_u,'accountant');

  select id into u_kg from units where account_id is null and code='kg';
  select id into u_g  from units where account_id is null and code='g';
  select id into rice from ingredients where account_id=acc and name='Rice (local)';

  insert into recipes (account_id,business_id,kind,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (acc,biz,'dish','Matrix Dish',1000,u_g,250,'active') returning id into rid;
  insert into customers (account_id,business_id,name) values (acc,biz,'Matrix Customer') returning id into cust;
  insert into suppliers (account_id,name) values (acc,'Matrix Supplier') returning id into sup;
  select id into ch from channels where business_id=biz limit 1;
  insert into labour_rates (account_id,business_id,name,rate_per_hour)
  values (acc,biz,'Matrix Cook',1000) returning id into lr;

  create temp table _mfx as
    select own,mgr,kit,sal,acc_u,acc,biz,rice,u_kg,u_g,rid,cust,sup,ch,lr;
end $$;

-- ============================================================================
-- PROBES
-- ============================================================================
do $$
declare f record; u uuid;
begin
  select * into f from _mfx;

  -- ---- business_settings: owner only (protected settings) ----
  perform m('owner','business_settings','UPDATE','ALLOWED',
    perm(f.own, format('update business_settings set default_target_margin=45 where business_id=%L', f.biz)));
  perform m('manager','business_settings','UPDATE','DENIED',
    perm(f.mgr, format('update business_settings set default_target_margin=99 where business_id=%L', f.biz)));
  perform m('kitchen','business_settings','UPDATE','DENIED',
    perm(f.kit, format('update business_settings set default_target_margin=99 where business_id=%L', f.biz)));
  perform m('sales','business_settings','UPDATE','DENIED',
    perm(f.sal, format('update business_settings set default_target_margin=99 where business_id=%L', f.biz)));
  perform m('accountant','business_settings','UPDATE','DENIED',
    perm(f.acc_u, format('update business_settings set default_target_margin=99 where business_id=%L', f.biz)));

  -- ---- businesses: owner may edit, nobody may delete ----
  perform m('manager','businesses','UPDATE','DENIED',
    perm(f.mgr, format('update businesses set name=''Hijacked'' where id=%L', f.biz)));
  perform m('owner','businesses','DELETE','DENIED',
    perm(f.own, format('delete from businesses where id=%L', f.biz)));

  -- ---- recipes: kitchen yes, sales and accountant no ----
  perform m('kitchen','recipes','UPDATE','ALLOWED',
    perm(f.kit, format('update recipes set category=''Mains'' where id=%L', f.rid)));
  perform m('sales','recipes','UPDATE','DENIED',
    perm(f.sal, format('update recipes set name=''Sales Edit'' where id=%L', f.rid)));
  perform m('accountant','recipes','UPDATE','DENIED',
    perm(f.acc_u, format('update recipes set name=''Accountant Edit'' where id=%L', f.rid)));
  perform m('kitchen','recipes','DELETE','DENIED',
    perm(f.kit, format('delete from recipes where id=%L', f.rid)));
  perform m('sales','recipe_lines','INSERT','DENIED',
    perm(f.sal, format('insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id) values (%L,%L,%L,10,%L)',
                       f.acc, f.rid, f.rice, f.u_g)));
  perform m('kitchen','recipe_lines','INSERT','ALLOWED',
    perm(f.kit, format('insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id) values (%L,%L,%L,10,%L)',
                       f.acc, f.rid, f.rice, f.u_g)));

  -- ---- ingredients + conversions: kitchen keeps production facts (ruling Q2) ----
  perform m('kitchen','ingredients','UPDATE','ALLOWED',
    perm(f.kit, format('update ingredients set purchase_yield_pct=80 where id=%L', f.rice)));
  perform m('sales','ingredients','UPDATE','DENIED',
    perm(f.sal, format('update ingredients set purchase_yield_pct=10 where id=%L', f.rice)));
  perform m('kitchen','ingredient_unit_conversions','INSERT','ALLOWED',
    perm(f.kit, format('insert into ingredient_unit_conversions(account_id,ingredient_id,unit_id,qty_in_base) values (%L,%L,(select id from units where account_id is null and code=''paint''),4000)',
                       f.acc, f.rice)));
  perform m('kitchen','ingredients','DELETE','DENIED',
    perm(f.kit, format('delete from ingredients where id=%L', f.rice)));

  -- ---- channels: manager may set operational pricing (ruling Q1c) ----
  perform m('manager','channels','UPDATE','ALLOWED',
    perm(f.mgr, format('update channels set target_margin=35 where id=%L', f.ch)));
  perform m('sales','channels','UPDATE','DENIED',
    perm(f.sal, format('update channels set target_margin=5 where id=%L', f.ch)));
  perform m('kitchen','channels','UPDATE','DENIED',
    perm(f.kit, format('update channels set target_margin=5 where id=%L', f.ch)));

  -- ---- purchases: accountant yes, kitchen and sales no ----
  perform m('accountant','purchases','INSERT','ALLOWED',
    perm(f.acc_u, format('insert into purchases(account_id,business_id,purchase_date,reference) values (%L,%L,current_date,''ACCT-1'')', f.acc, f.biz)));
  perform m('kitchen','purchases','INSERT','DENIED',
    perm(f.kit, format('insert into purchases(account_id,business_id,purchase_date,reference) values (%L,%L,current_date,''KIT-1'')', f.acc, f.biz)));
  perform m('sales','purchases','INSERT','DENIED',
    perm(f.sal, format('insert into purchases(account_id,business_id,purchase_date,reference) values (%L,%L,current_date,''SAL-1'')', f.acc, f.biz)));

  -- ---- suppliers / labour_rates / overhead_items: accountant scope ----
  perform m('accountant','suppliers','UPDATE','ALLOWED',
    perm(f.acc_u, format('update suppliers set phone=''080'' where id=%L', f.sup)));
  perform m('accountant','suppliers','DELETE','DENIED',
    perm(f.acc_u, format('delete from suppliers where id=%L', f.sup)));
  perform m('accountant','labour_rates','UPDATE','ALLOWED',
    perm(f.acc_u, format('update labour_rates set rate_per_hour=1200 where id=%L', f.lr)));
  perform m('accountant','labour_rates','DELETE','DENIED',
    perm(f.acc_u, format('delete from labour_rates where id=%L', f.lr)));
  perform m('kitchen','labour_rates','UPDATE','DENIED',
    perm(f.kit, format('update labour_rates set rate_per_hour=1 where id=%L', f.lr)));
  perform m('accountant','overhead_items','INSERT','ALLOWED',
    perm(f.acc_u, format('insert into overhead_items(account_id,business_id,name,monthly_cost) values (%L,%L,''Rent'',50000)', f.acc, f.biz)));
  perform m('accountant','overhead_items','DELETE','DENIED',
    perm(f.acc_u, format('delete from overhead_items where business_id=%L', f.biz)));

  -- ---- customers / orders: sales scope, accountant excluded ----
  perform m('sales','customers','UPDATE','ALLOWED',
    perm(f.sal, format('update customers set phone=''0801'' where id=%L', f.cust)));
  perform m('accountant','customers','UPDATE','DENIED',
    perm(f.acc_u, format('update customers set phone=''0802'' where id=%L', f.cust)));
  perform m('kitchen','orders','INSERT','DENIED',
    perm(f.kit, format('insert into orders(account_id,business_id,order_no,order_date) values (%L,%L,''KIT-ORD'',current_date)', f.acc, f.biz)));
  perform m('sales','orders','INSERT','ALLOWED',
    perm(f.sal, format('insert into orders(account_id,business_id,order_no,order_date) values (%L,%L,''SAL-ORD'',current_date)', f.acc, f.biz)));
  perform m('sales','customers','DELETE','DENIED',
    perm(f.sal, format('delete from customers where id=%L', f.cust)));

  -- ---- append-only surfaces: nobody updates or deletes ----
  perform m('owner','period_closes','UPDATE','DENIED',
    perm(f.own, format('update period_closes set revenue=1 where business_id=%L', f.biz)));
  perform m('accountant','period_closes','INSERT','ALLOWED',
    perm(f.acc_u, format('insert into period_closes(account_id,business_id,period_start,period_end,revenue) values (%L,%L,date_trunc(''month'',current_date),current_date,1000)', f.acc, f.biz)));
  perform m('manager','period_closes','INSERT','DENIED',
    perm(f.mgr, format('insert into period_closes(account_id,business_id,period_start,period_end,revenue) values (%L,%L,''2020-01-01'',''2020-01-31'',1)', f.acc, f.biz)));
  perform m('owner','costing_method_changes','UPDATE','DENIED',
    perm(f.own, format('update costing_method_changes set to_method=''fifo'' where business_id=%L', f.biz)));
  perform m('manager','costing_method_changes','INSERT','DENIED',
    perm(f.mgr, format('insert into costing_method_changes(account_id,business_id,to_method) values (%L,%L,''fifo'')', f.acc, f.biz)));

  -- ---- sales_entries: insert-only, immutable thereafter ----
  perform m('sales','sales_entries','INSERT','ALLOWED',
    perm(f.sal, format('insert into sales_entries(account_id,business_id,sale_date,recipe_id,qty,unit_price) values (%L,%L,current_date,%L,1,1000)', f.acc, f.biz, f.rid)));
  perform m('owner','sales_entries','UPDATE','DENIED',
    perm(f.own, format('update sales_entries set unit_price=1 where business_id=%L', f.biz)));
  perform m('owner','sales_entries','DELETE','DENIED',
    perm(f.own, format('delete from sales_entries where business_id=%L', f.biz)));
end $$;

-- ============================================================================
-- SECURITY PROBES FOR THE 0016 TRIGGER-DEPTH RELAXATION
--
-- 0016 relaxes the ROLE half of fn_require_cost_access inside a trigger so a
-- kitchen user can record a yield. These probes prove that relaxation did not
-- become a cost leak, and that the account boundary is untouched.
-- ============================================================================
do $$
declare
  f record; saw_snaps int; saw_prices int; direct text; ok boolean;
begin
  select * into f from _mfx;

  -- The kitchen user has just caused recomputation (yield update above).
  -- It must still be unable to READ any cost.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.kit::text, true);
  select count(*) into saw_snaps  from cost_snapshots;
  select count(*) into saw_prices from ingredient_prices;
  begin
    perform fn_ingredient_unit_cost(f.rice, f.biz);
    direct := 'ALLOWED';
  exception when others then direct := 'DENIED';
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  perform m('kitchen','cost_snapshots','SELECT','DENIED',
    case when saw_snaps = 0 then 'DENIED' else 'ALLOWED' end);
  perform m('kitchen','ingredient_prices','SELECT','DENIED',
    case when saw_prices = 0 then 'DENIED' else 'ALLOWED' end);
  perform m('kitchen','fn_ingredient_unit_cost','EXECUTE','DENIED', direct);
end $$;

-- Sales must likewise gain nothing from the relaxation.
do $$
declare f record; direct text;
begin
  select * into f from _mfx;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.sal::text, true);
  begin
    perform fn_compute_recipe_cost_snapshot(f.rid);
    direct := 'ALLOWED';
  exception when others then direct := 'DENIED';
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform m('sales','fn_compute_recipe_cost_snapshot','EXECUTE','DENIED', direct);
end $$;

-- ============================================================================
-- ACCOUNTANT SCOPE (founder ruling Q3b and its restriction)
-- ============================================================================
do $$
declare
  f record; p uuid; posted text; reversed text; voided text;
  ord uuid; res jsonb;
begin
  select * into f from _mfx;

  -- May post a legitimate purchase.
  insert into purchases (account_id,business_id,purchase_date,reference)
  values (f.acc,f.biz,current_date,'ACCT-POST') returning id into p;
  insert into purchase_lines (account_id,purchase_id,ingredient_id,qty,unit_id,amount)
  values (f.acc,p,f.rice,5,f.u_kg,25000);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.acc_u::text, true);
  begin
    res := fn_post_purchase(p);
    posted := case when (res->>'posted')::boolean then 'ALLOWED' else 'DENIED' end;
  exception when others then posted := 'DENIED'; end;

  -- May reverse through the sanctioned mechanism, which preserves the original.
  begin
    res := fn_reverse_purchase(p, 'wrong supplier invoice');
    reversed := case when (res->>'reversed')::boolean then 'ALLOWED' else 'DENIED' end;
  exception when others then reversed := 'DENIED'; end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  perform m('accountant','fn_post_purchase','EXECUTE','ALLOWED', posted);
  perform m('accountant','fn_reverse_purchase','EXECUTE','ALLOWED', reversed);

  perform m('accountant','purchases','ORIGINAL PRESERVED','ALLOWED',
    case when exists (select 1 from purchases where id = p and status='reversed')
          and exists (select 1 from purchases where reverses = p)
         then 'ALLOWED' else 'DENIED' end);

  -- Must NOT rewrite finalised sales: fn_void_order excludes accountant.
  insert into orders (account_id,business_id,order_no,order_date)
  values (f.acc,f.biz,'ACCT-ORD',current_date) returning id into ord;
  insert into order_lines (account_id,order_id,recipe_id,qty,unit_price)
  values (f.acc,ord,f.rid,1,1000);
  perform fn_finalise_order(ord);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.acc_u::text, true);
  begin
    perform fn_void_order(ord, 'accountant attempt');
    voided := 'ALLOWED';
  exception when others then voided := 'DENIED'; end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  perform m('accountant','fn_void_order','EXECUTE','DENIED', voided);
end $$;

-- ============================================================================
-- RESULTS
-- ============================================================================
\echo ''
\echo '================ SUITE 005 RESULTS (write-side role matrix) ================'
select seq, role_name, tbl, op, expected, actual,
       case when passed then 'PASS' else 'FAIL' end as result
from _m1 order by seq;

select count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed,
       count(*) as total
from _m1;
