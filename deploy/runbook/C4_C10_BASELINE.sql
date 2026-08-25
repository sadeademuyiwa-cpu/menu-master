-- ============================================================================
-- MENU MASTER NG — C10 STAGE, STEP 1: baseline capture
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- C10 will change fn_create_account_and_business. Before any migration is
-- written, this captures what production actually holds, transport-safely.
--
-- WHY BASE64 AGAIN
--   The same CSV export that silently stripped CRLF from handle_new_user will
--   do it to this function too. Row "2 payload" is base64 on a single line and
--   survives copy-paste unchanged; row "1 fingerprint" verifies it. A rollback
--   for C10 cannot be authored from text that may have been altered in transit.
--
-- WHAT THIS ANSWERS
--   * exactly which overload(s) exist, and their full signatures
--   * the owner, security attribute and search_path config
--   * who holds EXECUTE, which the migration must re-grant identically
--   * whether onboarding_requests already exists (it must not)
--   * whether the constraints C10 relies on are in place
--   * that the repaired signup path and PART 5 are still intact
--
-- PROCEED only if every '>>>' row reads GO.
-- ============================================================================

select * from (

  select '1 session' as section, 'current_user / version' as item,
         current_user || ' / ' || substring(version() from 'PostgreSQL [0-9.]+') as observed,
         'postgres / PostgreSQL 17.6' as expected, 'INFORMATIONAL' as "verdict >>>"

  -- 2. THE ONBOARDING RPC ----------------------------------------------------
  union all
  select '2 rpc', '>>> exactly one overload exists',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace
             and proname='fn_create_account_and_business'),
         '1 -- more than one means PostgREST could resolve ambiguously',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace
                       and proname='fn_create_account_and_business') = 1
              then 'GO' else 'STOP' end
  union all
  select '2 rpc', '>>> full signature',
         coalesce((select string_agg(p.oid::regprocedure::text, '  |  ')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
         case when (select coalesce(string_agg(p.oid::regprocedure::text, '|'), '')
                      from pg_proc p where p.pronamespace='public'::regnamespace
                        and p.proname='fn_create_account_and_business')
                   = 'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)'
              then 'GO' else 'STOP' end
  union all
  select '2 rpc', 'owner / security / config',
         coalesce((select p.proowner::regrole::text
                        || ' / ' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end
                        || ' / ' || coalesce(array_to_string(p.proconfig, ','), '(none)')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'postgres / DEFINER / search_path=public', 'INFORMATIONAL'
  union all
  select '2 rpc', '>>> roles holding EXECUTE (must be re-granted identically)',
         coalesce((select string_agg(r.rolname, ', ' order by r.rolname)
                     from pg_roles r, pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='fn_create_account_and_business'
                      and r.rolname in ('anon','authenticated','service_role')
                      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 'none'),
         'authenticated, service_role -- and NOT anon',
         case when (select coalesce(string_agg(r.rolname, ',' order by r.rolname), '')
                      from pg_roles r, pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'
                       and r.rolname in ('anon','authenticated','service_role')
                       and has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
                   in ('authenticated,service_role','authenticated')
              then 'GO' else 'STOP' end

  -- 3. TRANSPORT-SAFE CAPTURE ------------------------------------------------
  union all
  select '3 fingerprint', 'md5 of the definition',
         coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'record this -- it is the pre-C10 fingerprint', 'CAPTURE'
  union all
  select '3 fingerprint', 'byte length',
         coalesce((select octet_length(convert_to(pg_get_functiondef(p.oid),'UTF8'))::text
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'cross-checks the decode', 'CAPTURE'
  union all
  select '4 payload', 'base64 of the definition, single line -- COPY WHOLE',
         coalesce((select replace(
                            encode(convert_to(pg_get_functiondef(p.oid),'UTF8'),'base64'),
                            chr(10), '')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'the input to the C10 rollback', 'CAPTURE'

  -- 5. C10 PRECONDITIONS -----------------------------------------------------
  union all
  select '5 preconditions', '>>> onboarding_requests must NOT already exist',
         case when exists (select 1 from pg_class
                            where relname='onboarding_requests') then 'ALREADY EXISTS'
              else 'absent' end,
         'absent -- C10 creates it',
         case when not exists (select 1 from pg_class where relname='onboarding_requests')
              then 'GO' else 'STOP' end
  union all
  select '5 preconditions', '>>> constraints C10 builds on',
         (case when exists (select 1 from pg_class where relname='ux_subscriptions_account')
               then 'ux_subscriptions_account' else 'MISSING ux_subscriptions_account' end)
         || ' / ' ||
         (case when exists (select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
                             where t.relname='businesses' and c.contype='u'
                               and pg_get_constraintdef(c.oid) like '%account_id, slug%')
               then 'businesses(account_id,slug)' else 'MISSING businesses unique' end),
         'both present',
         case when exists (select 1 from pg_class where relname='ux_subscriptions_account')
               and exists (select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
                            where t.relname='businesses' and c.contype='u'
                              and pg_get_constraintdef(c.oid) like '%account_id, slug%')
              then 'GO' else 'STOP' end
  union all
  select '5 preconditions', '>>> starter-catalogue cloner present',
         case when exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                            and proname='fn_clone_starter_catalog') then 'present' else 'ABSENT' end,
         'present -- C10 must not make it re-clone for a second business',
         case when exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                            and proname='fn_clone_starter_catalog')
              then 'GO' else 'STOP' end

  -- 6. STATE UNCHANGED SINCE THE SIGNUP REPAIR -------------------------------
  union all
  select '6 state', '>>> auth.users / accounts / businesses / memberships',
         (select count(*) from auth.users)::text || ' / ' ||
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text,
         '5 / 0 / 0 / 0',
         case when (select count(*) from auth.users)=5
               and (select count(*) from accounts)=0
               and (select count(*) from businesses)=0
               and (select count(*) from memberships)=0
              then 'GO' else 'STOP' end
  union all
  select '6 state', '>>> signup still repaired (hook still a no-op)',
         coalesce((select case when p.prosecdef
                                 or lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    ~ '(insert|update|delete|merge)\s'
                               then 'HOOK REGRESSED' else 'still neutralised' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'still neutralised',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and not p.prosecdef
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge)\s')
              then 'GO' else 'STOP' end
  union all
  select '6 state', '>>> PART 5 intact: fn_* / relations / policies',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' / ' ||
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) || ' / ' ||
         (select count(*)::text from pg_policies where schemaname='public'),
         '40 / 43 / 92',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%')=40
               and (select count(*) from pg_class
                     where relnamespace='public'::regnamespace
                       and relkind in ('r','p','v','m','f'))=43
               and (select count(*) from pg_policies where schemaname='public')=92
              then 'GO' else 'STOP' end

) as t order by 1, 2;
