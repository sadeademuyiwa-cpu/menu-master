-- ============================================================================
-- MENU MASTER NG — 0019c: neutralise the foreign signup hook (REVERSIBLE)
--
-- PROPOSED. Not applied. Requires explicit approval.
--
-- WHY THIS SUPERSEDES 0019a AND 0019b
--   C2_TRIGGER_AUTHORITY.sql on production returned:
--
--     auth.users owner .................... supabase_auth_admin
--     current role owns it ................ NO   <- cannot DROP or DISABLE the trigger
--     public.handle_new_user owner ........ postgres
--     current role owns it ................ YES  <- CAN replace the function
--
--   0019a (ALTER TABLE auth.users DISABLE TRIGGER) and 0019b (DROP TRIGGER)
--   both require ownership of auth.users, which this role does not have. Both
--   are therefore impossible and must not be attempted. Neither is modified;
--   they remain on file as the record of a route that was closed off.
--
--   Replacing the body of a function requires ownership of the FUNCTION only.
--   That is an ordinary privilege this role already holds -- not an escalation,
--   not a workaround, and nothing to do with auth.users at all.
--
-- WHAT THIS DOES
--   Replaces public.handle_new_user() with a no-op that returns NEW. The
--   trigger on_auth_user_created stays exactly where it is, still enabled,
--   still owned by supabase_auth_admin, still firing on every signup -- it
--   simply stops raising. Signup succeeds again.
--
-- WHAT IT DOES NOT DO
--   It does not drop or disable the trigger. It does not alter auth.users or
--   anything in the auth schema. It does not create, delete, modify or
--   otherwise touch a single auth.users row -- the five existing users are not
--   read, not written, and not affected. It does not touch service_role, any
--   Menu Master object, or any tenant data.
--
-- ATTRIBUTE CHANGES, DELIBERATE
--   SECURITY DEFINER -> SECURITY INVOKER: a function that does nothing needs no
--   elevated privilege, so the elevation is dropped rather than left lying
--   around. search_path is pinned to pg_catalog; the body references nothing,
--   and pinning it removes any question of search_path manipulation.
--
-- REVERSAL
--   One statement, printed by the preflight below and reproduced here. Verified
--   on a replica: restoring the original body makes signup fail again with the
--   identical 42P01, so the reversal is real and not merely nominal.
-- ============================================================================

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user';

  if v_def is null then
    raise exception '0019c preflight: public.handle_new_user does not exist. '
                    'Nothing to neutralise -- do not run this migration.';
  end if;

  -- A. Refuse if a `vendors` relation now exists: the hook might be functional
  --    again, and neutralising a working hook would be a silent regression.
  if exists (select 1 from pg_class c
              where c.relname = 'vendors' and c.relkind in ('r','p','v','m','f')) then
    raise exception '0019c preflight FAILED: a `vendors` relation now exists, so '
                    'the hook may be working. Stop and re-analyse before running this.';
  end if;

  -- B. Refuse unless it is still the broken one.
  if v_def not like '%vendors%' then
    raise exception '0019c preflight FAILED: handle_new_user no longer references '
                    '`vendors`. Its body has changed since analysis. Stop.';
  end if;

  -- C. Refuse if we do not own it. This is the only privilege required, and
  --    without it the replacement below would fail halfway through the script.
  if not exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'handle_new_user'
                    and pg_has_role(current_user, p.proowner, 'USAGE')) then
    raise exception '0019c preflight FAILED: % does not own public.handle_new_user '
                    'and cannot replace it.', current_user;
  end if;

  -- D. Refuse if it is extension-owned.
  if exists (select 1 from pg_depend d join pg_proc p on p.oid = d.objid
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'handle_new_user' and d.deptype = 'e') then
    raise exception '0019c preflight FAILED: handle_new_user belongs to an extension.';
  end if;

  -- E. Refuse if any PUBLIC table's trigger uses it -- out of scope here.
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'handle_new_user'
                and t.tgrelid::regclass::text not like 'auth.%'
                and not t.tgisinternal) then
    raise exception '0019c preflight FAILED: a trigger on a public table uses it.';
  end if;

  raise notice '0019c: original definition follows. KEEP THIS -- it is the reversal.';
  raise notice '%', v_def;
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security invoker
set search_path to pg_catalog
as $$
begin
  -- Neutralised by 0019c. This hook was left behind by a previous application.
  -- It wrote to a table that exists in no schema, so it raised 42P01 on every
  -- signup and rolled the signup back.
  --
  -- The trigger belongs to auth.users, which this role does not own, so the
  -- trigger itself cannot be dropped or disabled from here. Neutralising the
  -- function it calls achieves the same outcome using only privileges we hold.
  --
  -- Menu Master does not use an auth.users trigger. Accounts and businesses are
  -- created by fn_create_account_and_business, called by the client after
  -- authentication succeeds. Nothing belongs in this function.
  return new;
end
$$;

do $$
declare
  v_src text;
  v_sec boolean;
begin
  select p.prosrc, p.prosecdef into v_src, v_sec
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user';

  -- prosrc includes comments, so match an actual write statement rather than
  -- the bare table name; otherwise a comment describing the old behaviour
  -- would trip this check.
  if lower(regexp_replace(v_src, '\s+', ' ', 'g')) like '%insert into vendors%' then
    raise exception '0019c self-check FAILED: the body still writes to `vendors`.';
  end if;

  if v_sec then
    raise exception '0019c self-check FAILED: the function is still SECURITY DEFINER.';
  end if;

  if not exists (select 1 from pg_trigger t
                   join pg_class c on c.oid = t.tgrelid
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'auth' and c.relname = 'users'
                    and t.tgname = 'on_auth_user_created' and not t.tgisinternal) then
    raise exception '0019c self-check FAILED: the trigger is gone. This migration '
                    'must not remove it -- investigate before proceeding.';
  end if;

  raise notice '0019c OK: hook neutralised, trigger left in place and enabled. '
               'Signup should now succeed. Reverse by restoring the definition '
               'logged by the preflight above.';
end
$$;
