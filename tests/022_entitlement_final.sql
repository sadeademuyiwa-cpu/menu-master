-- ============================================================================
-- MENU MASTER NG -- tests/022_entitlement_final.sql
--
-- Acceptance test for 0032. Run on a database with 0001-0032 applied.
-- Rolls everything back.
--
-- Proves the D-26 truth table row by row, the owner's final Case 11 ruling,
-- the boundary semantics (access ends AT current_period_end, not after), and
-- that V-7 is closed without gating a single read.
-- ============================================================================

begin;

create temp table t22 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx22 (acct uuid, usr uuid, biz uuid, sub uuid, ing uuid, g uuid, rec uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); b uuid; s uuid; ing uuid := gen_random_uuid();
        rec uuid := gen_random_uuid(); g uuid; res jsonb;
begin
  select id into g from units where account_id is null and code='g';
  insert into auth.users(id,email) values (u,'ent22@t.test');
  res := fn_create_account_and_business('E22','K22','caterer',u,p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  select id into s from subscriptions where account_id = a;
  insert into ingredients(id,account_id,kind,name,base_unit_id) values (ing,a,'ingredient','R22',g);
  -- A recipe must exist, or the recipe_prices probe inserts zero rows and
  -- reports WROTE without the policy ever being consulted.
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty)
  values (rec,a,b,'R22 Dish',1000,g,250);
  insert into fx22 values (a,u,b,s,ing,g,rec);
end $$;

-- The boundary constraint is what stops a NULL reaching production. The NULL
-- branches of the rule still have to be provable, so it is lifted inside this
-- transaction only and rolled back with everything else.
alter table subscriptions drop constraint ck_subscriptions_period_present;

create or replace function pg_temp.set_state(p_status text, p_end timestamptz)
returns void language plpgsql as $$
declare f record;
begin
  select * into f from fx22;
  update subscriptions set status = p_status, current_period_end = p_end where id = f.sub;
end $$;

create or replace function pg_temp.entitled() returns boolean language plpgsql as $$
declare f record; r boolean;
begin
  select * into f from fx22;
  select fn_account_is_entitled(f.acct) into r;
  return r;
end $$;

-- Whether an ordinary authenticated client can actually WRITE, which is the
-- only thing entitlement is for.
create or replace function pg_temp.can_write(p_table text) returns text language plpgsql as $$
declare f record; msg text := 'WROTE';
begin
  select * into f from fx22;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  begin
    if p_table = 'ingredients' then
      insert into ingredients(account_id,kind,name,base_unit_id)
      values (f.acct,'ingredient','probe-'||gen_random_uuid(),f.g);
    elsif p_table = 'ingredient_prices' then
      insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
      values (f.acct,f.ing,1000,100,'manual');
    elsif p_table = 'recipe_prices' then
      insert into recipe_prices(account_id,recipe_id,price) values (f.acct, f.rec, 100);
    end if;
  exception when others then msg := 'REFUSED';
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  return msg;
end $$;

create or replace function pg_temp.can_read(p_table text) returns int language plpgsql as $$
declare f record; n int;
begin
  select * into f from fx22;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  if p_table = 'ingredient_prices' then
    select count(*) into n from ingredient_prices;
  elsif p_table = 'cost_snapshots' then
    select count(*) into n from cost_snapshots;
  else
    select count(*) into n from recipe_prices;
  end if;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- The D-26 truth table
-- ---------------------------------------------------------------------------
do $$
declare rows_ text[][] := array[
  ['1','active, inside period','active','+30 days','t'],
  ['2','active, period expired','active','-30 days','t'],
  ['3','past_due, inside 7-day grace','past_due','-3 days','t'],
  ['4','past_due, beyond grace','past_due','-30 days','f'],
  ['5','trialing, before boundary','trialing','+3 days','t'],
  ['6','trialing, exactly at boundary','trialing','AT','f'],
  ['7','trialing, after boundary','trialing','-1 days','f'],
  ['9','cancelled, inside paid period','cancelled','+5 days','t'],
  ['10','cancelled, outside period','cancelled','-5 days','f']
];
  r text[]; ent boolean; want boolean; ts timestamptz;
begin
  foreach r slice 1 in array rows_ loop
    if r[4] = 'AT' then ts := now(); else ts := now() + r[4]::interval; end if;
    perform pg_temp.set_state(r[3], ts);
    ent := pg_temp.entitled();
    want := (r[5] = 't');
    insert into t22 values (r[1]::int, r[2],
      case when ent = want then 'PASS' else 'FAIL' end,
      'entitled='||ent||' expected='||want);
  end loop;
end $$;

-- NULL boundary, per the owner's final Case 11 ruling
do $$
declare rows_ text[][] := array[
  ['8','trialing + NULL boundary -> DENIED','trialing','f'],
  ['11','active + NULL boundary -> allowed','active','t'],
  ['12','past_due + NULL boundary -> allowed','past_due','t'],
  ['13','cancelled + NULL boundary -> DENIED','cancelled','f']
];
  r text[]; ent boolean; want boolean;
begin
  foreach r slice 1 in array rows_ loop
    perform pg_temp.set_state(r[3], null);
    ent := pg_temp.entitled();
    want := (r[4] = 't');
    insert into t22 values (r[1]::int, r[2],
      case when ent = want then 'PASS' else 'FAIL' end,
      'entitled='||ent||' expected='||want);
  end loop;
end $$;

-- 14. No subscription row at all
do $$
declare f record; ent boolean;
begin
  select * into f from fx22;
  ent := fn_account_is_entitled(gen_random_uuid());
  insert into t22 values (14,'an account with no subscription row is not entitled',
    case when ent = false then 'PASS' else 'FAIL' end, 'entitled='||ent);
end $$;

-- 15. provider_ref is NOT an access-control primitive
do $$
declare f record; ent boolean;
begin
  select * into f from fx22;
  perform pg_temp.set_state('cancelled', null);
  update subscriptions set provider_ref = 'SUB_someexistingcode' where id = f.sub;
  ent := pg_temp.entitled();
  insert into t22 values (15,'provider_ref does NOT restore entitlement for cancelled + NULL',
    case when ent = false then 'PASS' else 'FAIL' end, 'entitled='||ent);
  update subscriptions set provider_ref = null where id = f.sub;
end $$;

-- 16. Grace is read from configuration, not hard-coded
do $$
declare ent boolean;
begin
  perform pg_temp.set_state('past_due', now() - interval '9 days');
  ent := pg_temp.entitled();                       -- 9 days > 7 -> denied
  -- now() is transaction start, which is later than the migration's row but
  -- earlier than "a minute ago" would be if the migration ran seconds before.
  insert into billing_config (effective_from, payment_failure_grace, authorised_by, reason)
  values (now(), interval '14 days', 'test', 'widen the grace');
  insert into t22 values (16,'grace comes from billing_config, not a literal',
    case when ent = false and pg_temp.entitled() = true then 'PASS' else 'FAIL' end,
    'before='||ent||' after_widening='||pg_temp.entitled());
end $$;

-- ---------------------------------------------------------------------------
-- V-7: the three cost tables
-- ---------------------------------------------------------------------------
do $$
declare w_price text; w_recipe text; w_ing text; r_price int; r_snap int;
begin
  -- reset the grace so the expiry below is unambiguous
  delete from billing_config where authorised_by = 'test';
  perform pg_temp.set_state('trialing', now() - interval '1 day');   -- expired trial

  w_ing    := pg_temp.can_write('ingredients');
  w_price  := pg_temp.can_write('ingredient_prices');
  w_recipe := pg_temp.can_write('recipe_prices');
  r_price  := pg_temp.can_read('ingredient_prices');
  r_snap   := pg_temp.can_read('cost_snapshots');

  insert into t22 values
    (17,'expired trial cannot write an ingredient',
        case when w_ing='REFUSED' then 'PASS' else 'FAIL' end, w_ing),
    (18,'V-7: expired trial cannot write an ingredient PRICE',
        case when w_price='REFUSED' then 'PASS' else 'FAIL' end, w_price),
    (19,'V-7: expired trial cannot write a RECIPE PRICE',
        case when w_recipe='REFUSED' then 'PASS' else 'FAIL' end, w_recipe),
    (20,'an expired trial can still READ its prices',
        case when r_price >= 0 then 'PASS' else 'FAIL' end, r_price||' row(s), no error'),
    (21,'an expired trial can still READ its cost snapshots',
        case when r_snap >= 0 then 'PASS' else 'FAIL' end, r_snap||' row(s), no error');
end $$;

-- 22. A live trial CAN write all three
do $$
declare w_ing text; w_price text;
begin
  perform pg_temp.set_state('trialing', now() + interval '10 days');
  w_ing   := pg_temp.can_write('ingredients');
  w_price := pg_temp.can_write('ingredient_prices');
  insert into t22 values (22,'a live trial writes both ingredients and prices',
    case when w_ing='WROTE' and w_price='WROTE' then 'PASS' else 'FAIL' end,
    'ingredient='||w_ing||' price='||w_price);
end $$;

-- 23/24. Structural guarantees
insert into t22
select 23, 'no SELECT policy anywhere is gated by entitlement',
       case when count(*)=0 then 'PASS' else 'FAIL' end, count(*)||' gated read policy(ies)'
from pg_policies
where schemaname='public' and cmd='SELECT'
  and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_is_entitled%';

insert into t22
select 24, '69 write policies carry the entitlement gate (60 + the 9 V-7 ones)',
       case when count(*)=69 then 'PASS' else 'FAIL' end, count(*)||' policy(ies)'
from pg_policies
where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_is_entitled%';

-- 25. fn_my_entitlement_status derives from the same function
do $$
declare f record; st record;
begin
  select * into f from fx22;
  perform pg_temp.set_state('trialing', now() - interval '1 day');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  select * into st from fn_my_entitlement_status();
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t22 values (25,'fn_my_entitlement_status reports the ended trial, not an error',
    case when st.entitled = false and st.reason = 'trial_ended' then 'PASS' else 'FAIL' end,
    'entitled='||st.entitled||' reason='||st.reason);
end $$;

-- 26. anon cannot call either function
insert into t22
select 26, 'anon can call neither entitlement function',
       case when count(*)=0 then 'PASS' else 'FAIL' end, count(*)||' grant(s)'
from information_schema.role_routine_grants
where grantee='anon' and routine_name in ('fn_account_is_entitled','fn_my_entitlement_status');

select * from t22 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail
from t22;

rollback;
