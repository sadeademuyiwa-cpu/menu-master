-- ============================================================================
-- MENU MASTER NG — inspect the 5 auth.users found by the Part 5 preflight
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- PRIVACY
--   This deliberately returns NO email address, NO password hash, NO
--   confirmation/recovery/reauthentication token, and NO metadata VALUES.
--   Identity is shown as an irreversible md5 prefix plus the email domain,
--   which is enough to tell the rows apart and to spot a test domain, and
--   nothing more. Metadata is reported as KEY NAMES only.
--
-- ROBUSTNESS
--   auth.users columns vary across GoTrue versions, and a reference to a
--   column that does not exist fails at PARSE time -- which would defeat the
--   whole query. Every optional column is therefore read out of to_jsonb(u)
--   by name, so a missing column yields NULL instead of an error.
-- ============================================================================

with u as (
  select to_jsonb(t) as j from auth.users t
),
fk as (
  -- every table that references auth.users, discovered rather than assumed
  select c.conrelid::regclass::text as referencing_table,
         a.attname                  as referencing_column
  from pg_constraint c
  join pg_class      rc on rc.oid = c.confrelid
  join pg_namespace  rn on rn.oid = rc.relnamespace
  join unnest(c.conkey) with ordinality k(attnum, ord) on true
  join pg_attribute  a  on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.contype = 'f' and rn.nspname = 'auth' and rc.relname = 'users'
)
select * from (

  select '1 identity' as section,
         'user ' || substr(md5(coalesce(j->>'email', j->>'id')), 1, 8) as item,
         'domain=' || coalesce(split_part(j->>'email', '@', 2), '(none)') ||
         '  created=' || coalesce(left(j->>'created_at', 19), '?') ||
         '  confirmed=' || case when (j->>'email_confirmed_at') is not null then 'yes' else 'NO' end ||
         '  last_sign_in=' || coalesce(left(j->>'last_sign_in_at', 19), 'never') as observed
  from u

  union all
  select '2 shape',
         'user ' || substr(md5(coalesce(j->>'email', j->>'id')), 1, 8),
         'role=' || coalesce(j->>'role', '?') ||
         '  provider=' || coalesce(j->'raw_app_meta_data'->>'provider', '?') ||
         '  sso=' || coalesce(j->>'is_sso_user', '?') ||
         '  anonymous=' || coalesce(j->>'is_anonymous', 'n/a') ||
         '  banned_until=' || coalesce(left(j->>'banned_until', 19), 'no') ||
         '  soft_deleted=' || case when (j->>'deleted_at') is not null then 'YES' else 'no' end
  from u

  union all
  select '3 metadata keys',
         'user ' || substr(md5(coalesce(j->>'email', j->>'id')), 1, 8),
         'user_meta_keys=[' ||
           coalesce((select string_agg(k, ',' order by k)
                       from jsonb_object_keys(coalesce(j->'raw_user_meta_data', '{}'::jsonb)) k), '') ||
         ']  has_name_key=' ||
         case when coalesce(j->'raw_user_meta_data', '{}'::jsonb) ? 'name'
              then 'yes -- the key handle_new_user reads' else 'no' end
  from u

  union all
  select '4 timeline', 'created_at span (earliest .. latest)',
         coalesce((select left(min(j->>'created_at'), 19) || '  ..  ' || left(max(j->>'created_at'), 19) from u),
                  'no users')

  union all
  select '4 timeline', 'all created within one minute of each other?',
         coalesce((select case when max((j->>'created_at')::timestamptz)
                                 - min((j->>'created_at')::timestamptz) < interval '1 minute'
                               then 'YES -- looks like one batch/seed'
                               else 'no -- spread over ' ||
                                    (max((j->>'created_at')::timestamptz)
                                     - min((j->>'created_at')::timestamptz))::text end
                    from u), 'no users')

  union all
  select '5 dependants', 'tables with a FK to auth.users',
         coalesce((select string_agg(referencing_table || '.' || referencing_column, ', '
                                     order by referencing_table)
                     from fk), 'none')

  union all
  select '5 dependants', 'rows in public.profiles',
         (select count(*)::text from profiles)

  union all
  select '5 dependants', 'rows in public.memberships',
         (select count(*)::text from memberships)

  union all
  -- auth.identities may not exist on every GoTrue version, and a static
  -- reference to a missing relation fails at PARSE time, which would kill the
  -- whole query. Read the catalog instead: reltuples is a planner estimate,
  -- labelled as such rather than presented as a count.
  select '5 dependants', 'auth.identities (catalog estimate)',
         coalesce((select 'present, ~' || greatest(c.reltuples, 0)::bigint::text || ' rows (estimate)'
                     from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'auth' and c.relname = 'identities'), 'table absent')

  union all
  select '6 hook', 'trigger state on auth.users',
         coalesce((select string_agg(t.tgname || ' enabled=' || t.tgenabled::text, ', ')
                     from pg_trigger t
                     join pg_class c on c.oid = t.tgrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'auth' and c.relname = 'users'
                      and not t.tgisinternal), 'none')

  union all
  select '6 hook', 'handle_new_user created/modified marker',
         coalesce((select 'oid=' || p.oid::text || ' owner=' || p.proowner::regrole::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'handle_new_user'), 'absent')

) as t order by 1, 2, 3;
