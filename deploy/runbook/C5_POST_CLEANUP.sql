-- ============================================================================
-- MENU MASTER NG — POST-CLEANUP VERIFICATION
--
--   *** PURE SELECT. Single statement. Changes nothing. ***
--
-- Run immediately after C5_CLEANUP.sql commits, BEFORE deleting either
-- disposable Auth user in the Dashboard.
--
-- auth.users is expected to still be 7 here. The cleanup does not touch it.
-- The two disposable users are removed afterwards through the Dashboard only.
--
-- PASS only if every '>>>' row reads PASS.
-- ============================================================================

select * from (

  select '1 tenant gone' as section, '>>> accounts / businesses / memberships' as item,
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text as observed,
         '0 / 0 / 0' as expected,
         case when (select count(*) from accounts) = 0
               and (select count(*) from businesses) = 0
               and (select count(*) from memberships) = 0
              then 'PASS' else 'STOP' end as "verdict >>>"
  union all
  select '1 tenant gone', '>>> tenant ingredients / categories / prices',
         (select count(*) from ingredients)::text || ' / ' ||
         (select count(*) from ingredient_categories)::text || ' / ' ||
         (select count(*) from ingredient_prices)::text, '0 / 0 / 0',
         case when (select count(*) from ingredients) = 0
               and (select count(*) from ingredient_categories) = 0
               and (select count(*) from ingredient_prices) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 tenant gone', '>>> locations / business_settings / channels',
         (select count(*) from locations)::text || ' / ' ||
         (select count(*) from business_settings)::text || ' / ' ||
         (select count(*) from channels)::text, '0 / 0 / 0',
         case when (select count(*) from locations) = 0
               and (select count(*) from business_settings) = 0
               and (select count(*) from channels) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 tenant gone', '>>> subscriptions / onboarding_requests',
         (select count(*) from subscriptions)::text || ' / ' ||
         (select count(*) from onboarding_requests)::text, '0 / 0',
         case when (select count(*) from subscriptions) = 0
               and (select count(*) from onboarding_requests) = 0
              then 'PASS' else 'STOP' end
  union all
  select '1 tenant gone', '>>> the target account is gone',
         case when exists (select 1 from accounts
                            where id='59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'STILL PRESENT' else 'gone' end, 'gone',
         case when not exists (select 1 from accounts
                                where id='59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'PASS' else 'STOP' end

  union all
  select '2 reference intact', '>>> global units',
         (select count(*)::text from units), '45',
         case when (select count(*) from units) = 45 then 'PASS' else 'STOP' end
  union all
  select '2 reference intact', '>>> catalog_categories / catalog_ingredients',
         (select count(*) from catalog_categories)::text || ' / ' ||
         (select count(*) from catalog_ingredients)::text, '16 / 180',
         case when (select count(*) from catalog_categories) = 16
               and (select count(*) from catalog_ingredients) = 180
              then 'PASS' else 'STOP' end
  union all
  select '2 reference intact', '>>> plans / plan_features',
         (select count(*) from plans)::text || ' / ' ||
         (select count(*) from plan_features)::text, '3 / 12',
         case when (select count(*) from plans) = 3
               and (select count(*) from plan_features) = 12
              then 'PASS' else 'STOP' end

  union all
  select '3 schema intact', '>>> fn_* / relations / policies',
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
  select '3 schema intact', '>>> nine-argument onboarding RPC present',
         (select count(*)::text from pg_proc
           where pronamespace='public'::regnamespace
             and proname='fn_create_account_and_business' and pronargs=9), '1',
         case when (select count(*) from pg_proc
                     where pronamespace='public'::regnamespace
                       and proname='fn_create_account_and_business' and pronargs=9) = 1
              then 'PASS' else 'STOP' end
  union all
  select '3 schema intact', '>>> onboarding_requests TABLE still exists',
         case when exists (select 1 from pg_class
                            where relnamespace='public'::regnamespace
                              and relname='onboarding_requests' and relkind='r')
              then 'present' else 'DROPPED' end,
         'present -- only its rows were removed',
         case when exists (select 1 from pg_class
                            where relnamespace='public'::regnamespace
                              and relname='onboarding_requests' and relkind='r')
              then 'PASS' else 'STOP' end
  union all
  select '3 schema intact', '>>> handle_new_user still the neutralised no-op',
         coalesce((select case when p.prosecdef
                                 or lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                    ~ '(insert|update|delete|merge)\s'
                               then 'HOOK REGRESSED' else 'no-op intact' end
                     from pg_proc p where p.pronamespace='public'::regnamespace
                       and p.proname='handle_new_user'), 'ABSENT'),
         'no-op intact',
         case when exists (select 1 from pg_proc p
                            where p.pronamespace='public'::regnamespace
                              and p.proname='handle_new_user' and not p.prosecdef
                              and lower(regexp_replace(p.prosrc,'\s+',' ','g'))
                                  !~ '(insert|update|delete|merge)\s')
              then 'PASS' else 'STOP' end

  union all
  select '4 guard restored', '>>> trg_memberships_last_owner is ENABLED again',
         coalesce((select t.tgname || '  tgenabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname='memberships'
                      and t.tgname='trg_memberships_last_owner'
                      and not t.tgisinternal), 'MISSING'),
         'trg_memberships_last_owner  tgenabled=O',
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='public' and c.relname='memberships'
                             and t.tgname='trg_memberships_last_owner'
                             and not t.tgisinternal and t.tgenabled='O')
              then 'PASS' else 'STOP' end

  union all
  select '5 auth untouched', '>>> auth.users is STILL 7',
         (select count(*)::text from auth.users),
         '7 -- SQL must not have removed a user; the Dashboard does that next',
         case when (select count(*) from auth.users) = 7 then 'PASS' else 'STOP' end
  union all
  select '5 auth untouched', '>>> the five protected users are present and hold nothing',
         (select count(*)::text from auth.users
           where created_at < '2026-08-15'::timestamptz) || ' present, holding ' ||
         (select count(*)::text from memberships m join auth.users u on u.id=m.user_id
           where u.created_at < '2026-08-15'::timestamptz) || ' memberships',
         '5 present, holding 0 memberships',
         case when (select count(*) from auth.users
                     where created_at < '2026-08-15'::timestamptz) = 5
               and not exists (select 1 from memberships m join auth.users u on u.id=m.user_id
                                where u.created_at < '2026-08-15'::timestamptz)
              then 'PASS' else 'STOP' end
  union all
  select '5 auth untouched', 'the two disposable users, still present by design',
         coalesce((select string_agg(u.id::text, '  |  ' order by u.created_at)
                     from auth.users u
                    where u.created_at >= '2026-08-15'::timestamptz), 'none'),
         'both still present -- delete them in the Dashboard now',
         'OPERATOR ACTION'

) as t order by 1, 2;
