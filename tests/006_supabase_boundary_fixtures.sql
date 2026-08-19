-- ============================================================================
-- MENU MASTER NG
-- 006: fixtures for the Supabase production-boundary test
--
-- REMOTE, DISPOSABLE PROJECT ONLY. Never run against production.
-- Run AFTER migrations 0001-0016, in the Supabase SQL Editor.
-- Do NOT run tests/0000_local_supabase_shim.sql on Supabase.
--
-- Substitute the three user UUIDs below before running.
-- ============================================================================

\set user_a    'REPLACE-WITH-ownera-UUID'
\set user_b    'REPLACE-WITH-ownerb-UUID'
\set cashier_b 'REPLACE-WITH-cashierb-UUID'

do $$
declare
  ua uuid := :'user_a';  ub uuid := :'user_b';  cb uuid := :'cashier_b';
  oa jsonb; ob jsonb; acca uuid; accb uuid; biza uuid; bizb uuid;
  ricea uuid; u_paint uuid; u_kg uuid; pur uuid;
begin
  oa := fn_create_account_and_business('Boundary A','Kitchen A','soup_seller', ua);
  ob := fn_create_account_and_business('Boundary B','Kitchen B','restaurant',  ub);
  acca := (oa->>'account_id')::uuid;  biza := (oa->>'business_id')::uuid;
  accb := (ob->>'account_id')::uuid;  bizb := (ob->>'business_id')::uuid;

  insert into memberships (account_id, business_id, user_id, role)
  values (accb, null, cb, 'sales');

  select id into u_paint from units where account_id is null and code='paint';
  select id into u_kg    from units where account_id is null and code='kg';
  select id into ricea   from ingredients where account_id=acca and name='Rice (local)';

  -- A's private measurement knowledge, and a real price. B must never reach either.
  insert into ingredient_unit_conversions (account_id, ingredient_id, unit_id, qty_in_base)
  values (acca, ricea, u_paint, 4000);

  insert into purchases (account_id, business_id, purchase_date, reference)
  values (acca, biza, current_date, 'BOUNDARY-A-1') returning id into pur;
  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  values (acca, pur, ricea, 1, u_paint, 60000);
  perform fn_post_purchase(pur);

  raise notice 'account_a=%  business_a=%  ingredient_a=%', acca, biza, ricea;
  raise notice 'account_b=%  business_b=%', accb, bizb;
  raise notice 'Record these ids for scripts/supabase_boundary_test.sh';
end $$;
