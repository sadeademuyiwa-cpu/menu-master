-- ============================================================================
-- MENU MASTER NG
-- 010: the anon reference surface must be READABLE, not merely GRANTED
--
-- REGRESSION TEST. Runs anywhere the chain is applied, including production:
-- it only reads, and it only reads reference data.
--
-- WHAT THIS CATCHES, AND WHY IT EXISTS
--   Test 009 asserted that anon holds SELECT on exactly five reference tables.
--   It never asserted anon could actually read them. That gap let a real
--   regression pass 154/154: 0018 revokes EXECUTE on every fn_* from anon,
--   while units' policies called fn_is_account_member. A FOR ALL policy's
--   USING clause applies to SELECT too, and PostgreSQL checks function EXECUTE
--   when the expression runs rather than skipping it because an OR branch
--   could have short-circuited. So `select from units` as anon was not a
--   filtered result, it was:
--
--     ERROR: permission denied for function fn_is_account_member
--
--   even with every row's account_id IS NULL.
--
--   The requirement, permanently: an anonymous SELECT against every intended
--   reference table must succeed after privilege hardening WITHOUT anon
--   holding EXECUTE on any Menu Master-owned function.
--
-- Each read runs in its own sub-transaction so one failure is reported rather
-- than aborting the run. Emits ONE result set.
-- ============================================================================

do $$
declare
  t          text;
  n          bigint;
  v_results  text := '';
  v_failures text := '';
begin
  foreach t in array array['units','catalog_categories','catalog_ingredients',
                           'plans','plan_features']
  loop
    begin
      -- set local confines the role change to this block; it is undone on exit.
      set local role anon;
      execute format('select count(*) from public.%I', t) into n;
      reset role;
      v_results := v_results || t || '=' || n::text || ' ';
    exception when others then
      reset role;
      v_failures := v_failures || t || ' (' || sqlerrm || '); ';
    end;
  end loop;

  -- set_config(name, NULL, ...) stores an empty string rather than NULL, so
  -- an explicit sentinel is used instead of relying on NULL round-tripping.
  perform set_config('mm.t010_reads',    coalesce(nullif(v_results,''),  'none'), false);
  perform set_config('mm.t010_failures', coalesce(nullif(v_failures,''), 'none'), false);
end
$$;

select * from (
  values

  ('1  anon can READ every reference table',
     case when coalesce(current_setting('mm.t010_failures', true), 'none') = 'none'
          then 'all five readable: ' || coalesce(current_setting('mm.t010_reads', true), '?')
          else current_setting('mm.t010_failures', true) end,
     case when coalesce(current_setting('mm.t010_failures', true), 'none') = 'none'
          then 'PASS' else 'FAIL' end),

  ('2  anon holds EXECUTE on no Menu Master fn_*',
     (select count(*)::text || ' of ' ||
             (select count(*)::text from pg_proc
               where pronamespace='public'::regnamespace and proname like 'fn\_%')
        from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%'
         and has_function_privilege('anon', oid, 'EXECUTE')),
     case when (select count(*) from pg_proc
                 where pronamespace='public'::regnamespace and proname like 'fn\_%'
                   and has_function_privilege('anon', oid, 'EXECUTE')) = 0
          then 'PASS' else 'FAIL' end),

  ('3  no anon-readable table has an unscoped fn_-calling policy',
     (select coalesce(string_agg(distinct p.tablename||'.'||p.policyname, ', '), 'none')
        from pg_policies p
       where p.schemaname='public'
         and p.tablename in (select table_name from information_schema.role_table_grants
                              where table_schema='public' and grantee='anon'
                                and privilege_type='SELECT')
         and coalesce(p.qual,'')||coalesce(p.with_check,'') like '%fn\_%' escape '\'
         and not ('authenticated' = any(p.roles))),
     case when not exists (select 1 from pg_policies p
                            where p.schemaname='public'
                              and p.tablename in (select table_name
                                    from information_schema.role_table_grants
                                   where table_schema='public' and grantee='anon'
                                     and privilege_type='SELECT')
                              and coalesce(p.qual,'')||coalesce(p.with_check,'')
                                  like '%fn\_%' escape '\'
                              and not ('authenticated' = any(p.roles)))
          then 'PASS' else 'FAIL' end),

  ('4  the anon SELECT surface is exactly the five reference tables',
     (select coalesce(string_agg(distinct table_name, ', ' order by table_name), 'NONE')
        from information_schema.role_table_grants
       where table_schema='public' and grantee='anon' and privilege_type='SELECT'),
     case when (select coalesce(string_agg(distinct table_name, ',' order by table_name), '')
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee='anon' and privilege_type='SELECT')
              = 'catalog_categories,catalog_ingredients,plan_features,plans,units'
          then 'PASS' else 'FAIL' end),

  ('5  anon holds no privilege other than SELECT',
     (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NONE')
        from information_schema.role_table_grants
       where table_schema='public' and grantee='anon'),
     case when (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NONE')
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee='anon') in ('SELECT','NONE')
          then 'PASS' else 'FAIL' end)

) as t(item, observed, verdict);
