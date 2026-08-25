-- ============================================================================
-- MENU MASTER NG — TRIGGER AUTHORITY GATE (before C5_CLEANUP.sql)
--
--   *** PURE SELECT. Single statement. Changes nothing. ***
--
-- Answers, from production, whether this session may disable and re-enable
-- trg_memberships_last_owner. It asks the catalog rather than attempting the
-- ALTER, so nothing is changed to find out.
--
-- PROCEED only if every '>>>' row reads GO.
-- ============================================================================

select * from (

  select '1 identity' as section, 'current_user / session_user' as item,
         current_user || ' / ' || session_user as observed,
         'postgres / postgres' as expected,
         case when current_user = 'postgres' then 'GO' else 'STOP' end as "verdict >>>"

  union all
  select '2 trigger', '>>> exists on public.memberships',
         case when exists (select 1 from pg_trigger t
                             join pg_class c on c.oid = t.tgrelid
                             join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname='public' and c.relname='memberships'
                              and t.tgname='trg_memberships_last_owner'
                              and not t.tgisinternal)
              then 'yes' else 'NOT FOUND' end,
         'yes',
         case when exists (select 1 from pg_trigger t
                             join pg_class c on c.oid = t.tgrelid
                             join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname='public' and c.relname='memberships'
                              and t.tgname='trg_memberships_last_owner'
                              and not t.tgisinternal)
              then 'GO' else 'STOP' end
  union all
  select '2 trigger', '>>> timing / events / level / function / enabled',
         coalesce((select case when (t.tgtype & 2)=2 then 'BEFORE' else 'AFTER' end
                        || case when (t.tgtype & 4)=4 then ' INSERT' else '' end
                        || case when (t.tgtype & 16)=16 then ' UPDATE' else '' end
                        || case when (t.tgtype & 8)=8 then ' DELETE' else '' end
                        || case when (t.tgtype & 1)=1 then ' ROW' else ' STATEMENT' end
                        || '  fn=' || p.proname
                        || '  tgenabled=' || t.tgenabled::text
                     from pg_trigger t
                     join pg_class c on c.oid = t.tgrelid
                     join pg_namespace n on n.oid = c.relnamespace
                     join pg_proc p on p.oid = t.tgfoid
                    where n.nspname='public' and c.relname='memberships'
                      and t.tgname='trg_memberships_last_owner'
                      and not t.tgisinternal), 'NOT FOUND'),
         'BEFORE UPDATE DELETE ROW  fn=fn_guard_last_owner  tgenabled=O',
         case when exists (select 1 from pg_trigger t
                             join pg_class c on c.oid=t.tgrelid
                             join pg_namespace n on n.oid=c.relnamespace
                             join pg_proc p on p.oid=t.tgfoid
                            where n.nspname='public' and c.relname='memberships'
                              and t.tgname='trg_memberships_last_owner'
                              and not t.tgisinternal
                              and (t.tgtype & 2)=2 and (t.tgtype & 8)=8
                              and (t.tgtype & 16)=16 and (t.tgtype & 1)=1
                              and p.proname='fn_guard_last_owner'
                              and t.tgenabled='O')
              then 'GO' else 'STOP' end
  union all
  select '2 trigger', '>>> exactly one trigger with that name, no near-duplicates',
         coalesce((select string_agg(c.relname || '.' || t.tgname
                          || ' (enabled=' || t.tgenabled::text || ')', ', ')
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                    where not t.tgisinternal
                      and t.tgname ilike '%last_owner%'), 'none'),
         'memberships.trg_memberships_last_owner (enabled=O) and nothing else',
         case when (select count(*) from pg_trigger t
                     where not t.tgisinternal and t.tgname ilike '%last_owner%') = 1
              then 'GO' else 'STOP' end
  union all
  select '2 trigger', 'other triggers on memberships (left untouched)',
         coalesce((select string_agg(t.tgname, ', ' order by t.tgname)
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname='memberships'
                      and not t.tgisinternal
                      and t.tgname <> 'trg_memberships_last_owner'), 'none'),
         'whatever they are, the cleanup touches none of them', 'INFORMATIONAL'

  union all
  select '3 ownership', '>>> public.memberships owner',
         coalesce((select c.relowner::regrole::text from pg_class c
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname='memberships'), 'ABSENT'),
         'postgres',
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                            where n.nspname='public' and c.relname='memberships'
                              and c.relowner::regrole::text = 'postgres')
              then 'GO' else 'STOP' end
  union all
  -- ALTER TABLE ... DISABLE/ENABLE TRIGGER requires ownership of the TABLE.
  -- pg_has_role answers that without attempting the ALTER.
  select '3 ownership', '>>> current role may DISABLE and re-ENABLE the trigger',
         coalesce((select case when pg_has_role(current_user, c.relowner, 'USAGE')
                               then 'YES' else 'NO' end
                     from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname='memberships'), 'ABSENT'),
         'YES',
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                            where n.nspname='public' and c.relname='memberships'
                              and pg_has_role(current_user, c.relowner, 'USAGE'))
              then 'GO' else 'STOP' end
  union all
  select '3 ownership', 'is the session a superuser? (not required either way)',
         (select case when rolsuper then 'yes' else 'no -- ownership is what matters' end
            from pg_roles where rolname = current_user),
         'either is fine; ownership above is the deciding fact', 'INFORMATIONAL'

  union all
  select '4 target', '>>> the account to be deleted still exists, and is the only one',
         (select count(*)::text from accounts) || ' account(s); target present: ' ||
         case when exists (select 1 from accounts
                            where id='59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'yes' else 'NO' end,
         '1 account(s); target present: yes',
         case when (select count(*) from accounts) = 1
               and exists (select 1 from accounts
                            where id='59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'GO' else 'STOP' end

) as t order by 1, 2;
