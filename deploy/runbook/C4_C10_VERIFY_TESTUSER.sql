-- ============================================================================
-- MENU MASTER NG — verify the temporary C10 test user
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run after creating the throwaway user through the Dashboard, and before the
-- acceptance test.
--
-- IT REPORTS THE UUID ITSELF
--   Row "3 candidate" prints the full UUID straight from the database. That
--   value, not a hand-copied one, is what gets substituted into the acceptance
--   test. A partially copied UUID cannot survive this step, because the value
--   is read rather than typed.
--
-- The five protected users are shown pseudonymously and are never candidates:
-- the split is by created_at at 2026-08-15, and all five predate it.
--
-- PROCEED only if every '>>>' row reads GO.
-- ============================================================================

select * from (

  select '1 total' as section, '>>> auth.users' as item,
         (select count(*)::text from auth.users) as observed,
         '6 -- five protected plus one temporary test user' as expected,
         case when (select count(*) from auth.users) = 6
              then 'GO' else 'STOP' end as "verdict >>>"

  union all
  select '2 protected', '>>> the five, present and unused',
         coalesce((select string_agg(
                     substr(md5(coalesce(u.email, u.id::text)), 1, 8)
                     || ' ' || left(u.created_at::text, 10), '  |  '
                     order by u.created_at)
                     from auth.users u
                    where u.created_at < '2026-08-15'::timestamptz), 'none'),
         'exactly 5, dated 2026-08-10..14',
         case when (select count(*) from auth.users
                     where created_at < '2026-08-15'::timestamptz) = 5
              then 'GO' else 'STOP' end
  union all
  select '2 protected', '>>> none of the five holds a membership or profile',
         (select count(*)::text from auth.users u
           where u.created_at < '2026-08-15'::timestamptz
             and (exists (select 1 from memberships m where m.user_id = u.id)
               or exists (select 1 from profiles p where p.id = u.id))),
         '0',
         case when not exists (select 1 from auth.users u
                                where u.created_at < '2026-08-15'::timestamptz
                                  and (exists (select 1 from memberships m
                                                where m.user_id = u.id)
                                    or exists (select 1 from profiles p
                                                where p.id = u.id)))
              then 'GO' else 'STOP' end

  union all
  select '3 candidate', '>>> exactly one temporary user',
         (select count(*)::text from auth.users
           where created_at >= '2026-08-15'::timestamptz), '1',
         case when (select count(*) from auth.users
                     where created_at >= '2026-08-15'::timestamptz) = 1
              then 'GO' else 'STOP' end
  union all
  select '3 candidate', '>>> FULL UUID -- send this back verbatim',
         coalesce((select u.id::text from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz
                    order by u.created_at desc limit 1), 'NONE'),
         'a complete 36-character uuid, 8-4-4-4-12',
         case when (select count(*) from auth.users
                     where created_at >= '2026-08-15'::timestamptz
                       and length(id::text) = 36) = 1
              then 'GO' else 'STOP' end
  union all
  select '3 candidate', 'its email and creation time',
         coalesce((select coalesce(u.email,'(none)') || '   created ' || left(u.created_at::text, 19)
                     from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz
                    order by u.created_at desc limit 1), 'NONE'),
         'the throwaway address you just used', 'INFORMATIONAL'
  union all
  select '3 candidate', '>>> holds no membership and no profile',
         coalesce((select (select count(*) from memberships m where m.user_id = u.id)::text
                          || ' memberships / '
                          || (select count(*) from profiles p where p.id = u.id)::text
                          || ' profiles'
                     from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz
                    order by u.created_at desc limit 1), 'no candidate'),
         '0 memberships / 0 profiles',
         case when not exists (
                select 1 from auth.users u
                 where u.created_at >= '2026-08-15'::timestamptz
                   and (exists (select 1 from memberships m where m.user_id = u.id)
                     or exists (select 1 from profiles p where p.id = u.id)))
              then 'GO' else 'STOP' end

  union all
  select '4 clean baseline', '>>> accounts / businesses / memberships',
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text, '0 / 0 / 0',
         case when (select count(*) from accounts) = 0
               and (select count(*) from businesses) = 0
               and (select count(*) from memberships) = 0
              then 'GO' else 'STOP' end
  union all
  select '4 clean baseline', '>>> onboarding_requests empty',
         (select count(*)::text from onboarding_requests), '0',
         case when (select count(*) from onboarding_requests) = 0
              then 'GO' else 'STOP' end
  union all
  select '4 clean baseline', '>>> ingredients / subscriptions',
         (select count(*) from ingredients)::text || ' / ' ||
         (select count(*) from subscriptions)::text, '0 / 0',
         case when (select count(*) from ingredients) = 0
               and (select count(*) from subscriptions) = 0
              then 'GO' else 'STOP' end
  union all
  select '4 clean baseline', '>>> C10 machinery still in place',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace
             and proname='fn_create_account_and_business' and pronargs = 9)
         || ' nine-arg RPC / ' ||
         (select count(*)::text from pg_class
           where relnamespace='public'::regnamespace and relname='onboarding_requests'),
         '1 nine-arg RPC / 1',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace
                       and proname='fn_create_account_and_business' and pronargs=9) = 1
               and (select count(*) from pg_class
                     where relnamespace='public'::regnamespace
                       and relname='onboarding_requests') = 1
              then 'GO' else 'STOP' end

) as t order by 1, 2;
