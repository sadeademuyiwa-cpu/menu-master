-- ============================================================================
-- 0050 -- POST-VERIFY               READ ONLY. Changes nothing.
-- Run immediately after 0050 commits.
-- EXPECTED: rows 1-11 PASS. Row 12 is a READINESS statement, not a check on
-- the migration: it reads TODO until the four Paystack Plans exist and their
-- codes are written into plans.provider_plan_code. TODO on row 12 is NOT a
-- reason to roll back -- 0050 is correct either way, nobody can simply pay yet.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'fn_checkout_quote exists and is SECURITY DEFINER',
         exists(select 1 from pg_proc where proname='fn_checkout_quote'
                  and pronamespace='public'::regnamespace and prosecdef), ''
  union all select 2, 'fn_apply_billing_side_effects exists and is SECURITY DEFINER',
         exists(select 1 from pg_proc where proname='fn_apply_billing_side_effects'
                  and pronamespace='public'::regnamespace and prosecdef), ''
  union all select 3, 'fn_billing_apply now calls the 0049 payment boundary',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) like '%fn_apply_billing_side_effects%', ''
  union all select 4, 'and it still refuses a non-service caller',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) like '%fn_is_service_context%', ''

  union all select 5, 'NOTHING new is reachable from the browser',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
            and p.proname in ('fn_checkout_quote','fn_apply_billing_side_effects',
                              'fn_billing_apply','fn_billing_ingest')
            and (has_function_privilege('authenticated', p.oid,'EXECUTE')
              or has_function_privilege('anon', p.oid,'EXECUTE'))) = 0,
         'authenticated and anon hold no EXECUTE on any of the four'
  union all select 6, 'but the service context can quote',
         has_function_privilege('service_role','fn_checkout_quote(uuid,text,interval)','execute'), ''

  union all select 7, '0050 added no policy: still 117',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 8, '0050 added no table and no column: 66 tables, 756 columns',
         (select count(*) from information_schema.tables where table_schema='public') = 66
     and (select count(*) from information_schema.columns where table_schema='public') = 756,
         (select count(*)::text from information_schema.tables where table_schema='public')
         ||' tables, '||
         (select count(*)::text from information_schema.columns where table_schema='public')||' columns'
  union all select 9, 'founder_slots is still exactly 100 rows',
         (select count(*) from founder_slots) = 100,
         (select count(*)::text from founder_slots)
  union all select 10, 'no slot was claimed by the migration itself',
         (select count(*) from founder_slots where claimed_at is not null) = 0,
         (select count(*)::text||' claimed' from founder_slots where claimed_at is not null)
  union all select 11, 'every pre-existing subscription still resolves to a real plan',
         not exists(select 1 from subscriptions s
                     where not exists (select 1 from plans p where p.id = s.plan_id)), ''

  -- THE GATE FOR TAKING MONEY. Not a failure of 0050 -- a statement of whether
  -- checkout can work yet. All four must be mapped before anyone can pay.
  union all select 12, 'READINESS: all four paid plans carry a Paystack plan code',
         (select count(*) from plans where id in
            ('costing','trading','founding_costing','founding_trading')
            and provider_plan_code is not null) = 4,
         coalesce((select string_agg(id||'='||coalesce(provider_plan_code,'UNMAPPED'), ', ' order by id)
                     from plans where id in
                       ('costing','trading','founding_costing','founding_trading')),'none')
)
select n,
       case when ok then 'PASS'
            when n = 12 then 'TODO'   -- readiness, not a failure. See the header.
            else 'FAIL' end as result,
       check_name, detail
  from checks order by n;
