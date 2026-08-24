-- ============================================================================
-- MENU MASTER NG — 0018 AMENDMENT: keep anon's reference read actually working
--
-- PROPOSED. Not applied. Requires approval before it enters PART_5.
--
-- THE DEFECT
--   0018 revokes EXECUTE on every fn_* from anon, and separately grants anon
--   SELECT on the five reference tables. Those two intents collide on `units`,
--   and only on `units`:
--
--     p_units_read   FOR SELECT USING (account_id is null
--                                      OR fn_is_account_member(account_id))
--     p_units_write  FOR ALL    USING (account_id is not null
--                                      AND fn_is_account_member(account_id))
--
--   A FOR ALL policy's USING clause is applied to SELECT as well, so a plain
--   `select ... from units` as anon evaluates fn_is_account_member. With
--   EXECUTE revoked that is not a filtered-out row, it is a hard error:
--
--     ERROR: permission denied for function fn_is_account_member
--
--   PostgreSQL checks function EXECUTE when the expression runs, and does not
--   skip the check because an OR branch could have short-circuited. The table
--   need not contain a single account-scoped row: on a database where all 45
--   units have account_id IS NULL, anon still cannot read the table at all.
--
--   catalog_categories, catalog_ingredients, plans and plan_features are
--   unaffected -- their policies are `using (true)` and call no function.
--
-- THE FIX
--   Scope the two member-check policies to `authenticated`. A role-scoped
--   policy is never applied to anon, so anon never evaluates the function, and
--   0018's principle -- anon executes no Menu Master function -- is preserved
--   exactly. anon keeps read access to global units and gains nothing else.
--
--   The alternative, granting anon EXECUTE on fn_is_account_member, also works
--   (the function returns false for anon because auth.uid() is null) but it
--   punches a hole in the rule 0018 exists to enforce. This does not.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='units'
                    and policyname in ('p_units_read','p_units_write')) then
    raise exception '0018 amendment preflight: expected policies p_units_read '
                    'and p_units_write on units. Found neither -- the schema is '
                    'not what this amendment was written against.';
  end if;
end $$;

drop policy if exists p_units_read  on units;
drop policy if exists p_units_write on units;

-- Global reference units: readable by anyone who can reach the table at all.
-- Table-level GRANTs decide who that is; 0018 gives SELECT to anon and
-- authenticated, and nothing else.
create policy p_units_read_global on units
  for select
  using (account_id is null);

-- A tenant's own custom units. Restricted to authenticated so the member
-- check is never evaluated in an anon session.
create policy p_units_read_own on units
  for select to authenticated
  using (account_id is not null and fn_is_account_member(account_id));

create policy p_units_write on units
  for all to authenticated
  using       (account_id is not null and fn_is_account_member(account_id))
  with check  (account_id is not null and fn_is_account_member(account_id));

do $$
declare v_bad text;
begin
  -- Every table anon can SELECT must now be free of fn_-calling policies that
  -- anon would be forced to evaluate. Role-scoped policies do not count.
  select string_agg(distinct p.tablename||'.'||p.policyname, ', ')
    into v_bad
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (select table_name from information_schema.role_table_grants
                         where table_schema='public' and grantee='anon'
                           and privilege_type='SELECT')
    and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%fn\_%' escape '\'
    and not ('authenticated' = any(p.roles));

  if v_bad is not null then
    raise exception '0018 amendment self-check FAILED: anon can SELECT tables '
                    'whose policies still call an fn_ it cannot execute: %', v_bad;
  end if;

  raise notice '0018 amendment OK: no anon-readable table has an unscoped '
               'fn_-calling policy.';
end $$;
