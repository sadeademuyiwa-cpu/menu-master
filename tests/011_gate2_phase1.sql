-- ============================================================================
-- MENU MASTER NG -- tests/011_gate2_phase1.sql
--
-- Acceptance test for migration 0021 (Gate 2, Phase 1 structural).
--
-- Run AFTER 0021 on a database built from the shim + 0001-0018 + 0020.
-- Self-contained: creates its own fixtures, asserts, then rolls everything
-- back. Leaves no rows behind.
--
-- Every check states what would be WRONG if it failed, not merely that it
-- passed.
-- ============================================================================

begin;

create temp table t2_result (n int, area text, check_name text, verdict text, detail text)
  on commit drop;

do $$
declare
  aA uuid := gen_random_uuid();  aB uuid := gen_random_uuid();
  uA uuid := gen_random_uuid();  uB uuid := gen_random_uuid();
  bA uuid := gen_random_uuid();  bB uuid := gen_random_uuid();
  u_l uuid; u_ml uuid; u_g uuid;
  pkgA uuid := gen_random_uuid(); pkgA2 uuid := gen_random_uuid();
  ingA uuid := gen_random_uuid();
  rA uuid := gen_random_uuid();  rB uuid := gen_random_uuid();
  fA uuid := gen_random_uuid();  fB uuid := gen_random_uuid();
  vA uuid;
  unitX uuid := gen_random_uuid();
  n int; ok boolean; msg text;

  procedure_note text;
begin
  select id into u_l  from units where account_id is null and code='l';
  select id into u_ml from units where account_id is null and code='ml';
  select id into u_g  from units where account_id is null and code='g';

  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id,email) values (uA,'a@t.test'), (uB,'b@t.test');
  insert into accounts (id,name) values (aA,'Acct A'), (aB,'Acct B');
  insert into businesses (id,account_id,name,slug,type)
    values (bA,aA,'Biz A','biz-a','restaurant'), (bB,aB,'Biz B','biz-b','restaurant');
  insert into memberships (account_id,business_id,user_id,role)
    values (aA,bA,uA,'owner'), (aB,bB,uB,'owner');
  insert into ingredients (id,account_id,kind,name,base_unit_id)
    values (pkgA,aA,'packaging','Bowl 1L',u_g),
           (pkgA2,aA,'packaging','Lid',u_g),
           (ingA,aA,'ingredient','Rice',u_g);
  insert into recipes (id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty)
    values (rA,aA,bA,'Egusi',10,u_l,1.5),
           (rB,aB,bB,'Efo',10,u_l,1.5);
  -- a unit privately owned by account B, used to test cross-account unit leaks
  insert into units (id,account_id,code,name,kind) values (unitX,aB,'bwlB','B Bowl','container');

  insert into serving_formats (id,account_id,business_id,name,capacity_qty,capacity_unit_id)
    values (fA,aA,bA,'Family Bowl',4,u_l);
  insert into serving_formats (id,account_id,business_id,name)
    values (fB,aB,bB,'B Bowl');

  -- =========================================================== F1: unit scope
  begin
    insert into serving_formats (account_id,business_id,name,capacity_qty,capacity_unit_id)
      values (aA,bA,'Stolen Unit Format',1,unitX);
    insert into t2_result values (1,'F1','capacity_unit_id from another account is refused',
      'FAIL','the row was accepted -- units leak across accounts');
  exception when others then
    insert into t2_result values (1,'F1','capacity_unit_id from another account is refused',
      'PASS', sqlerrm);
  end;

  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,
                                 costing_basis,sellable_qty,sellable_unit_id)
      values (aA,bA,rA,fA,'explicit_qty',1,unitX);
    insert into t2_result values (2,'F1','sellable_unit_id from another account is refused',
      'FAIL','the row was accepted');
  exception when others then
    insert into t2_result values (2,'F1','sellable_unit_id from another account is refused',
      'PASS', sqlerrm);
  end;

  select prosrc like '%new.unit_id%' into ok from pg_proc
   where pronamespace='public'::regnamespace and proname='fn_assert_unit_visible';
  insert into t2_result values (3,'F1','0004 fn_assert_unit_visible left untouched',
    case when ok then 'PASS' else 'FAIL' end,
    'must still reference new.unit_id verbatim');

  -- =================================================== F2: composite FK holds
  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,costing_basis)
      values (aA,bA,rA,fB,'capacity');
    insert into t2_result values (4,'F2','attaching another business format is refused',
      'FAIL','CROSS-TENANT LEAK: A used B''s serving format');
  exception when others then
    insert into t2_result values (4,'F2','attaching another business format is refused',
      'PASS', sqlerrm);
  end;

  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,costing_basis)
      values (aA,bA,rB,fA,'capacity');
    insert into t2_result values (5,'F2','attaching another business recipe is refused',
      'FAIL','CROSS-TENANT LEAK: A varied B''s recipe');
  exception when others then
    insert into t2_result values (5,'F2','attaching another business recipe is refused',
      'PASS', sqlerrm);
  end;

  -- ==================================================== D3: basis exclusivity
  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,
                                 costing_basis,sellable_qty,sellable_unit_id)
      values (aA,bA,rA,fA,'capacity',2,u_l);
    insert into t2_result values (6,'D3','capacity basis may not carry a sellable qty',
      'FAIL','both were accepted -- the system could pick the wrong one');
  exception when others then
    insert into t2_result values (6,'D3','capacity basis may not carry a sellable qty',
      'PASS', sqlerrm);
  end;

  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,costing_basis)
      values (aA,bA,rA,fA,'explicit_qty');
    insert into t2_result values (7,'D3','explicit_qty basis requires a sellable qty',
      'FAIL','an explicit-quantity variant was created with no quantity');
  exception when others then
    insert into t2_result values (7,'D3','explicit_qty basis requires a sellable qty',
      'PASS', sqlerrm);
  end;

  begin
    insert into serving_formats (account_id,business_id,name,capacity_qty)
      values (aA,bA,'Bare Number',4);
    insert into t2_result values (8,'D3','capacity_qty without a unit is refused',
      'FAIL','a bare number was stored as a capacity');
  exception when others then
    insert into t2_result values (8,'D3','capacity_qty without a unit is refused',
      'PASS', sqlerrm);
  end;

  -- the legitimate variant everything below builds on
  insert into recipe_variants (account_id,business_id,recipe_id,format_id,costing_basis)
    values (aA,bA,rA,fA,'capacity') returning id into vA;
  insert into t2_result values (9,'D3','a valid capacity variant is accepted',
    'PASS','baseline for the checks below');

  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,costing_basis)
      values (aA,bA,rA,fA,'capacity');
    insert into t2_result values (10,'design','one variant per recipe x format',
      'FAIL','a duplicate variant was created');
  exception when others then
    insert into t2_result values (10,'design','one variant per recipe x format',
      'PASS', sqlerrm);
  end;

  -- ============================================ D5: variants cannot hold lines
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='recipe_lines' and column_name='variant_id';
  insert into t2_result values (11,'D5','no variant may carry an ingredient',
    case when n=0 then 'PASS' else 'FAIL' end,
    'recipe_lines must have no variant_id: a variant cannot alter a formula');

  -- ================================================== D4: no double counting
  insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
    values (aA,bA,fA,pkgA,1);
  insert into t2_result values (12,'D4','format-level packaging accepted',
    'PASS','bowl attached to the format');

  begin
    insert into recipe_lines (account_id,recipe_id,ingredient_id,qty,unit_id)
      values (aA,rA,pkgA,1,u_g);
    insert into t2_result values (13,'D4','same item at recipe level is refused',
      'FAIL','DOUBLE COUNT: the bowl is now costed twice');
  exception when others then
    insert into t2_result values (13,'D4','same item at recipe level is refused',
      'PASS', sqlerrm);
  end;

  -- the reverse path: recipe level first, then format level
  insert into recipe_lines (account_id,recipe_id,ingredient_id,qty,unit_id)
    values (aA,rA,pkgA2,1,u_g);
  begin
    insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
      values (aA,bA,fA,pkgA2,1);
    insert into t2_result values (14,'D4','same item at format level is refused',
      'FAIL','DOUBLE COUNT via the other insert path');
  exception when others then
    insert into t2_result values (14,'D4','same item at format level is refused',
      'PASS', sqlerrm);
  end;

  begin
    insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
      values (aA,bA,fA,ingA,1);
    insert into t2_result values (15,'D4','a non-packaging item is refused as packaging',
      'FAIL','rice was accepted as a container');
  exception when others then
    insert into t2_result values (15,'D4','a non-packaging item is refused as packaging',
      'PASS', sqlerrm);
  end;

  -- ==================================================== D6: change log, D7
  update serving_formats set capacity_qty = 4.5 where id = fA;
  select count(*) into n from serving_format_changes
   where format_id=fA and field='capacity_qty' and old_value='4.000' and new_value='4.500';
  insert into t2_result values (16,'D6','a capacity change is logged with both values',
    case when n=1 then 'PASS' else 'FAIL' end,
    'found '||n||' log row(s); history must be answerable');

  begin
    update serving_format_changes set new_value='9' where format_id=fA;
    insert into t2_result values (17,'D6','the change log cannot be edited',
      'FAIL','history was rewritten');
  exception when others then
    insert into t2_result values (17,'D6','the change log cannot be edited',
      'PASS', sqlerrm);
  end;

  begin
    delete from serving_format_changes where format_id=fA;
    insert into t2_result values (18,'D6','the change log cannot be deleted',
      'FAIL','history was destroyed');
  exception when others then
    insert into t2_result values (18,'D6','the change log cannot be deleted',
      'PASS', sqlerrm);
  end;

  update serving_formats set is_active=false where id=fA;
  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,
                                 costing_basis,sellable_qty,sellable_unit_id)
      values (aA,bA,rA,fA,'explicit_qty',1,u_l);
    insert into t2_result values (19,'D7','an inactive format takes no new variant',
      'FAIL','a retired container is still being sold');
  exception when others then
    insert into t2_result values (19,'D7','an inactive format takes no new variant',
      'PASS', sqlerrm);
  end;

  begin
    insert into sales_entries (account_id,business_id,recipe_id,variant_id,qty,unit_price)
      values (aA,bA,rA,vA,1,1000);
    insert into t2_result values (20,'D7','an inactive format takes no new sale',
      'FAIL','a sale was recorded against a retired container');
  exception when others then
    insert into t2_result values (20,'D7','an inactive format takes no new sale',
      'PASS', sqlerrm);
  end;

  select count(*) into n from recipe_variants where id=vA;
  insert into t2_result values (21,'D7','deactivation preserves the existing variant',
    case when n=1 then 'PASS' else 'FAIL' end,
    'history must survive deactivation');

  update serving_formats set is_active=true where id=fA;

  -- =========================================== variant / recipe match on sale
  begin
    insert into sales_entries (account_id,business_id,recipe_id,variant_id,qty,unit_price)
      values (aA,bA,rB,vA,1,1000);
    insert into t2_result values (22,'design','a sale''s variant must match its recipe',
      'FAIL','a variant of one recipe was sold as another');
  exception when others then
    insert into t2_result values (22,'design','a sale''s variant must match its recipe',
      'PASS', sqlerrm);
  end;

  -- ================================================= snapshot completeness
  -- Phase 1 must NOT constrain completeness against resolved_qty: the 0012
  -- engine writes complete snapshots without it, and only Phase 5 teaches it
  -- to populate the column. This check asserts the ABSENCE of that constraint,
  -- so that re-adding it early fails loudly here instead of in production.
  begin
    insert into cost_snapshots (account_id,business_id,recipe_id,costing_method,
                                is_complete,required_inputs,priced_inputs)
      values (aA,bA,rA,'weighted_average',true,1,1);
    insert into t2_result values (23,'design','a complete snapshot still writes without resolved_qty',
      'PASS','chk_complete_requires_resolution is correctly deferred to 0025');
  exception when others then
    insert into t2_result values (23,'design','a complete snapshot still writes without resolved_qty',
      'FAIL','PHASE 1 BROKE THE COSTING ENGINE: '||sqlerrm);
  end;

  insert into cost_snapshots (account_id,business_id,recipe_id,costing_method,
                              is_complete,required_inputs,priced_inputs)
    values (aA,bA,rA,'weighted_average',false,1,0);
  insert into t2_result values (24,'design','an incomplete snapshot still writes',
    'PASS','the completeness gate is unchanged: incomplete, never zero');
end
$$;

-- ======================================================= RLS / tenant boundary
--
-- Counts are taken while acting as B, then written to the result table after
-- resetting the role: `authenticated` has no privilege on the temp table, and
-- granting it one would weaken the very boundary under test.
do $$
declare aA uuid; aB uuid; uB uuid; n_fmt int; n_var int; n_pkg int;
begin
  select id into aA from accounts where name='Acct A';
  select id into aB from accounts where name='Acct B';
  select user_id into uB from memberships where account_id=aB limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', uB::text, true);

  select count(*) into n_fmt from serving_formats          where account_id=aA;
  select count(*) into n_var from recipe_variants          where account_id=aA;
  select count(*) into n_pkg from serving_format_packaging where account_id=aA;

  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  insert into t2_result values (25,'RLS','B cannot read A''s serving formats',
    case when n_fmt=0 then 'PASS' else 'FAIL' end, 'B saw '||n_fmt||' of A''s formats');
  insert into t2_result values (26,'RLS','B cannot read A''s variants',
    case when n_var=0 then 'PASS' else 'FAIL' end, 'B saw '||n_var||' of A''s variants');
  insert into t2_result values (27,'RLS','B cannot read A''s format packaging costs',
    case when n_pkg=0 then 'PASS' else 'FAIL' end, 'B saw '||n_pkg||' of A''s packaging rows');
end
$$;

-- ================================================= grant surface (0018 intact)
do $$
declare n int;
begin
  select count(distinct table_name) into n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public';
  insert into t2_result values (28,'0018','anon still reads exactly 5 reference tables',
    case when n=5 then 'PASS' else 'FAIL' end, 'anon can read '||n||' table(s)');

  select count(*) into n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public'
     and table_name in ('serving_formats','recipe_variants',
                        'serving_format_packaging','serving_format_changes');
  insert into t2_result values (29,'0018','anon holds nothing on the Gate 2 tables',
    case when n=0 then 'PASS' else 'FAIL' end, 'found '||n||' grant(s)');

  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  insert into t2_result values (30,'0018','anon executes no fn_* function',
    case when n=0 then 'PASS' else 'FAIL' end, n||' executable');
end
$$;

-- ============================================================ structural counts
do $$
declare v_fns int; v_rels int; v_pols int;
begin
  select count(*) into v_fns from pg_proc
    where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
    where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  select count(*) into v_pols from pg_policies where schemaname='public';

  -- Assert the seven Phase 1 functions BY NAME rather than a global total.
  -- Later phases legitimately add functions (0023 adds two), and a hardcoded
  -- total would fail for the wrong reason -- it did, before this was fixed.
  insert into t2_result values (31,'counts','all 7 Phase 1 functions present',
    case when (select count(*) from pg_proc
                where pronamespace='public'::regnamespace
                  and proname in ('fn_assert_unit_visible_col',
                                  'fn_assert_packaging_item_kind',
                                  'fn_log_serving_format_change',
                                  'fn_block_format_change_mutation',
                                  'fn_reject_variant_on_inactive_format',
                                  'fn_assert_sale_variant_valid',
                                  'fn_assert_no_packaging_double_count')) = 7
         then 'PASS' else 'FAIL' end, v_fns::text||' fn_* in total');
  insert into t2_result values (32,'counts','relations = 48',
    case when v_rels=48 then 'PASS' else 'FAIL' end, v_rels::text);
  insert into t2_result values (33,'counts','policies = 105',
    case when v_pols=105 then 'PASS' else 'FAIL' end, v_pols::text);
end
$$;

select n, area, check_name, verdict, left(detail,72) as detail from t2_result order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail
  from t2_result;

rollback;
