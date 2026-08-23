-- ============================================================================
-- MENU MASTER NG — C2 CHECKPOINT: STRUCTURE
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Safe at ANY point in the deployment, including before PART_1: it references
-- no application table by name, only system catalogues.
--
-- Run after EVERY part. Compare against the runbook's expected values for the
-- part you just ran.
-- ============================================================================

select * from (

  select 'A markers' as section, m.item,
         case when m.present then 'present' else 'ABSENT' end as observed
  from (values
    ('0001 accounts table',      to_regclass('public.accounts') is not null),
    ('0001 units table',         to_regclass('public.units') is not null),
    ('0002 container unit kind', exists (select 1 from pg_enum e join pg_type ty on ty.oid=e.enumtypid
                                          where ty.typname='unit_kind' and e.enumlabel='container')),
    ('0003 catalog_ingredients', to_regclass('public.catalog_ingredients') is not null),
    ('0004 fn_can_see_costs(uuid)', exists (select 1 from pg_proc where proname='fn_can_see_costs' and pronargs=1)),
    ('0005 fn_resolve_qty_to_base', exists (select 1 from pg_proc where proname='fn_resolve_qty_to_base')),
    ('0006 fn_post_purchase',    exists (select 1 from pg_proc where proname='fn_post_purchase')),
    ('0007 fn_compute_recipe_cost_snapshot', exists (select 1 from pg_proc where proname='fn_compute_recipe_cost_snapshot')),
    ('0008 v_price_check',       to_regclass('public.v_price_check') is not null),
    ('0009 v_profit_by_period',  to_regclass('public.v_profit_by_period') is not null),
    ('0010 fn_create_account_and_business', exists (select 1 from pg_proc where proname='fn_create_account_and_business')),
    -- NOT "anon can select units": Supabase's default privileges make that true
    -- from PART_1, before 0011 has run. 0011's distinctive effect is REVOKING
    -- execute on the costing internals, which nothing else does.
    ('0011 costing internals closed to anon',
       exists (select 1 from pg_proc where proname='fn__recipe_cost_core')
       and not has_function_privilege('anon',
             (select oid from pg_proc where proname='fn__recipe_cost_core' limit 1),'execute')),
    ('0012 fn_is_service_context', exists (select 1 from pg_proc where proname='fn_is_service_context')),
    ('0013 zero-amount check',   exists (select 1 from pg_constraint where conname='ck_purchase_lines_amount_positive')),
    ('0014 fn_void_order',       exists (select 1 from pg_proc where proname='fn_void_order')),
    ('0015 per-command policies', exists (select 1 from pg_policies where tablename='recipes' and cmd='INSERT')),
    ('0016 fn_require_cost_access', exists (select 1 from pg_proc where proname='fn_require_cost_access')),
    ('0017 status CHECK',        exists (select 1 from pg_constraint where conname='ck_subscriptions_status')),
    ('0017 one-sub index',       exists (select 1 from pg_indexes where indexname='ux_subscriptions_account')),
    ('0017 ROW_COUNT guard',     exists (select 1 from pg_proc where proname='fn_set_subscription_plan'
                                          and prosrc ilike '%get diagnostics%row_count%')),
    ('0018 defaults revoked',    to_regclass('public.accounts') is not null
                                 and not exists (select 1 from pg_default_acl d
                                       where array_to_string(d.defaclacl, ',') similar to '%(anon|authenticated)%'))
  ) as m(item, present)

  union all select 'B objects', 'tables',
    (select count(*)::text from pg_class where relnamespace='public'::regnamespace and relkind='r')
  union all select 'B objects', 'views',
    (select count(*)::text from pg_class where relnamespace='public'::regnamespace and relkind='v')
  union all select 'B objects', 'functions',
    (select count(*)::text from pg_proc where pronamespace='public'::regnamespace)

  union all select 'C grants', 'anon: tables',
    coalesce((select string_agg(distinct table_name, ', ' order by table_name)
                from information_schema.role_table_grants
               where table_schema='public' and grantee='anon'), 'NONE')
  union all select 'C grants', 'anon: privileges',
    coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                from information_schema.role_table_grants
               where table_schema='public' and grantee='anon'), 'NONE')
  union all select 'C grants', 'authenticated: privileges',
    coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                from information_schema.role_table_grants
               where table_schema='public' and grantee='authenticated'), 'NONE')
  union all select 'C grants', '>>> UNGATED (TRUNCATE/TRIGGER/REFERENCES)',
    (select count(*)::text from information_schema.role_table_grants
      where table_schema='public' and grantee in ('anon','authenticated')
        and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES'))
  union all select 'C grants', 'default privileges for client roles',
    coalesce((select string_agg(distinct defaclobjtype::text, ',') from pg_default_acl d
               where array_to_string(d.defaclacl, ',') similar to '%(anon|authenticated)%'), 'none')
  union all select 'C grants', 'fingerprint',
    coalesce((select substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type,'|'
                     order by grantee, table_name, privilege_type)),1,12)
                from information_schema.role_table_grants
               where table_schema='public' and grantee in ('anon','authenticated')), 'n/a')

  union all select 'D RLS', '>>> tables with RLS DISABLED',
    coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_class c
               where c.relnamespace='public'::regnamespace and c.relkind='r'
                 and not c.relrowsecurity), 'none — all enabled')
  union all select 'D RLS', 'tables with RLS enabled',
    (select count(*)::text from pg_class c where c.relnamespace='public'::regnamespace
      and c.relkind='r' and c.relrowsecurity)

) as chk order by section, item;
