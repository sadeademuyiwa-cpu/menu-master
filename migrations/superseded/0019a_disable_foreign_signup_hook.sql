-- ============================================================================
-- MENU MASTER NG — 0019a: DISABLE the foreign signup hook (REVERSIBLE)
--
-- PROPOSED. Not part of the deploy chain. Requires explicit approval.
--
-- WHY THIS EXISTS AS A SEPARATE STEP
--   public.handle_new_user() fires AFTER INSERT on auth.users and inserts into
--   a relation named `vendors` that exists in no schema. Every signup therefore
--   raises 42P01 inside the trigger, the INSERT rolls back, and GoTrue reports
--   a failed signup. Production cannot onboard a single user today.
--
--   0019b removes the hook permanently. This step only switches it off. It
--   changes no definition, drops nothing, and is undone by one statement:
--
--       alter table auth.users enable trigger on_auth_user_created;
--
--   Prefer this first: it restores signup immediately and keeps the original
--   object available for inspection until the signup test has passed.
--
-- WHAT IT DOES NOT DO
--   It does not delete data. It does not alter Menu Master objects. It does
--   not touch service_role. It leaves handle_new_user and its trigger in place.
-- ============================================================================

do $$
declare
  v_enabled "char";
begin
  select t.tgenabled into v_enabled
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users'
    and t.tgname = 'on_auth_user_created' and not t.tgisinternal;

  if v_enabled is null then
    raise exception '0019a preflight: no trigger on_auth_user_created on '
                    'auth.users. Nothing to disable -- do not run this.';
  end if;

  if v_enabled = 'D' then
    raise exception '0019a preflight: the trigger is already disabled. '
                    'Nothing to do.';
  end if;

  -- Disabling a trigger requires ownership of the table, same as dropping one.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'auth' and c.relname = 'users'
                    and pg_has_role(current_user, c.relowner, 'USAGE')) then
    raise exception '0019a preflight FAILED: % does not own auth.users. Run '
                    'C2_TRIGGER_AUTHORITY.sql and report the owner before '
                    'proceeding; do not attempt a workaround.', current_user;
  end if;

  -- Record the exact definition before switching it off, so it can be
  -- reconstructed from the log alone if the trigger is later dropped.
  raise notice '0019a: disabling on_auth_user_created. Current definition of '
               'the function it calls follows.';
  raise notice '%', (select pg_get_functiondef(p.oid) from pg_proc p
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'handle_new_user');
end $$;

alter table auth.users disable trigger on_auth_user_created;

do $$
declare v_enabled "char";
begin
  select t.tgenabled into v_enabled
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users'
    and t.tgname = 'on_auth_user_created' and not t.tgisinternal;

  if v_enabled is distinct from 'D' then
    raise exception '0019a self-check FAILED: trigger state is %, expected D.',
                    coalesce(v_enabled::text, 'missing');
  end if;

  raise notice '0019a OK: on_auth_user_created is disabled. Signup should now '
               'succeed. Re-enable with: alter table auth.users enable trigger '
               'on_auth_user_created;';
end $$;
