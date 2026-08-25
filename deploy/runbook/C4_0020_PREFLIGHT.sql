-- ============================================================================
-- MENU MASTER NG — 0020 (C10) PREFLIGHT
--
--   *** PURE SELECT. Single statement. No state change whatsoever. ***
--
-- Run immediately before 0020. Proves production is in the exact condition
-- 0020 was built and tested against, and that no partial prior attempt exists.
--
-- PROCEED only if every '>>>' row reads GO.
-- ============================================================================

select * from (

  -- 1. ENVIRONMENT -----------------------------------------------------------
  select '1 env' as section, '>>> PostgreSQL version' as item,
         substring(version() from 'PostgreSQL [0-9.]+') as observed,
         'PostgreSQL 17.6' as expected,
         case when substring(version() from 'PostgreSQL [0-9.]+') = 'PostgreSQL 17.6'
              then 'GO' else 'STOP' end as "verdict >>>"
  union all
  select '1 env', 'current_user', current_user, 'postgres', 'INFORMATIONAL'

  -- 2. DATA STATE ------------------------------------------------------------
  union all
  select '2 data', '>>> auth.users',
         (select count(*)::text from auth.users), '5',
         case when (select count(*) from auth.users) = 5 then 'GO' else 'STOP' end
  union all
  select '2 data', '>>> accounts / businesses / memberships',
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text, '0 / 0 / 0',
         case when (select count(*) from accounts) = 0
               and (select count(*) from businesses) = 0
               and (select count(*) from memberships) = 0
              then 'GO' else 'STOP' end
  union all
  select '2 data', '>>> units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text || ' / ' ||
         (select count(*) from catalog_categories)::text || ' / ' ||
         (select count(*) from catalog_ingredients)::text, '45 / 16 / 180',
         case when (select count(*) from units) = 45
               and (select count(*) from catalog_categories) = 16
               and (select count(*) from catalog_ingredients) = 180
              then 'GO' else 'STOP' end
  union all
  select '2 data', '>>> plans / plan_features',
         (select count(*) from plans)::text || ' / ' ||
         (select count(*) from plan_features)::text, '3 / 12',
         case when (select count(*) from plans) = 3
               and (select count(*) from plan_features) = 12
              then 'GO' else 'STOP' end

  -- 3. THE RPC ---------------------------------------------------------------
  union all
  select '3 rpc', '>>> exactly one overload',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace
             and proname='fn_create_account_and_business'), '1',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace
                       and proname='fn_create_account_and_business') = 1
              then 'GO' else 'STOP' end
  union all
  select '3 rpc', '>>> signature matches the captured live one',
         coalesce((select p.oid::regprocedure::text from pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
         case when (select coalesce(string_agg(p.oid::regprocedure::text,'|'),'')
                      from pg_proc p where p.pronamespace='public'::regnamespace
                        and p.proname='fn_create_account_and_business')
                   = 'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)'
              then 'GO' else 'STOP' end
  union all
  select '3 rpc', '>>> definition md5',
         coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='fn_create_account_and_business'), 'ABSENT'),
         '71aff1dbc2e89d11383d77e1cbf1f967',
         case when (select md5(pg_get_functiondef(p.oid)) from pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business')
                   = '71aff1dbc2e89d11383d77e1cbf1f967'
              then 'GO' else 'STOP' end
  union all
  select '3 rpc', '>>> definition byte length',
         coalesce((select octet_length(convert_to(pg_get_functiondef(p.oid),'UTF8'))::text
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         '2771',
         case when (select octet_length(convert_to(pg_get_functiondef(p.oid),'UTF8'))
                      from pg_proc p where p.pronamespace='public'::regnamespace
                        and p.proname='fn_create_account_and_business') = 2771
              then 'GO' else 'STOP' end

  -- 4. GRANTS ON THE RPC -----------------------------------------------------
  union all
  select '4 grants', '>>> roles holding EXECUTE',
         coalesce((select string_agg(r.rolname, ', ' order by r.rolname)
                     from pg_roles r, pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='fn_create_account_and_business'
                      and r.rolname in ('anon','authenticated','service_role')
                      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 'none'),
         'authenticated, service_role -- anon absent',
         case when (select coalesce(string_agg(r.rolname, ',' order by r.rolname),'')
                      from pg_roles r, pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'
                       and r.rolname in ('anon','authenticated','service_role')
                       and has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
                   = 'authenticated,service_role'
              then 'GO' else 'STOP' end
  union all
  -- A PUBLIC grant shows in proacl as an entry with an empty grantee ("=X/..").
  -- anon inherits PUBLIC, so this must be absent as well as anon's own grant.
  select '4 grants', '>>> no PUBLIC grant on the RPC',
         coalesce((select case when exists (
                            select 1 from unnest(coalesce(p.proacl, array[]::aclitem[])) a
                             where a::text like '=%')
                          then 'PUBLIC GRANT PRESENT' else 'none' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'none',
         case when not exists (
                select 1 from pg_proc p,
                     unnest(coalesce(p.proacl, array[]::aclitem[])) a
                 where p.pronamespace='public'::regnamespace
                   and p.proname='fn_create_account_and_business'
                   and a::text like '=%')
              then 'GO' else 'STOP' end

  -- 5. NO C10 OBJECT OR PARTIAL PRIOR ATTEMPT --------------------------------
  union all
  select '5 no partial', '>>> onboarding_requests absent',
         case when exists (select 1 from pg_class where relname='onboarding_requests')
              then 'ALREADY EXISTS' else 'absent' end, 'absent',
         case when not exists (select 1 from pg_class where relname='onboarding_requests')
              then 'GO' else 'STOP' end
  union all
  select '5 no partial', '>>> no p_onboarding_requests policy',
         case when exists (select 1 from pg_policies
                            where policyname='p_onboarding_requests')
              then 'ALREADY EXISTS' else 'absent' end, 'absent',
         case when not exists (select 1 from pg_policies
                                where policyname='p_onboarding_requests')
              then 'GO' else 'STOP' end
  union all
  select '5 no partial', '>>> no nine-argument RPC overload',
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='fn_create_account_and_business'
                              and pronargs = 9)
              then 'ALREADY EXISTS' else 'absent' end, 'absent',
         case when not exists (select 1 from pg_proc
                                where pronamespace='public'::regnamespace
                                  and proname='fn_create_account_and_business'
                                  and pronargs = 9)
              then 'GO' else 'STOP' end
  union all
  select '5 no partial', '>>> no C10 constraints left behind',
         coalesce((select string_agg(conname, ', ') from pg_constraint
                    where conname in ('pk_onboarding_requests',
                                      'ck_onboarding_key_nonblank')), 'none'),
         'none',
         case when not exists (select 1 from pg_constraint
                                where conname in ('pk_onboarding_requests',
                                                  'ck_onboarding_key_nonblank'))
              then 'GO' else 'STOP' end

  -- 6. SIGNUP REPAIR STILL INTACT --------------------------------------------
  union all
  select '6 signup', '>>> handle_new_user still the neutralised no-op',
         coalesce((select case when p.prosecdef then 'SECURITY DEFINER AGAIN'
                               when lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    ~ '(insert|update|delete|merge|truncate|perform|execute)\s'
                                 then 'A DATA STATEMENT REAPPEARED'
                               else 'no-op, SECURITY INVOKER' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'no-op, SECURITY INVOKER',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and not p.prosecdef
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge|truncate|perform|execute)\s')
              then 'GO' else 'STOP' end
  union all
  select '6 signup', '>>> trigger present and enabled',
         coalesce((select t.tgname || ' enabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users'
                      and not t.tgisinternal), 'MISSING'),
         'on_auth_user_created enabled=O',
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='auth' and c.relname='users'
                             and not t.tgisinternal
                             and t.tgname='on_auth_user_created' and t.tgenabled='O')
              then 'GO' else 'STOP' end
  union all
  select '6 signup', '>>> vendors absent',
         coalesce((select string_agg(n.nspname||'.'||c.relname, ', ')
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where c.relname='vendors'), 'none'), 'none',
         case when not exists (select 1 from pg_class where relname='vendors')
              then 'GO' else 'STOP' end

  -- 7. PART 5 STATE ----------------------------------------------------------
  union all
  select '7 part5', '>>> fn_* / relations / policies',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' / ' ||
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) || ' / ' ||
         (select count(*)::text from pg_policies where schemaname='public'),
         '40 / 43 / 92 -- 0020 moves these to 40 / 44 / 93',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%') = 40
               and (select count(*) from pg_class
                     where relnamespace='public'::regnamespace
                       and relkind in ('r','p','v','m','f')) = 43
               and (select count(*) from pg_policies where schemaname='public') = 92
              then 'GO' else 'STOP' end

) as t order by 1, 2;
