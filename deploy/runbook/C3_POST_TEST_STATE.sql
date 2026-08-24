-- ============================================================================
-- MENU MASTER NG — POST-ACCEPTANCE-TEST STATE VERIFICATION
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run after the signup acceptance test was rolled back. It proves the rollback
-- discarded the temporary tenant completely, that 0019c is still in place, and
-- that nothing else moved.
--
-- WHY THIS IS NOT C3_0019C_GATE.sql
--   That gate asserts auth.users = 5. The acceptance test required a real user
--   to be created through Supabase Auth, so the correct count is now 6: the
--   five pre-existing users plus one test user. Re-running the old gate would
--   report a correct state as a failure. The baseline is re-pinned here, and
--   the five originals are still asserted to be untouched.
--
-- PASS only if every '>>>' row reads PASS.
-- ============================================================================

select * from (

  -- 1. THE ROLLBACK DISCARDED EVERYTHING ------------------------------------
  select '1 rollback' as section,
         '>>> accounts / businesses / memberships / profiles' as item,
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text || ' / ' ||
         (select count(*) from profiles)::text as observed,
         '0 / 0 / 0 / 0 -- the test tenant must be gone' as expected,
         case when (select count(*) from accounts) = 0
               and (select count(*) from businesses) = 0
               and (select count(*) from memberships) = 0
               and (select count(*) from profiles) = 0
              then 'PASS' else 'STOP' end as "verdict >>>"
  union all
  select '1 rollback', '>>> locations / business_settings / channels',
         (select count(*) from locations)::text || ' / ' ||
         (select count(*) from business_settings)::text || ' / ' ||
         (select count(*) from channels)::text,
         '0 / 0 / 0',
         case when (select count(*) from locations) = 0
               and (select count(*) from business_settings) = 0
               and (select count(*) from channels) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 rollback', '>>> ingredients / ingredient_prices / subscriptions',
         (select count(*) from ingredients)::text || ' / ' ||
         (select count(*) from ingredient_prices)::text || ' / ' ||
         (select count(*) from subscriptions)::text,
         '0 / 0 / 0 -- the 180 cloned ingredients must be gone too',
         case when (select count(*) from ingredients) = 0
               and (select count(*) from ingredient_prices) = 0
               and (select count(*) from subscriptions) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 rollback', '>>> no orphan rows anywhere tenant-scoped',
         (select count(*) from recipes)::text || ' recipes / ' ||
         (select count(*) from suppliers)::text || ' suppliers / ' ||
         (select count(*) from ingredient_categories)::text || ' categories',
         '0 / 0 / 0',
         case when (select count(*) from recipes) = 0
               and (select count(*) from suppliers) = 0
               and (select count(*) from ingredient_categories) = 0
              then 'PASS' else 'STOP' end

  -- 2. THE AUTH USERS --------------------------------------------------------
  union all
  select '2 users', '>>> auth.users (new baseline)',
         (select count(*)::text from auth.users),
         '6 -- five pre-existing plus one acceptance-test user',
         case when (select count(*) from auth.users) = 6 then 'PASS' else 'STOP' end
  union all
  select '2 users', '>>> the five originals are untouched',
         (select count(*)::text from auth.users
           where created_at < '2026-08-15'::timestamptz),
         '5 -- created 2026-08-10..14, never modified',
         case when (select count(*) from auth.users
                     where created_at < '2026-08-15'::timestamptz) = 5
              then 'PASS' else 'STOP' end
  union all
  select '2 users', 'the acceptance-test user (delete separately if you wish)',
         coalesce((select 'user ' || substr(md5(coalesce(u.email, u.id::text)), 1, 8)
                        || ' created ' || left(u.created_at::text, 19)
                     from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz
                    order by u.created_at desc limit 1), 'none'),
         'one recent user; removing it is optional and separate',
         'OPERATOR CHOICE'
  union all
  select '2 users', '>>> no auth user holds a tenant',
         (select count(*)::text from auth.users u
           where exists (select 1 from memberships m where m.user_id = u.id)),
         '0 -- including the five stranded users, still stranded',
         case when not exists (select 1 from auth.users u
                                where exists (select 1 from memberships m
                                               where m.user_id = u.id))
              then 'PASS' else 'STOP' end

  -- 3. 0019c STILL IN PLACE --------------------------------------------------
  union all
  select '3 hook', '>>> handle_new_user is still the neutralised no-op',
         coalesce((select case
                     when lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                          ~ '(insert|update|delete|merge|truncate|perform|execute)\s'
                       then 'A DATA STATEMENT REAPPEARED'
                     when p.prosecdef then 'SECURITY DEFINER AGAIN'
                     else 'no-op, SECURITY INVOKER' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'no-op, SECURITY INVOKER',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and not p.prosecdef
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge|truncate|perform|execute)\s')
              then 'PASS' else 'STOP' end
  union all
  select '3 hook', '>>> trigger still present and enabled',
         coalesce((select t.tgname || ' enabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='auth' and c.relname='users'
                      and not t.tgisinternal), 'MISSING'),
         'on_auth_user_created enabled=O',
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='auth' and c.relname='users'
                             and not t.tgisinternal
                             and t.tgname='on_auth_user_created' and t.tgenabled='O')
              then 'PASS' else 'STOP' end
  union all
  select '3 hook', 'live definition md5 (reported, not gated)',
         coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT'),
         'e506880513e139ce688e88f643503198 as captured after 0019c',
         'INFORMATIONAL'

  -- 4. REFERENCE DATA AND PART 5 --------------------------------------------
  union all
  select '4 reference', '>>> units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text || ' / ' ||
         (select count(*) from catalog_categories)::text || ' / ' ||
         (select count(*) from catalog_ingredients)::text,
         '45 / 16 / 180',
         case when (select count(*) from units) = 45
               and (select count(*) from catalog_categories) = 16
               and (select count(*) from catalog_ingredients) = 180
              then 'PASS' else 'STOP' end
  union all
  select '4 reference', '>>> plans / plan_features',
         (select count(*) from plans)::text || ' / ' ||
         (select count(*) from plan_features)::text,
         '3 / 12',
         case when (select count(*) from plans) = 3
               and (select count(*) from plan_features) = 12
              then 'PASS' else 'STOP' end
  union all
  select '4 reference', '>>> PART 5 intact: fn_* / relations / policies',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' / ' ||
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) || ' / ' ||
         (select count(*)::text from pg_policies where schemaname='public'),
         '40 / 43 / 92',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%') = 40
               and (select count(*) from pg_class
                     where relnamespace='public'::regnamespace
                       and relkind in ('r','p','v','m','f')) = 43
               and (select count(*) from pg_policies where schemaname='public') = 92
              then 'PASS' else 'STOP' end
  union all
  select '4 reference', '>>> anon still holds SELECT only, no fn_ EXECUTE',
         (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type),'none')
            from information_schema.role_table_grants
           where table_schema='public' and grantee='anon')
         || ' / ' ||
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%'
             and has_function_privilege('anon', oid, 'EXECUTE')),
         'SELECT / 0',
         case when (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'none')
                      from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon') in ('SELECT','none')
               and (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%'
                       and has_function_privilege('anon', oid, 'EXECUTE')) = 0
              then 'PASS' else 'STOP' end

) as t order by 1, 2;
