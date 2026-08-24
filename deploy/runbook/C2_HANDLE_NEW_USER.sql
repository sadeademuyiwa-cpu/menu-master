-- ============================================================================
-- MENU MASTER NG — identify public.handle_new_user
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- handle_new_user exists in production's public schema and is NOT created by
-- migrations 0001-0018. It is the function name used by Supabase's own
-- "User Management Starter" quickstart, which pairs a trigger on auth.users
-- with a profiles table.
--
-- This matters before PART_5: migration 0018 revokes EXECUTE from PUBLIC and
-- anon on EVERY function in the public schema, this one included. If a
-- trigger on auth.users invokes it and relies on the implicit PUBLIC grant,
-- revoking that grant could break user signup -- silently, and only at the
-- moment a real person first registers.
-- ============================================================================

select * from (
  select '1 identity' as section, 'exists' as item,
         case when exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace
                            and p.proname='handle_new_user') then 'yes' else 'no' end as observed
  union all
  select '1 identity', 'owner / security / returns',
         coalesce((select pg_get_userbyid(p.proowner) || ' | ' ||
                          case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end || ' | ' ||
                          pg_get_function_result(p.oid)
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user' limit 1), 'n/a')
  union all
  select '1 identity', 'created by an extension?',
         coalesce((select e.extname from pg_proc p
                    join pg_depend d on d.objid=p.oid and d.deptype='e'
                    join pg_extension e on e.oid=d.refobjid
                   where p.pronamespace='public'::regnamespace and p.proname='handle_new_user'),
                  'no — created by hand or by a quickstart')

  -- ---- 2. is anything actually calling it? -------------------------------
  union all
  select '2 triggers', '>>> triggers invoking it (ANY schema)',
         coalesce((select string_agg(n.nspname||'.'||c.relname||' → '||t.tgname, ', ')
                     from pg_trigger t
                     join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                     join pg_proc p on p.oid=t.tgfoid
                    where p.proname='handle_new_user' and not t.tgisinternal),
                  'none — the function is orphaned, nothing calls it')

  -- ---- 3. who can execute it today ---------------------------------------
  union all
  select '3 privileges', 'EXECUTE holders (before 0018)',
         coalesce((select string_agg(r.rolname, ', ' order by r.rolname)
                     from pg_roles r, pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname='handle_new_user'
                      and has_function_privilege(r.rolname, p.oid, 'execute')
                      and r.rolname in ('anon','authenticated','service_role','postgres',
                                        'supabase_auth_admin','supabase_admin','authenticator')),
                  'n/a')

  -- ---- 4. what does it touch? --------------------------------------------
  union all
  select '4 body', 'references profiles?',
         coalesce((select case when p.prosrc ilike '%profiles%' then 'yes — inserts into a profiles table'
                               else 'no' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user' limit 1), 'n/a')
  union all
  select '4 body', 'first 200 chars of definition',
         coalesce((select left(regexp_replace(p.prosrc, '\s+', ' ', 'g'), 200)
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user' limit 1), 'n/a')

  -- ---- 5. is our profiles table intact? ----------------------------------
  union all
  select '5 profiles', 'row count (ours, created by 0001)', (select count(*)::text from profiles)
) as t order by 1, 2;
