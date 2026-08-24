-- ============================================================================
-- MENU MASTER NG — can this session remove the foreign signup hook?
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- DROP TRIGGER requires ownership of the TABLE the trigger sits on, not of
-- the trigger or its function. On Supabase, auth.users is owned by
-- supabase_auth_admin, not by postgres. This asks Postgres directly whether
-- the current role holds that ownership, so we learn the answer without
-- attempting anything. It also reports the same for the function itself,
-- which DROP FUNCTION does require.
-- ============================================================================

select * from (
  select '1 identity' as section, 'current_user / session_user' as item,
         current_user || ' / ' || session_user as observed
  union all
  select '2 auth.users', 'table owner',
         coalesce((select c.relowner::regrole::text from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='auth' and c.relname='users'), 'ABSENT')
  union all
  select '2 auth.users', '>>> current role owns it (DROP TRIGGER allowed)',
         coalesce((select case when pg_has_role(current_user, c.relowner, 'USAGE')
                               then 'YES' else 'NO' end
                     from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='auth' and c.relname='users'), 'ABSENT')
  union all
  select '3 function', 'public.handle_new_user owner',
         coalesce((select p.proowner::regrole::text from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT')
  union all
  select '3 function', '>>> current role owns it (DROP FUNCTION allowed)',
         coalesce((select case when pg_has_role(current_user, p.proowner, 'USAGE')
                               then 'YES' else 'NO' end
                     from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT')
  union all
  select '4 hook', 'trigger on auth.users → function, timing',
         coalesce((select string_agg(t.tgname||' → '||p.proname||
                        ' ('||case when (t.tgtype & 2)=2 then 'BEFORE' else 'AFTER' end||
                        case when (t.tgtype & 4)=4 then ' INSERT' else '' end||
                        case when (t.tgtype & 1)=1 then ' ROW' else ' STATEMENT' end||
                        ', enabled='||t.tgenabled::text||')', ', ')
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                     join pg_proc p on p.oid=t.tgfoid
                    where n.nspname='auth' and c.relname='users' and not t.tgisinternal),
                  'none')
  union all
  select '5 target', 'a relation named vendors exists anywhere',
         coalesce((select string_agg(n.nspname||'.'||c.relname, ', ')
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where c.relname='vendors'), 'NO — the hook cannot succeed')
  union all
  select '6 blast radius', 'auth.users rows that would be affected',
         (select count(*)::text from auth.users)
) as t order by 1, 2;
