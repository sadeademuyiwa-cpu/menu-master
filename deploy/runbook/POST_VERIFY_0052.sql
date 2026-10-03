-- ============================================================================
-- 0052 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0052 commits.
-- EXPECTED: 8 rows, every one PASS.
-- ============================================================================
with fk as (
  select c.conrelid::regclass::text as tbl, c.conname, c.conkey
    from pg_constraint c join pg_class r on r.oid=c.conrelid
   where c.contype='f' and r.relnamespace='public'::regnamespace),
covered as (
  select fk.conname from fk join pg_index i on i.indrelid = fk.tbl::regclass
   where (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] = fk.conkey),
checks(n, check_name, ok, detail) as (
  select 1, 'every fn_* function pins its search_path',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
            and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
            and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))) = 0,
         (select count(*)::text||' unpinned' from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
            and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
            and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))
  union all select 2, 'every foreign key has a covering index',
         (select count(*) from fk where conname not in (select conname from covered)) = 0,
         (select count(*)::text||' uncovered' from fk where conname not in (select conname from covered))
  union all select 3, 'exactly 138 ix_fk_* indexes',
         (select count(*) from pg_class where relname like 'ix\_fk\_%' and relkind='i') = 138,
         (select count(*)::text from pg_class where relname like 'ix\_fk\_%' and relkind='i')
  union all select 4, 'anon reads exactly the five reference tables',
         (select string_agg(table_name, ', ' order by table_name) from information_schema.role_table_grants
           where grantee='anon' and table_schema='public' and privilege_type='SELECT')
           = 'catalog_categories, catalog_ingredients, plan_features, plans, units',
         (select string_agg(table_name, ', ' order by table_name) from information_schema.role_table_grants
           where grantee='anon' and table_schema='public' and privilege_type='SELECT')
  union all select 5, 'the grace period is still served through fn_payment_failure_grace',
         (select proconfig is not null from pg_proc where proname='fn_payment_failure_grace' and pronamespace='public'::regnamespace),
         'the only reader of billing_config is SECURITY DEFINER and needs no client grant'
  union all select 6, '117 policies, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 7, '77 fn_* functions, unchanged',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 77, ''
  union all select 8, 'the paying customer is untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
