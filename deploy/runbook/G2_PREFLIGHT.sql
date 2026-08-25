-- ============================================================================
-- MENU MASTER NG -- GATE 2 PREFLIGHT
--
-- READ ONLY. Pure SELECT. No DDL, no DML, no transaction required.
-- Nothing in this file writes, and nothing in it depends on Gate 2 having
-- been applied. Safe to run repeatedly.
--
-- Purpose: establish the exact baseline that migration 0021 will be built
-- against, prove every Gate 2 dependency already exists, prove no Gate 2
-- object name is already taken, and confirm the C1-C5 production state is
-- still intact.
--
-- Run in the Supabase SQL Editor as one statement. Read every VERDICT column.
-- ANY 'STOP' means do not proceed to 0021.
-- ============================================================================

with

-- ---------------------------------------------------------------- 1. context
shape as (
  select
    (select count(*) from pg_proc
      where pronamespace='public'::regnamespace and proname like 'fn\_%')  as fns,
    (select count(*) from pg_class
      where relnamespace='public'::regnamespace
        and relkind in ('r','p','v','m','f'))                              as rels,
    (select count(*) from pg_policies where schemaname='public')           as pols
),

-- name collisions: every object 0021 intends to create must be ABSENT today
g2_new_tables(t) as (
  values ('serving_formats'),('recipe_variants'),
         ('serving_format_packaging'),('serving_format_changes')
),
g2_new_cols(t,c) as (
  values ('business_settings','overhead_basis_qty'),
         ('business_settings','overhead_basis_unit_id'),
         ('cost_snapshots','variant_id'),
         ('cost_snapshots','resolved_qty'),
         ('cost_snapshots','resolved_unit_id'),
         ('cost_snapshots','basis_used'),
         ('cost_snapshots','format_packaging_cost'),
         ('recipe_prices','variant_id'),
         ('order_lines','variant_id'),
         ('sales_entries','variant_id')
),

-- dependencies 0021 relies on and does not create
dep_fns(f) as (
  values ('fn_is_account_member'),('fn_can_see_costs'),
         ('fn_require_member'),('fn_require_cost_access'),
         ('fn_assert_unit_visible'),('fn_can_resolve_unit'),
         ('fn_resolve_qty_to_base')
),
dep_tables(t) as (
  values ('accounts'),('businesses'),('business_settings'),('units'),
         ('ingredients'),('recipes'),('recipe_lines'),('recipe_prices'),
         ('cost_snapshots'),('order_lines'),('sales_entries')
)

-- ============================================================================
select * from (

-- ---------------------------------------------------------------- 1. context
select 1 as n, 'server major version' as check,
       current_setting('server_version') as observed,
       case when current_setting('server_version_num')::int >= 170000
            then 'GO' else 'STOP -- expected PostgreSQL 17.x' end as verdict
union all
select 2, 'current_user is the owning role',
       current_user::text,
       case when current_user::text = 'postgres' then 'GO'
            else 'STOP -- run this as postgres' end

-- --------------------------------------------------- 2. baseline schema shape
union all
select 3, 'fn_* functions in public (0021 baseline)',
       fns::text, case when fns = 40 then 'GO'
                       else 'STOP -- baseline is 40; schema has drifted' end
  from shape
union all
select 4, 'relations in public (0021 baseline)',
       rels::text, case when rels = 44 then 'GO'
                        else 'STOP -- baseline is 44; schema has drifted' end
  from shape
union all
select 5, 'policies in public (0021 baseline)',
       pols::text, case when pols = 93 then 'GO'
                        else 'STOP -- baseline is 93; schema has drifted' end
  from shape
union all
select 6, 'RLS enabled on every base table',
       (select count(*)::text from pg_class
         where relnamespace='public'::regnamespace and relkind='r'
           and not relrowsecurity) || ' table(s) without RLS',
       case when not exists (select 1 from pg_class
                              where relnamespace='public'::regnamespace
                                and relkind='r' and not relrowsecurity)
            then 'GO' else 'STOP' end

-- --------------------------------------------- 3. C1-C5 production invariants
union all
select 7, 'onboarding RPC is the 0020 nine-argument version',
       (select count(*)::text from pg_proc
         where pronamespace='public'::regnamespace
           and proname='fn_create_account_and_business' and pronargs=9),
       case when (select count(*) from pg_proc
                   where pronamespace='public'::regnamespace
                     and proname='fn_create_account_and_business'
                     and pronargs=9) = 1
            then 'GO' else 'STOP -- 0020 is not in place' end
union all
select 8, 'handle_new_user is still the 0019c no-op',
       case when exists (select 1 from pg_proc
                          where pronamespace='public'::regnamespace
                            and proname='handle_new_user'
                            and prosrc like '%insert into vendors%')
            then 'still references vendors'
            else 'neutralised' end,
       case when exists (select 1 from pg_proc
                          where pronamespace='public'::regnamespace
                            and proname='handle_new_user'
                            and prosrc like '%insert into vendors%')
            then 'STOP -- the signup outage has returned' else 'GO' end
union all
select 9, 'last-owner guard present and ENABLED',
       coalesce((select t.tgenabled::text from pg_trigger t
                  join pg_class c on c.oid=t.tgrelid
                 where c.relname='memberships'
                   and t.tgname='trg_memberships_last_owner'
                   and not t.tgisinternal), 'MISSING'),
       case when (select t.tgenabled from pg_trigger t
                   join pg_class c on c.oid=t.tgrelid
                  where c.relname='memberships'
                    and t.tgname='trg_memberships_last_owner'
                    and not t.tgisinternal) = 'O'
            then 'GO' else 'STOP -- C5 left the guard disabled' end
union all
select 10, 'auth.users (five protected users, nothing else)',
       (select count(*)::text from auth.users),
       case when (select count(*) from auth.users) = 5
            then 'GO' else 'STOP -- expected exactly 5 after C5' end
union all
select 11, 'tenant tables are empty (C5 closed)',
       (select count(*)::text from accounts) || ' account(s)',
       case when (select count(*) from accounts) = 0
            then 'GO' else 'OPERATOR CHECK -- real tenants now exist' end
union all
select 12, 'anon SELECT surface is the five reference tables only',
       (select count(distinct table_name)::text
          from information_schema.role_table_grants
         where grantee='anon' and table_schema='public'),
       case when (select count(distinct table_name)
                    from information_schema.role_table_grants
                   where grantee='anon' and table_schema='public') = 5
            then 'GO' else 'STOP -- the 0018 anon surface has changed' end
union all
select 13, 'anon holds EXECUTE on no fn_* function',
       (select count(*)::text from pg_proc p
         where p.pronamespace='public'::regnamespace
           and p.proname like 'fn\_%'
           and has_function_privilege('anon', p.oid, 'EXECUTE')),
       case when (select count(*) from pg_proc p
                   where p.pronamespace='public'::regnamespace
                     and p.proname like 'fn\_%'
                     and has_function_privilege('anon', p.oid, 'EXECUTE')) = 0
            then 'GO' else 'STOP' end

-- ------------------------------------------------------- 4. Gate 2 dependencies
union all
select 14, 'dependency functions present (7 expected)',
       (select count(*)::text from dep_fns d
         where exists (select 1 from pg_proc
                        where pronamespace='public'::regnamespace
                          and proname = d.f)),
       case when (select count(*) from dep_fns d
                   where exists (select 1 from pg_proc
                                  where pronamespace='public'::regnamespace
                                    and proname = d.f)) = 7
            then 'GO' else 'STOP -- a Gate 2 dependency is missing' end
union all
select 15, 'dependency tables present (11 expected)',
       (select count(*)::text from dep_tables d
         where to_regclass('public.'||d.t) is not null),
       case when (select count(*) from dep_tables d
                   where to_regclass('public.'||d.t) is not null) = 11
            then 'GO' else 'STOP' end
union all
select 16, 'unit_kind includes container (0002)',
       (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e join pg_type t on t.oid=e.enumtypid
         where t.typname='unit_kind'),
       case when exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                          where t.typname='unit_kind' and e.enumlabel='container')
            then 'GO' else 'STOP -- D3 capacity basis needs container' end
union all
select 17, 'exclusion_reason enum reusable for format packaging',
       (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e join pg_type t on t.oid=e.enumtypid
         where t.typname='exclusion_reason'),
       case when exists (select 1 from pg_type where typname='exclusion_reason')
            then 'GO' else 'STOP' end
union all
select 18, 'item_kind has packaging (D4 dependency)',
       (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e join pg_type t on t.oid=e.enumtypid
         where t.typname='item_kind'),
       case when exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                          where t.typname='item_kind' and e.enumlabel='packaging')
            then 'GO' else 'STOP' end
union all
select 19, 'recipes.portion_qty present (Phase 2 backfill source)',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='recipes'
                            and column_name='portion_qty')
            then 'present' else 'ABSENT' end,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='recipes'
                            and column_name='portion_qty')
            then 'GO' else 'STOP -- backfill has no source' end
union all
select 20, 'business_settings.overhead_enabled present (D1 dependency)',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public'
                            and table_name='business_settings'
                            and column_name='overhead_enabled')
            then 'present' else 'ABSENT' end,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public'
                            and table_name='business_settings'
                            and column_name='overhead_enabled')
            then 'GO' else 'STOP' end

-- ------------------------------------------- 5. composite-key prerequisites
union all
select 21, 'ux_businesses_id_account exists (0004)',
       case when exists (select 1 from pg_constraint
                          where conname='ux_businesses_id_account')
            then 'present' else 'ABSENT' end,
       case when exists (select 1 from pg_constraint
                          where conname='ux_businesses_id_account')
            then 'GO' else 'STOP' end
union all
select 22, 'ux_ingredients_id_account exists (0004)',
       case when exists (select 1 from pg_constraint
                          where conname='ux_ingredients_id_account')
            then 'present' else 'ABSENT' end,
       case when exists (select 1 from pg_constraint
                          where conname='ux_ingredients_id_account')
            then 'GO' else 'STOP' end
union all
select 23, 'unique (id, business_id) on recipes -- 0021 MUST ADD IT',
       case when exists (
              select 1 from pg_constraint c
               where c.conrelid='public.recipes'::regclass
                 and c.contype in ('u','p')
                 and (select array_agg(a.attname::text order by a.attname)
                        from unnest(c.conkey) k
                        join pg_attribute a
                          on a.attrelid=c.conrelid and a.attnum=k)
                     = array['business_id','id'])
            then 'already present' else 'absent, as expected' end,
       'INFORMATIONAL -- recipe_variants needs this composite FK target'

-- ------------------------------------------------ 6. Gate 2 name collisions
union all
select 24, 'none of the four Gate 2 tables already exist',
       coalesce((select string_agg(t, ', ') from g2_new_tables
                  where to_regclass('public.'||t) is not null), 'none'),
       case when not exists (select 1 from g2_new_tables
                              where to_regclass('public.'||t) is not null)
            then 'GO' else 'STOP -- 0021 would collide' end
union all
select 25, 'variant_costing_basis type does not exist yet',
       case when exists (select 1 from pg_type where typname='variant_costing_basis')
            then 'ALREADY EXISTS' else 'absent' end,
       case when exists (select 1 from pg_type where typname='variant_costing_basis')
            then 'STOP -- 0021 would collide' else 'GO' end
union all
select 26, 'none of the ten new columns already exist',
       coalesce((select string_agg(t||'.'||c, ', ') from g2_new_cols n
                  where exists (select 1 from information_schema.columns
                                 where table_schema='public'
                                   and table_name=n.t and column_name=n.c)),
                'none'),
       case when not exists (select 1 from g2_new_cols n
                              where exists (select 1 from information_schema.columns
                                             where table_schema='public'
                                               and table_name=n.t
                                               and column_name=n.c))
            then 'GO' else 'STOP -- 0021 would collide' end
union all
select 27, '0021 marker absent (migration not yet applied)',
       case when exists (select 1 from pg_class
                          where relnamespace='public'::regnamespace
                            and relname='serving_formats')
            then 'APPLIED' else 'not applied' end,
       case when exists (select 1 from pg_class
                          where relnamespace='public'::regnamespace
                            and relname='serving_formats')
            then 'STOP' else 'GO' end

-- ------------------------------------- 7. data preconditions for later phases
union all
select 28, 'recipes needing a Phase 2 backfill variant',
       (select count(*)::text from recipes where portion_qty is not null),
       'INFORMATIONAL -- one recipe_variants row each in 0022'
union all
select 29, 'recipes with NULL portion_qty (no honest backfill source)',
       (select count(*)::text from recipes where portion_qty is null),
       'INFORMATIONAL -- these get NO variant; nothing is invented'
union all
select 30, 'businesses with overhead_enabled = true (D1 exposure)',
       (select count(*)::text from business_settings where overhead_enabled),
       case when (select count(*) from business_settings where overhead_enabled) = 0
            then 'GO -- no live business is affected by D1'
            else 'OPERATOR CHECK -- these must supply an overhead basis' end
union all
select 31, 'existing complete cost_snapshots (chk_complete_requires_resolution)',
       (select count(*)::text from cost_snapshots where is_complete),
       case when (select count(*) from cost_snapshots where is_complete) = 0
            then 'GO -- constraint can be added VALID'
            else 'STOP -- add it NOT VALID or backfill resolved_qty first' end

) rows order by n;
