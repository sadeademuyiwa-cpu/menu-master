-- ============================================================================
-- MENU MASTER NG
-- 0018: grant surface hardening
--
-- 0011 stated privileges explicitly and said of the anon role: "gets nothing
-- on tenant data. Not read, not write." That was true on the local test shim
-- and FALSE on Supabase, because Supabase ships default privileges granting
-- ALL on new public tables to anon, authenticated and service_role -- and
-- GRANTs are additive. 0011 never revoked them.
--
-- Confirmed on a disposable Supabase project: every tenant table carried
--   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- for BOTH anon and authenticated.
--
-- What that actually cost us, tested rather than assumed:
--
--   SELECT/INSERT/UPDATE/DELETE  mitigated. RLS gates them; anon reads 0 rows.
--   EXECUTE on functions         mitigated. In-function authorization refuses
--                                anon. (Note: EXECUTE to PUBLIC on new
--                                functions is core PostgreSQL behaviour, not a
--                                Supabase quirk.)
--   TRUNCATE                     NOT MITIGATED. RLS does not apply to TRUNCATE.
--                                `set role anon; truncate ingredient_prices
--                                cascade;` emptied the table.
--   TRIGGER                      Not currently exploitable, but 0016 line 43
--                                justifies pg_trigger_depth() by claiming
--                                "CREATE TRIGGER requires table ownership".
--                                That is WRONG: it requires the TRIGGER
--                                privilege, which was granted. The attack
--                                fails only because authenticated has no
--                                CREATE on schema public and every
--                                trigger-returning function has EXECUTE
--                                revoked. This migration removes the
--                                privilege so the conclusion no longer rests
--                                on an incorrect premise.
--
-- Deliberately NOT changed: service_role keeps ALL. It is the trusted backend,
-- it bypasses RLS by design, and the billing path depends on it.
--
-- ADDITIVE. Migrations 0001-0017 are not modified. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLES: anon loses everything, then gets back only reference data
-- ----------------------------------------------------------------------------

-- ALL TABLES covers views and materialised views too.
revoke all on all tables in schema public from anon;

grant select on units, catalog_categories, catalog_ingredients, plans, plan_features
  to anon;

-- ----------------------------------------------------------------------------
-- 2. TABLES: authenticated loses the three privileges RLS cannot gate
--
-- SELECT/INSERT/UPDATE/DELETE are left exactly as 0011, 0012 and 0015 set
-- them: those are row-gated by policy, which is the design. TRUNCATE,
-- TRIGGER and REFERENCES are not row-gated by anything.
-- ----------------------------------------------------------------------------

do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      -- Views carry the same default grants as tables and must not be
      -- skipped: an updatable view is a write path, and the self-check in
      -- section 6 rightly refuses to pass while any object still holds these.
      and c.relkind in ('r','p','v','m','f')
  loop
    execute format('revoke truncate, trigger, references on %I from authenticated', t.relname);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. FUNCTIONS: anon and PUBLIC lose EXECUTE
--
-- authenticated's grants are left untouched -- 0011, 0012, 0014 and 0016
-- state them deliberately and the suites depend on them. Only the implicit
-- PUBLIC grant and anon are removed.
-- ----------------------------------------------------------------------------

--
-- SCOPED 2026-08-24. This loop originally touched EVERY function in the
-- public schema. Production carries public.handle_new_user -- a foreign
-- SECURITY DEFINER function, owned by postgres, invoked by an active trigger
-- on auth.users, and created by neither this chain nor an extension.
-- Revoking its PUBLIC grant could have broken user signup silently.
--
-- Menu Master's functions are all named fn_*; verified 33 of 33 on a fully
-- migrated database, with the only non-fn_ function in production being the
-- foreign one. The loop is therefore restricted to fn_* and to functions not
-- owned by an extension. Anything else in public is left byte-for-byte and
-- privilege-for-privilege untouched, and is reported so it stays visible.
do $$
declare f record; v_foreign text;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname like 'fn\_%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;

  select string_agg(p.proname, ', ' order by p.proname) into v_foreign
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname not like 'fn\_%'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

  if v_foreign is not null then
    raise notice '0018: LEFT UNTOUCHED (not Menu Master functions): %', v_foreign;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. SEQUENCES
-- ----------------------------------------------------------------------------

revoke all on all sequences in schema public from anon;

do $$
declare s text;
begin
  for s in select sequence_name from information_schema.sequences
            where sequence_schema = 'public'
  loop
    execute format('grant usage, select on sequence %I to authenticated', s);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. DEFAULT PRIVILEGES: stop the next table inheriting the same problem
--
-- Applies to objects created by the role running migrations. From here on a
-- new table grants NOTHING to anon or authenticated until a migration says
-- so explicitly -- which is what 0011 always claimed was happening.
--
-- This fails CLOSED: forget the grant and the feature visibly does not work,
-- rather than silently arriving world-writable.
-- ----------------------------------------------------------------------------

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. SELF-CHECK
--
-- A migration whose whole purpose is removing privilege should verify it did.
-- ----------------------------------------------------------------------------

do $$
declare
  v_trunc  text;
  v_anon   text;
begin
  select string_agg(distinct table_name, ', ')
    into v_trunc
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon','authenticated')
     and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES');

  if v_trunc is not null then
    raise exception
      '0018 self-check FAILED: TRUNCATE/TRIGGER/REFERENCES still held on: %', v_trunc;
  end if;

  select string_agg(distinct table_name, ', ')
    into v_anon
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'anon'
     and table_name not in ('units','catalog_categories','catalog_ingredients',
                            'plans','plan_features');

  if v_anon is not null then
    raise exception
      '0018 self-check FAILED: anon still holds privileges on tenant tables: %', v_anon;
  end if;

  raise notice '0018 self-check passed: anon holds reference-data SELECT only; no TRUNCATE/TRIGGER/REFERENCES for either client role.';
end
$$;

-- ----------------------------------------------------------------------------
-- 7. KEEP THE ANON REFERENCE READ ACTUALLY WORKING
--
-- Section 3 revokes EXECUTE on every fn_* from anon. Section 1 grants anon
-- SELECT on five reference tables. Those two intents collide on `units`, and
-- only on `units`, because both of its policies call fn_is_account_member:
--
--   p_units_read   FOR SELECT USING (account_id is null
--                                    OR fn_is_account_member(account_id))
--   p_units_write  FOR ALL    USING (account_id is not null
--                                    AND fn_is_account_member(account_id))
--
-- A FOR ALL policy's USING clause is applied to SELECT as well, and PostgreSQL
-- checks function EXECUTE when the expression runs -- it does not skip the
-- check because an OR branch could have short-circuited. Without this section
-- a plain `select from units` as anon is not a filtered result, it is:
--
--   ERROR: permission denied for function fn_is_account_member
--
-- and that happens even when every row has account_id IS NULL.
--
-- The fix scopes the two member-check policies to `authenticated`. A
-- role-scoped policy is never applied to anon, so anon never evaluates the
-- function. The invariant this migration exists to enforce -- anon executes
-- no Menu Master fn_* -- is preserved exactly. Granting anon EXECUTE on
-- fn_is_account_member would also work, and is deliberately NOT done.
--
-- catalog_categories, catalog_ingredients, plans and plan_features need no
-- change: their policies are `using (true)` and call no function.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'units'
                    and policyname in ('p_units_read','p_units_write')) then
    raise exception '0018 section 7 preflight FAILED: expected p_units_read and '
                    'p_units_write on units; found neither. The schema is not '
                    'what this section was written against.';
  end if;
end
$$;

drop policy if exists p_units_read  on units;
drop policy if exists p_units_write on units;

-- Global reference units. Table-level GRANTs decide who reaches the table at
-- all; section 1 gives anon SELECT and nothing else.
create policy p_units_read_global on units
  for select
  using (account_id is null);

-- A tenant's own custom units. Scoped to authenticated so the member check is
-- never evaluated in an anon session.
create policy p_units_read_own on units
  for select to authenticated
  using (account_id is not null and fn_is_account_member(account_id));

create policy p_units_write on units
  for all to authenticated
  using      (account_id is not null and fn_is_account_member(account_id))
  with check (account_id is not null and fn_is_account_member(account_id));

do $$
declare v_bad text;
begin
  -- Every table anon may SELECT must be free of fn_-calling policies that anon
  -- would be forced to evaluate. Policies scoped to authenticated do not count.
  select string_agg(distinct p.tablename || '.' || p.policyname, ', ')
    into v_bad
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (select table_name
                           from information_schema.role_table_grants
                          where table_schema = 'public'
                            and grantee = 'anon'
                            and privilege_type = 'SELECT')
     and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%fn\_%' escape '\'
     and not ('authenticated' = any(p.roles));

  if v_bad is not null then
    raise exception '0018 section 7 self-check FAILED: anon may SELECT tables '
                    'whose policies still call an fn_ it cannot execute: %', v_bad;
  end if;

  raise notice '0018 section 7 passed: the anon reference surface is readable '
               'without EXECUTE on any Menu Master function.';
end
$$;
