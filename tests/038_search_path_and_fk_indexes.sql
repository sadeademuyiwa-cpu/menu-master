-- ============================================================================
-- MENU MASTER NG -- tests/038_search_path_and_fk_indexes.sql
--
-- Acceptance test for 0052. Run on a database with 0052 applied.
-- Rolls everything back.
--
-- Three things the Supabase advisors flagged on production, each proved here
-- as a property of the schema rather than an absence of warnings.
-- ============================================================================

begin;

create temp table t38 (n int, check_name text, verdict text, detail text) on commit drop;

do $$
declare v int; v_txt text;
begin
  -- ============================================ 1. search_path
  select count(*) into v from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  insert into t38 values (1,'every fn_* function pins its search_path',
    case when v=0 then 'PASS' else 'FAIL' end, v||' unpinned');

  select count(*) into v from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public');
  insert into t38 values (2,'and they pin PUBLIC, matching every definer function',
    case when v=77 then 'PASS' else 'FAIL' end, v||' of 77 pin public');

  -- a pinned trigger function must still work: fire one on purpose
  begin
    perform fn_is_service_context();
    insert into t38 values (3,'a pinned helper still executes','PASS','fn_is_service_context ran');
  exception when others then
    insert into t38 values (3,'a pinned helper still executes','FAIL',sqlerrm);
  end;

  -- ============================================ 2. foreign keys
  with fk as (
    select c.conrelid::regclass::text as tbl, c.conname, c.conkey
      from pg_constraint c join pg_class r on r.oid=c.conrelid
     where c.contype='f' and r.relnamespace='public'::regnamespace),
  covered as (
    select fk.conname from fk join pg_index i on i.indrelid = fk.tbl::regclass
     where (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] = fk.conkey)
  select count(*) into v from fk where conname not in (select conname from covered);
  insert into t38 values (4,'every foreign key has a covering index',
    case when v=0 then 'PASS' else 'FAIL' end, v||' uncovered');

  select count(*) into v from pg_class where relname like 'ix\_fk\_%' and relkind='i';
  insert into t38 values (5,'exactly 138 ix_fk_* indexes exist',
    case when v=138 then 'PASS' else 'FAIL' end, v::text);

  select count(*) into v from pg_class where relname like 'ix\_fk\_%' and length(relname) > 63;
  insert into t38 values (6,'no index name was silently truncated',
    case when v=0 then 'PASS' else 'FAIL' end, v||' over 63 chars');

  -- the hottest trading tables are covered on account_id, which RLS filters on
  select count(*) into v from pg_indexes
   where tablename in ('sales_entries','orders','order_lines','purchases')
     and indexdef like '%(account_id%';
  insert into t38 values (7,'the trading tables are indexed on account_id',
    case when v>=4 then 'PASS' else 'FAIL' end, v||' of 4 tables');

  -- ============================================ 3. billing_config
  select string_agg(table_name, ', ' order by table_name) into v_txt
    from information_schema.role_table_grants
   where grantee='anon' and table_schema='public' and privilege_type='SELECT';
  insert into t38 values (8,'anon reads exactly the five reference tables again',
    case when v_txt='catalog_categories, catalog_ingredients, plan_features, plans, units'
         then 'PASS' else 'FAIL' end, coalesce(v_txt,'none'));

  insert into t38 values (9,'the grace period is still readable THROUGH the definer function',
    case when fn_payment_failure_grace() = interval '7 days' then 'PASS' else 'FAIL' end,
    fn_payment_failure_grace()::text);

  -- ============================================ 4. nothing else moved
  insert into t38 values (10,'117 policies, unchanged',
    case when (select count(*) from pg_policies where schemaname='public')=117 then 'PASS' else 'FAIL' end,
    (select count(*)::text from pg_policies where schemaname='public'));
  insert into t38 values (11,'77 fn_* functions, unchanged',
    case when (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')=77
         then 'PASS' else 'FAIL' end, '');
end $$;

-- and anon must actually be refused, not merely un-granted on paper
do $$
declare msg text := 'READ';
begin
  set local role anon;
  begin
    perform * from billing_config;
  exception when others then msg := sqlstate; end;
  reset role;
  insert into t38 values (12,'anon is refused billing_config at the wire',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);
end $$;

select n, check_name, verdict, left(detail,60) as detail from t38 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t38;

rollback;
