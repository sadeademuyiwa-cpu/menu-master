-- ============================================================================
-- MENU MASTER NG — when did signup work, and is it failing right now?
--
--   *** READ ONLY. No table is written. ***
--
-- WHY
--   Five confirmed email signups exist, created 2026-08-10 to 2026-08-14.
--   With the on_auth_user_created hook enabled and `vendors` absent, a signup
--   CANNOT succeed -- it fails 42P01 and rolls back. So during that window
--   either `vendors` still existed, or the hook was not firing. GoTrue keeps
--   its own audit log, which can settle this without guessing.
--
-- PRIVACY
--   No email address, no token, no payload body. Actors appear only as an
--   irreversible md5 prefix. Output is counts by action and day.
--
-- ROBUSTNESS
--   auth.audit_log_entries does not exist on every GoTrue version, and a
--   static reference to a missing relation fails at PARSE time, which would
--   kill the whole script. Everything below therefore runs through dynamic
--   SQL inside a DO block, so a missing table reports "absent" instead.
-- ============================================================================

do $$
declare
  v_has_audit  boolean;
  v_summary    text := '';
  v_recent     text := '';
  v_actors     text := '';
begin
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'audit_log_entries'
  ) into v_has_audit;

  if not v_has_audit then
    perform set_config('mm.tl_summary', 'auth.audit_log_entries is absent on this GoTrue version', false);
    perform set_config('mm.tl_recent',  'n/a', false);
    perform set_config('mm.tl_actors',  'n/a', false);
    return;
  end if;

  -- counts by action and day, newest first
  execute $q$
    select coalesce(string_agg(line, '  |  ' order by d desc, action), 'no entries')
    from (
      select (created_at at time zone 'UTC')::date as d,
             coalesce(payload->>'action', 'unknown')  as action,
             count(*)                                  as n,
             (created_at at time zone 'UTC')::date::text || ' '
               || coalesce(payload->>'action','unknown') || '=' || count(*)::text as line
      from auth.audit_log_entries
      group by 1, 2
      order by 1 desc, 2
      limit 40
    ) s
  $q$ into v_summary;

  -- anything at all in the last 14 days
  execute $q$
    select coalesce(string_agg(line, '  |  ' order by d desc), 'nothing in the last 14 days')
    from (
      select (created_at at time zone 'UTC')::date as d,
             (created_at at time zone 'UTC')::date::text || ' total=' || count(*)::text as line
      from auth.audit_log_entries
      where created_at > now() - interval '14 days'
      group by 1
    ) s
  $q$ into v_recent;

  -- distinct actors, pseudonymised
  execute $q$
    select coalesce(count(distinct md5(coalesce(payload->>'actor_username','')))::text, '0')
    from auth.audit_log_entries
  $q$ into v_actors;

  perform set_config('mm.tl_summary', coalesce(v_summary, 'none'), false);
  perform set_config('mm.tl_recent',  coalesce(v_recent,  'none'), false);
  perform set_config('mm.tl_actors',  coalesce(v_actors,  '0'),    false);
end
$$;

select * from (
  select '1 audit log' as section, 'actions by day (most recent 40 groups)' as item,
         coalesce(current_setting('mm.tl_summary', true), 'not collected') as observed
  union all
  select '1 audit log', 'activity in the last 14 days',
         coalesce(current_setting('mm.tl_recent', true), 'not collected')
  union all
  select '1 audit log', 'distinct actors (pseudonymised count)',
         coalesce(current_setting('mm.tl_actors', true), 'not collected')
  union all
  select '2 now', 'can a signup succeed at this moment?',
         case when exists (select 1 from pg_trigger t
                             join pg_class c on c.oid = t.tgrelid
                             join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname='auth' and c.relname='users'
                              and not t.tgisinternal and t.tgenabled = 'O')
               and not exists (select 1 from pg_class where relname = 'vendors')
              then 'NO -- hook enabled and vendors absent: every signup fails 42P01 and rolls back'
              else 'possibly -- re-check the hook and vendors state' end
  union all
  select '2 now', 'users created in the last 14 days',
         (select count(*)::text from auth.users where created_at > now() - interval '14 days')
  union all
  select '2 now', 'most recent user created_at',
         coalesce((select max(created_at)::text from auth.users), 'none')
) as t order by 1, 2;
