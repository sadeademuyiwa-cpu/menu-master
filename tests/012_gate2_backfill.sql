-- ============================================================================
-- MENU MASTER NG -- tests/012_gate2_backfill.sql
--
-- Acceptance test for 0022 (Gate 2, Phase 2 backfill).
-- Run from the repository root, on a database with 0021 applied.
--
-- Seeds deliberately awkward data, runs the real migration file via \i, then
-- asserts. Everything rolls back; no rows are left behind.
-- ============================================================================

begin;

create temp table t3_result (n int, check_name text, verdict text, detail text)
  on commit drop;

do $$
declare
  aA uuid := gen_random_uuid(); aB uuid := gen_random_uuid();
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  bA uuid := gen_random_uuid(); bB uuid := gen_random_uuid(); bC uuid := gen_random_uuid();
  u_l uuid; u_g uuid;
begin
  select id into u_l from units where account_id is null and code='l';
  select id into u_g from units where account_id is null and code='g';

  insert into auth.users (id,email) values (uA,'bf-a@t.test'), (uB,'bf-b@t.test');
  insert into accounts (id,name) values (aA,'BF A'), (aB,'BF B');
  insert into businesses (id,account_id,name,slug,type) values
    (bA,aA,'BF Biz A','bf-a','soup_seller'),
    (bB,aB,'BF Biz B','bf-b','restaurant'),
    (bC,aA,'BF Biz C','bf-c','baker');          -- no eligible recipe at all
  insert into memberships (account_id,business_id,user_id,role)
    values (aA,bA,uA,'owner'), (aB,bB,uB,'owner');

  -- eligible: two in business A, one in business B
  insert into recipes (account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty)
    values (aA,bA,'Egusi',10,u_l,1.5),
           (aA,bA,'Jollof',8,u_g,250),
           (aB,bB,'Efo',10,u_l,2);
  -- NOT eligible: no portion_qty
  insert into recipes (account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty)
    values (aA,bA,'Stock (no portion)',5,u_l,null);
  -- NOT eligible: soft deleted
  insert into recipes (account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,deleted_at)
    values (aA,bA,'Retired dish',5,u_l,1,now());
  -- business C gets a recipe with no portion_qty, so it must receive NO format
  insert into recipes (account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty)
    values (aA,bC,'Bread (no portion)',20,u_g,null);
end
$$;

\i migrations/proposed/0022_backfill_default_variants.sql

do $$
declare n int;
begin
  select count(*) into n from recipe_variants;
  insert into t3_result values (1,'one variant per eligible recipe',
    case when n=3 then 'PASS' else 'FAIL' end, n||' variant(s), expected 3');

  select count(*) into n from serving_formats where lower(name)='default';
  insert into t3_result values (2,'one Default format per eligible business',
    case when n=2 then 'PASS' else 'FAIL' end, n||' format(s), expected 2 (A and B, not C)');

  select count(*) into n from serving_formats f
    join businesses b on b.id=f.business_id where b.slug='bf-c';
  insert into t3_result values (3,'a business with no eligible recipe gets no format',
    case when n=0 then 'PASS' else 'FAIL' end, n||' format(s) for business C');

  select count(*) into n from serving_formats
   where lower(name)='default' and (capacity_qty is not null or capacity_unit_id is not null);
  insert into t3_result values (4,'NO container size is inferred',
    case when n=0 then 'PASS' else 'FAIL' end, n||' Default format(s) carry a capacity');

  select count(*) into n from recipe_variants rv join recipes r on r.id=rv.recipe_id
   where rv.sellable_qty is distinct from r.portion_qty
      or rv.sellable_unit_id is distinct from r.yield_unit_id
      or rv.costing_basis <> 'explicit_qty';
  insert into t3_result values (5,'every quantity reproduces portion_qty exactly',
    case when n=0 then 'PASS' else 'FAIL' end, n||' mismatch(es)');

  select count(*) into n from recipe_variants rv join recipes r on r.id=rv.recipe_id
   where r.portion_qty is null;
  insert into t3_result values (6,'a NULL portion_qty is never turned into a quantity',
    case when n=0 then 'PASS' else 'FAIL' end, n||' variant(s) for null-portion recipes');

  select count(*) into n from recipe_variants rv join recipes r on r.id=rv.recipe_id
   where r.deleted_at is not null;
  insert into t3_result values (7,'a soft-deleted recipe receives no variant',
    case when n=0 then 'PASS' else 'FAIL' end, n||' variant(s) for deleted recipes');

  select count(*) into n from recipe_variants rv
    join serving_formats sf on sf.id=rv.format_id
   where rv.business_id <> sf.business_id or rv.account_id <> sf.account_id;
  insert into t3_result values (8,'no variant crosses a business or account boundary',
    case when n=0 then 'PASS' else 'FAIL' end, n||' boundary violation(s)');
end
$$;

-- idempotence: running the very same migration again must add nothing
\i migrations/proposed/0022_backfill_default_variants.sql

do $$
declare v int; f int;
begin
  select count(*) into v from recipe_variants;
  select count(*) into f from serving_formats where lower(name)='default';
  insert into t3_result values (9,'re-running the backfill adds nothing',
    case when v=3 and f=2 then 'PASS' else 'FAIL' end,
    v||' variant(s), '||f||' format(s) after the second run');
end
$$;

\i migrations/proposed/0022_rollback.sql

do $$
declare v int; f int; r int;
begin
  select count(*) into v from recipe_variants;
  select count(*) into f from serving_formats where lower(name)='default';
  select count(*) into r from recipes;
  insert into t3_result values (10,'rollback removes the backfill and nothing else',
    case when v=0 and f=0 and r=6 then 'PASS' else 'FAIL' end,
    v||' variant(s), '||f||' format(s), '||r||' recipe(s) still present (expect 0/0/6)');
end
$$;

select n, check_name, verdict, detail from t3_result order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t3_result;

rollback;
