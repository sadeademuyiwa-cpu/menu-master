-- ============================================================================
-- MENU MASTER NG — function-count reconciliation
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- The runbook's "functions" expectation was measured on a local database
-- where pgcrypto lives in the PUBLIC schema. On Supabase pgcrypto lives in
-- EXTENSIONS, so a raw count of public functions is not comparable. This
-- separates our functions from extension-owned ones and lists ours by name.
-- ============================================================================

select * from (
  select '1 totals' as section, 'all functions in public' as item,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace) as observed
  union all
  select '1 totals', 'owned by an extension',
         (select count(*)::text from pg_proc p
           where p.pronamespace='public'::regnamespace
             and exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e'))
  union all
  select '1 totals', '>>> OURS (extension-owned excluded)',
         (select count(*)::text from pg_proc p
           where p.pronamespace='public'::regnamespace
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e'))
  union all
  select '2 extensions', 'pgcrypto schema',
         coalesce((select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace
                    where e.extname='pgcrypto'), 'not installed')
  union all
  select '2 extensions', 'extensions with functions in public',
         coalesce((select string_agg(distinct e.extname, ', ') from pg_proc p
                    join pg_depend d on d.objid=p.oid and d.deptype='e'
                    join pg_extension e on e.oid=d.refobjid
                   where p.pronamespace='public'::regnamespace), 'none')
  union all
  select '3 ours', 'names not starting fn_',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
                      and p.proname not like 'fn\_%'), 'none — all are fn_*')
  union all
  select '3 ours', 'fn_ function count',
         (select count(*)::text from pg_proc p
           where p.pronamespace='public'::regnamespace
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
             and p.proname like 'fn\_%')
  union all
  select '4 markers', 'migration markers present',
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
              and not has_function_privilege('anon',(select oid from pg_proc where proname='fn__recipe_cost_core' limit 1),'execute')),
           (exists (select 1 from pg_proc where proname='fn_is_service_context')),
           (exists (select 1 from pg_constraint where conname='ck_purchase_lines_amount_positive')),
           (exists (select 1 from pg_proc where proname='fn_void_order')),
           (exists (select 1 from pg_policies where tablename='recipes' and cmd='INSERT')),
           (exists (select 1 from pg_proc where proname='fn_require_cost_access')),
           (exists (select 1 from pg_constraint where conname='ck_subscriptions_status')),
           (exists (select 1 from pg_indexes where indexname='ux_subscriptions_account')),
           (exists (select 1 from pg_proc where proname='fn_set_subscription_plan' and prosrc ilike '%get diagnostics%row_count%'))
         ) v(p) where p) || ' of 19'
) as t order by 1, 2;
