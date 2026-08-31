-- ============================================================================
-- STEP 3 -- POST-MIGRATION VERIFICATION       READ ONLY. Changes nothing.
--
-- Run immediately after STEP 2 commits, BEFORE the runtime probe and BEFORE
-- the frontend.
--
-- Paste the whole file into the Supabase SQL Editor and Run once.
-- EXPECTED: 20 rows, every one PASS.
--
-- Rows 15-20 are the figures to compare, by eye, against STEP 1's baseline.
-- On this database every one of them should be 0, because production holds no
-- trading data yet.
-- ============================================================================
with
sig as (
  select md5(string_agg(s,',' order by s collate "C")) as fp
    from (select p.proname || '(' || coalesce((
                   select string_agg(t.typname, ',' order by u.ord)
                     from unnest(p.proargtypes) with ordinality as u(oid, ord)
                     join pg_type t on t.oid = u.oid), '') || ')' as s
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname like 'fn\_%') z
),
checks(n, check_name, ok, detail) as (
  select 1,'identity: function catalogue is exactly the rehearsed 0048 set',
         (select fp from sig) = 'e24f3871788893cafd1fc17c70fe41d5',
         'fingerprint ' || (select fp from sig) || ' (expect e24f3871788893cafd1fc17c70fe41d5)'
  union all select 2,'schema: all fifteen migrations landed',
         (select count(*) from information_schema.columns
           where table_name='order_lines' and column_name in ('business_id','discount_amount')) = 2
         and (select count(*) from information_schema.columns
               where table_name='cost_snapshots'
                 and column_name in ('seq','portion_qty_at_snapshot','variant_overhead_cost')) = 3
         and (select count(*) from information_schema.columns
               where table_name='overhead_items' and column_name in ('basis_qty','basis_unit_id')) = 2
         and (select count(*) from pg_views where schemaname='public'
               and viewname in ('v_sale_lines','v_sales_summary','v_product_performance',
                                'v_orders_attention','v_sale_cost_breakdown','v_purchase_summary',
                                'v_recipe_basis','v_product_attention','v_ingredient_price_status')) = 9
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace
               and proname in ('fn_confirm_order','fn_frozen_sale_cost','fn_variant_cost_components',
                               'fn_allocate_order_discount','fn_ingredient_cost_basis',
                               'fn_overhead_breakdown','fn_overhead_problem')) = 7,
         'columns, views and functions from 0034-0048'
  union all select 3,'schema: an order is now born a draft',
         (select column_default from information_schema.columns
           where table_name='orders' and column_name='status') = '''draft''::order_status',
         coalesce((select column_default from information_schema.columns
                    where table_name='orders' and column_name='status'),'none')
  union all select 4,'schema: the insert-time freeze is gone',
         not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     where c.relname='order_lines' and t.tgname='trg_order_lines_freeze'), ''
  union all select 5,'lifecycle: no order reads as a sale without a confirmation time',
         (select count(*) from orders where status not in ('draft','cancelled')
           and finalised_at is null and voided_at is null) = 0,
         (select count(*)::text from orders where status not in ('draft','cancelled')
           and finalised_at is null and voided_at is null)
  union all select 6,'lifecycle: no order is finalised while still labelled a draft',
         (select count(*) from orders where finalised_at is not null and status='draft') = 0, ''
  union all select 7,'lifecycle: no confirmation time predates its own order',
         not exists(select 1 from orders where finalised_at < created_at), ''
  union all select 8,'tenancy: policy count is still 116',
         (select count(*) from pg_policies where schemaname='public') = 116,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 9,'tenancy: every tenant view is security_invoker',
         (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='v'
             and c.relname <> 'v_billing_reconciliation'
             and not coalesce('security_invoker=on' = any(c.reloptions), false)) = 0,
         coalesce((select string_agg(c.relname,', ') from pg_class c
                    join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='v'
                     and c.relname <> 'v_billing_reconciliation'
                     and not coalesce('security_invoker=on' = any(c.reloptions), false)),'none')
  -- Read through aclexplode rather than matching ACL text. An entry reads
  -- '=X/postgres' only when the owner happens to be postgres; comparing the
  -- literal silently stops detecting anything the moment the owner differs,
  -- and this is the check that certifies the deployment. grantee = 0 is PUBLIC.
  union all select 10,'tenancy: no function is executable by public or anon',
         (select count(*) from pg_proc p
           where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
             and (p.proacl is null
                  or exists (select 1 from aclexplode(p.proacl) a
                              where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                  or exists (select 1 from aclexplode(p.proacl) a
                               join pg_roles r on r.oid = a.grantee
                              where r.rolname = 'anon' and a.privilege_type = 'EXECUTE'))) = 0,
         coalesce((select string_agg(p.proname,', ' order by p.proname) from pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
                      and (p.proacl is null
                           or exists (select 1 from aclexplode(p.proacl) a
                                       where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                           or exists (select 1 from aclexplode(p.proacl) a
                                        join pg_roles r on r.oid = a.grantee
                                       where r.rolname = 'anon' and a.privilege_type = 'EXECUTE'))),'none')
  union all select 11,'tenancy: the cost freezer checks membership',
         (select pg_get_functiondef(oid) ~ 'fn_require_member' from pg_proc
           where proname='fn_frozen_sale_cost' and pronamespace='public'::regnamespace), ''
  union all select 12,'AUTH: exactly 7 login accounts, untouched',
         (select count(*) from auth.users) = 7,
         (select count(*)::text from auth.users) || ' (must equal STEP 1)'
  union all select 13,'AUTH: no login account was created or altered during the migration',
         not exists(select 1 from auth.users where created_at > now() - interval '2 hours'),
         'no auth.users row created in the last 2 hours; nothing in 0034-0048 writes to auth at all'
  union all select 14,'data: no snapshot gained provenance it never had',
         not exists(select 1 from cost_snapshots
                     where (portion_qty_at_snapshot is not null or variant_overhead_cost is not null)
                       and computed_at < now() - interval '2 hours'), ''
  union all select 15,'baseline: orders (compare to STEP 1)', true, (select count(*)::text from orders)
  union all select 16,'baseline: order_lines (compare to STEP 1)', true, (select count(*)::text from order_lines)
  union all select 17,'baseline: customers (compare to STEP 1)', true, (select count(*)::text from customers)
  union all select 18,'baseline: cost_snapshots (compare to STEP 1)', true, (select count(*)::text from cost_snapshots)
  union all select 19,'baseline: total revenue (compare to STEP 1)', true,
         coalesce((select round(sum(revenue),2)::text from v_sales_unified),'0')
  union all select 20,'baseline: rows 0045 reconciled (compare to STEP 1 row 24)', true,
         (select count(*)::text from orders
           where finalised_at = created_at and status not in ('draft','cancelled') and voided_at is null)
)
select n, case when ok then 'PASS' else '*** FAIL -- STOP ***' end as verdict, check_name, detail
  from checks order by ok, n;
