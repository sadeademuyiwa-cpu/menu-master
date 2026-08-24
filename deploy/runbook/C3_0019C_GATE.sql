-- ============================================================================
-- MENU MASTER NG — POST-0019c VERIFICATION GATE
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run immediately after 0019c. This is a NEW gate. It deliberately does NOT
-- reuse the PART 5 foreign-hook assertions, which required handle_new_user to
-- be unchanged and SECURITY DEFINER with a body still targeting `vendors`.
-- After 0019c those expectations are inverted on purpose, and reusing the old
-- gate would report a correct repair as a failure.
--
-- WHAT IS NOW EXPECTED
--   handle_new_user ....... still present, but neutralised
--   the trigger ........... still present and still ENABLED (we never touch it)
--   the body .............. performs no statement; it only returns NEW
--   vendors ............... still absent, and nothing references it any more
--   signup ................ structurally unblocked (live proof is Step 5)
--
-- ON THE FUNCTION FINGERPRINT
--   The md5 of the new definition is reported but NOT gated. Production's
--   original body was stored with CRLF line endings, and a CSV export of it
--   silently stripped them once already. If the SQL Editor introduces or
--   normalises line endings while 0019c is pasted, the md5 would differ while
--   the function is semantically identical. Gating on it would produce a false
--   STOP. The semantic properties below are gated instead: they are what
--   actually matter and they are immune to whitespace.
--
-- The gate is PASS only if every '>>>' row reads PASS.
-- ============================================================================

select * from (

  -- 1. THE NEUTRALISED FUNCTION ---------------------------------------------
  select '1 function' as section, '>>> handle_new_user still present' as item,
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user') then 'yes' else 'ABSENT' end as observed,
         'yes -- 0019c must NOT remove it' as expected,
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user') then 'PASS' else 'STOP' end as "verdict >>>"
  union all
  select '1 function', '>>> body performs no write to vendors',
         coalesce((select case when lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    like '%insert into vendors%'
                               then 'STILL WRITES TO VENDORS' else 'no' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'no',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  not like '%insert into vendors%')
              then 'PASS' else 'STOP' end
  union all
  select '1 function', '>>> body performs NO data statement at all',
         coalesce((select case when lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    ~ '(insert|update|delete|merge|truncate|perform|execute)\s'
                               then 'A DATA STATEMENT IS PRESENT' else 'none' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'none -- the no-op must read and write nothing',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge|truncate|perform|execute)\s')
              then 'PASS' else 'STOP' end
  union all
  select '1 function', '>>> body returns new',
         coalesce((select case when lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    like '%return new%' then 'yes' else 'NO' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'yes',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g')) like '%return new%')
              then 'PASS' else 'STOP' end
  union all
  select '1 function', '>>> no longer SECURITY DEFINER',
         coalesce((select case when p.prosecdef then 'STILL SECURITY DEFINER'
                               else 'SECURITY INVOKER' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'SECURITY INVOKER',
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user' and not prosecdef)
              then 'PASS' else 'STOP' end
  union all
  select '1 function', '>>> search_path pinned',
         coalesce((select coalesce(array_to_string(p.proconfig,','),'(none)')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'search_path=pg_catalog',
         case when exists (select 1 from pg_proc
                            where pronamespace='public'::regnamespace
                              and proname='handle_new_user'
                              and 'search_path=pg_catalog' = any(proconfig))
              then 'PASS' else 'STOP' end
  union all
  select '1 function', 'owner and signature unchanged',
         coalesce((select p.proowner::regrole::text||' / '||p.pronargs::text||' args / '
                          ||p.prorettype::regtype::text
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'postgres / 0 args / trigger',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and p.proowner::regrole::text='postgres'
                              and p.pronargs=0 and p.prorettype='trigger'::regtype)
              then 'PASS' else 'STOP' end
  union all
  select '1 function', 'definition md5 (reported, not gated)',
         coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT'),
         '874ac8926c77b3ce65c894426cc6363c on the reference build; may differ '
         'if the editor normalised line endings', 'INFORMATIONAL'

  -- 2. THE TRIGGER — MUST BE UNTOUCHED --------------------------------------
  union all
  select '2 trigger', '>>> still present, AFTER INSERT ROW, still ENABLED',
         coalesce((select t.tgname
                        || case when (t.tgtype & 2)=2 then ' BEFORE' else ' AFTER' end
                        || case when (t.tgtype & 4)=4 then ' INSERT' else '' end
                        || case when (t.tgtype & 1)=1 then ' ROW' else ' STATEMENT' end
                        || ' enabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal),
                  'MISSING'),
         'on_auth_user_created AFTER INSERT ROW enabled=O',
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='auth' and c.relname='users' and not t.tgisinternal
                             and t.tgname='on_auth_user_created'
                             and (t.tgtype & 2)=0 and (t.tgtype & 4)=4
                             and (t.tgtype & 1)=1 and t.tgenabled='O')
              then 'PASS' else 'STOP' end
  union all
  select '2 trigger', 'auth.users owner (never touched by 0019c)',
         coalesce((select c.relowner::regrole::text from pg_class c
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users'), 'ABSENT'),
         'supabase_auth_admin', 'INFORMATIONAL'

  -- 3. SIGNUP STRUCTURALLY UNBLOCKED ----------------------------------------
  union all
  select '3 signup', '>>> nothing in the hook references a missing relation',
         case when not exists (select 1 from pg_class where relname='vendors')
               and exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge)\s')
              then 'clear -- the hook can no longer raise'
              else 'NOT CLEAR' end,
         'clear (live proof is the Step 5 signup test)',
         case when not exists (select 1 from pg_class where relname='vendors')
               and exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user'
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge)\s')
              then 'PASS' else 'STOP' end
  union all
  select '3 signup', '>>> a relation named vendors',
         coalesce((select string_agg(n.nspname||'.'||c.relname, ', ')
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where c.relname='vendors'), 'none'),
         'none',
         case when not exists (select 1 from pg_class where relname='vendors')
              then 'PASS' else 'STOP' end

  -- 4. USERS AND TENANT DATA — MUST BE UNCHANGED ----------------------------
  union all
  select '4 data', '>>> auth.users (before any signup test)',
         (select count(*)::text from auth.users), '5 exactly',
         case when (select count(*) from auth.users)=5 then 'PASS' else 'STOP' end
  union all
  select '4 data', '>>> accounts / businesses / memberships / profiles',
         (select count(*) from accounts)::text||' / '||
         (select count(*) from businesses)::text||' / '||
         (select count(*) from memberships)::text||' / '||
         (select count(*) from profiles)::text,
         '0 / 0 / 0 / 0',
         case when (select count(*) from accounts)=0 and (select count(*) from businesses)=0
               and (select count(*) from memberships)=0 and (select count(*) from profiles)=0
              then 'PASS' else 'STOP' end
  union all
  select '4 data', '>>> units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text||' / '||
         (select count(*) from catalog_categories)::text||' / '||
         (select count(*) from catalog_ingredients)::text,
         '45 / 16 / 180',
         case when (select count(*) from units)=45 and (select count(*) from catalog_categories)=16
               and (select count(*) from catalog_ingredients)=180
              then 'PASS' else 'STOP' end
  union all
  select '4 data', '>>> plans / plan_features / ingredient_prices',
         (select count(*) from plans)::text||' / '||
         (select count(*) from plan_features)::text||' / '||
         (select count(*) from ingredient_prices)::text,
         '3 / 12 / 0',
         case when (select count(*) from plans)=3 and (select count(*) from plan_features)=12
               and (select count(*) from ingredient_prices)=0
              then 'PASS' else 'STOP' end

  -- 5. PART 5 STILL INTACT ---------------------------------------------------
  union all
  select '5 part5', '>>> fn_* / relations / policies',
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
              then 'PASS' else 'STOP' end
  union all
  select '5 part5', '>>> no new non-fn_ function appeared',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname not like 'fn\_%'
                      and not exists (select 1 from pg_depend d
                                       where d.objid=p.oid and d.deptype='e')), 'none'),
         'handle_new_user, and nothing else',
         case when (select coalesce(string_agg(p.proname, ','),'none') from pg_proc p
                     where p.pronamespace='public'::regnamespace and p.proname not like 'fn\_%'
                       and not exists (select 1 from pg_depend d
                                        where d.objid=p.oid and d.deptype='e'))
                   = 'handle_new_user'
              then 'PASS' else 'STOP' end

  -- 6. GRANTS AND ISOLATION — MUST BE UNCHANGED -----------------------------
  union all
  select '6 grants', '>>> anon SELECT tables',
         (select coalesce(string_agg(distinct table_name, ', ' order by table_name),'none')
            from information_schema.role_table_grants
           where table_schema='public' and grantee='anon' and privilege_type='SELECT'),
         'catalog_categories, catalog_ingredients, plan_features, plans, units',
         case when (select coalesce(string_agg(distinct table_name, ',' order by table_name),'')
                      from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon' and privilege_type='SELECT')
                   = 'catalog_categories,catalog_ingredients,plan_features,plans,units'
              then 'PASS' else 'STOP' end
  union all
  select '6 grants', '>>> anon privilege types / fn_* EXECUTE',
         (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'none')
            from information_schema.role_table_grants
           where table_schema='public' and grantee='anon')
         ||' / '||
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%'
             and has_function_privilege('anon', oid, 'EXECUTE')),
         'SELECT / 0',
         case when (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'none')
                      from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon') in ('SELECT','none')
               and (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%'
                       and has_function_privilege('anon', oid, 'EXECUTE'))=0
              then 'PASS' else 'STOP' end
  union all
  select '6 grants', '>>> authenticated TRUNCATE/TRIGGER/REFERENCES',
         (select coalesce(string_agg(distinct table_name||':'||privilege_type, ', '),'none')
            from information_schema.role_table_grants
           where table_schema='public' and grantee='authenticated'
             and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')),
         'none',
         case when not exists (select 1 from information_schema.role_table_grants
                                where table_schema='public' and grantee='authenticated'
                                  and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES'))
              then 'PASS' else 'STOP' end
  union all
  select '6 grants', '>>> onboarding RPC executable by authenticated',
         case when has_function_privilege('authenticated',
                'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
                'EXECUTE') then 'yes' else 'NO -- signup could not complete' end,
         'yes',
         case when has_function_privilege('authenticated',
                'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
                'EXECUTE') then 'PASS' else 'STOP' end
  union all
  select '6 grants', '>>> service_role untouched',
         case when exists (select 1 from information_schema.role_table_grants
                            where table_schema='public' and grantee='service_role')
              then 'present' else 'MISSING' end,
         'present',
         case when exists (select 1 from information_schema.role_table_grants
                            where table_schema='public' and grantee='service_role')
              then 'PASS' else 'STOP' end
  union all
  select '6 grants', 'grants fingerprint',
         (select substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type,'|'
                        order by grantee,table_name,privilege_type)),1,12)
            from information_schema.role_table_grants
           where table_schema='public' and grantee in ('anon','authenticated')),
         '8ac70f63e534 -- unchanged from PART 5', 'INFORMATIONAL'
  union all
  select '6 grants', 'policies fingerprint',
         (select substr(md5(string_agg(tablename||'.'||policyname||'.'||cmd||'.'
                        ||coalesce(qual,'')||'.'||coalesce(with_check,''),'|'
                        order by tablename,policyname)),1,12)
            from pg_policies where schemaname='public'),
         'b0ce58371195 -- unchanged from PART 5', 'INFORMATIONAL'

  -- 7. ANON REFERENCE ACCESS -------------------------------------------------
  union all
  select '7 anon read', '>>> no anon-readable table has an unscoped fn_ policy',
         coalesce((select string_agg(distinct p.tablename||'.'||p.policyname, ', ')
                     from pg_policies p
                    where p.schemaname='public'
                      and p.tablename in (select table_name
                                            from information_schema.role_table_grants
                                           where table_schema='public' and grantee='anon'
                                             and privilege_type='SELECT')
                      and coalesce(p.qual,'')||coalesce(p.with_check,'') like '%fn\_%' escape '\'
                      and not ('authenticated' = any(p.roles))), 'none'),
         'none -- run tests/010 for the live read proof',
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

) as t order by 1, 2;
