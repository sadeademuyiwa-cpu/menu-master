-- ============================================================================
-- 0064 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at 0062 or 0063 and 0064 is not applied. It passes
-- both before and after 0063, so every check of this release can be run up
-- front; 0064 itself refuses to run until 0063 is in (row 3 says which).
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0062 is applied (v_recipe_line_costs guards the purchase-evidence lookup)',
         (select pg_get_viewdef('v_recipe_line_costs'::regclass) like '%rl.ingredient_id IS NOT NULL%'), ''
  union all select 2, 'identity: 118 policies in public, 98 fn_* functions (0063 adds neither)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 3, 'order: 0063 (dish photos) goes in first',
         true,
         case when exists(select 1 from information_schema.columns
                           where table_schema='public' and table_name='recipes' and column_name='photo_path')
              then '0063 applied: 0064 may run now'
              else 'NOT YET: apply 0063 first; 0064 refuses to run without it' end
  union all select 4, 'not yet applied: no fn_menu_prices',
         not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='fn_menu_prices'), ''
  union all select 5, 'selling prices are still cost-gated: recipe_prices has its four fn_can_see_costs policies',
         (select count(*) from pg_policies where schemaname='public' and tablename='recipe_prices'
            and coalesce(qual,'') || coalesce(with_check,'') like '%fn_can_see_costs%') = 4, ''
  union all select 6, 'the role helper 0064 reuses is present: fn_has_account_role(uuid, member_role[])',
         to_regprocedure('public.fn_has_account_role(uuid, public.member_role[])') is not null, ''
  union all select 7, 'live data: who gains read access to selling prices',
         true, (select count(*)::text || ' sales member(s) in ' || count(distinct account_id)::text || ' account(s)'
                  from memberships where role = 'sales')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
