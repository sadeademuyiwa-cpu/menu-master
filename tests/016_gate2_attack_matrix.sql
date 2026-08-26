-- ============================================================================
-- MENU MASTER NG -- tests/016_gate2_attack_matrix.sql
--
-- GATE 2 ATTACK MATRIX -- docs/GATE2_FINAL_DESIGN.md section 8.
-- Run on a database with 0021-0025 applied. Rolls everything back.
--
-- The four attacks the design names, plus the controls that prove the tests
-- are actually exercising the boundary rather than failing for another reason:
--
--   * B cannot read, use, modify or attach A's formats
--   * B cannot read A's packaging costs
--   * B cannot price A's variants
--   * a kitchen role cannot read format packaging cost INSIDE ITS OWN ACCOUNT
--
-- Every attack runs as a real client role with a real JWT subject, not as the
-- owner of the tables.
-- ============================================================================

begin;

create temp table t7 (n int, attack text, verdict text, detail text) on commit drop;
create temp table t7_fx (aA uuid, aB uuid, uA uuid, uB uuid, uK uuid,
                        bA uuid, bB uuid, fA uuid, vA uuid, rB uuid, fB uuid, pkgA uuid)
  on commit drop;

do $$
declare
  aA uuid := gen_random_uuid(); aB uuid := gen_random_uuid();
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uK uuid := gen_random_uuid();
  bA uuid := gen_random_uuid(); bB uuid := gen_random_uuid();
  u_l uuid; u_g uuid; u_pc uuid;
  ingA uuid := gen_random_uuid(); pkgA uuid := gen_random_uuid();
  rA uuid := gen_random_uuid(); rB uuid := gen_random_uuid();
  fA uuid := gen_random_uuid(); fB uuid := gen_random_uuid();
  vA uuid := gen_random_uuid(); s uuid;
begin
  select id into u_l from units where account_id is null and code='l';
  select id into u_g from units where account_id is null and code='g';
  select id into u_pc from units where account_id is null and kind='count' limit 1;

  insert into auth.users (id,email) values
    (uA,'atk-a@t.test'), (uB,'atk-b@t.test'), (uK,'atk-kitchen@t.test');
  insert into accounts (id,name) values (aA,'Attack A'), (aB,'Attack B');
  insert into businesses (id,account_id,name,slug,type) values
    (bA,aA,'A Biz','atk-a','soup_seller'), (bB,aB,'B Biz','atk-b','restaurant');
  -- uK is a KITCHEN member of account A: inside the tenant, but cost-blind
  insert into memberships (account_id,business_id,user_id,role) values
    (aA,bA,uA,'owner'), (aB,bB,uB,'owner'), (aA,bA,uK,'kitchen');
  insert into business_settings (business_id,account_id,overhead_enabled) values
    (bA,aA,false), (bB,aB,false);

  insert into ingredients (id,account_id,kind,name,base_unit_id) values
    (ingA,aA,'ingredient','Rice',u_g), (pkgA,aA,'packaging','Bowl',u_pc);
  insert into ingredient_prices (account_id,ingredient_id,qty_base,amount,source) values
    (aA,ingA,1000,5000,'manual'), (aA,pkgA,10,1000,'manual');

  insert into recipes (id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty) values
    (rA,aA,bA,'A Egusi',10,u_l,1.5), (rB,aB,bB,'B Efo',10,u_l,1.5);
  insert into recipe_lines (account_id,recipe_id,ingredient_id,qty,unit_id) values (aA,rA,ingA,1000,u_g);
  s := fn_compute_recipe_cost_snapshot(rA);

  insert into serving_formats (id,account_id,business_id,name) values
    (fA,aA,bA,'A Family Bowl'), (fB,aB,bB,'B Bowl');
  insert into recipe_variants (id,account_id,business_id,recipe_id,format_id,
                               costing_basis,sellable_qty,sellable_unit_id)
    values (vA,aA,bA,rA,fA,'explicit_qty',1.5,u_l);
  insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
    values (aA,bA,fA,pkgA,1);
  s := fn_compute_variant_cost_snapshot(vA);

  insert into t7_fx values (aA,aB,uA,uB,uK,bA,bB,fA,vA,rB,fB,pkgA);
end
$$;

-- ============================================================ ATTACK 1-3: B vs A
do $$
declare f record; n_fmt int; n_var int; n_pkg int; n_price int;
        upd int; del int; att text; prc text;
begin
  select * into f from t7_fx;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.uB::text, true);

  select count(*) into n_fmt from serving_formats          where account_id = f.aA;
  select count(*) into n_var from recipe_variants          where account_id = f.aA;
  select count(*) into n_pkg from serving_format_packaging where account_id = f.aA;
  select count(*) into n_price from v_price_check          where account_id = f.aA;

  update serving_formats set name = 'PWNED' where id = f.fA;
  get diagnostics upd = row_count;
  delete from serving_format_packaging where format_id = f.fA;
  get diagnostics del = row_count;

  -- attach A's format to B's own recipe
  begin
    insert into recipe_variants (account_id,business_id,recipe_id,format_id,costing_basis)
      values (f.aB, f.bB, f.rB, f.fA, 'capacity');
    att := 'ACCEPTED';
  exception when others then att := sqlerrm;
  end;

  -- price A's variant
  begin
    insert into recipe_prices (account_id,recipe_id,variant_id,price)
      values (f.aB, f.rB, f.vA, 1);
    prc := 'ACCEPTED';
  exception when others then prc := sqlerrm;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  insert into t7 values (1,'B cannot READ A''s serving formats',
    case when n_fmt=0 then 'PASS' else 'FAIL' end, 'saw '||n_fmt);
  insert into t7 values (2,'B cannot READ A''s variants',
    case when n_var=0 then 'PASS' else 'FAIL' end, 'saw '||n_var);
  insert into t7 values (3,'B cannot READ A''s format packaging costs',
    case when n_pkg=0 then 'PASS' else 'FAIL' end, 'saw '||n_pkg);
  insert into t7 values (4,'B cannot READ A''s pricing',
    case when n_price=0 then 'PASS' else 'FAIL' end, 'saw '||n_price||' priced row(s)');
  insert into t7 values (5,'B cannot MODIFY A''s format',
    case when upd=0 then 'PASS' else 'FAIL' end, upd||' row(s) updated');
  insert into t7 values (6,'B cannot DELETE A''s format packaging',
    case when del=0 then 'PASS' else 'FAIL' end, del||' row(s) deleted');
  insert into t7 values (7,'B cannot ATTACH A''s format to its own recipe',
    case when att<>'ACCEPTED' then 'PASS' else 'FAIL' end, left(att,60));
  insert into t7 values (8,'B cannot PRICE A''s variant',
    case when prc<>'ACCEPTED' then 'PASS' else 'FAIL' end, left(prc,60));
end
$$;

-- ==================================== ATTACK 4: kitchen, inside its own account
do $$
declare f record; n_pkg int; n_fmt int; n_cost int; ins text;
begin
  select * into f from t7_fx;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.uK::text, true);

  select count(*) into n_pkg  from serving_format_packaging where account_id = f.aA;
  select count(*) into n_fmt  from serving_formats          where account_id = f.aA;
  select count(*) into n_cost from v_price_check
   where account_id = f.aA and cost_per_portion is not null;

  begin
    insert into serving_format_packaging (account_id,business_id,format_id,packaging_item_id,qty)
      values (f.aA, f.bA, f.fA, f.pkgA, 99);
    ins := 'ACCEPTED';
  exception when others then ins := sqlerrm;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub','',true);

  insert into t7 values (9,'kitchen cannot read format packaging cost in its OWN account',
    case when n_pkg=0 then 'PASS' else 'FAIL' end,
    'saw '||n_pkg||' row(s) — a container list plus prices is commercial intelligence');
  insert into t7 values (10,'kitchen CAN still see the formats themselves (control)',
    case when n_fmt>0 then 'PASS' else 'FAIL' end,
    'saw '||n_fmt||' format(s) — proves the test exercises the COST boundary');
  insert into t7 values (11,'kitchen cannot see a variant cost through v_price_check',
    case when n_cost=0 then 'PASS' else 'FAIL' end, 'saw '||n_cost||' costed row(s)');
  insert into t7 values (12,'kitchen cannot add format packaging',
    case when ins<>'ACCEPTED' then 'PASS' else 'FAIL' end, left(ins,60));
end
$$;

-- ============================================================ anon sees nothing
do $$
declare f record; n int; total int;
begin
  select * into f from t7_fx;
  set local role anon;
  select count(*) into n from serving_formats;
  select count(*) into total from recipe_variants;
  reset role;
  insert into t7 values (13,'anon sees no serving formats at all',
    case when n=0 then 'PASS' else 'FAIL' end, 'saw '||n);
  insert into t7 values (14,'anon sees no variants at all',
    case when total=0 then 'PASS' else 'FAIL' end, 'saw '||total);
exception when insufficient_privilege then
  reset role;
  insert into t7 values (13,'anon sees no serving formats at all','PASS','permission denied');
  insert into t7 values (14,'anon sees no variants at all','PASS','permission denied');
end
$$;

-- =========================================== D7: no DELETE path, even for owner
do $$
declare f record; d1 int; d2 int;
begin
  select * into f from t7_fx;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.uA::text, true);
  delete from recipe_variants where id = f.vA;  get diagnostics d1 = row_count;
  delete from serving_formats where id = f.fA;  get diagnostics d2 = row_count;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t7 values (15,'D7: even the OWNER cannot delete a variant',
    case when d1=0 then 'PASS' else 'FAIL' end, d1||' row(s) — deactivate, never delete');
  insert into t7 values (16,'D7: even the OWNER cannot delete a format',
    case when d2=0 then 'PASS' else 'FAIL' end, d2||' row(s) — history is preserved');
end
$$;

select n, attack, verdict, left(detail,62) as detail from t7 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t7;

rollback;
