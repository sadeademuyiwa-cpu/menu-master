-- ============================================================================
-- MENU MASTER NG
-- 006: fixtures for the Supabase production-boundary test
--
-- REMOTE, DISPOSABLE PROJECT ONLY. Never run against production.
-- Run AFTER migrations 0001-0016, in the Supabase SQL Editor.
-- Do NOT run tests/0000_local_supabase_shim.sql on Supabase.
--
-- Users are resolved BY EMAIL, so no UUIDs need to be copied by hand.
-- It is safe to run this more than once: it stops with a clear message rather
-- than creating duplicate accounts.
--
-- Sets up the two rival tenants the attack script needs:
--   Account A  owns a real price and a private paint->kg conversion
--   Account B  owns nothing of A's, and must never be able to reach it
--   cashier B  a low-privilege member of B, used for the escalation probes
-- ============================================================================

do $$
declare
  ua uuid; ub uuid; cb uuid;
  oa jsonb; ob jsonb;
  acca uuid; accb uuid; biza uuid; bizb uuid;
  ricea uuid; u_paint uuid; pur uuid; res jsonb;
begin
  -- ---- resolve the three test users by email -------------------------------
  select id into ua from auth.users where lower(email) = 'ownera@boundary.test';
  select id into ub from auth.users where lower(email) = 'ownerb@boundary.test';
  select id into cb from auth.users where lower(email) = 'cashierb@boundary.test';

  if ua is null or ub is null or cb is null then
    raise exception
      'Test users not found. Expected ownera@boundary.test, ownerb@boundary.test and cashierb@boundary.test in Authentication > Users. Found: A=% B=% cashier=%',
      coalesce(ua::text,'MISSING'), coalesce(ub::text,'MISSING'), coalesce(cb::text,'MISSING');
  end if;

  -- ---- refuse to double-run ------------------------------------------------
  if exists (select 1 from accounts where name in ('Boundary A','Boundary B')) then
    raise exception
      'Fixtures already loaded. Re-running would create duplicate accounts. If you need a clean slate, create a fresh project.';
  end if;

  -- ---- two independent tenants --------------------------------------------
  oa := fn_create_account_and_business('Boundary A','Kitchen A','soup_seller', ua, p_idempotency_key => gen_random_uuid()::text);
  ob := fn_create_account_and_business('Boundary B','Kitchen B','restaurant',  ub, p_idempotency_key => gen_random_uuid()::text);
  acca := (oa->>'account_id')::uuid;  biza := (oa->>'business_id')::uuid;
  accb := (ob->>'account_id')::uuid;  bizb := (ob->>'business_id')::uuid;

  -- a low-privilege member of B only
  insert into memberships (account_id, business_id, user_id, role)
  values (accb, null, cb, 'sales');

  select id into u_paint from units where account_id is null and code = 'paint';
  select id into ricea   from ingredients where account_id = acca and name = 'Rice (local)';

  -- ---- A's private data: the two things B must never reach -----------------
  -- A's own measurement knowledge: one paint of rice is 4kg in her experience.
  insert into ingredient_unit_conversions (account_id, ingredient_id, unit_id, qty_in_base)
  values (acca, ricea, u_paint, 4000);

  -- A's own price: 1 paint for 60,000 => 15 per gram.
  insert into purchases (account_id, business_id, purchase_date, reference)
  values (acca, biza, current_date, 'BOUNDARY-A-1') returning id into pur;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (acca, pur, ricea, 1, u_paint, 60000);
  res := fn_post_purchase(pur);

  if not (res->>'posted')::boolean then
    raise exception 'Fixture purchase failed to post: %', res::text;
  end if;

  raise notice '--------------------------------------------------------------';
  raise notice 'FIXTURES LOADED. Send these four values back:';
  raise notice '--------------------------------------------------------------';
  raise notice 'ACCOUNT_A    = %', acca;
  raise notice 'BUSINESS_A   = %', biza;
  raise notice 'INGREDIENT_A = %', ricea;
  raise notice 'BUSINESS_B   = %', bizb;
  raise notice '--------------------------------------------------------------';
end $$;

-- The same four values as a table, in case the notices are hard to copy.
select 'ACCOUNT_A'    as name, a.id::text as value from accounts a where a.name = 'Boundary A'
union all
select 'BUSINESS_A',  b.id::text from businesses b join accounts a on a.id = b.account_id where a.name = 'Boundary A'
union all
select 'INGREDIENT_A', i.id::text from ingredients i join accounts a on a.id = i.account_id
  where a.name = 'Boundary A' and i.name = 'Rice (local)'
union all
select 'BUSINESS_B',  b.id::text from businesses b join accounts a on a.id = b.account_id where a.name = 'Boundary B';

-- Sanity check: A has exactly one real price, B has none.
select 'A price rows' as check, count(*)::text as value
from ingredient_prices ip join accounts a on a.id = ip.account_id where a.name = 'Boundary A'
union all
select 'B price rows', count(*)::text
from ingredient_prices ip join accounts a on a.id = ip.account_id where a.name = 'Boundary B';
