-- ============================================================================
-- MENU MASTER NG -- tests/fixtures/boundary_users.sql
--
--   *** LOCAL ONLY. NEVER RUN AGAINST SUPABASE. ***
--
-- The three auth users that tests 006, 007 and 009 resolve BY EMAIL. On a
-- disposable Supabase project they were created by hand in
-- Authentication > Users; a database built from this repository has nobody to
-- do that, so this file does it against the LOCAL shim's auth.users.
--
-- It writes only to auth.users, which on Supabase belongs to the platform.
-- The guard below refuses to run anywhere the local shim is not present, so a
-- copy-paste into the wrong SQL Editor cannot create accounts on a real
-- project.
--
-- 006 creates everything else (accounts, memberships, prices, conversions)
-- from these three users, exactly as it would on a disposable project.
-- ============================================================================

do $$
begin
  -- The shim is the only thing that ever defines this function. Its absence
  -- means we are not on a local database, and this file must do nothing.
  if not exists (select 1 from pg_proc where proname = 'local_pre_request'
                   and pronamespace = 'public'::regnamespace) then
    raise exception 'boundary_users.sql: local shim not present -- refusing to touch auth.users';
  end if;
end
$$;

insert into auth.users (id, email) values
  ('0000000b-0000-4000-8000-00000000000a', 'ownera@boundary.test'),
  ('0000000b-0000-4000-8000-00000000000b', 'ownerb@boundary.test'),
  ('0000000b-0000-4000-8000-00000000000c', 'cashierb@boundary.test')
on conflict (id) do nothing;

do $$
begin
  if (select count(*) from auth.users
       where lower(email) in ('ownera@boundary.test','ownerb@boundary.test','cashierb@boundary.test')) <> 3 then
    raise exception 'boundary_users.sql: the three boundary users were not provisioned';
  end if;
  raise notice 'fixtures OK: ownera, ownerb and cashierb exist in auth.users (local shim).';
end
$$;
