-- ============================================================================
-- MENU MASTER NG — verify a real signup landed correctly
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run this AFTER performing a real signup through the Supabase Auth API and
-- calling fn_create_account_and_business from the client. It reports what the
-- signup actually produced. It does not create anything itself, because the
-- point of the test is to exercise the real GoTrue path, not to simulate it.
-- ============================================================================

select * from (
  select '1 auth' as section, 'auth.users rows' as item,
         (select count(*)::text from auth.users) as observed,
         '1 or more' as expected
  union all
  select '1 auth', '>>> signup errors still occurring',
         case when exists (select 1 from pg_trigger t
                             join pg_class c on c.oid = t.tgrelid
                             join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname='auth' and c.relname='users'
                              and not t.tgisinternal and t.tgenabled <> 'D')
              then 'YES - an ENABLED trigger still runs on auth.users'
              else 'no enabled trigger on auth.users' end,
         'no enabled trigger on auth.users'
  union all
  select '2 onboarding', 'accounts / businesses / locations',
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from locations)::text,
         'one each per signed-up account'
  union all
  select '2 onboarding', 'owner memberships',
         (select count(*)::text from memberships where role = 'owner'),
         'one per account'
  union all
  select '2 onboarding', '>>> every account has exactly one owner',
         coalesce((select 'NO - account ' || account_id::text
                     from memberships where role='owner'
                    group by account_id having count(*) <> 1 limit 1),
                  case when (select count(*) from accounts) =
                            (select count(distinct account_id) from memberships where role='owner')
                       then 'YES' else 'NO - an account has no owner' end),
         'YES'
  union all
  select '2 onboarding', 'business_settings / channels',
         (select count(*) from business_settings)::text || ' / ' ||
         (select count(*) from channels)::text,
         'one each per business'
  union all
  select '3 trial', 'subscriptions by status',
         coalesce((select string_agg(status || '=' || n, ', ' order by status)
                     from (select status, count(*) n from subscriptions group by status) s),
                  'none'),
         'trialing=<number of accounts>'
  union all
  select '4 catalogue', 'ingredients cloned into accounts',
         (select count(*)::text from ingredients),
         '180 per account (starter catalogue)'
  union all
  select '4 catalogue', '>>> SOURCE OF TRUTH: prices must be empty',
         case when (select count(*) from ingredient_prices) = 0
              then 'PASS - 0 price rows, nothing was invented'
              else 'FAIL - ' || (select count(*) from ingredient_prices)::text
                   || ' price rows exist and no user entered them' end,
         'PASS'
  union all
  select '4 catalogue', '>>> onboarding reports incomplete, not costed',
         coalesce((select string_agg(distinct 'has blockers', ', ')
                     from v_costing_blockers), 'no recipes yet, so no blockers'),
         'incomplete until the owner enters prices'
  union all
  select '5 profiles', 'profiles rows (client-written, may be 0)',
         (select count(*)::text from profiles),
         '0 unless the client upserts name/phone'
) as t order by 1, 2;
