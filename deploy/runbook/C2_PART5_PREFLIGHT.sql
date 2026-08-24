-- ============================================================================
-- MENU MASTER NG — PART 5 PREFLIGHT
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run this IMMEDIATELY BEFORE pasting PART_5_gate1_closure.sql.
--
-- It proves production is still in the exact state PART_5 was validated
-- against: Parts 1-4 applied, Part 5 NOT yet applied, reference data intact,
-- no tenant data, and the one known foreign object still the only one.
--
-- PROCEED only if every '>>>' row reads GO. Any STOP means the database has
-- moved since validation and PART_5 must be re-validated, not pasted.
-- ============================================================================

select * from (

  -- A. PARTS 1-4 ARE APPLIED -------------------------------------------------
  select 'A parts 1-4' as section, 'fn_* functions in public' as item,
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace and proname like 'fn\_%') as observed,
         '33' as expected,
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace and proname like 'fn\_%')=33
              then 'GO' else 'STOP' end as "verdict >>>"
  union all
  select 'A parts 1-4', 'public relations',
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')), '42',
         case when (select count(*) from pg_class
                     where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f'))=42
              then 'GO' else 'STOP' end
  union all
  select 'A parts 1-4', 'policies on public tables',
         (select count(*)::text from pg_policies where schemaname='public'), '37',
         case when (select count(*) from pg_policies where schemaname='public')=37
              then 'GO' else 'STOP' end
  union all
  select 'A parts 1-4', 'onboarding RPC present (0010/0012)',
         case when exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                            and proname='fn_create_account_and_business')
              then 'yes' else 'MISSING' end, 'yes',
         case when exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                            and proname='fn_create_account_and_business')
              then 'GO' else 'STOP' end

  -- B. PART 5 IS NOT YET APPLIED --------------------------------------------
  union all
  select 'B part 5 absent', '0013 marker (zero-value constraint)',
         case when exists (select 1 from pg_constraint
                            where conname like '%nonzero%' or conname like '%positive%')
              then 'ALREADY PRESENT' else 'absent' end, 'absent',
         case when not exists (select 1 from pg_constraint
                                where conname like '%nonzero%' or conname like '%positive%')
              then 'GO' else 'STOP' end
  union all
  select 'B part 5 absent', '0014 marker (fn_void_order, fn_reissue_order)',
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace
           and proname in ('fn_void_order','fn_reissue_order')), '0',
         case when (select count(*) from pg_proc where pronamespace='public'::regnamespace
                     and proname in ('fn_void_order','fn_reissue_order'))=0
              then 'GO' else 'STOP' end
  union all
  select 'B part 5 absent', '0017 marker (ck_subscriptions_status)',
         case when exists (select 1 from pg_constraint where conname='ck_subscriptions_status')
              then 'ALREADY PRESENT' else 'absent' end, 'absent',
         case when not exists (select 1 from pg_constraint where conname='ck_subscriptions_status')
              then 'GO' else 'STOP' end
  union all
  select 'B part 5 absent', '0018 section 7 marker (p_units_read_global)',
         case when exists (select 1 from pg_policies
                            where schemaname='public' and policyname='p_units_read_global')
              then 'ALREADY PRESENT' else 'absent' end, 'absent',
         case when not exists (select 1 from pg_policies
                                where schemaname='public' and policyname='p_units_read_global')
              then 'GO' else 'STOP' end
  union all
  select 'B part 5 absent', '0018 pre-state (p_units_read, p_units_write)',
         (select count(*)::text from pg_policies where schemaname='public'
           and policyname in ('p_units_read','p_units_write')), '2',
         case when (select count(*) from pg_policies where schemaname='public'
                     and policyname in ('p_units_read','p_units_write'))=2
              then 'GO' else 'STOP' end
  union all
  select 'B part 5 absent', 'anon SELECT surface still wide (0018 not run)',
         (select count(distinct table_name)::text from information_schema.role_table_grants
           where table_schema='public' and grantee='anon' and privilege_type='SELECT'),
         'equal to the public relation count -- 0018 narrows this to 5',
         case when (select count(distinct table_name) from information_schema.role_table_grants
                     where table_schema='public' and grantee='anon' and privilege_type='SELECT')
                 = (select count(*) from pg_class
                     where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f'))
              then 'GO' else 'STOP' end

  -- C. REFERENCE DATA INTACT -------------------------------------------------
  union all
  select 'C data', 'units / catalog_categories / catalog_ingredients',
         (select count(*) from units)::text||' / '||
         (select count(*) from catalog_categories)::text||' / '||
         (select count(*) from catalog_ingredients)::text, '45 / 16 / 180',
         case when (select count(*) from units)=45
               and (select count(*) from catalog_categories)=16
               and (select count(*) from catalog_ingredients)=180
              then 'GO' else 'STOP' end
  union all
  select 'C data', 'plans / plan_features',
         (select count(*) from plans)::text||' / '||(select count(*) from plan_features)::text,
         '3 / 12',
         case when (select count(*) from plans)=3 and (select count(*) from plan_features)=12
              then 'GO' else 'STOP' end
  union all
  select 'C data', 'units distinct on (account_id, lower(code))',
         (select count(distinct (coalesce(account_id::text,'-')||'/'||lower(code)))::text from units),
         '45 -- equal to the row count, no duplicate from a re-run',
         case when (select count(distinct (coalesce(account_id::text,'-')||'/'||lower(code))) from units)
                 = (select count(*) from units)
               and (select count(*) from units)=45
              then 'GO' else 'STOP' end

  -- D. NO TENANT DATA AT RISK ------------------------------------------------
  union all
  select 'D no tenants', 'auth.users / accounts / businesses',
         (select count(*) from auth.users)::text||' / '||
         (select count(*) from accounts)::text||' / '||
         (select count(*) from businesses)::text, '0 / 0 / 0',
         case when (select count(*) from auth.users)=0
               and (select count(*) from accounts)=0
               and (select count(*) from businesses)=0
              then 'GO' else 'STOP' end
  union all
  select 'D no tenants', 'ingredients / ingredient_prices / recipes',
         (select count(*) from ingredients)::text||' / '||
         (select count(*) from ingredient_prices)::text||' / '||
         (select count(*) from recipes)::text, '0 / 0 / 0',
         case when (select count(*) from ingredients)=0
               and (select count(*) from ingredient_prices)=0
               and (select count(*) from recipes)=0
              then 'GO' else 'STOP' end

  -- E. THE FOREIGN OBJECT IS STILL THE ONLY ONE ------------------------------
  union all
  select 'E foreign', 'non-fn_, non-extension functions in public',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname not like 'fn\_%'
                      and not exists (select 1 from pg_depend d
                                       where d.objid=p.oid and d.deptype='e')), 'none'),
         'handle_new_user, and nothing else',
         case when (select coalesce(string_agg(p.proname, ','), 'none') from pg_proc p
                     where p.pronamespace='public'::regnamespace and p.proname not like 'fn\_%'
                       and not exists (select 1 from pg_depend d
                                        where d.objid=p.oid and d.deptype='e'))
                   = 'handle_new_user'
              then 'GO' else 'STOP' end
  union all
  select 'E foreign', 'triggers on auth.users',
         coalesce((select string_agg(t.tgname||' (enabled='||t.tgenabled::text||')', ', ')
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal), 'none'),
         'on_auth_user_created (enabled=O) -- untouched, PART_5 must not alter it',
         case when (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal)=1
              then 'GO' else 'STOP' end
  union all
  select 'E foreign', 'a relation named vendors',
         coalesce((select string_agg(n.nspname||'.'||c.relname, ', ')
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where c.relname='vendors'), 'none'),
         'none -- if one appeared, STOP and re-analyse the hook',
         case when not exists (select 1 from pg_class where relname='vendors')
              then 'GO' else 'STOP' end

  -- F. ENVIRONMENT -----------------------------------------------------------
  union all
  select 'F environment', 'current_user / server version',
         current_user||' / '||substring(version() from 'PostgreSQL [0-9.]+'),
         'postgres / PostgreSQL 16.x', 'INFORMATIONAL'
  union all
  select 'F environment', 'open transactions holding locks on public tables',
         (select count(distinct pid)::text from pg_locks l
           join pg_class c on c.oid = l.relation
          where c.relnamespace='public'::regnamespace and l.pid <> pg_backend_pid()),
         'expect 0 or a few idle PostgREST/realtime backends; a long-running '
         'WRITE transaction here would block PART_5 on a lock',
         'INFORMATIONAL'

) as t order by 1, 2;
