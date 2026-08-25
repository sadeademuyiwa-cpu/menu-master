-- ============================================================================
-- MENU MASTER NG
-- Test suite 002: GATE 1 ATTACK AND REGRESSION
--
-- Every attack runs as the real `authenticated` database role with a forged
-- JWT subject, exactly as a hostile REST client would arrive.
--
-- Identities:
--   userA  = OWNER of Account A            (the victim)
--   userB  = OWNER of Account B            (the attacker's account)
--   cashB  = SALES role in Account B only  (the low privilege attacker)
--   kitchA = KITCHEN role in Account A     (insider, no cost access)
-- ============================================================================

set client_min_messages = warning;

create table if not exists _g1 (
  seq serial primary key, phase text, name text, passed boolean, detail text);
truncate _g1 restart identity;

create or replace function g(p_phase text, p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin insert into _g1 (phase,name,passed,detail) values (p_phase,p_name,coalesce(p_ok,false),p_detail); end; $$;

-- Runs a statement as a given user and reports whether it was blocked
create or replace function attack(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    execute p_sql;
    v := 'ALLOWED';
  exception when others then
    v := 'BLOCKED: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end; $$;

-- Same, but returns the scalar result of a query
create or replace function attack_val(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    execute p_sql into v;
    v := 'ALLOWED: ' || coalesce(v,'NULL');
  exception when others then
    v := 'BLOCKED: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end; $$;

-- ============================================================================
-- FIXTURES
-- ============================================================================
create table fx (
  ua uuid, ub uuid, cashb uuid, kitcha uuid,
  acca uuid, accb uuid, biza uuid, bizb uuid,
  ricea uuid, riceb uuid, toma uuid,
  u_paint uuid, u_g uuid, u_kg uuid,
  pura uuid, purb uuid, reca uuid, recb uuid);

do $$
declare
  v_ua uuid; v_ub uuid; v_cashb uuid; v_kitcha uuid;
  oA jsonb; oB jsonb;
  v_acca uuid; v_accb uuid; v_biza uuid; v_bizb uuid;
  v_paint uuid; v_g uuid; v_kg uuid;
  v_ricea uuid; v_riceb uuid; v_toma uuid;
  v_pura uuid; v_purb uuid; v_reca uuid; v_recb uuid;
begin
  insert into auth.users(id,email) values (gen_random_uuid(),'ownerA@t') returning id into v_ua;
  insert into auth.users(id,email) values (gen_random_uuid(),'ownerB@t') returning id into v_ub;
  insert into auth.users(id,email) values (gen_random_uuid(),'cashierB@t') returning id into v_cashb;
  insert into auth.users(id,email) values (gen_random_uuid(),'kitchenA@t') returning id into v_kitcha;

  oA := fn_create_account_and_business('Slim Olobe Group','Slim Olobe Kitchen','soup_seller',v_ua, p_idempotency_key => gen_random_uuid()::text);
  oB := fn_create_account_and_business('Abuja Foods','Abuja Kitchen','restaurant',v_ub, p_idempotency_key => gen_random_uuid()::text);
  v_acca := (oA->>'account_id')::uuid; v_biza := (oA->>'business_id')::uuid;
  v_accb := (oB->>'account_id')::uuid; v_bizb := (oB->>'business_id')::uuid;

  insert into memberships(account_id,business_id,user_id,role) values (v_accb,null,v_cashb,'sales');
  insert into memberships(account_id,business_id,user_id,role) values (v_acca,null,v_kitcha,'kitchen');

  select id into v_paint from units where account_id is null and code='paint';
  select id into v_g     from units where account_id is null and code='g';
  select id into v_kg    from units where account_id is null and code='kg';
  select id into v_ricea from ingredients where account_id=v_acca and name='Rice (local)';
  select id into v_riceb from ingredients where account_id=v_accb and name='Rice (local)';
  select id into v_toma  from ingredients where account_id=v_acca and name='Tomato';

  -- Account A: private conversion and a posted purchase
  insert into ingredient_unit_conversions(account_id,ingredient_id,unit_id,qty_in_base)
    values (v_acca, v_ricea, v_paint, 4000);
  insert into purchases(account_id,business_id,purchase_date,reference)
    values (v_acca,v_biza,current_date,'A-1') returning id into v_pura;
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
    values (v_acca,v_pura,v_ricea,1,v_paint,60000);
  perform fn_post_purchase(v_pura);

  insert into recipes(account_id,business_id,kind,name,batch_yield_qty,yield_unit_id,portion_qty,status)
    values (v_acca,v_biza,'dish','Jollof Rice',5000,v_g,500,'active') returning id into v_reca;
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
    values (v_acca,v_reca,v_ricea,1000,v_g);
  perform fn_compute_recipe_cost_snapshot(v_reca);

  -- Account B: its own data, so legitimate operations can be regression tested
  insert into ingredient_unit_conversions(account_id,ingredient_id,unit_id,qty_in_base)
    values (v_accb, v_riceb, v_paint, 3500);
  insert into purchases(account_id,business_id,purchase_date,reference)
    values (v_accb,v_bizb,current_date,'B-1') returning id into v_purb;
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
    values (v_accb,v_purb,v_riceb,1,v_paint,35000);

  insert into recipes(account_id,business_id,kind,name,batch_yield_qty,yield_unit_id,portion_qty,status)
    values (v_accb,v_bizb,'dish','Fried Rice',4000,v_g,400,'active') returning id into v_recb;
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id)
    values (v_accb,v_recb,v_riceb,800,v_g);

  insert into fx values (v_ua,v_ub,v_cashb,v_kitcha,v_acca,v_accb,v_biza,v_bizb,
    v_ricea,v_riceb,v_toma,v_paint,v_g,v_kg,v_pura,v_purb,v_reca,v_recb);
end $$;

-- ============================================================================
-- ATTACK TEST A: COSTING RPC
-- ============================================================================
do $$
declare f record; r1 text; r2 text; r3 text; r4 text;
begin
  select * into f from fx;

  r1 := attack_val(f.ub, format('select fn_ingredient_unit_cost(%L,%L)', f.ricea, f.biza));
  perform g('ATTACK A','A1 B calls costing RPC on A ingredient + A business',
    r1 like 'BLOCKED%', r1);

  -- Mix and match: A's ingredient with B's own business id
  r2 := attack_val(f.ub, format('select fn_ingredient_unit_cost(%L,%L)', f.ricea, f.bizb));
  perform g('ATTACK A','A2 B mixes A ingredient with own business id',
    r2 like 'BLOCKED%', r2);

  -- Yield variant
  r3 := attack_val(f.ub, format('select fn_ingredient_usable_unit_cost(%L,%L)', f.ricea, f.biza));
  perform g('ATTACK A','A3 B calls usable-cost RPC on A data', r3 like 'BLOCKED%', r3);

  -- NULL parameter probing
  r4 := attack_val(f.ub, format('select fn_ingredient_unit_cost(%L,NULL)', f.ricea));
  perform g('ATTACK A','A4 NULL business id does not leak', r4 not like 'ALLOWED: 15%', r4);
end $$;

-- LEGITIMATE: B costs its own ingredient
do $$
declare f record; r text;
begin
  select * into f from fx;
  perform attack(f.ub, format('select fn_post_purchase(%L)', f.purb));
  r := attack_val(f.ub, format('select fn_ingredient_unit_cost(%L,%L)', f.riceb, f.bizb));
  perform g('LEGIT','L1 B costs its OWN ingredient (35000/3500 = 10)',
    r = 'ALLOWED: 10.0000000000000000', r);
end $$;

-- ============================================================================
-- ATTACK TEST B: UNIT CONVERSION RPC
-- ============================================================================
do $$
declare f record; r1 text; r2 text;
begin
  select * into f from fx;
  r1 := attack_val(f.ub, format('select fn_resolve_qty_to_base(%L,1,%L)', f.ricea, f.u_paint));
  perform g('ATTACK B','B1 B reads A private paint conversion', r1 like 'BLOCKED%', r1);

  r2 := attack_val(f.cashb, format('select fn_can_resolve_unit(%L,%L)', f.ricea, f.u_paint));
  perform g('ATTACK B','B2 cashier probes A conversion existence', r2 like 'BLOCKED%', r2);
end $$;

do $$
declare f record; r text;
begin
  select * into f from fx;
  r := attack_val(f.ub, format('select fn_resolve_qty_to_base(%L,1,%L)', f.riceb, f.u_paint));
  perform g('LEGIT','L2 B resolves its OWN paint conversion (3500)',
    r = 'ALLOWED: 3500.000000', r);
end $$;

-- ============================================================================
-- ATTACK TEST C: PURCHASE REVERSAL
-- ============================================================================
do $$
declare f record; r1 text; r2 text; v_status text; v_cost numeric; v_rev int;
begin
  select * into f from fx;

  r1 := attack_val(f.ub, format('select fn_reverse_purchase(%L,%L)', f.pura, 'attacker'));
  perform g('ATTACK C','C1 B reverses A posted purchase', r1 like 'BLOCKED%', r1);

  r2 := attack_val(f.cashb, format('select fn_reverse_purchase(%L,%L)', f.pura, 'attacker'));
  perform g('ATTACK C','C2 cashier reverses A posted purchase', r2 like 'BLOCKED%', r2);

  -- Verify Account A is completely untouched
  select status into v_status from purchases where id = f.pura;
  select count(*) into v_rev from ingredient_prices
    where account_id=f.acca and reversed_at is not null;
  v_cost := fn_ingredient_unit_cost(f.ricea, f.biza);

  perform g('ATTACK C','C3 A purchase untouched after attack',
    v_status='posted' and v_rev=0 and v_cost=15,
    format('status=%s reversed_rows=%s cost=%s', v_status, v_rev, v_cost));
end $$;

-- LEGITIMATE: A's own owner reverses A's purchase
do $$
declare f record; r text; v_cost numeric;
begin
  select * into f from fx;
  r := attack_val(f.ua, format('select fn_reverse_purchase(%L,%L)', f.pura, 'wrong supplier'));
  v_cost := fn_ingredient_unit_cost(f.ricea, f.biza);
  perform g('LEGIT','L3 A owner reverses own purchase',
    r like 'ALLOWED%' and v_cost is null,
    format('%s ; cost after = %s', r, coalesce(v_cost::text,'NULL')));
end $$;

-- A kitchen user must NOT be able to reverse, even inside their own account
do $$
declare f record; r text; p uuid;
begin
  select * into f from fx;
  insert into purchases(account_id,business_id,purchase_date,reference)
    values (f.acca,f.biza,current_date,'A-2') returning id into p;
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
    values (f.acca,p,f.ricea,1,f.u_paint,70000);
  perform fn_post_purchase(p);
  r := attack_val(f.kitcha, format('select fn_reverse_purchase(%L,%L)', p, 'x'));
  perform g('ATTACK C','C4 kitchen role in OWN account cannot reverse', r like 'BLOCKED%', r);
end $$;

-- ============================================================================
-- ATTACK TEST D: SELF PROMOTION
-- ============================================================================
do $$
declare f record; r text; n int;
begin
  select * into f from fx;

  r := attack(f.cashb, format(
    'insert into memberships(account_id,business_id,user_id,role) values (%L,null,%L,''owner'')',
    f.accb, f.cashb));
  perform g('ATTACK D','D1 cashier inserts owner membership for self', r like 'BLOCKED%', r);

  -- An UPDATE that matches zero rows raises nothing, so the block must be
  -- proven by the stored role, not by the absence of an error.
  r := attack(f.cashb, format(
    'update memberships set role=''owner'' where user_id=%L and account_id=%L', f.cashb, f.accb));
  perform g('ATTACK D','D2 cashier updates own role to owner',
    (select role from memberships where user_id=f.cashb and account_id=f.accb) = 'sales',
    format('%s ; role is now %s', r,
      (select role from memberships where user_id=f.cashb and account_id=f.accb)));

  r := attack(f.cashb, format(
    'insert into memberships(account_id,business_id,user_id,role) values (%L,null,%L,''owner'')',
    f.acca, f.cashb));
  perform g('ATTACK D','D3 cashier grants self owner of ANOTHER account', r like 'BLOCKED%', r);

  r := attack(f.kitcha, format(
    'update memberships set role=''owner'' where user_id=%L', f.kitcha));
  perform g('ATTACK D','D4 kitchen user updates own role',
    (select role from memberships where user_id=f.kitcha) = 'kitchen',
    format('%s ; role is now %s', r,
      (select role from memberships where user_id=f.kitcha)));

  -- Forged account id: does a nonexistent uuid open a hole?
  r := attack(f.cashb, format(
    'insert into memberships(account_id,business_id,user_id,role) values (%L,null,%L,''owner'')',
    gen_random_uuid(), f.cashb));
  perform g('ATTACK D','D5 forged account id rejected', r like 'BLOCKED%', r);

  -- Escalation by onboarding: mint an owner membership for someone else
  r := attack(f.cashb, format(
    'select fn_create_account_and_business(''X'',''Y'',''other'',%L, p_idempotency_key => gen_random_uuid()::text)', f.ua));
  perform g('ATTACK D','D6 cashier mints owner membership for another user',
    r like 'BLOCKED%', r);

  select count(*) into n from memberships
   where account_id=f.accb and user_id=f.cashb and role='owner';
  perform g('ATTACK D','D7 cashier still holds no owner row anywhere', n=0,
    format('owner rows for cashier: %s', n));
end $$;

-- LEGITIMATE membership administration
do $$
declare f record; r text; newu uuid;
begin
  select * into f from fx;
  insert into auth.users(id,email) values (gen_random_uuid(),'newstaff@t') returning id into newu;

  r := attack(f.ub, format(
    'insert into memberships(account_id,business_id,user_id,role) values (%L,null,%L,''manager'')',
    f.accb, newu));
  perform g('LEGIT','L4 owner adds a manager to own account', r='ALLOWED', r);

  r := attack(f.ub, format(
    'update memberships set role=''kitchen'' where account_id=%L and user_id=%L', f.accb, newu));
  perform g('LEGIT','L5 owner changes a member role', r='ALLOWED', r);

  r := attack(f.ub, format(
    'insert into memberships(account_id,business_id,user_id,role) values (%L,null,%L,''manager'')',
    f.acca, newu));
  perform g('ATTACK D','D8 owner of B cannot add members to A', r like 'BLOCKED%', r);

  -- Own-goal protection: the last owner cannot be removed
  r := attack(f.ub, format(
    'delete from memberships where account_id=%L and user_id=%L and role=''owner''', f.accb, f.ub));
  perform g('LEGIT','L6 last owner cannot be deleted', r like 'BLOCKED%', r);
end $$;

-- ============================================================================
-- ATTACK TEST E: SUBSCRIPTION ESCALATION
-- ============================================================================
do $$
declare f record; r text; v_plan text;
begin
  select * into f from fx;

  r := attack(f.cashb, format(
    'update subscriptions set plan_id=''trading'', status=''active'' where account_id=%L', f.accb));
  perform g('ATTACK E','E1 cashier upgrades own plan', r like 'BLOCKED%', r);

  r := attack(f.ub, format(
    'update subscriptions set plan_id=''trading'', current_period_end=now()+interval ''99 years''
     where account_id=%L', f.accb));
  perform g('ATTACK E','E2 OWNER upgrades own plan directly', r like 'BLOCKED%', r);

  r := attack(f.ub, format(
    'insert into subscriptions(account_id,plan_id,status) values (%L,''trading'',''active'')', f.accb));
  perform g('ATTACK E','E3 owner inserts a second paid subscription', r like 'BLOCKED%', r);

  r := attack(f.ub, format('delete from subscriptions where account_id=%L', f.accb));
  perform g('ATTACK E','E4 owner deletes subscription to escape billing', r like 'BLOCKED%', r);

  r := attack(f.ub, format(
    'select fn_set_subscription_plan(%L,''trading'')', f.accb));
  perform g('ATTACK E','E5 client calls the billing function directly', r like 'BLOCKED%', r);

  -- The self-serve trial carve-out must not become a paid-plan hole
  declare newu2 uuid; acc2 uuid; begin
    insert into auth.users(id,email) values (gen_random_uuid(),'greedy@t') returning id into newu2;
    r := attack_val(newu2, 'select (fn_create_account_and_business(''G'',''G Kitchen'',''other'',null,''NGN'',''trading'', p_idempotency_key => gen_random_uuid()::text))->>''account_id''');
    perform g('ATTACK E','E7 self-signup cannot mint a PAID plan', r like 'BLOCKED%', r);
  end;

  select plan_id into v_plan from subscriptions where account_id=f.accb;
  perform g('ATTACK E','E6 plan unchanged after all attempts', v_plan='trial',
    format('plan is now %s', v_plan));
end $$;

-- LEGITIMATE: the billing system (service context) changes the plan
do $$
declare f record; res jsonb; v_plan text;
begin
  select * into f from fx;
  res := fn_set_subscription_plan(f.accb, 'trading', 'active', now()+interval '30 days', 'PSK_123');
  select plan_id into v_plan from subscriptions where account_id=f.accb;
  perform g('LEGIT','L7 billing system can upgrade a plan', v_plan='trading',
    format('plan now %s', v_plan));
end $$;

-- ============================================================================
-- STEP 5: BYPASS ATTEMPTS BEYOND THE ORIGINAL EXPLOITS
-- ============================================================================
do $$
declare f record; r text;
begin
  select * into f from fx;

  -- Direct table reads of cost data
  r := attack_val(f.ub, format(
    'select count(*)::text from ingredient_prices where account_id=%L', f.acca));
  perform g('BYPASS','X1 direct SELECT on A ingredient_prices', r='ALLOWED: 0', r);

  r := attack_val(f.ub, format(
    'select count(*)::text from cost_snapshots where account_id=%L', f.acca));
  perform g('BYPASS','X2 direct SELECT on A cost_snapshots', r='ALLOWED: 0', r);

  -- Join-based leakage: reach A costs through a table B can read
  -- B may legitimately see its OWN snapshots through this join. What must be
  -- zero is the number of ACCOUNT A snapshots reachable from it.
  r := attack_val(f.ub, format(
    'select count(*)::text from recipes r join cost_snapshots s on s.recipe_id=r.id
      where s.account_id=%L', f.acca));
  perform g('BYPASS','X3 join from recipes reaches zero A snapshots', r='ALLOWED: 0', r);

  -- Function chaining: use a permitted function to reach a blocked one
  r := attack_val(f.ub, format(
    'select count(*)::text from fn_recipes_using_ingredient(%L)', f.ricea));
  perform g('BYPASS','X4 enumerate A recipes via dependency RPC', r like 'BLOCKED%', r);

  r := attack_val(f.ub, format('select fn_purchase_blockers(%L)::text', f.pura));
  perform g('BYPASS','X5 read A purchase contents via blockers RPC', r like 'BLOCKED%', r);

  -- Write into another tenant's ledger
  r := attack(f.ub, format('select fn_compute_recipe_cost_snapshot(%L)', f.reca));
  perform g('BYPASS','X6 write a snapshot into A ledger', r like 'BLOCKED%', r);

  r := attack(f.ub, format('select fn_recompute_recipes_for_ingredient(%L)', f.ricea));
  perform g('BYPASS','X7 mass recompute across A', r like 'BLOCKED%', r);

  r := attack(f.ub, format('select fn_post_purchase(%L)', f.pura));
  perform g('BYPASS','X8 post A draft purchase', r like 'BLOCKED%', r);

  r := attack(f.ub, format('select fn_clone_starter_catalog(%L)', f.acca));
  perform g('BYPASS','X9 pollute A catalogue', r like 'BLOCKED%', r);

  -- Insert rows into another tenant
  r := attack(f.ub, format(
    'insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
     values (%L,%L,1000,1,''manual'')', f.acca, f.ricea));
  perform g('BYPASS','X10 insert a forged price into A', r like 'BLOCKED%', r);

  -- Kitchen role inside A: correct account, wrong role
  r := attack_val(f.kitcha, format(
    'select fn_ingredient_unit_cost(%L,%L)', f.ricea, f.biza));
  perform g('BYPASS','X11 kitchen role reads cost in OWN account', r like 'BLOCKED%', r);

  r := attack_val(f.kitcha, format(
    'select count(*)::text from ingredient_prices where account_id=%L', f.acca));
  perform g('BYPASS','X12 kitchen role direct-reads prices in own account', r='ALLOWED: 0', r);

  -- Anonymous
  r := attack_val(null, format('select fn_ingredient_unit_cost(%L,%L)', f.ricea, f.biza));
  perform g('BYPASS','X13 no JWT subject at all', r like 'BLOCKED%', r);

  -- Service-context spoofing: can a client claim to be the billing system?
  r := attack_val(f.ub, 'select fn_is_service_context()::text');
  perform g('BYPASS','X14 client cannot claim service context', r='ALLOWED: false', r);

  -- X15 is proven in a separate real client session (tests/003), because in
  -- this harness the session is already a superuser and SET ROLE would
  -- succeed for reasons that do not exist in production.
end $$;

-- ============================================================================
-- STEP 6: REGRESSION, THE PRODUCT MUST STILL WORK
-- ============================================================================
do $$
declare f record; r text; snap uuid; v record;
begin
  select * into f from fx;

  -- B computes its own recipe cost end to end
  r := attack_val(f.ub, format('select fn_compute_recipe_cost_snapshot(%L)::text', f.recb));
  perform g('REGRESS','R1 B computes own recipe snapshot', r like 'ALLOWED%', r);

  select * into v from v_price_check where recipe_id=f.recb limit 1;
  perform g('REGRESS','R2 B own dish costs correctly (800g @ 10/g / 4000 * 400 = 800)',
    v.is_complete and v.cost_per_portion = 800,
    format('complete=%s cost_per_portion=%s', v.is_complete, v.cost_per_portion));

  -- B records a sale, cost freezes
  r := attack(f.ub, format(
    'insert into orders(account_id,business_id,order_no,order_date) values (%L,%L,''B-ORD-1'',current_date)',
    f.accb, f.bizb));
  perform g('REGRESS','R3 B creates an order', r='ALLOWED', r);

  r := attack(f.cashb, format(
    'insert into order_lines(account_id,order_id,recipe_id,qty,unit_price)
     select %L, id, %L, 2, 2500 from orders where order_no=''B-ORD-1''', f.accb, f.recb));
  perform g('REGRESS','R4 cashier records a sale line', r='ALLOWED', r);

  perform g('REGRESS','R5 sale froze the cost without the cashier seeing it',
    (select unit_cost_at_sale from order_lines ol join orders o on o.id=ol.order_id
      where o.order_no='B-ORD-1') = 800,
    'freeze runs inside a trigger, not through the guarded RPC');

  -- B maintains its own catalogue
  r := attack(f.ub, format(
    'insert into ingredient_unit_conversions(account_id,ingredient_id,unit_id,qty_in_base)
     values (%L,%L,%L,50000)', f.accb, f.riceb, (select id from units where code='bag' and account_id is null)));
  perform g('REGRESS','R6 B adds its own unit conversion', r='ALLOWED', r);

  -- A owner still fully functional after the attacks
  r := attack_val(f.ua, format('select fn_ingredient_unit_cost(%L,%L)', f.ricea, f.biza));
  perform g('REGRESS','R7 A owner still reads own costs', r like 'ALLOWED%', r);

  -- Onboarding still works for a brand new user
  declare newu uuid; begin
    insert into auth.users(id,email) values (gen_random_uuid(),'fresh@t') returning id into newu;
    r := attack_val(newu, 'select (fn_create_account_and_business(''New Co'',''New Kitchen'',''baker'', p_idempotency_key => gen_random_uuid()::text))->>''ingredients_added''');
    perform g('REGRESS','R8 new user can self-onboard', r like 'ALLOWED: 1%', r);
  end;
end $$;

-- ============================================================================
-- STEP 7: THE FIVE ORIGINAL EXPLOITS, BEFORE AND AFTER
-- ============================================================================
\echo ''
\echo '=========== ORIGINAL EXPLOIT REGRESSION ==========='
select
  v.test,
  'Vulnerable' as before,
  case when r.passed then 'Blocked' else 'STILL VULNERABLE' end as after,
  case when r.passed then 'PASS' else 'FAIL' end as result
from (values
  (1,'Cross-tenant costing',            'A1 B calls costing RPC on A ingredient + A business'),
  (2,'Cross-tenant conversion',         'B1 B reads A private paint conversion'),
  (3,'Cross-tenant purchase reversal',  'C1 B reverses A posted purchase'),
  (4,'Self-promotion to owner',         'D1 cashier inserts owner membership for self'),
  (5,'Self-upgrade of subscription',    'E1 cashier upgrades own plan')
) as v(ord,test,tname)
join _g1 r on r.name = v.tname
order by v.ord;

\echo ''
\echo '=========== FULL GATE 1 RESULTS ==========='
select seq, phase, case when passed then 'PASS' else 'FAIL' end as result, name
from _g1 order by seq;

select phase,
       count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed
from _g1 group by phase order by phase;

select count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed,
       count(*) as total from _g1;
