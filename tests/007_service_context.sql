-- ============================================================================
-- MENU MASTER NG
-- 007: service-context pre-flight
--
-- DISPOSABLE PROJECT ONLY. Never run against production.
-- READ ONLY: one SELECT. Nothing inserted, updated, deleted or created.
--
-- Run AFTER deploy/PART_1..PART_5 and tests/006_supabase_boundary_fixtures.sql.
-- Confirms the starting state the S1-S13 matrix assumes.
--
-- Emits ONE result set, because the Supabase SQL Editor only renders the last
-- one. Every row must read OK except section 5, which deliberately records two
-- guards as absent-or-present so their state is visible either way.
-- ============================================================================

with

-- 1. Only 'trial' may be self-served. A paid plan flagged self-serve would let
--    a client grant itself a paid entitlement through onboarding.
plan_flags as (
  select '1 plans' as section,
         p.id as item,
         'active=' || p.is_active || ' self_serve_trial=' || p.is_self_serve_trial as detail,
         case when (p.id = 'trial') = p.is_self_serve_trial then 'OK'
              else '>>> WRONG' end as verdict
  from plans p
),

-- 2. Each fixture account starts with exactly one trialing subscription.
--    Emits a row per expected account whether or not it exists, so a MISSING
--    fixture is visible rather than an absent row nobody notices.
subs as (
  select '2 subscriptions' as section,
         e.name as item,
         coalesce((select s.plan_id || ' / ' || s.status
                     from subscriptions s join accounts a on a.id = s.account_id
                    where a.name = e.name limit 1), 'NO SUBSCRIPTION')
           || ' / ' || (select count(*) from subscriptions s
                          join accounts a on a.id = s.account_id
                         where a.name = e.name) || ' row(s)' as detail,
         case when (select count(*) from subscriptions s
                      join accounts a on a.id = s.account_id
                     where a.name = e.name and s.status = 'trialing'
                       and s.plan_id = 'trial') = 1
               and (select count(*) from subscriptions s
                      join accounts a on a.id = s.account_id
                     where a.name = e.name) = 1
              then 'OK' else '>>> UNEXPECTED' end as verdict
  from (values ('Boundary A'),('Boundary B')) as e(name)
),

-- 3. 0012 revokes insert/update/delete on subscriptions from `authenticated`.
--    Anything beyond SELECT means S2-S4 would be testing the trigger only,
--    with the grant layer already open.
--    anon should hold NOTHING, so its row must read 'none'.
grants as (
  select '3 client grants' as section,
         r.role as item,
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                     from information_schema.role_table_grants g
                    where g.table_name = 'subscriptions' and g.grantee = r.role), 'none') as detail,
         case when r.role = 'authenticated' and coalesce((select string_agg(g.privilege_type, ',' order by g.privilege_type)
                     from information_schema.role_table_grants g
                    where g.table_name = 'subscriptions' and g.grantee = r.role), 'none') = 'SELECT' then 'OK'
              when r.role = 'anon' and not exists (select 1 from information_schema.role_table_grants g
                    where g.table_name = 'subscriptions' and g.grantee = r.role) then 'OK'
              else '>>> UNEXPECTED' end as verdict
  from (values ('anon'),('authenticated')) as r(role)
),

-- 4. The billing function must be closed to every client role.
billing_fn as (
  select '4 billing fn' as section,
         p.proname as item,
         'authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
           || ' anon=' || has_function_privilege('anon', p.oid, 'execute') as detail,
         case when has_function_privilege('authenticated', p.oid, 'execute')
               or has_function_privilege('anon', p.oid, 'execute')
              then '>>> CLIENT CAN CALL IT' else 'OK' end as verdict
  from pg_proc p
  where p.proname in ('fn_set_subscription_plan','fn_guard_subscription_writes')
),

-- 5. The 0017 protections. Present = the migration landed.
integrity as (
  select '5 integrity (0017)' as section, item,
         case when present then 'present' else 'ABSENT' end as detail,
         case when present then 'OK' else '>>> 0017 NOT APPLIED' end as verdict
  from (
    values
      ('subscriptions.status CHECK constraint',
       exists (select 1 from pg_constraint
                where conrelid = 'subscriptions'::regclass
                  and conname  = 'ck_subscriptions_status')),
      ('one-subscription-per-account unique index',
       exists (select 1 from pg_indexes
                where indexname = 'ux_subscriptions_account')),
      ('fn_set_subscription_plan checks ROW_COUNT',
       exists (select 1 from pg_proc
                where proname = 'fn_set_subscription_plan'
                  and prosrc ilike '%get diagnostics%row_count%'))
  ) as t(item, present)
),

-- 6. The fixture asymmetry every attack depends on.
fixtures as (
  select '6 fixtures' as section,
         e.name as item,
         case when not exists (select 1 from accounts a where a.name = e.name)
              then 'ACCOUNT MISSING'
              else (select count(ip.id) from ingredient_prices ip
                      join accounts a on a.id = ip.account_id
                     where a.name = e.name and ip.reversed_at is null)::text
                   || ' price row(s)' end as detail,
         case when e.name = 'Boundary A'
               and (select count(ip.id) from ingredient_prices ip
                      join accounts a on a.id = ip.account_id
                     where a.name = e.name and ip.reversed_at is null) = 1 then 'OK'
              when e.name = 'Boundary B'
               and (select count(ip.id) from ingredient_prices ip
                      join accounts a on a.id = ip.account_id
                     where a.name = e.name and ip.reversed_at is null) = 0
               and exists (select 1 from accounts a where a.name = e.name) then 'OK'
              else '>>> WRONG' end as verdict
  from (values ('Boundary A'),('Boundary B')) as e(name)
)

select section, item, detail, verdict from plan_flags
union all select * from subs
union all select * from grants
union all select * from billing_fn
union all select * from integrity
union all select * from fixtures
order by section, item;
