-- ============================================================================
-- MENU MASTER NG — PART 5 GATE
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run immediately after PART_5_gate1_closure.sql (plus the approved 0018
-- amendment). Every row carries its own expected value and verdict. The gate
-- is PASS only if every '>>>' row reads PASS.
-- ============================================================================

select * from (

  -- 1. STRUCTURE ------------------------------------------------------------
  select '1 structure' as section, 'tables (relkind r,p)' as item,
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p')) as observed,
         '33' as expected,
         case when (select count(*) from pg_class
                     where relnamespace='public'::regnamespace and relkind in ('r','p'))=33
              then 'PASS' else 'STOP' end as "verdict >>>"
  union all
  select '1 structure', 'views (relkind v,m)',
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('v','m')), '10',
         case when (select count(*) from pg_class
                     where relnamespace='public'::regnamespace and relkind in ('v','m'))=10
              then 'PASS' else 'STOP' end
  union all
  select '1 structure', 'total public relations',
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')), '43',
         case when (select count(*) from pg_class
                     where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f'))=43
              then 'PASS' else 'STOP' end

  -- 2. RLS ------------------------------------------------------------------
  union all
  select '2 rls', 'base tables with RLS disabled',
         coalesce((select string_agg(relname, ', ' order by relname) from pg_class
                    where relnamespace='public'::regnamespace and relkind='r'
                      and not relrowsecurity), 'none'),
         'none',
         case when not exists (select 1 from pg_class
                                where relnamespace='public'::regnamespace and relkind='r'
                                  and not relrowsecurity) then 'PASS' else 'STOP' end
  union all
  select '2 rls', 'policies on public tables',
         (select count(*)::text from pg_policies where schemaname='public'), '92',
         case when (select count(*) from pg_policies where schemaname='public')=92
              then 'PASS' else 'STOP' end
  union all
  select '2 rls', 'policies not named p_*',
         coalesce((select string_agg(tablename||'.'||policyname, ', ') from pg_policies
                    where schemaname='public' and policyname not like 'p\_%'), 'none'),
         'none',
         case when not exists (select 1 from pg_policies
                                where schemaname='public' and policyname not like 'p\_%')
              then 'PASS' else 'STOP' end

  -- 3. FUNCTIONS ------------------------------------------------------------
  union all
  select '3 functions', 'fn_* in public',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%'), '40',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%')=40
              then 'PASS' else 'STOP' end
  union all
  select '3 functions', 'non-fn_, non-extension functions in public',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname not like 'fn\_%'
                      and not exists (select 1 from pg_depend d
                                       where d.objid=p.oid and d.deptype='e')), 'none'),
         'handle_new_user (and nothing else)',
         case when (select coalesce(string_agg(p.proname, ','), 'none') from pg_proc p
                     where p.pronamespace='public'::regnamespace and p.proname not like 'fn\_%'
                       and not exists (select 1 from pg_depend d
                                        where d.objid=p.oid and d.deptype='e'))
                   = 'handle_new_user'
              then 'PASS' else 'STOP' end

  -- 4. FOREIGN OBJECT UNTOUCHED --------------------------------------------
  union all
  select '4 foreign', 'handle_new_user still present and SECURITY DEFINER',
         coalesce((select case when p.prosecdef then 'present, SECURITY DEFINER, owner '
                                    || p.proowner::regrole::text
                               else 'present but NOT security definer' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'present, unchanged by Part 5',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and p.prosecdef)
              then 'PASS' else 'STOP' end
  union all
  select '4 foreign', 'its body still targets the missing vendors table',
         coalesce((select case when p.prosrc like '%vendors%' then 'yes, unchanged'
                               else 'BODY CHANGED' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'yes, unchanged',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and p.prosrc like '%vendors%')
              then 'PASS' else 'STOP' end
  union all
  select '4 foreign', 'trigger on auth.users',
         coalesce((select string_agg(t.tgname||' (enabled='||t.tgenabled::text||')', ', ')
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal),
                  'none'),
         'on_auth_user_created (enabled=O) -- still there, Part 5 must not touch it',
         case when (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal)=1
              then 'PASS' else 'STOP' end
  union all
  select '4 foreign', 'foreign relations in public',
         coalesce((select string_agg(c.relname, ', ') from pg_class c
                    where c.relnamespace='public'::regnamespace
                      and c.relkind in ('r','p','v','m','f')
                      and c.relname not in (
                        'accounts','profiles','businesses','locations','memberships','subscriptions',
                        'ingredient_categories','ingredients','ingredient_unit_conversions',
                        'suppliers','ingredient_prices','business_settings','costing_method_changes',
                        'recipes','recipe_lines','labour_rates','recipe_labour','overhead_items',
                        'cost_snapshots','channels','recipe_prices','purchases','purchase_lines',
                        'customers','orders','order_lines','sales_entries','period_closes',
                        'units','catalog_categories','catalog_ingredients','plans','plan_features',
                        'v_price_check','v_costing_blockers','v_missing_unit_conversions',
                        'v_recipe_cost_current','v_sales_unified','v_profit_by_period',
                        'v_profit_by_product','v_dashboard_waterfall','v_onboarding_status',
                        'v_voided_sales')), 'none'),
         'none',
         case when not exists (select 1 from pg_class c
                                where c.relnamespace='public'::regnamespace
                                  and c.relkind in ('r','p','v','m','f')
                                  and c.relname not in (
                        'accounts','profiles','businesses','locations','memberships','subscriptions',
                        'ingredient_categories','ingredients','ingredient_unit_conversions',
                        'suppliers','ingredient_prices','business_settings','costing_method_changes',
                        'recipes','recipe_lines','labour_rates','recipe_labour','overhead_items',
                        'cost_snapshots','channels','recipe_prices','purchases','purchase_lines',
                        'customers','orders','order_lines','sales_entries','period_closes',
                        'units','catalog_categories','catalog_ingredients','plans','plan_features',
                        'v_price_check','v_costing_blockers','v_missing_unit_conversions',
                        'v_recipe_cost_current','v_sales_unified','v_profit_by_period',
                        'v_profit_by_product','v_dashboard_waterfall','v_onboarding_status',
                        'v_voided_sales'))
              then 'PASS' else 'STOP' end

  -- 5. GRANTS ---------------------------------------------------------------
  union all
  select '5 grants', 'tables anon may SELECT',
         coalesce((select string_agg(distinct table_name, ', ' order by table_name)
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee='anon'
                      and privilege_type='SELECT'), 'none'),
         'catalog_categories, catalog_ingredients, plan_features, plans, units',
         case when (select coalesce(string_agg(distinct table_name, ',' order by table_name),'none')
                      from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon' and privilege_type='SELECT')
                   = 'catalog_categories,catalog_ingredients,plan_features,plans,units'
              then 'PASS' else 'STOP' end
  union all
  select '5 grants', 'privilege types anon holds anywhere in public',
         coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee='anon'), 'none'),
         'SELECT',
         case when (select coalesce(string_agg(distinct privilege_type,','),'none')
                      from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon') in ('SELECT','none')
              then 'PASS' else 'STOP' end
  union all
  select '5 grants', 'authenticated holding TRUNCATE/TRIGGER/REFERENCES',
         coalesce((select string_agg(distinct table_name||':'||privilege_type, ', ')
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee='authenticated'
                      and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')), 'none'),
         'none',
         case when not exists (select 1 from information_schema.role_table_grants
                                where table_schema='public' and grantee='authenticated'
                                  and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES'))
              then 'PASS' else 'STOP' end
  union all
  select '5 grants', 'fn_* anon may EXECUTE',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%'
             and has_function_privilege('anon', oid, 'EXECUTE')), '0',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%'
                       and has_function_privilege('anon', oid, 'EXECUTE'))=0
              then 'PASS' else 'STOP' end
  union all
  select '5 grants', '>>> onboarding RPC executable by authenticated',
         case when has_function_privilege('authenticated',
                     'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
                     'EXECUTE') then 'yes' else 'NO -- signup would be impossible' end,
         'yes',
         case when has_function_privilege('authenticated',
                     'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
                     'EXECUTE') then 'PASS' else 'STOP' end
  union all
  select '5 grants', 'service_role table privileges present',
         case when exists (select 1 from information_schema.role_table_grants
                            where table_schema='public' and grantee='service_role')
              then 'yes, untouched' else 'MISSING' end,
         'yes, untouched',
         case when exists (select 1 from information_schema.role_table_grants
                            where table_schema='public' and grantee='service_role')
              then 'PASS' else 'STOP' end

  -- 6. THE ANON REFERENCE SURFACE MUST ACTUALLY BE READABLE -----------------
  --    A grant is not the same as a working read. This is the check that
  --    catches an RLS policy calling a function anon may not execute.
  union all
  select '6 anon read', '>>> anon-readable tables whose policy calls fn_ unscoped',
         coalesce((select string_agg(distinct p.tablename||'.'||p.policyname, ', ')
                     from pg_policies p
                    where p.schemaname='public'
                      and p.tablename in (select table_name
                                            from information_schema.role_table_grants
                                           where table_schema='public' and grantee='anon'
                                             and privilege_type='SELECT')
                      and coalesce(p.qual,'')||coalesce(p.with_check,'') like '%fn\_%' escape '\'
                      and not ('authenticated' = any(p.roles))), 'none'),
         'none -- otherwise anon gets "permission denied for function"',
         case when not exists (select 1 from pg_policies p
                                where p.schemaname='public'
                                  and p.tablename in (select table_name
                                        from information_schema.role_table_grants
                                       where table_schema='public' and grantee='anon'
                                         and privilege_type='SELECT')
                                  and coalesce(p.qual,'')||coalesce(p.with_check,'')
                                      like '%fn\_%' escape '\'
                                  and not ('authenticated' = any(p.roles)))
              then 'PASS' else 'STOP' end

  -- 7. REFERENCE DATA -------------------------------------------------------
  union all
  select '7 data', 'units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text||' / '||
         (select count(*) from catalog_categories)::text||' / '||
         (select count(*) from catalog_ingredients)::text,
         '45 / 16 / 180',
         case when (select count(*) from units)=45
               and (select count(*) from catalog_categories)=16
               and (select count(*) from catalog_ingredients)=180
              then 'PASS' else 'STOP' end
  union all
  select '7 data', 'plans / plan_features',
         (select count(*) from plans)::text||' / '||(select count(*) from plan_features)::text,
         '3 / 12',
         case when (select count(*) from plans)=3 and (select count(*) from plan_features)=12
              then 'PASS' else 'STOP' end
  union all
  select '7 data', 'units unique on (coalesce(account_id), lower(code))',
         (select count(distinct (coalesce(account_id::text,'-')||'/'||lower(code)))::text from units),
         '45 (equal to the row count)',
         case when (select count(distinct (coalesce(account_id::text,'-')||'/'||lower(code))) from units)
                 = (select count(*) from units) then 'PASS' else 'STOP' end
  union all
  select '7 data', 'tenant data (must still be empty pre-signup)',
         (select count(*) from accounts)::text||' accounts / '||
         (select count(*) from ingredient_prices)::text||' price rows',
         '0 accounts / 0 price rows',
         case when (select count(*) from accounts)=0
               and (select count(*) from ingredient_prices)=0
              then 'PASS' else 'STOP' end

  -- 8. MIGRATION MARKERS ----------------------------------------------------
  union all
  select '8 markers', '0013 zero-value rejection present',
         case when exists (select 1 from pg_constraint
                            where conname like '%nonzero%' or conname like '%positive%')
              then 'yes' else 'no constraint found' end, 'yes',
         case when exists (select 1 from pg_constraint
                            where conname like '%nonzero%' or conname like '%positive%')
              then 'PASS' else 'STOP' end
  union all
  select '8 markers', '0014 order/sales void + reissue functions',
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace
           and proname in ('fn_finalise_order','fn_void_order','fn_reissue_order',
                           'fn_void_sales_entry','fn_guard_finalised_order',
                           'fn_guard_order_line_revenue','fn_guard_sales_entry_immutable')), '7',
         case when (select count(*) from pg_proc where pronamespace='public'::regnamespace
                     and proname in ('fn_finalise_order','fn_void_order','fn_reissue_order',
                           'fn_void_sales_entry','fn_guard_finalised_order',
                           'fn_guard_order_line_revenue','fn_guard_sales_entry_immutable'))=7
              then 'PASS' else 'STOP' end
  union all
  select '8 markers', '0017 subscription status constraint + unique index',
         case when exists (select 1 from pg_constraint where conname='ck_subscriptions_status')
               and exists (select 1 from pg_class where relname='ux_subscriptions_account')
              then 'both present' else 'MISSING' end, 'both present',
         case when exists (select 1 from pg_constraint where conname='ck_subscriptions_status')
               and exists (select 1 from pg_class where relname='ux_subscriptions_account')
              then 'PASS' else 'STOP' end

  -- 9. FINGERPRINTS (change detection, informational) -----------------------
  union all
  select '9 fingerprint', 'anon+authenticated grants',
         (select substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type,'|'
                        order by grantee,table_name,privilege_type)),1,12)
            from information_schema.role_table_grants
           where table_schema='public' and grantee in ('anon','authenticated')),
         '8ac70f63e534 on the local reference build', 'INFORMATIONAL'
  union all
  select '9 fingerprint', 'policies',
         (select substr(md5(string_agg(tablename||'.'||policyname||'.'||cmd||'.'
                        ||coalesce(qual,'')||'.'||coalesce(with_check,''),'|'
                        order by tablename,policyname)),1,12)
            from pg_policies where schemaname='public'),
         'b0ce58371195 on the local reference build', 'INFORMATIONAL'

  -- 10. TENANT ISOLATION ----------------------------------------------------
  union all
  select '10 isolation', 'live cross-tenant test',
         'not runnable: '||(select count(*) from accounts)::text||' accounts exist',
         'deferred to the signup acceptance test (Stage 2)',
         'OPERATOR CHECK'

) as t order by 1, 2;
