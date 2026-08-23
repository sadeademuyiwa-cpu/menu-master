-- ============================================================================
-- MENU MASTER NG — C1: PRODUCTION AUDIT
--
--   *** STRICTLY READ ONLY ***
--
-- Every statement below is a SELECT, a catalogue lookup, or a has_*_privilege()
-- call. This script contains NO:
--   INSERT · UPDATE · DELETE · TRUNCATE · MERGE
--   CREATE · ALTER · DROP · GRANT · REVOKE · COMMENT
--   migration · configuration change · key rotation
--
-- It uses set_config() ONLY to pass values between the DO block and the final
-- SELECT, because the Supabase SQL Editor renders only the last result set.
-- set_config on a custom 'mm.*' GUC changes no data and no configuration; the
-- values vanish with the connection.
--
-- Credential: the Supabase SQL Editor's default session (postgres). No
-- service_role key is required, requested, or used.
--
-- It reads no personal data. auth.users is counted, never listed: no email
-- addresses, names or identifiers are returned.
--
-- Safe on an empty project: every table lookup is guarded by to_regclass, so a
-- project where the chain was never applied reports "table absent" rather than
-- erroring.
-- ============================================================================

do $$
declare
  t text;
  n bigint;
  v text;
  parts text := '';
begin
  -- ---- B. data volume: is this project empty, or does it hold real data? ---
  foreach t in array array[
    'accounts','businesses','memberships','subscriptions','ingredients',
    'ingredient_prices','ingredient_unit_conversions','recipes','recipe_lines',
    'cost_snapshots','purchases','purchase_lines','orders','order_lines',
    'sales_entries','period_closes'
  ] loop
    if to_regclass('public.' || t) is null then
      parts := parts || t || '=TABLE ABSENT; ';
    else
      execute format('select count(*) from %I', t) into n;
      parts := parts || t || '=' || n || '; ';
    end if;
  end loop;
  perform set_config('mm.counts', parts, false);

  if to_regclass('auth.users') is null then
    perform set_config('mm.users', 'auth.users ABSENT', false);
  else
    execute 'select count(*) from auth.users' into n;
    perform set_config('mm.users', n::text || ' (count only; no addresses read)', false);
  end if;

  -- ---- D. 0017 preflight, SIMULATED. The migration is NOT run. --------------
  if to_regclass('public.subscriptions') is null then
    perform set_config('mm.d1', 'subscriptions table absent', false);
    perform set_config('mm.d2', 'subscriptions table absent', false);
  else
    execute $q$
      select coalesce(count(*)::text || ' row(s): ' ||
             coalesce(string_agg(distinct status, ', '), '-'), '0')
      from subscriptions
      where status not in ('trialing','active','past_due','cancelled')
    $q$ into v;
    perform set_config('mm.d1', v, false);

    execute $q$
      select coalesce(string_agg(account_id::text || ' (' || n || ')', ', '), 'none')
      from (select account_id, count(*) as n from subscriptions
             group by account_id having count(*) > 1) d
    $q$ into v;
    perform set_config('mm.d2', v, false);
  end if;

  -- ---- F. lifetime write activity, from the statistics collector -----------
  select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::text
    into v from pg_stat_user_tables where schemaname = 'public';
  perform set_config('mm.writes', v, false);

  select coalesce(string_agg(distinct coalesce(nullif(application_name,''), '(unnamed)')
                             || ' as ' || usename, ', '), 'none')
    into v from pg_stat_activity where datname = current_database();
  perform set_config('mm.conns', v, false);
end
$$;

-- ============================================================================
-- ONE RESULT SET
-- ============================================================================

select * from (

  -- ---- A. has the migration chain ever been applied here? -----------------
  select 'A migration chain' as section, m.item,
         case when m.present then 'present' else 'ABSENT' end as observed,
         m.means as interpretation
  from (values
    ('0001 accounts table',
      to_regclass('public.accounts') is not null,          'core schema'),
    ('0002 container unit kind',
      exists (select 1 from pg_enum e join pg_type ty on ty.oid=e.enumtypid
               where ty.typname='unit_kind' and e.enumlabel='container'), 'ALTER TYPE applied'),
    ('0004 fn_can_see_costs(uuid)',
      exists (select 1 from pg_proc where proname='fn_can_see_costs'
               and pronargs=1),                            'account-scoped cost gate'),
    ('0012 fn_is_service_context',
      exists (select 1 from pg_proc where proname='fn_is_service_context'), 'Gate 1 hardening'),
    ('0013 zero-amount check',
      exists (select 1 from pg_constraint
               where conname='ck_purchase_lines_amount_positive'), 'no free ingredients'),
    ('0014 fn_void_order',
      exists (select 1 from pg_proc where proname='fn_void_order'), 'void-and-reissue'),
    ('0016 fn_require_cost_access',
      exists (select 1 from pg_proc where proname='fn_require_cost_access'), 'role fn permissions'),
    ('0017 status CHECK',
      exists (select 1 from pg_constraint where conname='ck_subscriptions_status'), 'closed state set'),
    ('0017 one-sub-per-account index',
      exists (select 1 from pg_indexes where indexname='ux_subscriptions_account'), 'billing integrity'),
    ('0017 ROW_COUNT guard',
      exists (select 1 from pg_proc where proname='fn_set_subscription_plan'
               and prosrc ilike '%get diagnostics%row_count%'), 'no silent no-op'),
    -- Guarded on 0001 being present. Without the guard this reports "present"
    -- on an empty project, where there are no anon grants to be wrong.
    ('0018 anon reference-only',
      to_regclass('public.accounts') is not null
      and not exists (select 1 from information_schema.role_table_grants
                       where table_schema='public' and grantee='anon'
                         and table_name not in ('units','catalog_categories',
                            'catalog_ingredients','plans','plan_features')), 'grant hardening')
  ) as m(item, present, means)

  union all
  select 'B data volume', 'row counts', current_setting('mm.counts', true),
         'empty => low risk; populated => 0018 needs care'
  union all
  select 'B data volume', 'auth users', current_setting('mm.users', true),
         'count only, no personal data read'
  union all
  select 'B data volume', 'lifetime writes (public)', current_setting('mm.writes', true),
         'BEST EFFORT ONLY: stats can be reset or unflushed. 0 here does NOT prove nothing was written -- trust the row counts above instead'

  -- ---- C. the 0018 exposure: does it exist on production? -----------------
  union all
  select 'C grant surface', 'anon: tables',
         coalesce((select string_agg(distinct table_name, ', ' order by table_name)
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee='anon'), 'NONE'),
         'expect 5 reference tables only after 0018'
  union all
  select 'C grant surface', 'anon: privileges',
         coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee='anon'), 'NONE'),
         'SELECT only after 0018'
  union all
  select 'C grant surface', 'authenticated: privileges',
         coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee='authenticated'), 'NONE'),
         'no TRUNCATE/TRIGGER/REFERENCES after 0018'
  union all
  select 'C grant surface', '>>> UNGATED (TRUNCATE/TRIGGER/REFERENCES)',
         (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and grantee in ('anon','authenticated')
             and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')),
         'NOT gated by RLS. Non-zero = the 0018 exposure is present here'
  union all
  select 'C grant surface', 'fingerprint',
         coalesce((select substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type,'|'
                          order by grantee, table_name, privilege_type)),1,12)
                     from information_schema.role_table_grants
                    where table_schema='public' and grantee in ('anon','authenticated')), 'n/a'),
         'baseline to compare against after any change'
  union all
  select 'C grant surface', 'default privileges for client roles',
         coalesce((select string_agg(distinct defaclobjtype::text, ',')
                     from pg_default_acl d
                    where array_to_string(d.defaclacl, ',') similar to '%(anon|authenticated)%'), 'none'),
         'r=tables f=functions S=sequences; present => new objects still inherit'

  -- ---- D. would 0017 apply? SIMULATED ONLY -------------------------------
  union all
  select 'D 0017 preflight (simulated)', 'statuses outside the four',
         current_setting('mm.d1', true),
         '0 => preflight passes. Non-zero => it would REFUSE'
  union all
  select 'D 0017 preflight (simulated)', 'accounts with >1 subscription',
         current_setting('mm.d2', true),
         'none => preflight passes. Any => it would REFUSE'

  -- ---- E. RLS posture ----------------------------------------------------
  union all
  select 'E RLS', '>>> tables with RLS DISABLED',
         coalesce((select string_agg(c.relname, ', ' order by c.relname)
                     from pg_class c
                    where c.relnamespace='public'::regnamespace and c.relkind='r'
                      and not c.relrowsecurity), 'none — all enabled'),
         'any name here is a tenant-isolation hole'

  -- ---- F. what is connected right now ------------------------------------
  union all
  select 'F connections', 'current sessions', current_setting('mm.conns', true),
         'snapshot only: shows what is connected AT THIS MOMENT'

) as audit
order by section, item;
