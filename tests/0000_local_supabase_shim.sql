-- ============================================================================
-- MENU MASTER NG
-- tests/0000_local_supabase_shim.sql
--
--   *** RECONSTRUCTED — NOT A RECOVERED ORIGINAL ***
--
-- The original shim was NOT recovered. This file is a rebuild, derived only
-- from the requirements observable in the recovered artifacts:
--
--   - tests/001_correctness_and_isolation.sql   auth.users(id,email), auth.uid(),
--                                               set local role authenticated / anon,
--                                               request.jwt.claim.sub
--   - tests/002_gate1_attack_and_regression.sql set local role authenticated,
--                                               reset role, forged jwt subjects
--   - tests/003_real_client_role_escalation.sql connects AS authenticator;
--                                               set role postgres must fail;
--                                               set role service_role must succeed
--   - docs/GATE1_REPORT.md section 1            "Added an `authenticator` LOGIN
--                                               NOINHERIT role so tests run as a
--                                               real client, not a superuser"
--   - migrations/0012                           fn_is_service_context() reads the
--                                               `role` GUC and request.jwt.claim.sub
--
-- It is NOT byte-identical to the original and must not be presented as such.
--
-- LOCAL ONLY. Never run this against Supabase: Supabase provides the auth
-- schema, auth.uid() and these roles itself, and this file would collide with
-- or weaken them.
--
-- Run BEFORE migrations/0001_init.sql — 0001 creates foreign keys that
-- reference auth.users(id).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensions
-- ----------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 2. API roles
--
-- Mirrors the Supabase/PostgREST role model:
--   authenticator  the LOGIN role PostgREST connects as. NOINHERIT, so it holds
--                  no privilege of its own until it SET ROLEs.
--   anon           unauthenticated requests
--   authenticated  requests carrying a valid user JWT
--   service_role   trusted backend (webhooks, jobs). Bypasses RLS in Supabase.
--
-- authenticator is granted all three, which is what makes test 003 meaningful:
-- SET ROLE service_role succeeds, yet fn_is_service_context() must still
-- return false while an end-user JWT subject is present.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- ----------------------------------------------------------------------------
-- 2b. Supabase's DEFAULT PRIVILEGES
--
-- Added after the service-context test found that every local result had been
-- produced against a MORE locked-down database than production. Supabase runs
-- the equivalent of these three statements, so every table, function and
-- sequence a migration creates arrives with ALL granted to anon and
-- authenticated -- and GRANTs are additive, so an explicit GRANT never removes
-- them.
--
-- Without these lines the shim silently flatters us: anon appeared to hold
-- nothing, when on Supabase it held DELETE, INSERT, REFERENCES, SELECT,
-- TRIGGER, TRUNCATE, UPDATE on every tenant table. TRUNCATE is not gated by
-- RLS, and `set role anon; truncate ingredient_prices cascade;` worked.
--
-- Migration 0018 revokes them. These lines exist so that the local suite is
-- testing the same grant surface production has, and so that 0018 is exercised
-- rather than assumed.
-- ----------------------------------------------------------------------------

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. The auth schema
-- ----------------------------------------------------------------------------

create schema if not exists auth;

grant usage on schema auth to anon, authenticated, service_role;

-- Minimal stand-in for Supabase's auth.users. Only the columns the recovered
-- migrations and test suites actually reference are modelled: id and email.
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. auth.uid()
--
-- Supabase derives the current user from the `sub` claim of the request JWT,
-- surfaced as the GUC request.jwt.claim.sub. The tests forge that GUC directly
-- via set_config, which is exactly how a hostile client's identity would
-- arrive.
--
-- The nullif() matters: the suites clear the claim with set_config(..., '', ...)
-- rather than unsetting it, and ''::uuid would raise 22P02 instead of yielding
-- the "no current user" NULL that every policy expects.
-- ----------------------------------------------------------------------------

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- auth.role(), provided for parity with Supabase. Not referenced by the
-- recovered suites, but harmless and cheap to keep the surface faithful.
create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  current_setting('role', true));
$$;

grant execute on function auth.role() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Notes on what this shim deliberately does NOT do
--
--   - It does not grant anon or authenticated any privilege on public tables.
--     migrations/0011 states those explicitly, and test T23 depends on anon
--     having none.
--   - It does not disable or force RLS. The suites rely on RLS applying to the
--     `authenticated` role, which it does because that role neither owns the
--     tables nor holds BYPASSRLS.
--   - It does not create a `postgres` superuser. Test 003 expects
--     `SET ROLE postgres` to fail from the authenticator connection.
-- ----------------------------------------------------------------------------
