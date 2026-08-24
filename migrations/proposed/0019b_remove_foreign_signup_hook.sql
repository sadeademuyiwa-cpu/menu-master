-- ============================================================================
-- MENU MASTER NG
-- 0019 (PROPOSED — NOT APPROVED, NOT APPLIED, NOT IN THE DEPLOY CHAIN)
--
-- Removes the foreign signup hook that blocks every registration:
--   auth.users → on_auth_user_created → public.handle_new_user → vendors
-- where `vendors` exists in no schema.
--
-- This migration DELETES NO DATA. Dropping a trigger and a function touches
-- no rows in any table. It is included here for review only.
--
-- Menu Master creates no trigger on auth.users and does not need one: the
-- client calls fn_create_account_and_business after signup completes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PREFLIGHT — refuse unless every assumption still holds
--
-- Deliberately fails closed. If the hook has become functional since the
-- analysis (someone created `vendors`), this migration must NOT run: a
-- working integration owned by someone else is not ours to remove.
-- ----------------------------------------------------------------------------

do $$
declare
  v_src text;
begin
  if to_regclass('public.handle_new_user') is not null then
    null;  -- placeholder, relations and functions share no namespace check
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user';

  if v_src is null then
    raise exception '0019b preflight: public.handle_new_user does not exist. '
                    'Nothing to remove -- do not run this migration.';
  end if;

  -- 0. DROP TRIGGER requires ownership of auth.users, and DROP FUNCTION
  --    requires ownership of the function. On Supabase auth.users belongs to
  --    supabase_auth_admin, so refuse clearly rather than half-applying.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'auth' and c.relname = 'users'
                    and pg_has_role(current_user, c.relowner, 'USAGE')) then
    raise exception '0019b preflight FAILED: % does not own auth.users, so it '
                    'cannot drop the trigger. Apply 0019a instead, which only '
                    'disables the trigger and needs no ownership.', current_user;
  end if;

  if not exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'handle_new_user'
                    and pg_has_role(current_user, p.proowner, 'USAGE')) then
    raise exception '0019b preflight FAILED: % does not own '
                    'public.handle_new_user and cannot drop it.', current_user;
  end if;

  -- A. It must still be the broken one. If `vendors` now exists anywhere, the
  --    hook may be functional and this migration must not touch it.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relname = 'vendors' and c.relkind in ('r','v','p','f','m')) then
    raise exception '0019b preflight FAILED: a `vendors` relation now exists. '
                    'The hook may be functional. Re-run the analysis before removing anything.';
  end if;

  -- B. It must still target vendors. If the body changed, our analysis is stale.
  if v_src not ilike '%vendors%' then
    raise exception '0019b preflight FAILED: handle_new_user no longer references '
                    'vendors. Its definition changed since analysis. Stop.';
  end if;

  -- C. It must not belong to an extension.
  if exists (select 1 from pg_proc p
              join pg_depend d on d.objid = p.oid and d.deptype = 'e'
             where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user') then
    raise exception '0019b preflight FAILED: handle_new_user is owned by an extension. '
                    'Removing it would corrupt that extension.';
  end if;

  -- D. No Menu Master object may depend on it.
  if exists (select 1 from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
              join pg_proc p on p.oid = t.tgfoid
             where p.proname = 'handle_new_user' and not t.tgisinternal
               and c.relnamespace = 'public'::regnamespace) then
    raise exception '0019b preflight FAILED: a trigger on a public table uses it.';
  end if;

  raise notice '0019b preflight passed: handle_new_user targets a nonexistent `vendors`, '
               'is not extension-owned, and nothing in public depends on it.';
end
$$;

-- ----------------------------------------------------------------------------
-- 2. RECORD what is being removed, before removing it
--
-- The definition is written into the migration log so the object can be
-- reconstructed exactly if its owner ever wants it back.
-- ----------------------------------------------------------------------------

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user';
  raise notice '0019 REMOVING, definition preserved here: %', v_def;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Remove the trigger, then the function
--
-- Order matters: the trigger depends on the function.
-- Neither statement touches a single row of data.
-- ----------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. SELF-CHECK
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal) then
    raise exception '0019b self-check FAILED: a trigger still exists on auth.users';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname = 'handle_new_user') then
    raise exception '0019b self-check FAILED: handle_new_user still exists';
  end if;
  raise notice '0019b self-check passed: signup path is clear. '
               'No rows were deleted -- this migration only dropped a trigger and a function.';
end
$$;
