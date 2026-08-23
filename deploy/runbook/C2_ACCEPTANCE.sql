-- ============================================================================
-- MENU MASTER NG — C2 PRODUCTION ACCEPTANCE CHECKLIST
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run ONLY AFTER PART 5. Every row must read PASS.
--
-- Three acceptance items CANNOT be proved from SQL and are marked
-- OPERATOR CHECK. They are dashboard checks, listed in the runbook.
-- ============================================================================

-- A script must never print PASS for something it did not check. Items 14-16
-- are dashboard facts, unreachable from SQL, and are labelled OPERATOR CHECK
-- so they cannot be mistaken for a verified result.
select item, observed,
       case when ord >= 14 then 'OPERATOR CHECK'
            when ok        then 'PASS'
            else '>>> FAIL' end as verdict
from (

  select 1 as ord, '1. migrations 0001-0018 present' as item,
         (select count(*)::text from (values
            (to_regclass('public.accounts') is not null),
            (exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='unit_kind' and e.enumlabel='container')),
            (to_regclass('public.catalog_ingredients') is not null),
            (exists (select 1 from pg_proc where proname='fn_can_see_costs' and pronargs=1)),
            (exists (select 1 from pg_proc where proname='fn_resolve_qty_to_base')),
            (exists (select 1 from pg_proc where proname='fn_post_purchase')),
            (exists (select 1 from pg_proc where proname='fn_compute_recipe_cost_snapshot')),
            (to_regclass('public.v_price_check') is not null),
            (to_regclass('public.v_profit_by_period') is not null),
            (exists (select 1 from pg_proc where proname='fn_create_account_and_business')),
            (exists (select 1 from pg_proc where proname='fn__recipe_cost_core')
             and not has_function_privilege('anon',
                   (select oid from pg_proc where proname='fn__recipe_cost_core' limit 1),'execute')),
            (exists (select 1 from pg_proc where proname='fn_is_service_context')),
            (exists (select 1 from pg_constraint where conname='ck_purchase_lines_amount_positive')),
            (exists (select 1 from pg_proc where proname='fn_void_order')),
            (exists (select 1 from pg_policies where tablename='recipes' and cmd='INSERT')),
            (exists (select 1 from pg_proc where proname='fn_require_cost_access')),
            (exists (select 1 from pg_constraint where conname='ck_subscriptions_status')),
            (exists (select 1 from pg_indexes where indexname='ux_subscriptions_account'))
          ) v(p) where p) || ' of 18 markers' as observed,
         (select count(*) from (values
            (to_regclass('public.accounts') is not null),
            (exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='unit_kind' and e.enumlabel='container')),
            (to_regclass('public.catalog_ingredients') is not null),
            (exists (select 1 from pg_proc where proname='fn_can_see_costs' and pronargs=1)),
            (exists (select 1 from pg_proc where proname='fn_resolve_qty_to_base')),
            (exists (select 1 from pg_proc where proname='fn_post_purchase')),
            (exists (select 1 from pg_proc where proname='fn_compute_recipe_cost_snapshot')),
            (to_regclass('public.v_price_check') is not null),
            (to_regclass('public.v_profit_by_period') is not null),
            (exists (select 1 from pg_proc where proname='fn_create_account_and_business')),
            (exists (select 1 from pg_proc where proname='fn__recipe_cost_core')
             and not has_function_privilege('anon',
                   (select oid from pg_proc where proname='fn__recipe_cost_core' limit 1),'execute')),
            (exists (select 1 from pg_proc where proname='fn_is_service_context')),
            (exists (select 1 from pg_constraint where conname='ck_purchase_lines_amount_positive')),
            (exists (select 1 from pg_proc where proname='fn_void_order')),
            (exists (select 1 from pg_policies where tablename='recipes' and cmd='INSERT')),
            (exists (select 1 from pg_proc where proname='fn_require_cost_access')),
            (exists (select 1 from pg_constraint where conname='ck_subscriptions_status')),
            (exists (select 1 from pg_indexes where indexname='ux_subscriptions_account'))
          ) v(p) where p) = 18 as ok

  union all select 2, '2. RLS enabled on every public table',
    (select count(*)::text from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity)
      || ' of ' || (select count(*)::text from pg_class where relnamespace='public'::regnamespace and relkind='r'),
    not exists (select 1 from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity)

  union all select 3, '3. UNGATED = 0 (TRUNCATE/TRIGGER/REFERENCES)',
    (select count(*)::text from information_schema.role_table_grants
      where table_schema='public' and grantee in ('anon','authenticated')
        and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')),
    not exists (select 1 from information_schema.role_table_grants
                 where table_schema='public' and grantee in ('anon','authenticated')
                   and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES'))

  union all select 4, '4. anon limited to 5 reference tables, SELECT only',
    coalesce((select string_agg(distinct table_name, ',' order by table_name)
                from information_schema.role_table_grants where table_schema='public' and grantee='anon'), 'NONE'),
    coalesce((select string_agg(distinct table_name, ',' order by table_name)
                from information_schema.role_table_grants where table_schema='public' and grantee='anon'), '')
      = 'catalog_categories,catalog_ingredients,plan_features,plans,units'
    and coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                from information_schema.role_table_grants where table_schema='public' and grantee='anon'), '') = 'SELECT'

  union all select 5, '5. default privileges revoked for client roles',
    coalesce((select string_agg(distinct defaclobjtype::text, ',') from pg_default_acl d
               where array_to_string(d.defaclacl, ',') similar to '%(anon|authenticated)%'), 'none'),
    not exists (select 1 from pg_default_acl d
                 where array_to_string(d.defaclacl, ',') similar to '%(anon|authenticated)%')

  union all select 6, '6. reference data matches verified baseline',
    'units='||(select count(*) from units)||' cat='||(select count(*) from catalog_categories)
      ||' ing='||(select count(*) from catalog_ingredients)||' plans='||(select count(*) from plans)
      ||' feat='||(select count(*) from plan_features),
    (select count(*) from units)=45 and (select count(*) from catalog_categories)=16
    and (select count(*) from catalog_ingredients)=180 and (select count(*) from plans)=3
    and (select count(*) from plan_features)=12

  union all select 7, '7. tenant tables empty',
    'accounts='||(select count(*) from accounts)||' businesses='||(select count(*) from businesses)
      ||' subs='||(select count(*) from subscriptions)||' ingredients='||(select count(*) from ingredients)
      ||' recipes='||(select count(*) from recipes)||' orders='||(select count(*) from orders),
    (select count(*) from accounts)=0 and (select count(*) from businesses)=0
    and (select count(*) from subscriptions)=0 and (select count(*) from ingredients)=0
    and (select count(*) from recipes)=0 and (select count(*) from orders)=0
    and (select count(*) from sales_entries)=0 and (select count(*) from purchases)=0

  union all select 8, '8. no test fixtures, users or accounts',
    'auth.users='||(select count(*) from auth.users)||' test tables='||
      coalesce((select string_agg(relname,',') from pg_class
                 where relnamespace='public'::regnamespace
                   and relname in ('fx','_test_results','_g1','_c1','_m1')),'none'),
    (select count(*) from auth.users)=0
    and not exists (select 1 from pg_class where relnamespace='public'::regnamespace
                     and relname in ('fx','_test_results','_g1','_c1','_m1'))
    and not exists (select 1 from accounts where name in ('Boundary A','Boundary B'))

  union all select 9, '9. no billing_events table',
    coalesce(to_regclass('public.billing_events')::text, 'absent'),
    to_regclass('public.billing_events') is null

  union all select 10, '10. no entitlement enforcement',
    case when exists (select 1 from pg_proc where proname like 'fn_account_is_entitled%')
         then 'fn_account_is_entitled EXISTS' else 'absent' end,
    not exists (select 1 from pg_proc where proname like 'fn_account_is_entitled%')

  union all select 11, '11. plan prices all zero',
    coalesce((select string_agg(id||'='||monthly_price, ', ') from plans where monthly_price <> 0), 'all zero'),
    not exists (select 1 from plans where monthly_price <> 0)

  union all select 12, '12. no scheduled jobs (pg_cron not enabled)',
    case when exists (select 1 from pg_extension where extname='pg_cron') then 'pg_cron INSTALLED'
         else 'pg_cron not installed' end,
    not exists (select 1 from pg_extension where extname='pg_cron')

  union all select 13, '13. billing fn closed to clients',
    'authenticated='||has_function_privilege('authenticated',
        (select oid from pg_proc where proname='fn_set_subscription_plan' limit 1),'execute')::text
      ||' anon='||has_function_privilege('anon',
        (select oid from pg_proc where proname='fn_set_subscription_plan' limit 1),'execute')::text,
    not has_function_privilege('authenticated',
        (select oid from pg_proc where proname='fn_set_subscription_plan' limit 1),'execute')
    and not has_function_privilege('anon',
        (select oid from pg_proc where proname='fn_set_subscription_plan' limit 1),'execute')

  -- Not SQL-checkable. Marked, not asserted.
  union all select 14, '14. no billing Edge Function',
    'DASHBOARD: Edge Functions list must be empty', false
  union all select 15, '15. no Paystack secrets configured',
    'DASHBOARD: Edge Functions > Secrets has no PAYSTACK_* entry', false
  union all select 16, '16. no webhook endpoint registered',
    'PAYSTACK DASHBOARD: no webhook URL points at this project', false
) as t
order by ord;
