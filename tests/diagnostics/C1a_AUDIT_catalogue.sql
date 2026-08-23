-- ============================================================================
-- MENU MASTER NG — C1a: PRODUCTION AUDIT, part 1 of 2 (CATALOGUE)
--
--   *** PURE SELECT. NO SESSION OR DATABASE STATE IS CHANGED. ***
--
-- One statement: a single SELECT over system catalogues and information_schema.
-- No DO block, no set_config, no dynamic SQL, no SET, no RESET, no temp
-- objects, no advisory locks, no nextval, no CALL, no DDL, no DML.
--
-- Safe on ANY project in ANY state, because it references no application table
-- by name. A static reference to a missing table fails at PARSE time, which is
-- why the row counts live in C1b and are run only once this script confirms
-- the schema exists.
--
-- Credential: the Supabase SQL Editor's default session (postgres). No
-- service_role key. Reads no personal data.
-- ============================================================================

select * from (

  -- ---- A. which migrations have ever landed here? -------------------------
  select 'A migration chain' as section, m.item,
         case when m.present then 'present' else 'ABSENT' end as observed,
         m.means as interpretation
  from (values
    ('0001 accounts table',
      to_regclass('public.accounts') is not null,          'core schema'),
    ('0002 container unit kind',
      exists (select 1 from pg_enum e join pg_type ty on ty.oid = e.enumtypid
               where ty.typname = 'unit_kind' and e.enumlabel = 'container'),
                                                            'ALTER TYPE applied'),
    ('0004 fn_can_see_costs(uuid)',
      exists (select 1 from pg_proc
               where proname = 'fn_can_see_costs' and pronargs = 1),
                                                            'account-scoped cost gate'),
    ('0012 fn_is_service_context',
      exists (select 1 from pg_proc where proname = 'fn_is_service_context'),
                                                            'Gate 1 hardening'),
    ('0013 zero-amount check',
      exists (select 1 from pg_constraint
               where conname = 'ck_purchase_lines_amount_positive'),
                                                            'no free ingredients'),
    ('0014 fn_void_order',
      exists (select 1 from pg_proc where proname = 'fn_void_order'),
                                                            'void-and-reissue'),
    ('0016 fn_require_cost_access',
      exists (select 1 from pg_proc where proname = 'fn_require_cost_access'),
                                                            'role fn permissions'),
    ('0017 status CHECK',
      exists (select 1 from pg_constraint where conname = 'ck_subscriptions_status'),
                                                            'closed state set'),
    ('0017 one-sub-per-account index',
      exists (select 1 from pg_indexes where indexname = 'ux_subscriptions_account'),
                                                            'billing integrity'),
    ('0017 ROW_COUNT guard',
      exists (select 1 from pg_proc where proname = 'fn_set_subscription_plan'
               and prosrc ilike '%get diagnostics%row_count%'),
                                                            'no silent no-op'),
    -- Guarded on 0001: without it, a project with no tables has no anon grants
    -- to be wrong, and would report 0018 as present.
    ('0018 anon reference-only',
      to_regclass('public.accounts') is not null
      and not exists (select 1 from information_schema.role_table_grants
                       where table_schema = 'public' and grantee = 'anon'
                         and table_name not in ('units','catalog_categories',
                             'catalog_ingredients','plans','plan_features')),
                                                            'grant hardening')
  ) as m(item, present, means)

  -- ---- B(partial). write activity, from the statistics collector ----------
  union all
  select 'B data volume', 'lifetime writes (public)',
         coalesce((select sum(n_tup_ins + n_tup_upd + n_tup_del)::text
                     from pg_stat_user_tables where schemaname = 'public'), '0'),
         'BEST EFFORT ONLY: stats can be reset or unflushed. 0 here does NOT prove nothing was written -- trust C1b row counts instead'

  -- ---- C. does the 0018 exposure exist on production? ---------------------
  union all
  select 'C grant surface', 'anon: tables',
         coalesce((select string_agg(distinct table_name, ', ' order by table_name)
                     from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'anon'), 'NONE'),
         'expect 5 reference tables only after 0018'
  union all
  select 'C grant surface', 'anon: privileges',
         coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                     from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'anon'), 'NONE'),
         'SELECT only after 0018'
  union all
  select 'C grant surface', 'authenticated: privileges',
         coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                     from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'authenticated'), 'NONE'),
         'no TRUNCATE/TRIGGER/REFERENCES after 0018'
  union all
  select 'C grant surface', '>>> UNGATED (TRUNCATE/TRIGGER/REFERENCES)',
         (select count(*)::text from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon','authenticated')
             and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')),
         'NOT gated by RLS. Non-zero = the 0018 exposure is present here'
  union all
  select 'C grant surface', 'fingerprint',
         coalesce((select substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type, '|'
                            order by grantee, table_name, privilege_type)), 1, 12)
                     from information_schema.role_table_grants
                    where table_schema = 'public' and grantee in ('anon','authenticated')), 'n/a'),
         'baseline to compare against after any change'
  union all
  select 'C grant surface', 'default privileges for client roles',
         coalesce((select string_agg(distinct defaclobjtype::text, ',')
                     from pg_default_acl d
                    where array_to_string(d.defaclacl, ',') similar to '%(anon|authenticated)%'), 'none'),
         'r=tables f=functions S=sequences; present => new objects still inherit'

  -- ---- E. RLS posture ------------------------------------------------------
  union all
  select 'E RLS', '>>> tables with RLS DISABLED',
         coalesce((select string_agg(c.relname, ', ' order by c.relname)
                     from pg_class c
                    where c.relnamespace = 'public'::regnamespace
                      and c.relkind = 'r' and not c.relrowsecurity),
                  'none — all enabled'),
         'any application table here is a tenant-isolation hole. fx, _test_results, _g1, _c1 or _m1 appearing means the TEST SUITES were run against this project -- on production that is itself a finding'

  -- ---- F. what is connected right now -------------------------------------
  union all
  select 'F connections', 'current sessions',
         coalesce((select string_agg(distinct coalesce(nullif(a.application_name,''), '(unnamed)')
                                     || ' as ' || a.usename, ', ')
                     from pg_stat_activity a where a.datname = current_database()), 'none'),
         'snapshot only: shows what is connected AT THIS MOMENT'

) as audit
order by section, item;
