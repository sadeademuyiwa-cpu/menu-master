-- ============================================================================
-- MENU MASTER NG — sweep for foreign objects our migrations could alter
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- 0018 operates on objects in the public schema. This lists everything there
-- that migrations 0001-0018 do NOT create, so nothing foreign can be altered
-- without it having been seen first. Also lists triggers on auth.users, which
-- no Menu Master migration creates.
-- ============================================================================

with ours(name) as (values
  ('accounts'),('profiles'),('businesses'),('locations'),('memberships'),('subscriptions'),
  ('ingredient_categories'),('ingredients'),('ingredient_unit_conversions'),
  ('suppliers'),('ingredient_prices'),('business_settings'),('costing_method_changes'),
  ('recipes'),('recipe_lines'),('labour_rates'),('recipe_labour'),('overhead_items'),
  ('cost_snapshots'),('channels'),('recipe_prices'),('purchases'),('purchase_lines'),
  ('customers'),('orders'),('order_lines'),('sales_entries'),('period_closes'),
  ('units'),('catalog_categories'),('catalog_ingredients'),('plans'),('plan_features'),
  ('v_price_check'),('v_costing_blockers'),('v_missing_unit_conversions'),
  ('v_recipe_cost_current'),('v_sales_unified'),('v_profit_by_period'),
  ('v_profit_by_product'),('v_dashboard_waterfall'),('v_onboarding_status'),
  ('v_voided_sales'))
select * from (
  select '1 relations' as section, '>>> in public, NOT ours' as item,
         coalesce((select string_agg(c.relname||' ('||c.relkind::text||')', ', ' order by c.relname)
                     from pg_class c
                    where c.relnamespace='public'::regnamespace
                      and c.relkind in ('r','v','m','p','f')
                      and c.relname not in (select name from ours)), 'none') as observed
  union all
  select '2 functions', '>>> in public, not fn_* and not an extension''s',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname not like 'fn\_%'
                      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
                  'none')
  union all
  select '3 triggers', '>>> on auth.users (we create none)',
         coalesce((select string_agg(t.tgname||' → '||p.proname, ', ')
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                     join pg_proc p on p.oid=t.tgfoid
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal), 'none')
  union all
  select '3 triggers', 'on public tables, not fn_*',
         coalesce((select string_agg(c.relname||'.'||t.tgname, ', ')
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_proc p on p.oid=t.tgfoid
                    where c.relnamespace='public'::regnamespace and not t.tgisinternal
                      and p.proname not like 'fn\_%'), 'none')
  union all
  select '4 policies', 'on public tables, not p_*',
         coalesce((select string_agg(tablename||'.'||policyname, ', ')
                     from pg_policies where schemaname='public' and policyname not like 'p\_%'), 'none')
  union all
  select '5 schemas', 'non-standard schemas present',
         coalesce((select string_agg(nspname, ', ' order by nspname) from pg_namespace
                    where nspname not like 'pg\_%'
                      and nspname not in ('public','information_schema','auth','storage',
                                          'extensions','graphql','graphql_public','realtime',
                                          'supabase_functions','vault','cron','net','pgsodium',
                                          'pgsodium_masks','supabase_migrations','_analytics',
                                          '_realtime','pgbouncer')), 'none beyond Supabase defaults')
  union all
  select '6 signup', 'rows in profiles / accounts / memberships',
         (select count(*) from profiles)::text || ' / ' ||
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from memberships)::text
  union all
  select '6 signup', 'auth.users rows', (select count(*)::text from auth.users)
) as t order by 1, 2;
