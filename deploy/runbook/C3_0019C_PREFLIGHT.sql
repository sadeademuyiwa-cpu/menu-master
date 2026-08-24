-- ============================================================================
-- MENU MASTER NG — 0019c PREFLIGHT
--
--   *** PURE SELECT. Single statement. No state change whatsoever. ***
--
-- Run immediately before 0019c. It proves production is in the exact condition
-- 0019c was designed against, and it CAPTURES the current definition of
-- public.handle_new_user() so that a byte-exact rollback can be authored.
--
-- ON THE "PRE-0019c FINGERPRINT"
--   No such fingerprint exists yet. The full text of production's
--   handle_new_user has never been seen -- only its first 70 characters, from
--   a screenshot. This preflight therefore ESTABLISHES the baseline rather
--   than comparing against one, and asserts the structural properties that
--   were verified: owner, security attribute, language, argument count,
--   return type, and that the body still writes to `vendors`.
--
--   Row "9 baseline / full definition" is the authoritative record. It is also
--   the input to the rollback script, which cannot be finalised until it is
--   returned.
--
-- PROCEED only if every '>>>' row reads GO.
-- ============================================================================

select * from (

  -- 1. SESSION ---------------------------------------------------------------
  select '1 session' as section, 'current_user / session_user' as item,
         current_user || ' / ' || session_user as observed,
         'postgres / postgres' as expected,
         case when current_user = 'postgres' then 'GO' else 'STOP' end as "verdict >>>"
  union all
  select '1 session', 'server version',
         substring(version() from 'PostgreSQL [0-9.]+'), 'PostgreSQL 17.6', 'INFORMATIONAL'

  -- 2. THE FUNCTION ----------------------------------------------------------
  union all
  select '2 function', 'public.handle_new_user exists',
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user') then 'yes' else 'ABSENT' end,
         'yes',
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user') then 'GO' else 'STOP' end
  union all
  select '2 function', 'owner',
         coalesce((select p.proowner::regrole::text from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT'),
         'postgres',
         case when (select p.proowner::regrole::text from pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user') = 'postgres'
              then 'GO' else 'STOP' end
  union all
  select '2 function', '>>> current role owns it (replace allowed)',
         coalesce((select case when pg_has_role(current_user, p.proowner, 'USAGE')
                               then 'YES' else 'NO' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'YES',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and pg_has_role(current_user, p.proowner, 'USAGE'))
              then 'GO' else 'STOP' end
  union all
  select '2 function', 'signature: args / returns / language',
         coalesce((select p.pronargs::text || ' args / ' ||
                          p.prorettype::regtype::text || ' / ' || l.lanname
                     from pg_proc p join pg_language l on l.oid = p.prolang
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT'),
         '0 args / trigger / plpgsql',
         case when exists (select 1 from pg_proc p join pg_language l on l.oid=p.prolang
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and p.pronargs = 0
                              and p.prorettype = 'trigger'::regtype
                              and l.lanname = 'plpgsql')
              then 'GO' else 'STOP' end
  union all
  select '2 function', 'security attribute + config (needed for rollback)',
         coalesce((select case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
                          || '  config=' || coalesce(array_to_string(p.proconfig, ','), '(none)')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'SECURITY DEFINER, config as recorded',
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user' and prosecdef)
              then 'GO' else 'STOP' end
  union all
  select '2 function', '>>> body still writes to vendors (still the broken one)',
         coalesce((select case when lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    like '%insert into vendors%'
                               then 'yes' else 'BODY ALREADY CHANGED' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'yes',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  like '%insert into vendors%')
              then 'GO' else 'STOP' end
  union all
  select '2 function', 'not extension-owned',
         case when exists (select 1 from pg_depend d join pg_proc p on p.oid=d.objid
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and d.deptype='e')
              then 'EXTENSION-OWNED' else 'no' end,
         'no',
         case when not exists (select 1 from pg_depend d join pg_proc p on p.oid=d.objid
                                where p.pronamespace='public'::regnamespace
                                  and p.proname='handle_new_user' and d.deptype='e')
              then 'GO' else 'STOP' end
  union all
  select '2 function', 'triggers on PUBLIC tables using it (must be none)',
         coalesce((select string_agg(t.tgrelid::regclass::text||'.'||t.tgname, ', ')
                     from pg_trigger t join pg_proc p on p.oid=t.tgfoid
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'
                      and not t.tgisinternal
                      and t.tgrelid::regclass::text not like 'auth.%'), 'none'),
         'none',
         case when not exists (select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
                                where p.pronamespace='public'::regnamespace
                                  and p.proname='handle_new_user' and not t.tgisinternal
                                  and t.tgrelid::regclass::text not like 'auth.%')
              then 'GO' else 'STOP' end

  -- 3. THE TRIGGER (must remain untouched) -----------------------------------
  union all
  select '3 trigger', '>>> name, timing, level, enabled',
         coalesce((select t.tgname
                        || case when (t.tgtype & 2)=2 then ' BEFORE' else ' AFTER' end
                        || case when (t.tgtype & 4)=4 then ' INSERT' else '' end
                        || case when (t.tgtype & 1)=1 then ' ROW' else ' STATEMENT' end
                        || ' enabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal),
                  'none'),
         'on_auth_user_created AFTER INSERT ROW enabled=O',
         case when (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal) = 1
               and exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='auth' and c.relname='users'
                             and not t.tgisinternal
                             and t.tgname='on_auth_user_created'
                             and (t.tgtype & 2)=0 and (t.tgtype & 4)=4
                             and (t.tgtype & 1)=1 and t.tgenabled='O')
              then 'GO' else 'STOP' end
  union all
  select '3 trigger', 'auth.users owner (we do NOT touch this)',
         coalesce((select c.relowner::regrole::text from pg_class c
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users'), 'ABSENT'),
         'supabase_auth_admin -- unchanged by 0019c', 'INFORMATIONAL'

  -- 4. THE TARGET ------------------------------------------------------------
  union all
  select '4 target', '>>> a relation named vendors',
         coalesce((select string_agg(n.nspname||'.'||c.relname, ', ')
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where c.relname='vendors'), 'none'),
         'none -- if one appeared the hook may work; STOP and re-analyse',
         case when not exists (select 1 from pg_class where relname='vendors')
              then 'GO' else 'STOP' end

  -- 5. USERS (must be untouched, exactly 5) ----------------------------------
  union all
  select '5 users', '>>> auth.users count',
         (select count(*)::text from auth.users), '5 exactly',
         case when (select count(*) from auth.users)=5 then 'GO' else 'STOP' end

  -- 6. TENANT DATA (must still be empty) -------------------------------------
  union all
  select '6 tenant', '>>> accounts / businesses / memberships / profiles',
         (select count(*) from accounts)::text||' / '||
         (select count(*) from businesses)::text||' / '||
         (select count(*) from memberships)::text||' / '||
         (select count(*) from profiles)::text,
         '0 / 0 / 0 / 0',
         case when (select count(*) from accounts)=0
               and (select count(*) from businesses)=0
               and (select count(*) from memberships)=0
               and (select count(*) from profiles)=0
              then 'GO' else 'STOP' end

  -- 7. REFERENCE DATA (must be unchanged) ------------------------------------
  union all
  select '7 reference', '>>> units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text||' / '||
         (select count(*) from catalog_categories)::text||' / '||
         (select count(*) from catalog_ingredients)::text,
         '45 / 16 / 180',
         case when (select count(*) from units)=45
               and (select count(*) from catalog_categories)=16
               and (select count(*) from catalog_ingredients)=180
              then 'GO' else 'STOP' end
  union all
  select '7 reference', '>>> plans / plan_features / ingredient_prices',
         (select count(*) from plans)::text||' / '||
         (select count(*) from plan_features)::text||' / '||
         (select count(*) from ingredient_prices)::text,
         '3 / 12 / 0',
         case when (select count(*) from plans)=3
               and (select count(*) from plan_features)=12
               and (select count(*) from ingredient_prices)=0
              then 'GO' else 'STOP' end

  -- 8. PART 5 STILL INTACT (0019c must not disturb it) -----------------------
  union all
  select '8 part5', 'fn_* functions / relations / policies',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%')||' / '||
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f'))||' / '||
         (select count(*)::text from pg_policies where schemaname='public'),
         '40 / 43 / 92',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%')=40
               and (select count(*) from pg_class
                     where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f'))=43
               and (select count(*) from pg_policies where schemaname='public')=92
              then 'GO' else 'STOP' end

  -- 9. BASELINE CAPTURE ------------------------------------------------------
  union all
  select '9 baseline', 'md5 of the current definition',
         coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT'),
         'record this -- it is the pre-0019c fingerprint', 'CAPTURE'
  union all
  select '9 baseline', 'full definition (SEND THIS BACK -- rollback depends on it)',
         coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT'),
         'the exact text to restore on rollback', 'CAPTURE'

) as t order by 1, 2;
