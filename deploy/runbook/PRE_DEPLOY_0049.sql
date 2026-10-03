-- ============================================================================
-- 0049 -- PRE-DEPLOY AUDIT           READ ONLY. Changes nothing.
--
-- Proves production is at EXACTLY migration 0048 and that no part of 0049 has
-- been applied. It fails closed: anything that is not the state 0049 was
-- rehearsed against is a FAIL, not a warning.
--
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 18 rows, every one PASS.
-- ============================================================================
with
-- Bare type names, ordered COLLATE "C", so the fingerprint cannot vary with
-- the database collation or the session search_path.
sig as (
  select md5(string_agg(s, ',' order by s collate "C")) as fp
    from (select p.proname || '(' || coalesce((
                   select string_agg(t.typname, ',' order by u.ord)
                     from unnest(p.proargtypes) with ordinality as u(oid, ord)
                     join pg_type t on t.oid = u.oid), '') || ')' as s
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname like 'fn\_%') z
),
checks(n, check_name, ok, detail) as (
  -- IDENTITY: production is the catalogue 0049 was rehearsed against
  select 1, 'identity: function catalogue is exactly the rehearsed 0048 set',
         (select fp from sig) = 'e24f3871788893cafd1fc17c70fe41d5',
         'fingerprint ' || (select fp from sig) || ' (expect e24f3871788893cafd1fc17c70fe41d5)'
  union all select 2, 'identity: 70 fn_* functions',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 70,
         (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
  union all select 3, 'identity: 116 policies',
         (select count(*) from pg_policies where schemaname='public') = 116,
         (select count(*)::text from pg_policies where schemaname='public')

  -- DEPENDENCIES 0049 requires
  union all select 4, 'requires: fn_account_is_entitled exists (0018)',
         exists(select 1 from pg_proc where proname='fn_account_is_entitled' and pronamespace='public'::regnamespace), ''
  union all select 5, 'requires: fn_is_account_member exists',
         exists(select 1 from pg_proc where proname='fn_is_account_member' and pronamespace='public'::regnamespace), ''
  union all select 6, 'requires: fn_has_account_role exists',
         exists(select 1 from pg_proc where proname='fn_has_account_role' and pronamespace='public'::regnamespace), ''
  union all select 7, 'requires: plans and plan_features exist',
         (select count(*) from information_schema.tables
           where table_schema='public' and table_name in ('plans','plan_features')) = 2, ''
  union all select 8, 'requires: the 5 Sales tables exist',
         (select count(*) from information_schema.tables where table_schema='public'
            and table_name in ('orders','order_lines','customers','channels','sales_entries')) = 5, ''
  union all select 9, 'requires: the 13 Sales write policies are present and NOT yet gated',
         (select count(*) from pg_policies where schemaname='public' and cmd <> 'SELECT'
            and tablename in ('orders','order_lines','customers','channels','sales_entries')) = 13
         and (select count(*) from pg_policies where schemaname='public'
                and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%') = 0,
         (select count(*)::text from pg_policies where schemaname='public' and cmd <> 'SELECT'
            and tablename in ('orders','order_lines','customers','channels','sales_entries')) || ' write policies'
  union all select 10, 'requires: the 5 Sales SELECT policies are present',
         (select count(*) from pg_policies where schemaname='public' and cmd = 'SELECT'
            and tablename in ('orders','order_lines','customers','channels','sales_entries')) = 5,
         (select count(*)::text from pg_policies where schemaname='public' and cmd = 'SELECT'
            and tablename in ('orders','order_lines','customers','channels','sales_entries'))

  -- AHEAD: nothing from 0049 may already exist
  union all select 11, 'not yet applied: plans.tier absent',
         not exists(select 1 from information_schema.columns where table_name='plans' and column_name='tier'), ''
  union all select 12, 'not yet applied: plans.price_kobo absent',
         not exists(select 1 from information_schema.columns where table_name='plans' and column_name='price_kobo'), ''
  union all select 13, 'not yet applied: founder_slots absent',
         not exists(select 1 from information_schema.tables where table_schema='public' and table_name='founder_slots'), ''
  union all select 14, 'not yet applied: founding_price_policy absent',
         not exists(select 1 from information_schema.tables where table_schema='public' and table_name='founding_price_policy'), ''
  union all select 15, 'not yet applied: fn_account_has_sales absent',
         not exists(select 1 from pg_proc where proname='fn_account_has_sales' and pronamespace='public'::regnamespace), ''
  union all select 16, 'not yet applied: fn_claim_founder_slot absent',
         not exists(select 1 from pg_proc where proname='fn_claim_founder_slot' and pronamespace='public'::regnamespace), ''
  union all select 17, 'not yet applied: no plan id founding_costing / founding_trading',
         not exists(select 1 from plans where id in ('founding_costing','founding_trading')), ''

  -- The live users 0049 must not disturb
  union all select 18, 'live data: existing plans and their subscribers, for the record',
         true,
         coalesce((select string_agg(p.id || '=' || c, ', ' order by p.id)
                     from plans p
                     left join lateral (select count(*) c from subscriptions s where s.plan_id = p.id) x on true), 'none')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
