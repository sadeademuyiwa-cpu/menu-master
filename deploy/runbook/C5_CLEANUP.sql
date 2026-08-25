-- ============================================================================
-- MENU MASTER NG — CLEANUP of the committed C10 acceptance-test tenant
--
-- RUN INSIDE:  begin;  <this file>  commit;
--
-- WHAT IT DOES
--   Deletes ONE account: 59687f01-5954-4705-9a7c-32f2d5cbf669.
--   Every one of the 27 foreign keys pointing at accounts is ON DELETE CASCADE
--   -- verified from pg_constraint, none is NO ACTION or RESTRICT at the
--   account level -- so a single delete removes the whole tenant in the
--   database's own dependency order. No hand-ordered delete list is needed or
--   used; ordering is derived by PostgreSQL, not guessed by me.
--
-- WHY THE TRIGGER IS DISABLED
--   trg_memberships_last_owner fires BEFORE DELETE on memberships and refuses
--   to remove an account's last owner. It fires on cascades too, so deleting
--   the account, the membership, or the Auth user all fail with
--   'An account must retain at least one owner'. That guard is correct for
--   real tenants and wrong for removing a whole disposable one.
--
--   DDL is transactional, so the trigger is disabled ONLY inside this
--   transaction and restored before it commits. If anything fails, the
--   rollback restores both the data and the trigger.
--
-- WHAT IT DOES NOT DO
--   No schema change. No CREATE, no DROP, no ALTER beyond disabling and
--   re-enabling that one trigger. No grant, policy, function or migration is
--   touched. 0020 stays, onboarding_requests the TABLE stays, the nine-argument
--   RPC stays, handle_new_user stays. No reference data is touched. No
--   auth.users row is touched -- the two disposable users are removed
--   afterwards through the Dashboard, never from SQL.
-- ============================================================================

do $pre$
begin
  if not exists (select 1 from accounts where id = '59687f01-5954-4705-9a7c-32f2d5cbf669') then
    raise exception 'CLEANUP ABORTED: account 59687f01-5954-4705-9a7c-32f2d5cbf669 does not exist.';
  end if;
  if (select count(*) from accounts) <> 1 then
    raise exception 'CLEANUP ABORTED: % accounts exist, expected exactly 1.',
                    (select count(*) from accounts);
  end if;
  if exists (select 1 from memberships m
              join auth.users u on u.id = m.user_id
             where u.created_at < '2026-08-15'::timestamptz) then
    raise exception 'CLEANUP ABORTED: a protected user holds a membership. STOP.';
  end if;
  -- The trigger must be present, uniquely named and ENABLED before we touch
  -- it. If it were already disabled, something else has interfered and the
  -- re-enable at the end would silently "fix" a state we did not create.
  if not exists (select 1 from pg_trigger t
                   join pg_class c on c.oid = t.tgrelid
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'memberships'
                    and t.tgname = 'trg_memberships_last_owner'
                    and not t.tgisinternal
                    and t.tgenabled = 'O') then
    raise exception 'CLEANUP ABORTED: trg_memberships_last_owner is not present '
                    'and enabled on public.memberships. Do not proceed.';
  end if;

  if (select count(*) from pg_trigger
       where not tgisinternal and tgname ilike '%last_owner%') <> 1 then
    raise exception 'CLEANUP ABORTED: expected exactly one last-owner trigger, '
                    'found %. A near-duplicate name would make the disable '
                    'ambiguous.', (select count(*) from pg_trigger
                                    where not tgisinternal
                                      and tgname ilike '%last_owner%');
  end if;

  if (select count(*) from units where account_id is null) <> 45 then
    raise exception 'CLEANUP ABORTED: expected 45 global units, found %.',
                    (select count(*) from units where account_id is null);
  end if;
  raise notice 'Cleanup preflight OK. Removing account 59687f01-5954-4705-9a7c-32f2d5cbf669.';
end
$pre$;

alter table memberships disable trigger trg_memberships_last_owner;

delete from accounts where id = '59687f01-5954-4705-9a7c-32f2d5cbf669';

alter table memberships enable trigger trg_memberships_last_owner;

do $post$
declare v_bad text;
begin
  -- the guard must be back on before this transaction commits
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                  where c.relname='memberships'
                    and t.tgname='trg_memberships_last_owner'
                    and not t.tgisinternal and t.tgenabled='O') then
    raise exception 'CLEANUP SELF-CHECK FAILED: the last-owner guard was not '
                    're-enabled. Refusing to commit.';
  end if;

  select string_agg(x.t, ', ') into v_bad from (
    select 'accounts' t from accounts
    union select 'businesses' from businesses
    union select 'memberships' from memberships
    union select 'locations' from locations
    union select 'business_settings' from business_settings
    union select 'channels' from channels
    union select 'ingredients' from ingredients
    union select 'ingredient_categories' from ingredient_categories
    union select 'subscriptions' from subscriptions
    union select 'onboarding_requests' from onboarding_requests
  ) x;
  if v_bad is not null then
    raise exception 'CLEANUP SELF-CHECK FAILED: rows remain in %.', v_bad;
  end if;

  if (select count(*) from units) <> 45 then
    raise exception 'CLEANUP SELF-CHECK FAILED: units is %, expected 45.',
                    (select count(*) from units);
  end if;
  if (select count(*) from catalog_ingredients) <> 180
     or (select count(*) from catalog_categories) <> 16
     or (select count(*) from plans) <> 3
     or (select count(*) from plan_features) <> 12 then
    raise exception 'CLEANUP SELF-CHECK FAILED: reference data changed.';
  end if;

  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 40
     or (select count(*) from pg_class
          where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) <> 44
     or (select count(*) from pg_policies where schemaname='public') <> 93 then
    raise exception 'CLEANUP SELF-CHECK FAILED: schema shape changed from 40/44/93.';
  end if;

  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace
         and proname='fn_create_account_and_business' and pronargs=9) <> 1 then
    raise exception 'CLEANUP SELF-CHECK FAILED: the nine-argument RPC is gone.';
  end if;

  if (select count(*) from auth.users) <> 7 then
    raise exception 'CLEANUP SELF-CHECK FAILED: auth.users is %, expected 7. This '
                    'migration must not remove a user.', (select count(*) from auth.users);
  end if;

  raise notice 'CLEANUP OK: tenant removed, guard re-enabled, reference data and '
               'schema unchanged, all 7 auth users still present. Delete the two '
               'disposable users through the Dashboard next.';
end
$post$;
