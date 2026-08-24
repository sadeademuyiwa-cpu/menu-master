-- ============================================================================
-- MENU MASTER NG — does the table handle_new_user writes to actually exist?
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- handle_new_user is a SECURITY DEFINER trigger on auth.users that inserts
-- into `vendors`. Production's public schema holds 33 tables, all of them
-- created by our chain, and none named vendors. If the table is absent in
-- every schema the function can resolve, then EVERY signup already fails --
-- a pre-existing production defect unrelated to this deployment.
-- ============================================================================

select * from (
  select '1 vendors' as section, 'in any schema' as item,
         coalesce((select string_agg(n.nspname||'.'||c.relname, ', ')
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where c.relname='vendors' and c.relkind in ('r','v','p','f','m')),
                  '>>> DOES NOT EXIST IN ANY SCHEMA') as observed
  union all
  select '1 vendors', 'resolvable from the function''s search_path',
         coalesce((select case when to_regclass('public.vendors') is not null
                               then 'yes — public.vendors' else 'NO' end), 'NO')

  union all
  select '2 function', 'its search_path setting',
         coalesce((select coalesce(array_to_string(p.proconfig, ', '), 'none — uses caller''s search_path')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user' limit 1), 'n/a')
  union all
  select '2 function', 'full definition',
         coalesce((select regexp_replace(p.prosrc, '\s+', ' ', 'g')
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user' limit 1), 'n/a')
  union all
  select '2 function', 'trigger timing',
         coalesce((select t.tgname || ' — ' ||
                          case when (t.tgtype & 2) > 0 then 'BEFORE' else 'AFTER' end || ' ' ||
                          case when (t.tgtype & 4) > 0 then 'INSERT' else 'other' end
                     from pg_trigger t join pg_proc p on p.oid=t.tgfoid
                    where p.proname='handle_new_user' and not t.tgisinternal limit 1), 'n/a')

  union all
  select '3 impact', 'existing auth users',
         (select count(*)::text from auth.users)
  union all
  select '3 impact', '>>> signup status',
         case when to_regclass('public.vendors') is null
               and exists (select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
                            where p.proname='handle_new_user' and not t.tgisinternal)
              then '>>> ALREADY BROKEN — trigger active, target table missing'
              when to_regclass('public.vendors') is not null
              then 'trigger active and target exists'
              else 'no active trigger' end

  union all
  select '4 our path', 'our onboarding uses a trigger on auth.users?',
         case when exists (select 1 from pg_trigger t
                            join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                            join pg_proc p on p.oid=t.tgfoid
                           where n.nspname='auth' and c.relname='users'
                             and p.proname like 'fn\_%' and not t.tgisinternal)
              then '>>> yes — unexpected'
              else 'no — ours is the client-invoked fn_create_account_and_business' end
  union all
  select '4 our path', 'all triggers on auth.users',
         coalesce((select string_agg(t.tgname||' → '||p.proname, ', ')
                     from pg_trigger t
                     join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                     join pg_proc p on p.oid=t.tgfoid
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal),
                  'none')
) as t order by 1, 2;
