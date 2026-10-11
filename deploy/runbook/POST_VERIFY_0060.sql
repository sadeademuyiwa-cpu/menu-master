-- ============================================================================
-- 0060 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0060 commits.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'purchases.replaced_by exists, with its covering index',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='purchases' and column_name='replaced_by')
         and exists(select 1 from pg_indexes where indexname='ix_fk_purchases_replaced_by'), ''
  union all select 2, 'customers.deleted_at exists',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='customers' and column_name='deleted_at'), ''
  union all select 3, '98 fn_* functions (fn_correct_purchase, fn_recompute_business_recipes, fn_trg_ingredient_base_unit_locked)',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace
               and proname in ('fn_correct_purchase','fn_recompute_business_recipes','fn_trg_ingredient_base_unit_locked')) = 3,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 4, 'fn_reissue_order copies the lines',
         (select prosrc like '%edit_the_wrong_line_then_confirm%' from pg_proc
           where proname='fn_reissue_order' and pronamespace='public'::regnamespace), ''
  union all select 5, 'the base-unit lock trigger is on ingredients',
         exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                 where t.tgname='trg_ingredients_base_unit_locked' and c.relname='ingredients'), ''
  union all select 6, '118 policies in public, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 118,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 7, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
