-- ============================================================================
-- 0060 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0059 and 0060 is not applied.
-- EXPECTED: 6 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0059 is applied (bucket "site" exists)',
         exists(select 1 from storage.buckets where id='site'), ''
  union all select 2, 'identity: 118 policies in public',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: 95 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 95,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'not yet applied: purchases.replaced_by is absent',
         not exists(select 1 from information_schema.columns
                    where table_schema='public' and table_name='purchases' and column_name='replaced_by'), ''
  union all select 5, 'not yet applied: customers.deleted_at is absent',
         not exists(select 1 from information_schema.columns
                    where table_schema='public' and table_name='customers' and column_name='deleted_at'), ''
  union all select 6, 'fn_reissue_order is the 0014 version (creates an empty replacement)',
         (select prosrc like '%add_corrected_lines_then_finalise%' from pg_proc
           where proname='fn_reissue_order' and pronamespace='public'::regnamespace), ''
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
