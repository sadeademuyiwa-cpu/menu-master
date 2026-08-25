-- ============================================================================
-- MENU MASTER NG — identify the acceptance-test user before deleting it
--
--   *** PURE SELECT. Single statement. Deletes nothing. ***
--
-- Run this before removing anything. It proves exactly one user is a deletion
-- candidate and that the five originals are not among them.
--
-- PRIVACY
--   The five protected users are shown pseudonymously -- md5 prefix, domain,
--   creation date -- and never by address. The deletion CANDIDATE is shown by
--   full UUID and email, because you are about to act on it and must be able
--   to match it exactly in the dashboard. It is an account you created
--   minutes ago for this test.
--
-- PROCEED only if row "3 candidate" shows exactly ONE user and row
-- "2 protected" shows exactly FIVE.
-- ============================================================================

select * from (

  select '1 total' as section, '>>> auth.users' as item,
         (select count(*)::text from auth.users) as observed,
         '6 -- five originals plus one test user' as expected,
         case when (select count(*) from auth.users) = 6
              then 'GO' else 'STOP' end as "verdict >>>"

  union all
  select '2 protected', '>>> the five originals (DO NOT DELETE)',
         coalesce((select string_agg(
                     substr(md5(coalesce(u.email, u.id::text)), 1, 8)
                     || '@' || coalesce(split_part(u.email, '@', 2), '?')
                     || ' ' || left(u.created_at::text, 10), '  |  '
                     order by u.created_at)
                     from auth.users u
                    where u.created_at < '2026-08-15'::timestamptz), 'none'),
         'exactly 5, created 2026-08-10..14',
         case when (select count(*) from auth.users
                     where created_at < '2026-08-15'::timestamptz) = 5
              then 'GO' else 'STOP' end

  union all
  select '3 candidate', '>>> the ONE user to delete (full id, to match exactly)',
         coalesce((select u.id::text || '   ' || coalesce(u.email, '(no email)')
                        || '   created ' || left(u.created_at::text, 19)
                     from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz
                    order by u.created_at desc), 'NONE FOUND'),
         'exactly one, created today',
         case when (select count(*) from auth.users
                     where created_at >= '2026-08-15'::timestamptz) = 1
              then 'GO' else 'STOP' end

  union all
  select '4 safety', '>>> the candidate owns no tenant data',
         coalesce((select (select count(*) from memberships m where m.user_id = u.id)::text
                          || ' memberships / '
                          || (select count(*) from profiles p where p.id = u.id)::text
                          || ' profiles'
                     from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz
                    order by u.created_at desc limit 1), 'no candidate'),
         '0 memberships / 0 profiles -- nothing is lost by deleting it',
         case when not exists (
                select 1 from auth.users u
                 where u.created_at >= '2026-08-15'::timestamptz
                   and (exists (select 1 from memberships m where m.user_id = u.id)
                     or exists (select 1 from profiles p where p.id = u.id)))
              then 'GO' else 'STOP' end

  union all
  select '4 safety', '>>> no public table references the candidate',
         coalesce((select string_agg(x.src, ', ') from (
                     select 'ingredient_prices' as src from ingredient_prices ip
                      join auth.users u on u.id = ip.entered_by
                      where u.created_at >= '2026-08-15'::timestamptz
                     union select 'purchases' from purchases p
                      join auth.users u on u.id in (p.created_by, p.posted_by)
                      where u.created_at >= '2026-08-15'::timestamptz
                     union select 'orders' from orders o
                      join auth.users u on u.id = o.created_by
                      where u.created_at >= '2026-08-15'::timestamptz
                     union select 'sales_entries' from sales_entries s
                      join auth.users u on u.id = s.created_by
                      where u.created_at >= '2026-08-15'::timestamptz
                   ) x), 'none'),
         'none -- all tenant tables are empty anyway',
         case when (select count(*) from ingredient_prices) = 0
               and (select count(*) from purchases) = 0
               and (select count(*) from orders) = 0
               and (select count(*) from sales_entries) = 0
              then 'GO' else 'STOP' end

  union all
  select '5 dependants', 'auth-schema tables that reference auth.users',
         coalesce((select string_agg(distinct c.conrelid::regclass::text, ', '
                          order by c.conrelid::regclass::text)
                     from pg_constraint c
                     join pg_class rc on rc.oid = c.confrelid
                     join pg_namespace rn on rn.oid = rc.relnamespace
                    where c.contype = 'f' and rn.nspname = 'auth'
                      and rc.relname = 'users'
                      and c.connamespace = 'auth'::regnamespace), 'none'),
         'GoTrue owns these -- delete through the Dashboard, not SQL',
         'INFORMATIONAL'

) as t order by 1, 2;
