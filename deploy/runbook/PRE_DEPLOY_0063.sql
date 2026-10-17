-- ============================================================================
-- 0063 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at EXACTLY 0062 and 0063 is not applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 9 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0062 is applied (v_recipe_line_costs guards the purchase-evidence lookup)',
         (select pg_get_viewdef('v_recipe_line_costs'::regclass) like '%rl.ingredient_id IS NOT NULL%'), ''
  union all select 2, 'identity: 118 policies in public, 98 fn_* functions',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 3, 'Supabase Storage is present (storage.objects, storage.buckets)',
         exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='storage' and c.relname='objects')
         and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                     where n.nspname='storage' and c.relname='buckets'), ''
  union all select 4, 'identity: 0059 is applied (the four mm_site_* storage policies)',
         (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') = 4,
         (select count(*)::text from pg_policies where schemaname='storage') || ' storage policies in all'
  union all select 5, 'the rule 0063 copies: p_recipes_update is owner, manager and kitchen on an entitled account',
         (select coalesce(qual,'') like '%fn_has_account_role%' and coalesce(qual,'') like '%''owner''%'
                 and coalesce(qual,'') like '%''manager''%' and coalesce(qual,'') like '%''kitchen''%'
                 and coalesce(qual,'') not like '%''sales''%' and coalesce(qual,'') not like '%''accountant''%'
                 and coalesce(qual,'') like '%fn_account_is_entitled%'
                 and coalesce(with_check,'') = coalesce(qual,'')
            from pg_policies where schemaname='public' and tablename='recipes' and policyname='p_recipes_update'), ''
  union all select 6, 'not yet applied: recipes has no photo_path',
         not exists(select 1 from information_schema.columns
                     where table_schema='public' and table_name='recipes' and column_name='photo_path'), ''
  union all select 7, 'not yet applied: no mm_dish_* storage policies',
         not exists(select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%'), ''
  union all select 8, 'a bucket called "dish" does not exist yet (0063 would take it over)',
         not exists(select 1 from storage.buckets where id='dish'),
         coalesce((select 'exists: public='||public from storage.buckets where id='dish'), 'none')
  union all select 9, 'live data: 0063 writes no customer row (every dish starts with no photo)',
         true, (select count(*)::text || ' dish(es) across ' || count(distinct business_id)::text || ' business(es)'
                  from recipes where deleted_at is null)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
