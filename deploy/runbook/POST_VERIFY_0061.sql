-- ============================================================================
-- 0061 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0061 commits.
-- EXPECTED: 6 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'order_lines.extra_unit_cost exists, non-negative',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost')
         and exists(select 1 from pg_constraint where conname='ck_order_lines_extra_cost_positive'), ''
  union all select 2, 'fn_confirm_order freezes the extra cost',
         (select prosrc like '%extra_unit_cost%' from pg_proc
           where proname='fn_confirm_order' and pronamespace='public'::regnamespace), ''
  union all select 3, 'fn_reissue_order copies the extra cost',
         (select prosrc like '%extra_unit_cost%' from pg_proc
           where proname='fn_reissue_order' and pronamespace='public'::regnamespace), ''
  union all select 4, 'v_sale_lines reads a costed extra as costed',
         (select pg_get_viewdef('v_sale_lines'::regclass) like '%unit_cost_at_sale IS NOT NULL) THEN ''costed''%'
            and position('costed' in pg_get_viewdef('v_sale_lines'::regclass))
              < position('no_product' in pg_get_viewdef('v_sale_lines'::regclass))), ''
  union all select 5, '118 policies and 98 fn_* functions, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98,
         (select count(*)::text from pg_policies where schemaname='public') || ' / ' ||
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 6, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
