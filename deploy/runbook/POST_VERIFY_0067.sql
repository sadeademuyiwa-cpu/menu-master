-- ============================================================================
-- 0067 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0067 commits, on the production sequence (0065 if it
-- shipped, 0066, then 0067). Rows 8 and 13 call fn_billing_find_account and
-- fn_billing_event_sub_code, which only read; in the SQL Editor you are
-- service context, so they answer. On a database without 0067 the script
-- stops with "function ... does not exist": that is a FAIL.
-- Rows 10-12 are live counts only.
-- EXPECTED: 13 rows, every one PASS.
-- ============================================================================
with fns(name, sig, definer) as (values
  ('fn_billing_event_sub_code',        'public.fn_billing_event_sub_code(jsonb)', false),
  ('fn_billing_find_account',          'public.fn_billing_find_account(jsonb)', true),
  ('fn_billing_claim_switch_offs',     'public.fn_billing_claim_switch_offs(integer)', true),
  ('fn_billing_record_switch_off',     'public.fn_billing_record_switch_off(text, text, text)', true),
  ('fn_billing_record_manage_request', 'public.fn_billing_record_manage_request(uuid, uuid, text, text, text)', true)
), checks(n, check_name, ok, detail) as (
  select 1, 'billing_superseded: RLS on, no client policy',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.billing_superseded')), false)
         and not exists (select 1 from pg_policies where schemaname='public' and tablename='billing_superseded'), ''
  union all select 2, 'billing_superseded: anon and authenticated hold nothing; service_role may only SELECT',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema='public' and table_name='billing_superseded'
                        and (grantee in ('anon','authenticated','PUBLIC')
                             or (grantee = 'service_role' and privilege_type <> 'SELECT')))
         and has_table_privilege('service_role', 'public.billing_superseded', 'select'),
         coalesce((select string_agg(grantee||':'||privilege_type, ', ' order by grantee, privilege_type)
                     from information_schema.role_table_grants
                    where table_schema='public' and table_name='billing_superseded'
                      and grantee <> current_user), '')
  union all select 3, 'the five new functions: four SECURITY DEFINER, the code reading immutable and invoker; all pinned to public',
         (select count(*) from fns f join pg_proc p on p.oid = to_regprocedure(f.sig)
           where p.prosecdef = f.definer and 'search_path=public' = any(p.proconfig)
             and (f.definer or p.provolatile = 'i')) = 5, ''
  union all select 4, 'the five new functions: service_role may call them; anon, authenticated and PUBLIC may not',
         (select count(*) from fns f
           where to_regprocedure(f.sig) is not null
             and has_function_privilege('service_role', to_regprocedure(f.sig), 'execute')
             and not has_function_privilege('anon', to_regprocedure(f.sig), 'execute')
             and not has_function_privilege('authenticated', to_regprocedure(f.sig), 'execute')
             and not exists (select 1 from pg_proc p, unnest(p.proacl) a
                              where p.oid = to_regprocedure(f.sig) and a::text like '=%')) = 5, ''
  union all select 5, 'fn_billing_apply attributes, ignores replaced subscriptions, and holds a cancel for another subscription',
         (select prosrc from pg_proc where pronamespace='public'::regnamespace and proname='fn_billing_apply')
           like '%fn_billing_find_account%fn_billing_event_sub_code%billing_superseded%not_current_subscription%'
         and not has_function_privilege('authenticated', 'public.fn_billing_apply(uuid)', 'execute'), ''
  union all select 6, 'fn_apply_billing_side_effects lets only a payment replace a stored code, never a replaced one',
         (select prosrc from pg_proc where pronamespace='public'::regnamespace and proname='fn_apply_billing_side_effects')
           like '%fn_billing_event_sub_code%billing_superseded%only a payment replaces a code%', ''
  union all select 7, 'the alert kinds: the six 0055 kinds plus the four 0067 kinds',
         (select pg_get_constraintdef(oid) from pg_constraint where conname='ck_platform_alerts_kind')
           like '%billing_failed_permanent%subscription_no_period%subscription_not_switched_off%'
                '%superseded_subscription_charged%cancel_not_confirmed%possible_double_charge%'
         and (select prosrc from pg_proc where pronamespace='public'::regnamespace and proname='fn_admin_scan')
           like '%subscription_not_switched_off%superseded_subscription_charged%cancel_not_confirmed%possible_double_charge%', ''
  union all select 8, 'fn_billing_find_account answers, and fails closed on an event with nothing to match',
         public.fn_billing_find_account('{}'::jsonb) = '{"error": "no_account"}'::jsonb, ''
  union all select 9, '118 policies in public, 107 fn_* functions (0066: 102, 0067 adds 5)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 107,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 10, 'live: subscription codes recovered by 0067',
         true, (select count(*)::text from subscription_changes where change_kind = 'subscription_code_recovered')
  union all select 11, 'live: paying accounts still with no subscription code (refused a self-serve plan change)',
         true, (select count(*)::text from subscriptions where status <> 'trialing' and provider_subscription_code is null)
  union all select 12, 'the paying customers are untouched: no status, plan or period moved by the migration',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'),
                        'no paid subscriptions')
  union all select 13, 'the one code reading: data.subscription_code, then data.subscription, then data.plan',
         public.fn_billing_event_sub_code('{"data":{"subscription_code":"SUB_s","subscription":{"subscription_code":"SUB_i"},"plan":{"subscription_code":"SUB_p"}}}'::jsonb) = 'SUB_s'
         and public.fn_billing_event_sub_code('{"data":{"subscription":{"subscription_code":"SUB_i"},"plan":{"subscription_code":"SUB_p"}}}'::jsonb) = 'SUB_i'
         and public.fn_billing_event_sub_code('{"data":{"plan":{"subscription_code":"SUB_p"}}}'::jsonb) = 'SUB_p'
         and public.fn_billing_event_sub_code('{"data":{}}'::jsonb) is null, ''
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
