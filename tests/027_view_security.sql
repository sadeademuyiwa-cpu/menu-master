-- ============================================================================
-- MENU MASTER NG -- tests/027_view_security.sql
--
-- EVERY view that exposes tenant data must be security_invoker.
--
-- WHY THIS SUITE EXISTS
--   A view without security_invoker runs with the DEFINER's rights, so RLS on
--   the underlying tables does not apply to the caller and every tenant's rows
--   become readable. CREATE OR REPLACE VIEW does not preserve reloptions:
--   omitting `with (security_invoker = on)` silently RESETS it.
--
--   That is not hypothetical. Migrations 0036 and 0037 replaced four views
--   during Phase 3 and dropped the option on all four, opening a cross-tenant
--   read. A definition fingerprint did not catch it, because
--   pg_views.definition excludes reloptions. This suite checks the OPTION.
--
-- Run on any database with the schema applied. Read-only.
-- ============================================================================

begin;

create temp table t27 (n int, check_name text, verdict text, detail text) on commit drop;

-- 1. THE RELEASE-BLOCKING RULE.
--    A view that customers can read (granted to authenticated or anon) and
--    that touches tenant data MUST be security_invoker. Without it the view
--    runs with the definer's rights and RLS does not apply to the caller.
insert into t27
select 1,
       'every customer-readable view over tenant data is security_invoker',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(relname, ', '), 'none') ||
         case when count(*) = 0 then '' else ' <- READS ACROSS TENANTS' end
from (
  select distinct c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.role_table_grants g
      on g.table_name = c.relname and g.privilege_type = 'SELECT'
     and g.grantee in ('authenticated','anon')
   where n.nspname = 'public'
     and c.relkind = 'v'
     and not coalesce('security_invoker=on' = any(c.reloptions), false)
     and exists (
       select 1 from information_schema.columns col
        where col.table_schema = 'public' and col.column_name = 'account_id'
          and pg_get_viewdef(c.oid, true) ~ ('\m' || col.table_name || '\M')
     )
) x;

-- 2. THE ALLOW-LIST. Every view missing the option must be one we have already
--    examined and accepted. A NEW omission fails here even if it is not yet
--    customer-readable, because a later GRANT would turn it into check 1.
--
--    v_billing_reconciliation (0027, proposed): an operator view over
--    billing_events, granted only to service_role, and billing_events itself
--    is RLS deny-all to authenticated. No customer exposure today; latent if
--    ever granted. Logged P2, to be fixed with the billing work rather than
--    touched here, since billing must not be modified casually.
insert into t27
select 2,
       'no view is missing security_invoker beyond the accepted list',
       case when coalesce(array_agg(c.relname::text order by c.relname), '{}'::text[])
                 = array['v_billing_reconciliation']::text[]
              or count(*) = 0
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce('security_invoker=on' = any(c.reloptions), false);

-- 3. Views pinned individually rather than only by the rule: the ones Phase 3
--    replaced, because those are the ones that actually regressed, and the
--    Phase 6 sales views, because 0047 DROPs and recreates four existing views
--    and a drop is exactly where the option and the grants get lost.
--
--    A left join is deliberate: a view that has been deleted altogether shows
--    up here as a FAIL with 'NO OPTIONS', not as a silently absent row.
insert into t27
select 3 + row_number() over (order by v),
       'view ' || v || ' is security_invoker',
       case when coalesce('security_invoker=on' = any(c.reloptions), false)
            then 'PASS' else 'FAIL' end,
       coalesce(array_to_string(c.reloptions, ','), 'NO OPTIONS')
from (values ('v_price_check'),('v_recipe_cost_current'),
             ('v_costing_blockers'),('v_gate2_cutover'),
             ('v_recipe_line_costs'),('v_purchase_summary'),
             ('v_sale_lines'),('v_sales_summary'),('v_product_performance'),
             ('v_orders_attention'),('v_sale_cost_breakdown'),
             ('v_sales_unified'),('v_profit_by_period'),('v_profit_by_product'),
             ('v_dashboard_waterfall')) as t(v)
left join pg_class c on c.relname = t.v;

-- 4. A DROP VIEW discards its grants. Twice now a rollback restored a view and
--    left the application unable to read it, so the grant is asserted, not
--    assumed.
insert into t27
select 100 + row_number() over (order by v),
       'authenticated can read ' || v,
       case when exists (select 1 from information_schema.role_table_grants g
                          where g.table_schema = 'public' and g.table_name = v
                            and g.grantee = 'authenticated'
                            and g.privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end,
       ''
from (values ('v_sale_lines'),('v_sales_summary'),('v_product_performance'),
             ('v_orders_attention'),('v_sale_cost_breakdown'),
             ('v_sales_unified'),('v_profit_by_period'),('v_profit_by_product'),
             ('v_dashboard_waterfall')) as t(v);

select * from t27 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t27;

rollback;
