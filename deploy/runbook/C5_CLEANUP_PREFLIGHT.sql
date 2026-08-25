-- ============================================================================
-- MENU MASTER NG — CLEANUP PREFLIGHT (C10 committed test data)
--
--   *** PURE SELECT. Single statement. Deletes nothing. ***
--
-- Proves every row the cleanup will remove belongs to account
-- 59687f01-5954-4705-9a7c-32f2d5cbf669, owned by user
-- 2ca27f8c-7e39-41dc-a175-0a87c70da1e0, and that nothing
-- else is caught by it.
--
-- PROCEED only if every '>>>' row reads GO.
-- ============================================================================

select * from (

  select '1 target' as section, '>>> the account exists and is the expected one' as item,
         coalesce((select a.id::text || '  name=' || a.name from accounts a
                    where a.id = '59687f01-5954-4705-9a7c-32f2d5cbf669'), 'NOT FOUND') as observed,
         '59687f01-5954-4705-9a7c-32f2d5cbf669  name=C10 Test Foods' as expected,
         case when exists (select 1 from accounts where id = '59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'GO' else 'STOP' end as "verdict >>>"
  union all
  select '1 target', '>>> it is the ONLY account in the database',
         (select count(*)::text from accounts), '1',
         case when (select count(*) from accounts) = 1
               and exists (select 1 from accounts where id = '59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'GO' else 'STOP' end
  union all
  select '1 target', '>>> its only member is the disposable test user',
         coalesce((select string_agg(m.user_id::text || ' (' || m.role::text || ')', ', ')
                     from memberships m where m.account_id = '59687f01-5954-4705-9a7c-32f2d5cbf669'), 'none'),
         '2ca27f8c-7e39-41dc-a175-0a87c70da1e0 (owner)',
         case when (select coalesce(string_agg(m.user_id::text, ','), '') from memberships m
                     where m.account_id = '59687f01-5954-4705-9a7c-32f2d5cbf669') = '2ca27f8c-7e39-41dc-a175-0a87c70da1e0'
              then 'GO' else 'STOP' end

  union all
  select '2 attribution', '>>> no row in any tenant table belongs elsewhere',
         (select coalesce(string_agg(t, ', '), 'none') from (
            select 'businesses' t from businesses where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'locations' from locations where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'business_settings' from business_settings where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'channels' from channels where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'ingredients' from ingredients where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'ingredient_categories' from ingredient_categories where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'ingredient_prices' from ingredient_prices where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'subscriptions' from subscriptions where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'memberships' from memberships where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
            union select 'onboarding_requests' from onboarding_requests where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669'
          ) x),
         'none -- everything traces to the target account',
         case when not exists (select 1 from businesses where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from locations where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from business_settings where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from channels where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from ingredients where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from ingredient_categories where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from ingredient_prices where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from subscriptions where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from memberships where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
               and not exists (select 1 from onboarding_requests where account_id <> '59687f01-5954-4705-9a7c-32f2d5cbf669')
              then 'GO' else 'STOP' end

  union all
  select '3 to be deleted', 'businesses / locations / business_settings / channels',
         (select count(*) from businesses where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from locations where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from business_settings where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from channels where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text,
         '2 / 2 / 2 / 2', 'EXPECTED COUNT'
  union all
  select '3 to be deleted', 'ingredients / categories / prices',
         (select count(*) from ingredients where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from ingredient_categories where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from ingredient_prices where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text,
         '180 / 16 / 0', 'EXPECTED COUNT'
  union all
  select '3 to be deleted', 'subscriptions / memberships / onboarding_requests',
         (select count(*) from subscriptions where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from memberships where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text || ' / ' ||
         (select count(*) from onboarding_requests where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669')::text,
         '1 / 1 / 2', 'EXPECTED COUNT'
  union all
  select '3 to be deleted', 'account-scoped units (NOT the 45 global ones)',
         (select count(*)::text from units where account_id='59687f01-5954-4705-9a7c-32f2d5cbf669'),
         '0', 'EXPECTED COUNT'
  union all
  select '3 to be deleted', 'every deeper table is already empty',
         (select count(*) from recipes)::text || ' recipes / ' ||
         (select count(*) from purchases)::text || ' purchases / ' ||
         (select count(*) from orders)::text || ' orders / ' ||
         (select count(*) from sales_entries)::text || ' sales / ' ||
         (select count(*) from suppliers)::text || ' suppliers',
         '0 / 0 / 0 / 0 / 0',
         case when (select count(*) from recipes)=0 and (select count(*) from purchases)=0
               and (select count(*) from orders)=0 and (select count(*) from sales_entries)=0
               and (select count(*) from suppliers)=0
              then 'GO' else 'STOP' end

  union all
  select '4 must survive', '>>> global units (account_id IS NULL)',
         (select count(*)::text from units where account_id is null),
         '45 -- the cascade cannot match a NULL account_id',
         case when (select count(*) from units where account_id is null) = 45
              then 'GO' else 'STOP' end
  union all
  select '4 must survive', '>>> catalogue and plans have no FK to accounts',
         (select count(*)::text from information_schema.columns
           where table_schema='public'
             and table_name in ('catalog_ingredients','catalog_categories','plans','plan_features')
             and column_name='account_id'),
         '0 such columns -- no cascade can reach them',
         case when (select count(*) from information_schema.columns
                     where table_schema='public'
                       and table_name in ('catalog_ingredients','catalog_categories',
                                          'plans','plan_features')
                       and column_name='account_id') = 0
              then 'GO' else 'STOP' end
  union all
  select '4 must survive', '>>> the five protected users hold nothing',
         (select count(*)::text from auth.users u
           where u.created_at < '2026-08-15'::timestamptz
             and (exists (select 1 from memberships m where m.user_id=u.id)
               or exists (select 1 from profiles p where p.id=u.id)
               or exists (select 1 from onboarding_requests r where r.user_id=u.id))),
         '0',
         case when not exists (select 1 from auth.users u
                                where u.created_at < '2026-08-15'::timestamptz
                                  and (exists (select 1 from memberships m where m.user_id=u.id)
                                    or exists (select 1 from profiles p where p.id=u.id)
                                    or exists (select 1 from onboarding_requests r
                                                where r.user_id=u.id)))
              then 'GO' else 'STOP' end

  union all
  select '5 the guard', '>>> the blocking trigger, by name',
         coalesce((select t.tgname || '  enabled=' || t.tgenabled::text
                     from pg_trigger t join pg_class c on c.oid=t.tgrelid
                     join pg_proc p on p.oid=t.tgfoid
                    where c.relname='memberships' and p.proname='fn_guard_last_owner'
                      and not t.tgisinternal), 'NOT FOUND'),
         'trg_memberships_last_owner  enabled=O',
         case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                            join pg_proc p on p.oid=t.tgfoid
                           where c.relname='memberships'
                             and t.tgname='trg_memberships_last_owner'
                             and p.proname='fn_guard_last_owner'
                             and not t.tgisinternal and t.tgenabled='O')
              then 'GO' else 'STOP' end
  union all
  select '5 the guard', '>>> we own memberships, so we may disable its trigger',
         coalesce((select case when pg_has_role(current_user, c.relowner, 'USAGE')
                               then 'yes, owner is ' || c.relowner::regrole::text
                               else 'NO' end
                     from pg_class c where c.relnamespace='public'::regnamespace
                       and c.relname='memberships'), 'ABSENT'),
         'yes, owner is postgres',
         case when exists (select 1 from pg_class c
                            where c.relnamespace='public'::regnamespace
                              and c.relname='memberships'
                              and pg_has_role(current_user, c.relowner, 'USAGE'))
              then 'GO' else 'STOP' end

  union all
  select '6 disposable users', 'user A holds nothing (Dashboard delete only)',
         case when exists (select 1 from memberships where user_id='2b61fc84-7d06-4aa0-b7b5-d5bf7846ec5f')
                or exists (select 1 from onboarding_requests where user_id='2b61fc84-7d06-4aa0-b7b5-d5bf7846ec5f')
                or exists (select 1 from profiles where id='2b61fc84-7d06-4aa0-b7b5-d5bf7846ec5f')
              then 'HOLDS DATA' else 'holds nothing' end,
         'holds nothing', 'INFORMATIONAL'
  union all
  select '6 disposable users', 'user B holds the tenant being removed',
         case when exists (select 1 from memberships where user_id='2ca27f8c-7e39-41dc-a175-0a87c70da1e0')
              then 'owns the membership' else 'owns nothing' end,
         'owns the membership', 'INFORMATIONAL'

) as t order by 1, 2;
