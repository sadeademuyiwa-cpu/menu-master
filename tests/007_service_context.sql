-- ============================================================================
-- MENU MASTER NG
-- 007: service-context pre-flight and post-check
--
-- DISPOSABLE PROJECT ONLY. Never run against production.
-- READ ONLY: selects only. Nothing is inserted, updated, deleted or created.
--
-- Run AFTER deploy/PART_1..PART_5 and tests/006_supabase_boundary_fixtures.sql.
--
-- Part 1 confirms the starting state the S1-S13 matrix assumes.
-- Part 2 (bottom) is the post-Phase-B check: run it again afterwards to see
-- what the service_role key actually changed.
-- ============================================================================

-- ---- 1. plan flags -------------------------------------------------------
-- Only 'trial' may be self-served. If a paid plan were flagged self-serve, a
-- client could grant itself a paid entitlement through onboarding.
select '1_plans' as check,
       p.id                   as plan_id,
       p.is_active,
       p.is_self_serve_trial,
       case when p.id = 'trial' and p.is_self_serve_trial then 'OK'
            when p.id <> 'trial' and not p.is_self_serve_trial then 'OK'
            else '>>> WRONG' end as verdict
from plans p
order by p.id;

-- ---- 2. subscription starting state -------------------------------------
select '2_subscriptions' as check,
       a.name                as account_name,
       s.plan_id,
       s.status,
       count(*) over (partition by s.account_id) as rows_for_account,
       case when count(*) over (partition by s.account_id) = 1
             and s.status = 'trialing' and s.plan_id = 'trial'
            then 'OK' else '>>> UNEXPECTED' end as verdict
from subscriptions s
join accounts a on a.id = s.account_id
where a.name in ('Boundary A','Boundary B')
order by a.name;

-- ---- 3. the client-facing grant surface on subscriptions ----------------
-- 0012 revokes insert/update/delete from `authenticated`. Anything other than
-- SELECT appearing here means S2-S4 would be testing the trigger only, with
-- the grant layer already open.
select '3_grants' as check,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges,
       case when grantee = 'authenticated'
             and string_agg(privilege_type, ',' order by privilege_type) <> 'SELECT'
            then '>>> MORE THAN SELECT' else 'OK' end as verdict
from information_schema.role_table_grants
where table_name = 'subscriptions' and grantee in ('anon','authenticated')
group by grantee
order by grantee;

-- ---- 4. is the billing function closed to clients? ----------------------
select '4_billing_fn' as check,
       p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon',          p.oid, 'execute') as anon_can_execute,
       case when has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('anon', p.oid, 'execute')
            then '>>> CLIENT CAN CALL IT' else 'OK' end as verdict
from pg_proc p
where p.proname in ('fn_set_subscription_plan','fn_guard_subscription_writes');

-- ---- 5. integrity guards that DO NOT exist ------------------------------
-- Recorded deliberately. These are the gaps the S13 probe targets.
select '5_integrity' as check, item, present, note from (
  values
    ('subscriptions.status CHECK constraint',
     exists (select 1 from pg_constraint
              where conrelid = 'subscriptions'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) ilike '%status%'),
     'Without it, any string can be written as an entitlement state'),
    ('one-subscription-per-account unique index',
     exists (select 1 from pg_index i
              join pg_class c on c.oid = i.indexrelid
              where i.indrelid = 'subscriptions'::regclass and i.indisunique
                and pg_get_indexdef(i.indexrelid) ilike '%account_id%'),
     'Client duplicates are blocked by trigger only; service context is not')
) as t(item, present, note);

-- ============================================================================
-- POST-PHASE-B CHECK — run this block again after the service_role tests.
-- ============================================================================
select 'POST_B_subscriptions' as check,
       a.name as account_name, s.plan_id, s.status, s.current_period_end, s.provider_ref
from subscriptions s
join accounts a on a.id = s.account_id
order by a.name;
