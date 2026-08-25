-- ============================================================================
-- MENU MASTER NG — POST-0020 (C10) VERIFICATION GATE
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run immediately after 0020. Verifies the idempotency machinery is present
-- and correctly constrained, that the RPC was replaced cleanly with exactly
-- one overload, that no privilege leaked to anon or PUBLIC, and that nothing
-- else moved.
--
-- PASS only if every '>>>' row reads PASS.
-- ============================================================================

-- The ledger row count is read through dynamic SQL. A static reference to
-- onboarding_requests would fail at PARSE time on a database where 0020 did
-- not apply -- returning no rows at all instead of STOPping, which is exactly
-- the situation where this gate is most needed as a diagnostic.
do $gate$
declare v_n text;
begin
  if exists (select 1 from pg_class c
              where c.relnamespace = 'public'::regnamespace
                and c.relname = 'onboarding_requests' and c.relkind = 'r') then
    execute 'select count(*)::text from onboarding_requests' into v_n;
  else
    v_n := 'TABLE ABSENT';
  end if;
  perform set_config('mm.ledger_rows', v_n, false);
end
$gate$;

select * from (

  -- 1. THE LEDGER ------------------------------------------------------------
  select '1 ledger' as section, '>>> onboarding_requests exists' as item,
         case when exists (select 1 from pg_class c
                            where c.relnamespace='public'::regnamespace
                              and c.relname='onboarding_requests' and c.relkind='r')
              then 'yes' else 'MISSING' end as observed,
         'yes' as expected,
         case when exists (select 1 from pg_class c
                            where c.relnamespace='public'::regnamespace
                              and c.relname='onboarding_requests' and c.relkind='r')
              then 'PASS' else 'STOP' end as "verdict >>>"
  union all
  select '1 ledger', '>>> primary key is (user_id, idempotency_key)',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                     join pg_class t on t.oid=c.conrelid
                    where t.relname='onboarding_requests' and c.contype='p'), 'MISSING'),
         'PRIMARY KEY (user_id, idempotency_key)',
         case when exists (select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
                            where t.relname='onboarding_requests' and c.contype='p'
                              and pg_get_constraintdef(c.oid)
                                  = 'PRIMARY KEY (user_id, idempotency_key)')
              then 'PASS' else 'STOP' end
  union all
  select '1 ledger', '>>> blank-key check constraint present',
         case when exists (select 1 from pg_constraint
                            where conname='ck_onboarding_key_nonblank')
              then 'present' else 'MISSING' end, 'present',
         case when exists (select 1 from pg_constraint
                            where conname='ck_onboarding_key_nonblank')
              then 'PASS' else 'STOP' end
  union all
  select '1 ledger', '>>> RLS enabled',
         coalesce((select case when c.relrowsecurity then 'enabled' else 'DISABLED' end
                     from pg_class c where c.relnamespace='public'::regnamespace
                       and c.relname='onboarding_requests'), 'MISSING'),
         'enabled',
         case when exists (select 1 from pg_class c
                            where c.relnamespace='public'::regnamespace
                              and c.relname='onboarding_requests' and c.relrowsecurity)
              then 'PASS' else 'STOP' end
  union all
  select '1 ledger', '>>> policy scoped to authenticated, self-rows only',
         coalesce((select p.policyname || ' ' || p.cmd || ' roles=' || p.roles::text
                        || ' using=' || coalesce(p.qual,'-')
                     from pg_policies p where p.schemaname='public'
                       and p.tablename='onboarding_requests'), 'MISSING'),
         'p_onboarding_requests SELECT roles={authenticated} using=(user_id = auth.uid())',
         case when exists (select 1 from pg_policies p
                            where p.schemaname='public'
                              and p.tablename='onboarding_requests'
                              and p.policyname='p_onboarding_requests'
                              and p.cmd='SELECT'
                              and 'authenticated' = any(p.roles)
                              and p.qual like '%auth.uid()%')
              then 'PASS' else 'STOP' end
  union all
  select '1 ledger', '>>> empty (0020 must not have provisioned anything)',
         coalesce(current_setting('mm.ledger_rows', true), 'not collected'), '0',
         case when coalesce(current_setting('mm.ledger_rows', true), '') = '0'
              then 'PASS' else 'STOP' end

  -- 2. LEDGER GRANTS ---------------------------------------------------------
  union all
  select '2 ledger grants', '>>> authenticated holds SELECT and nothing more',
         (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type),'none')
            from information_schema.role_table_grants
           where table_schema='public' and table_name='onboarding_requests'
             and grantee='authenticated'), 'SELECT',
         case when (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'none')
                      from information_schema.role_table_grants
                     where table_schema='public' and table_name='onboarding_requests'
                       and grantee='authenticated') = 'SELECT'
              then 'PASS' else 'STOP' end
  union all
  select '2 ledger grants', '>>> anon holds nothing',
         (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type),'none')
            from information_schema.role_table_grants
           where table_schema='public' and table_name='onboarding_requests'
             and grantee='anon'), 'none',
         case when not exists (select 1 from information_schema.role_table_grants
                                where table_schema='public'
                                  and table_name='onboarding_requests' and grantee='anon')
              then 'PASS' else 'STOP' end

  -- 3. THE RPC ---------------------------------------------------------------
  union all
  select '3 rpc', '>>> exactly one overload survives',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace
             and proname='fn_create_account_and_business'),
         '1 -- two would let PostgREST resolve ambiguously',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace
                       and proname='fn_create_account_and_business') = 1
              then 'PASS' else 'STOP' end
  union all
  select '3 rpc', '>>> new nine-argument signature',
         coalesce((select p.oid::regprocedure::text from pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)',
         case when (select coalesce(string_agg(p.oid::regprocedure::text,'|'),'')
                      from pg_proc p where p.pronamespace='public'::regnamespace
                        and p.proname='fn_create_account_and_business')
                   = 'fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)'
              then 'PASS' else 'STOP' end
  union all
  select '3 rpc', '>>> owner / security / search_path preserved',
         coalesce((select p.proowner::regrole::text
                        || ' / ' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end
                        || ' / ' || coalesce(array_to_string(p.proconfig,','),'(none)')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'postgres / DEFINER / search_path=public',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='fn_create_account_and_business'
                              and p.proowner::regrole::text='postgres'
                              and p.prosecdef
                              and 'search_path=public' = any(p.proconfig))
              then 'PASS' else 'STOP' end
  union all
  select '3 rpc', '>>> body enforces the key and the ledger',
         coalesce((select case
                     when p.prosrc not like '%onboarding_requests%' then 'LEDGER NOT USED'
                     when p.prosrc not like '%idempotency key is required%' then 'KEY NOT ENFORCED'
                     when p.prosrc not like '%advisory_xact_lock%' then 'NO ADVISORY LOCK'
                     when p.prosrc not like '%unique_violation%' then 'NO RACE HANDLER'
                     else 'key enforced, ledger used, lock and race handler present' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'), 'ABSENT'),
         'key enforced, ledger used, lock and race handler present',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='fn_create_account_and_business'
                              and p.prosrc like '%onboarding_requests%'
                              and p.prosrc like '%idempotency key is required%'
                              and p.prosrc like '%advisory_xact_lock%'
                              and p.prosrc like '%unique_violation%')
              then 'PASS' else 'STOP' end

  -- 4. RPC GRANTS ------------------------------------------------------------
  union all
  select '4 rpc grants', '>>> EXECUTE held by authenticated and service_role only',
         coalesce((select string_agg(r.rolname, ', ' order by r.rolname)
                     from pg_roles r, pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='fn_create_account_and_business'
                      and r.rolname in ('anon','authenticated','service_role')
                      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 'none'),
         'authenticated, service_role',
         case when (select coalesce(string_agg(r.rolname, ',' order by r.rolname),'')
                      from pg_roles r, pg_proc p
                     where p.pronamespace='public'::regnamespace
                       and p.proname='fn_create_account_and_business'
                       and r.rolname in ('anon','authenticated','service_role')
                       and has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
                   = 'authenticated,service_role'
              then 'PASS' else 'STOP' end
  union all
  select '4 rpc grants', '>>> no PUBLIC grant (CREATE FUNCTION adds one by default)',
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
              then 'PASS' else 'STOP' end
  union all
  select '4 rpc grants', '>>> anon still executes no Menu Master fn_*',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%'
             and has_function_privilege('anon', oid, 'EXECUTE')), '0',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%'
                       and has_function_privilege('anon', oid, 'EXECUTE')) = 0
              then 'PASS' else 'STOP' end

  -- 5. STRUCTURAL SHIFT ------------------------------------------------------
  union all
  select '5 structure', '>>> fn_* / relations / policies',
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
  select '5 structure', '>>> RLS enabled on every base table',
         coalesce((select string_agg(relname, ', ') from pg_class
                    where relnamespace='public'::regnamespace and relkind='r'
                      and not relrowsecurity), 'none'), 'none',
         case when not exists (select 1 from pg_class
                                where relnamespace='public'::regnamespace
                                  and relkind='r' and not relrowsecurity)
              then 'PASS' else 'STOP' end

  -- 6. NOTHING ELSE MOVED ----------------------------------------------------
  union all
  select '6 unchanged', '>>> auth.users / accounts / businesses / memberships',
         (select count(*) from auth.users)::text || ' / ' ||
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text, '5 / 0 / 0 / 0',
         case when (select count(*) from auth.users) = 5
               and (select count(*) from accounts) = 0
               and (select count(*) from businesses) = 0
               and (select count(*) from memberships) = 0
              then 'PASS' else 'STOP' end
  union all
  select '6 unchanged', '>>> reference data',
         (select count(*) from units)::text || ' / ' ||
         (select count(*) from catalog_categories)::text || ' / ' ||
         (select count(*) from catalog_ingredients)::text || '  and  ' ||
         (select count(*) from plans)::text || ' / ' ||
         (select count(*) from plan_features)::text,
         '45 / 16 / 180  and  3 / 12',
         case when (select count(*) from units)=45
               and (select count(*) from catalog_categories)=16
               and (select count(*) from catalog_ingredients)=180
               and (select count(*) from plans)=3
               and (select count(*) from plan_features)=12
              then 'PASS' else 'STOP' end
  union all
  select '6 unchanged', '>>> signup repair intact',
         coalesce((select case when p.prosecdef
                                 or lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    ~ '(insert|update|delete|merge)\s'
                               then 'HOOK REGRESSED' else 'no-op intact' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT')
         || ' / ' ||
         coalesce((select 'trigger enabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users'
                      and not t.tgisinternal), 'TRIGGER MISSING'),
         'no-op intact / trigger enabled=O',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and not p.prosecdef
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge)\s')
               and exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='auth' and c.relname='users'
                             and not t.tgisinternal and t.tgenabled='O')
              then 'PASS' else 'STOP' end
  union all
  select '6 unchanged', '>>> anon reference surface',
         (select coalesce(string_agg(distinct table_name, ', ' order by table_name),'none')
            from information_schema.role_table_grants
           where table_schema='public' and grantee='anon' and privilege_type='SELECT'),
         'catalog_categories, catalog_ingredients, plan_features, plans, units',
         case when (select coalesce(string_agg(distinct table_name, ',' order by table_name),'')
                      from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon'
                       and privilege_type='SELECT')
                   = 'catalog_categories,catalog_ingredients,plan_features,plans,units'
              then 'PASS' else 'STOP' end
  union all
  select '6 unchanged', 'grants fingerprint',
         (select substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type,'|'
                        order by grantee,table_name,privilege_type)),1,12)
            from information_schema.role_table_grants
           where table_schema='public' and grantee in ('anon','authenticated')),
         'differs from PART 5 by design: onboarding_requests adds one row',
         'INFORMATIONAL'

) as t order by 1, 2;
