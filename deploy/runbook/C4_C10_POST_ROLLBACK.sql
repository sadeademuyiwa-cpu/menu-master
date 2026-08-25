-- ============================================================================
-- MENU MASTER NG — POST-ROLLBACK VERIFICATION (C10 acceptance test)
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run after rolling back the C10 acceptance test. Proves the rollback discarded
-- every provisioned row, that the five protected users are untouched, and that
-- the temporary Auth user is the only remaining test artefact.
--
-- The temporary user is EXPECTED to survive: it was created through the
-- Dashboard, outside the transaction, and is removed the same way afterwards.
-- Never from SQL.
--
-- PASS only if every '>>>' row reads PASS.
-- ============================================================================

select * from (

  -- 1. THE ROLLBACK DISCARDED EVERYTHING ------------------------------------
  select '1 rollback' as section,
         '>>> accounts / businesses / memberships' as item,
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text as observed,
         '0 / 0 / 0' as expected,
         case when (select count(*) from accounts) = 0
               and (select count(*) from businesses) = 0
               and (select count(*) from memberships) = 0
              then 'PASS' else 'STOP' end as "verdict >>>"
  union all
  select '1 rollback', '>>> subscriptions / onboarding_requests',
         (select count(*) from subscriptions)::text || ' / ' ||
         (select count(*) from onboarding_requests)::text, '0 / 0',
         case when (select count(*) from subscriptions) = 0
               and (select count(*) from onboarding_requests) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 rollback', '>>> locations / business_settings / channels',
         (select count(*) from locations)::text || ' / ' ||
         (select count(*) from business_settings)::text || ' / ' ||
         (select count(*) from channels)::text,
         '0 / 0 / 0 -- no test location, settings or channel may remain',
         case when (select count(*) from locations) = 0
               and (select count(*) from business_settings) = 0
               and (select count(*) from channels) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 rollback', '>>> ingredients / ingredient_prices / categories',
         (select count(*) from ingredients)::text || ' / ' ||
         (select count(*) from ingredient_prices)::text || ' / ' ||
         (select count(*) from ingredient_categories)::text,
         '0 / 0 / 0 -- the 180 cloned rows must be gone',
         case when (select count(*) from ingredients) = 0
               and (select count(*) from ingredient_prices) = 0
               and (select count(*) from ingredient_categories) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 rollback', '>>> every other tenant table',
         (select count(*) from recipes)::text || ' recipes / ' ||
         (select count(*) from suppliers)::text || ' suppliers / ' ||
         (select count(*) from customers)::text || ' customers / ' ||
         (select count(*) from orders)::text || ' orders',
         '0 / 0 / 0 / 0',
         case when (select count(*) from recipes) = 0
               and (select count(*) from suppliers) = 0
               and (select count(*) from customers) = 0
               and (select count(*) from orders) = 0
              then 'PASS' else 'STOP' end

  -- 2. THE USERS -------------------------------------------------------------
  union all
  select '2 users', '>>> auth.users total',
         (select count(*)::text from auth.users),
         '6 -- five protected plus the temporary user, which survives by design',
         case when (select count(*) from auth.users) = 6 then 'PASS' else 'STOP' end
  union all
  select '2 users', '>>> the five protected users are present',
         (select count(*)::text from auth.users
           where created_at < '2026-08-15'::timestamptz), '5',
         case when (select count(*) from auth.users
                     where created_at < '2026-08-15'::timestamptz) = 5
              then 'PASS' else 'STOP' end
  union all
  select '2 users', '>>> none of the five holds a membership or profile',
         (select count(*)::text from auth.users u
           where u.created_at < '2026-08-15'::timestamptz
             and (exists (select 1 from memberships m where m.user_id = u.id)
               or exists (select 1 from profiles p where p.id = u.id))),
         '0 -- they were never used as subjects',
         case when not exists (select 1 from auth.users u
                                where u.created_at < '2026-08-15'::timestamptz
                                  and (exists (select 1 from memberships m
                                                where m.user_id = u.id)
                                    or exists (select 1 from profiles p
                                                where p.id = u.id)))
              then 'PASS' else 'STOP' end
  union all
  select '2 users', '>>> the temporary user is the ONLY remaining artefact',
         coalesce((select string_agg(u.id::text, ', ') from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz), 'none'),
         '2ca27f8c-7e39-41dc-a175-0a87c70da1e0 and nothing else',
         case when (select coalesce(string_agg(u.id::text, ','), '') from auth.users u
                     where u.created_at >= '2026-08-15'::timestamptz)
                   = '2ca27f8c-7e39-41dc-a175-0a87c70da1e0'
              then 'PASS' else 'STOP' end
  union all
  select '2 users', '>>> the temporary user holds nothing either',
         coalesce((select (select count(*) from memberships m where m.user_id = u.id)::text
                          || ' memberships / '
                          || (select count(*) from profiles p where p.id = u.id)::text
                          || ' profiles'
                     from auth.users u
                    where u.id = '2ca27f8c-7e39-41dc-a175-0a87c70da1e0'), 'user absent'),
         '0 memberships / 0 profiles',
         case when exists (select 1 from auth.users
                            where id = '2ca27f8c-7e39-41dc-a175-0a87c70da1e0')
               and not exists (select 1 from memberships
                                where user_id = '2ca27f8c-7e39-41dc-a175-0a87c70da1e0')
               and not exists (select 1 from profiles
                                where id = '2ca27f8c-7e39-41dc-a175-0a87c70da1e0')
              then 'PASS' else 'STOP' end

  -- 3. REFERENCE CATALOGUE ---------------------------------------------------
  union all
  select '3 reference', '>>> units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text || ' / ' ||
         (select count(*) from catalog_categories)::text || ' / ' ||
         (select count(*) from catalog_ingredients)::text, '45 / 16 / 180',
         case when (select count(*) from units) = 45
               and (select count(*) from catalog_categories) = 16
               and (select count(*) from catalog_ingredients) = 180
              then 'PASS' else 'STOP' end
  union all
  select '3 reference', '>>> plans / plan_features',
         (select count(*) from plans)::text || ' / ' ||
         (select count(*) from plan_features)::text, '3 / 12',
         case when (select count(*) from plans) = 3
               and (select count(*) from plan_features) = 12
              then 'PASS' else 'STOP' end

  -- 4. C10 AND THE SIGNUP REPAIR STILL IN PLACE ------------------------------
  union all
  select '4 intact', '>>> fn_* / relations / policies',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' / ' ||
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) || ' / ' ||
         (select count(*)::text from pg_policies where schemaname='public'),
         '40 / 44 / 93',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%') = 40
               and (select count(*) from pg_class
                     where relnamespace='public'::regnamespace
                       and relkind in ('r','p','v','m','f')) = 44
               and (select count(*) from pg_policies where schemaname='public') = 93
              then 'PASS' else 'STOP' end
  union all
  select '4 intact', '>>> the nine-argument RPC survives the rollback',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace
             and proname='fn_create_account_and_business' and pronargs = 9),
         '1 -- the migration is committed; only the test data was rolled back',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace
                       and proname='fn_create_account_and_business' and pronargs=9) = 1
              then 'PASS' else 'STOP' end
  union all
  select '4 intact', '>>> signup repair still in place',
         coalesce((select case when p.prosecdef
                                 or lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    ~ '(insert|update|delete|merge)\s'
                               then 'HOOK REGRESSED' else 'no-op intact' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'no-op intact',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and not p.prosecdef
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge)\s')
              then 'PASS' else 'STOP' end

) as t order by 1, 2;
