-- ============================================================================
-- DIAGNOSE_LIVE_STATE.sql        READ ONLY -- a single SELECT. Changes nothing.
--
-- Production reported the 0048 catalogue after an execution that was supposed
-- to be atomic. The counts in PRE_DEPLOY_AUDIT cannot tell 0047 from 0048:
-- they are IDENTICAL at both (70 functions, 23 views, 36 triggers, 41 tables,
-- 116 policies, fingerprint e24f3871788893cafd1fc17c70fe41d5), because 0048
-- creates no objects -- it only moves EXECUTE privileges.
--
-- The GRANT SURFACE is the only thing that separates them:
--        at 0047   9 fn_* are executable by PUBLIC, 1 by anon
--        at 0048   0 and 0
-- Measured on local replicas of both.
--
-- Rows 1-4 settle where production actually is. Rows 5-11 confirm the seven
-- login accounts and the empty business baseline are untouched. Row 12 is the
-- verdict in plain English.
-- ============================================================================
with g as (
  select
    (select count(*) from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
        and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a
                                          where a.grantee=0 and a.privilege_type='EXECUTE'))) as pub,
    (select count(*) from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
        and exists (select 1 from aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
                     where r.rolname='anon' and a.privilege_type='EXECUTE')) as anon,
    (select count(*) from unnest(array[
        'fn_ingredient_cost_basis(uuid,uuid,date)','fn_overhead_breakdown(uuid,uuid)',
        'fn_overhead_problem(uuid,uuid)','fn_allocate_order_discount(uuid)','fn_confirm_order(uuid)',
        'fn_frozen_sale_cost(uuid,uuid,uuid)','fn_variant_cost_components(uuid)']) f
      where to_regprocedure(f) is not null
        and has_function_privilege('authenticated', to_regprocedure(f), 'execute')) as seven
)
select 1 as line, '0047 marker: v_sale_lines exists' as item,
       (exists(select 1 from pg_views where schemaname='public' and viewname='v_sale_lines'))::text as value
union all
select 2, '0048 revoke pass ran: fn_* executable by PUBLIC (0047 = 9, 0048 = 0)', pub::text from g
union all
select 3, '0048 revoke pass ran: fn_* executable by anon (0047 = 1, 0048 = 0)', anon::text from g
union all
select 4, '0048 grant pass ran: of the 7 app functions, callable by authenticated (expect 7)', seven::text from g
union all
select 5, 'AUTH: login accounts (must be 7)', (select count(*)::text from auth.users)
union all
select 6, 'AUTH: accounts created in the last 24h (must be 0)',
       (select count(*)::text from auth.users where created_at > now() - interval '24 hours')
union all
select 7, 'baseline: orders / order_lines', (select count(*)::text from orders)||' / '||(select count(*)::text from order_lines)
union all
select 8, 'baseline: customers / cost_snapshots', (select count(*)::text from customers)||' / '||(select count(*)::text from cost_snapshots)
union all
select 9, 'baseline: accounts / businesses', (select count(*)::text from accounts)||' / '||(select count(*)::text from businesses)
union all
select 10,'baseline: recipes / ingredients', (select count(*)::text from recipes)||' / '||(select count(*)::text from ingredients)
union all
select 11,'baseline: total revenue recognised', coalesce((select round(sum(revenue),2)::text from v_sales_unified),'0')
union all
select 12,'VERDICT',
       case
         when (select pub from g) = 0 and (select anon from g) = 0 and (select seven from g) = 7
              and exists(select 1 from pg_views where schemaname='public' and viewname='v_sale_lines')
           then 'COMPLETE AT 0048. Every change 0034-0048 makes is present, including the 0048 revokes and grants. Only 0048''s self-check -- which changes nothing -- did not run. Nothing further needs to be applied.'
         when exists(select 1 from pg_views where schemaname='public' and viewname='v_sale_lines')
           then 'AT 0047 WITH 0048 INCOMPLETE. The grant surface has not been moved. STOP and report rows 2-4.'
         else 'NEITHER 0047 NOR 0048. STOP and report every row.'
       end
order by 1;
