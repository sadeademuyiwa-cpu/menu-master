-- ============================================================================
-- MENU MASTER NG — C10 FORENSIC MAP
--
--   *** PURE SELECT. Single statement. Deletes nothing, changes nothing. ***
--
-- The C10 acceptance test committed instead of rolling back. This maps every
-- persisted row and attributes it to a user, so cleanup can be surgical.
--
-- It discovers the extra users dynamically as those created on or after
-- 2026-08-15. The five protected users predate that and are only ever counted,
-- never enumerated as targets.
-- ============================================================================

with extra as (
  select u.id, u.email, u.created_at
  from auth.users u
  where u.created_at >= '2026-08-15'::timestamptz
),
owned as (
  select e.id as user_id, m.account_id
  from extra e
  left join memberships m on m.user_id = e.id
)
select * from (

  -- ---- per-user identity ------------------------------------------------
  select '1 identity' as section,
         'user ' || substr(e.id::text, 1, 8) as item,
         e.id::text || '   ' || coalesce(e.email,'(no email)')
           || '   created ' || left(e.created_at::text, 19) as observed
  from extra e

  -- ---- does it own the membership? --------------------------------------
  union all
  select '2 membership',
         'user ' || substr(e.id::text, 1, 8),
         coalesce((select 'OWNS membership ' || m.id::text || '  role=' || m.role::text
                          || '  account=' || m.account_id::text
                     from memberships m where m.user_id = e.id limit 1),
                  'owns no membership')
  from extra e

  -- ---- account ------------------------------------------------------------
  union all
  select '3 account',
         'user ' || substr(e.id::text, 1, 8),
         coalesce((select 'account ' || a.id::text || '  name=' || a.name
                     from accounts a
                     join memberships m on m.account_id = a.id
                    where m.user_id = e.id limit 1),
                  'no account')
  from extra e

  -- ---- businesses ---------------------------------------------------------
  union all
  select '4 businesses',
         'user ' || substr(e.id::text, 1, 8),
         coalesce((select string_agg(b.id::text || ' (' || b.name || ')', '  |  '
                          order by b.name)
                     from businesses b
                    where b.account_id in (select account_id from owned o
                                            where o.user_id = e.id
                                              and o.account_id is not null)),
                  'none')
  from extra e

  -- ---- locations ----------------------------------------------------------
  union all
  select '5 locations',
         'user ' || substr(e.id::text, 1, 8),
         coalesce((select string_agg(l.id::text || ' (' || l.name || ')', '  |  ')
                     from locations l
                    where l.account_id in (select account_id from owned o
                                            where o.user_id = e.id
                                              and o.account_id is not null)),
                  'none')
  from extra e

  -- ---- subscription -------------------------------------------------------
  union all
  select '6 subscription',
         'user ' || substr(e.id::text, 1, 8),
         coalesce((select string_agg(s.id::text || '  plan=' || s.plan_id
                          || '  status=' || s.status, '  |  ')
                     from subscriptions s
                    where s.account_id in (select account_id from owned o
                                            where o.user_id = e.id
                                              and o.account_id is not null)),
                  'none')
  from extra e

  -- ---- onboarding_requests ------------------------------------------------
  union all
  select '7 ledger',
         'user ' || substr(e.id::text, 1, 8),
         coalesce((select string_agg('key=' || r.idempotency_key
                          || ' account_created=' || r.account_created::text
                          || ' ingredients=' || r.ingredients_added::text
                          || ' business=' || substr(r.business_id::text,1,8), '  |  '
                          order by r.created_at)
                     from onboarding_requests r where r.user_id = e.id),
                  'none')
  from extra e

  -- ---- ingredient rows ----------------------------------------------------
  union all
  select '8 ingredients',
         'user ' || substr(e.id::text, 1, 8),
         (select count(*)::text from ingredients i
           where i.account_id in (select account_id from owned o
                                   where o.user_id = e.id
                                     and o.account_id is not null))
         || ' ingredients / ' ||
         (select count(*)::text from ingredient_categories c
           where c.account_id in (select account_id from owned o
                                   where o.user_id = e.id
                                     and o.account_id is not null))
         || ' categories / ' ||
         (select count(*)::text from ingredient_prices p
           where p.account_id in (select account_id from owned o
                                   where o.user_id = e.id
                                     and o.account_id is not null))
         || ' prices'
  from extra e

  -- ---- does it own ANY tenant data at all? --------------------------------
  union all
  select '9 verdict',
         'user ' || substr(e.id::text, 1, 8),
         case when exists (select 1 from memberships m where m.user_id = e.id)
                or exists (select 1 from onboarding_requests r where r.user_id = e.id)
                or exists (select 1 from profiles p where p.id = e.id)
              then 'HOLDS TENANT DATA -- cleanup must remove it'
              else 'holds NOTHING -- only the auth row needs removing' end
  from extra e

  -- ---- totals, to prove nothing is unattributed ---------------------------
  union all
  select '10 totals', 'rows attributed to these users',
         (select count(*) from accounts)::text || ' accounts / ' ||
         (select count(*) from businesses)::text || ' businesses / ' ||
         (select count(*) from memberships)::text || ' memberships / ' ||
         (select count(*) from onboarding_requests)::text || ' ledger'
  union all
  select '10 totals', '>>> anything NOT owned by an extra user',
         case when exists (
                select 1 from accounts a
                 where a.id not in (select o.account_id from owned o
                                     where o.account_id is not null))
              then 'UNATTRIBUTED ACCOUNT EXISTS -- investigate before cleanup'
              else 'none -- every account traces to an extra user' end
  union all
  select '10 totals', '>>> the five protected users',
         (select count(*)::text from auth.users
           where created_at < '2026-08-15'::timestamptz)
         || ' present, holding ' ||
         (select count(*)::text from memberships m
           join auth.users u on u.id = m.user_id
          where u.created_at < '2026-08-15'::timestamptz)
         || ' memberships and ' ||
         (select count(*)::text from profiles p
           join auth.users u on u.id = p.id
          where u.created_at < '2026-08-15'::timestamptz)
         || ' profiles'
  union all
  select '10 totals', 'reference data (must not be touched by cleanup)',
         (select count(*) from units)::text || ' units / ' ||
         (select count(*) from catalog_ingredients)::text || ' catalog_ingredients / ' ||
         (select count(*) from plans)::text || ' plans'

) as t order by 1, 2;
