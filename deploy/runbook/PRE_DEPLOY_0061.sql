-- ============================================================================
-- 0061 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0060 and 0061 is not applied.
-- EXPECTED: 5 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0060 is applied (purchases.replaced_by exists)',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='purchases' and column_name='replaced_by'), ''
  union all select 2, 'identity: 118 policies in public',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: 98 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'not yet applied: order_lines.extra_unit_cost is absent',
         not exists(select 1 from information_schema.columns
                    where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost'), ''
  union all select 5, 'fn_confirm_order is the 0045 version',
         (select prosrc not like '%extra_unit_cost%' from pg_proc
           where proname='fn_confirm_order' and pronamespace='public'::regnamespace), ''
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
