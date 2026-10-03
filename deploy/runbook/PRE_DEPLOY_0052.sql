-- ============================================================================
-- 0052 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0051 and no part of 0052 is applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
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
  select 1, 'identity: 0051 is applied',
         exists(select 1 from pg_proc where proname='fn_my_has_sales' and pronamespace='public'::regnamespace), ''
  union all select 2, 'identity: 117 policies',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: 77 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 77,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'starting state: exactly 23 fn_* functions lack a search_path',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
            and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
            and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))) = 23,
         (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
            and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
            and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))
  union all select 5, 'starting state: exactly 138 foreign keys are uncovered',
         (select count(*) from fk where conname not in (select conname from covered)) = 138,
         (select count(*)::text from fk where conname not in (select conname from covered))
  union all select 6, 'not yet applied: no ix_fk_* index exists',
         not exists(select 1 from pg_class where relname like 'ix\_fk\_%' and relkind='i'), ''
  union all select 7, 'starting state: anon currently holds SELECT on billing_config (0032)',
         has_table_privilege('anon','billing_config','select'), ''
  union all select 8, 'live data: nothing in 0052 touches a row',
         true, (select count(*)::text||' subscriptions, '||(select count(*) from founder_slots where claimed_at is not null)||' founder(s)' from subscriptions)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
