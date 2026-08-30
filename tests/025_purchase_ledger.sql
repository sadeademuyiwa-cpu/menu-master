-- ============================================================================
-- MENU MASTER NG -- tests/025_purchase_ledger.sql
--
-- Phase 2. The purchase ledger is the ONLY way an ingredient price is created,
-- so its guarantees are financial guarantees: post once, refuse what cannot be
-- resolved, and reverse without destroying evidence.
--
-- Run on a database with 0001-0034 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t25 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx25 (acct uuid, usr uuid, biz uuid, g uuid, kg uuid, paint uuid, rice uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); b uuid; g uuid; kg uuid; paint uuid;
        rice uuid := gen_random_uuid(); res jsonb;
begin
  select id into g from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  select id into paint from units where account_id is null and code='paint';
  insert into auth.users(id,email) values (u,'ledger@t.test');
  res := fn_create_account_and_business('Ledger Co','Ledger K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (rice,a,'ingredient','Ledger Rice',g);
  insert into fx25 values (a,u,b,g,kg,paint,rice);
end $$;

create or replace function pg_temp.new_purchase(p_date date default current_date) returns uuid
language plpgsql as $$
declare f record; p uuid := gen_random_uuid();
begin
  select * into f from fx25;
  insert into purchases(id,account_id,business_id,purchase_date) values (p,f.acct,f.biz,p_date);
  return p;
end $$;

-- ---------------------------------------------------------------------------
-- POSTING WRITES A PURCHASE-SOURCED, REVERSIBLE PRICE
-- ---------------------------------------------------------------------------
do $$
declare f record; p uuid; res jsonb; ip record; c numeric;
begin
  select * into f from fx25;
  p := pg_temp.new_purchase();
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
  values (f.acct,p,f.rice,25,f.kg,42000);          -- 25 kg for N42,000

  res := fn_post_purchase(p);
  insert into t25 values (1,'posting a purchase succeeds and reports what it wrote',
    case when (res->>'posted')::boolean and (res->>'price_rows_written')::int = 1
         then 'PASS' else 'FAIL' end, res::text);

  select * into ip from ingredient_prices where ingredient_id = f.rice;
  insert into t25 values (2,'the price row is sourced ''purchase'' and linked to its line',
    case when ip.source = 'purchase' and ip.purchase_line_id is not null
         then 'PASS' else 'FAIL' end, ip.source||', line='||coalesce(ip.purchase_line_id::text,'NULL'));

  -- 25 kg resolves to 25,000 g; N42,000 / 25,000 g = N1.68/g
  insert into t25 values (3,'the engine derives N1.68 per g from N42,000 for 25 kg',
    case when round(ip.qty_base,2)=25000.00 and round(ip.unit_cost,4)=1.6800
         then 'PASS' else 'FAIL' end,
    ip.qty_base||' g, N'||round(ip.unit_cost,4)||'/g');

  c := fn_ingredient_unit_cost(f.rice, f.biz);
  insert into t25 values (4,'costing picks it up as a real purchase',
    case when round(c,4)=1.6800 then 'PASS' else 'FAIL' end, round(c,4)::text);
end $$;

-- ---------------------------------------------------------------------------
-- IDEMPOTENCY: a double submit must not post twice
-- ---------------------------------------------------------------------------
do $$
declare f record; p uuid; res jsonb; ok boolean := false; n int;
begin
  select * into f from fx25;
  p := pg_temp.new_purchase();
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
  values (f.acct,p,f.rice,1,f.kg,1000);
  res := fn_post_purchase(p);
  begin
    perform fn_post_purchase(p);                    -- the double click
  exception when others then ok := true;
  end;
  insert into t25 values (5,'posting the same purchase twice is refused',
    case when ok then 'PASS' else 'FAIL' end, case when ok then 'refused' else 'POSTED TWICE' end);

  select count(*) into n from ingredient_prices where purchase_line_id in
    (select id from purchase_lines where purchase_id = p);
  insert into t25 values (6,'and it wrote exactly one price row, not two',
    case when n = 1 then 'PASS' else 'FAIL' end, n||' row(s)');
end $$;

-- ---------------------------------------------------------------------------
-- REFUSALS: unresolved conversion, empty purchase, zero value
-- ---------------------------------------------------------------------------
do $$
declare f record; p uuid; res jsonb; ok boolean := false; n int;
begin
  select * into f from fx25;

  -- paint has no universal factor and no per-ingredient conversion yet
  p := pg_temp.new_purchase();
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
  values (f.acct,p,f.rice,2,f.paint,9000);
  res := fn_post_purchase(p);
  insert into t25 values (7,'a purchase in an unconvertible unit is REFUSED, not guessed',
    case when (res->>'posted')::boolean is false
          and res->>'reason' = 'unresolved_conversions' then 'PASS' else 'FAIL' end,
    res->>'reason');

  select count(*) into n from ingredient_prices where purchase_line_id in
    (select id from purchase_lines where purchase_id = p);
  insert into t25 values (8,'the refused purchase created no price at all',
    case when n = 0 then 'PASS' else 'FAIL' end, n||' row(s)');

  insert into t25 values (9,'the refusal names the ingredient so it can be fixed',
    case when res->'blockers'->0->>'ingredient_name' = 'Ledger Rice' then 'PASS' else 'FAIL' end,
    coalesce(res->'blockers'->0->>'ingredient_name','none'));

  -- once the business states its own conversion, the same purchase posts
  insert into ingredient_unit_conversions(account_id,ingredient_id,unit_id,qty_in_base)
  values (f.acct,f.rice,f.paint,4000);              -- 1 paint of THIS rice = 4,000 g
  res := fn_post_purchase(p);
  insert into t25 values (10,'after the business records the conversion it posts',
    case when (res->>'posted')::boolean then 'PASS' else 'FAIL' end, res::text);

  -- an empty purchase
  p := pg_temp.new_purchase();
  begin perform fn_post_purchase(p); exception when others then ok := true; end;
  insert into t25 values (11,'a purchase with no items is refused',
    case when ok then 'PASS' else 'FAIL' end, case when ok then 'refused' else 'POSTED' end);
end $$;

-- ---------------------------------------------------------------------------
-- REVERSAL: undo the cost without destroying the record
-- ---------------------------------------------------------------------------
do $$
declare f record; p uuid; res jsonb; c_before numeric; c_after numeric;
        n_rev int; n_orig int; st text;
begin
  select * into f from fx25;
  p := pg_temp.new_purchase();
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
  values (f.acct,p,f.rice,10,f.kg,50000);          -- 10 kg for N50,000 = N5.00/g
  perform fn_post_purchase(p);
  c_before := fn_ingredient_unit_cost(f.rice, f.biz);

  res := fn_reverse_purchase(p, 'goods returned');
  c_after := fn_ingredient_unit_cost(f.rice, f.biz);

  insert into t25 values (12,'reversal reports success',
    case when (res->>'reversed')::boolean then 'PASS' else 'FAIL' end, res::text);

  insert into t25 values (13,'the reversed purchase no longer affects the cost',
    case when c_before is distinct from c_after then 'PASS' else 'FAIL' end,
    'before N'||round(c_before,4)||' -> after N'||coalesce(round(c_after,4)::text,'NULL'));

  select count(*) into n_orig from purchases where id = p;
  select status into st from purchases where id = p;
  insert into t25 values (14,'the original purchase is KEPT as evidence, marked reversed',
    case when n_orig = 1 and st = 'reversed' then 'PASS' else 'FAIL' end, st);

  select count(*) into n_rev from purchases where reverses = p;
  insert into t25 values (15,'a reversing purchase is recorded against it',
    case when n_rev = 1 then 'PASS' else 'FAIL' end, n_rev||' reversal(s)');

  insert into t25
  select 16, 'the reversed price row is marked, not deleted',
         case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)||' marked row(s)'
  from ingredient_prices ip
  where ip.purchase_line_id in (select id from purchase_lines where purchase_id = p)
    and ip.reversed_at is not null;

  -- reversing twice must be refused
  declare ok boolean := false;
  begin
    begin perform fn_reverse_purchase(p, 'again'); exception when others then ok := true; end;
    insert into t25 values (17,'a purchase cannot be reversed twice',
      case when ok then 'PASS' else 'FAIL' end, case when ok then 'refused' else 'REVERSED TWICE' end);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- TENANT ISOLATION of the ledger
-- ---------------------------------------------------------------------------
do $$
declare f record; u2 uuid := gen_random_uuid(); res jsonb; k int;
begin
  select * into f from fx25;
  insert into auth.users(id,email) values (u2,'ledgerrival@t.test');
  res := fn_create_account_and_business('LRival','LRival K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);

  -- Read as the rival, then drop back before touching the temp table: the
  -- authenticated role has no rights on it, and that failure would otherwise
  -- masquerade as a test error.
  declare k2 int;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', u2::text, true);
    select count(*) into k  from purchases;
    select count(*) into k2 from purchase_lines;
    reset role;
    perform set_config('request.jwt.claim.sub','',true);

    insert into t25 values (18,'another account sees none of these purchases',
      case when k = 0 then 'PASS' else 'FAIL' end, k||' row(s)');
    insert into t25 values (19,'another account sees none of these purchase lines',
      case when k2 = 0 then 'PASS' else 'FAIL' end, k2||' row(s)');
  end;
end $$;

select * from t25 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t25;

rollback;
