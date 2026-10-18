-- ============================================================================
-- 0066 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0066 commits. Row 4 calls fn_trial_end, so on a
-- database without 0066 the script stops with "function fn_trial_end(...)
-- does not exist": that is a FAIL.
-- Counts only: no email, name, token or provider code is printed.
-- EXPECTED: 17 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'fn_trial_end(timestamptz): STABLE, runs as the caller, search_path public; signed-in users may call it, not anon or PUBLIC',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.fn_trial_end(timestamptz)')
                   and not p.prosecdef and p.provolatile = 's' and 'search_path=public' = any(p.proconfig))
         and coalesce(has_function_privilege('authenticated', to_regprocedure('public.fn_trial_end(timestamptz)'), 'execute'), false)
         and not coalesce(has_function_privilege('anon', to_regprocedure('public.fn_trial_end(timestamptz)'), 'execute'), true)
         and not exists (select 1 from pg_proc p, unnest(p.proacl) a
                          where p.oid = to_regprocedure('public.fn_trial_end(timestamptz)') and a::text like '=%'), ''
  union all select 2, 'fn_require_entitled(uuid, boolean): STABLE, runs as the caller, search_path public, granted to nobody',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.fn_require_entitled(uuid,boolean)')
                   and not p.prosecdef and p.provolatile = 's' and 'search_path=public' = any(p.proconfig))
         and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.fn_require_entitled(uuid,boolean)'), 'execute'), true)
         and not coalesce(has_function_privilege('anon', to_regprocedure('public.fn_require_entitled(uuid,boolean)'), 'execute'), true)
         and not coalesce(has_function_privilege('service_role', to_regprocedure('public.fn_require_entitled(uuid,boolean)'), 'execute'), true), ''
  union all select 3, 'fn_record_order_payment(uuid, numeric, payment_status): SECURITY DEFINER, search_path public; signed-in users only',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.fn_record_order_payment(uuid,numeric,payment_status)')
                   and p.prosecdef and p.provolatile = 'v' and 'search_path=public' = any(p.proconfig))
         and coalesce(has_function_privilege('authenticated', to_regprocedure('public.fn_record_order_payment(uuid,numeric,payment_status)'), 'execute'), false)
         and not coalesce(has_function_privilege('anon', to_regprocedure('public.fn_record_order_payment(uuid,numeric,payment_status)'), 'execute'), true)
         and not exists (select 1 from pg_proc p, unnest(p.proacl) a
                          where p.oid = to_regprocedure('public.fn_record_order_payment(uuid,numeric,payment_status)') and a::text like '=%'), ''
  union all select 4, 'a trial started at 09:30 Lagos on 18 Oct ends at 23:59:59 Lagos on 1 Nov',
         fn_trial_end('2026-10-18 09:30:00+01') = '2026-11-01 23:59:59+01'
         and fn_trial_end('2026-10-17 23:10:00+00') = '2026-11-01 23:59:59+01',
         fn_trial_end('2026-10-18 09:30:00+01')::text
  union all select 5, 'the 13 elevated write functions each call fn_require_entitled',
         (select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('fn_post_purchase','fn_correct_purchase','fn_reverse_purchase',
                               'fn_recompute_business_recipes','fn_recompute_recipes_for_ingredient',
                               'fn_compute_recipe_cost_snapshot','fn_compute_variant_cost_snapshot',
                               'fn_clone_starter_catalog','fn_confirm_order','fn_finalise_order',
                               'fn_reissue_order','fn_void_order','fn_void_sales_entry')
             and p.prosrc ~ 'perform\s+fn_require_entitled\(') = 13,
         (select count(*)::text || ' of 13' from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('fn_post_purchase','fn_correct_purchase','fn_reverse_purchase',
                               'fn_recompute_business_recipes','fn_recompute_recipes_for_ingredient',
                               'fn_compute_recipe_cost_snapshot','fn_compute_variant_cost_snapshot',
                               'fn_clone_starter_catalog','fn_confirm_order','fn_finalise_order',
                               'fn_reissue_order','fn_void_order','fn_void_sales_entry')
             and p.prosrc ~ 'perform\s+fn_require_entitled\(')
  union all select 6, 'member management and recording a payment stay open (no gate in them)',
         not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                                          'fn_remove_member','fn_revoke_invitation','fn_record_order_payment')
                        and p.prosrc ~ 'perform\s+fn_require_entitled\('), ''
  union all select 7, 'the catalogue rule: no other elevated write function a signed-in user can run is ungated',
         not exists (
           select 1 from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_%'
              and p.prosecdef and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
              and has_function_privilege('authenticated', p.oid, 'execute')
              and p.prosrc !~ 'perform\s+fn_require_entitled\('
              and p.proname not in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                                    'fn_remove_member','fn_revoke_invitation','fn_record_order_payment',
                                    'fn_admin_resolve_alert','fn_admin_set_site_setting','fn_admin_scan',
                                    'fn_create_account_and_business')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_%'
                      and p.prosecdef and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and p.prosrc !~ 'perform\s+fn_require_entitled\('
                      and p.proname not in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                                            'fn_remove_member','fn_revoke_invitation','fn_record_order_payment',
                                            'fn_admin_resolve_alert','fn_admin_set_site_setting','fn_admin_scan',
                                            'fn_create_account_and_business')), 'none')
  union all select 8, 'onboarding: 14 days only, one account per login, a new business needs access, trial before catalogue',
         (select position('p_trial_days is distinct from 14' in prosrc) > 0
             and position('MMLGN' in prosrc) > 0
             and position('perform fn_require_entitled(v_account);' in prosrc) > 0
             and position('fn_trial_end(now())' in prosrc) > 0
             and position('insert into subscriptions' in prosrc) < position('v_cloned := fn_clone_starter_catalog' in prosrc)
            from pg_proc where oid = to_regprocedure(
              'public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)')), ''
  union all select 9, 'the subscription guard accepts a client-made trial only if it ends at fn_trial_end(now())',
         (select position('fn_trial_end(now())' in prosrc) > 0
            from pg_proc where oid = to_regprocedure('public.fn_guard_subscription_writes()')), ''
  union all select 10, 'fn_my_entitlement_status names the oldest membership; same four columns',
         (select position('order by m.created_at, m.account_id' in prosrc) > 0
             and pg_get_function_result(oid) = 'TABLE(entitled boolean, status text, boundary timestamp with time zone, reason text)'
            from pg_proc where oid = to_regprocedure('public.fn_my_entitlement_status()')), ''
  union all select 11, 'it runs, and returns no row here (this session has no signed-in user)',
         (select count(*) from public.fn_my_entitlement_status()) = 0, ''
  union all select 12, 'custom units: owner, manager or kitchen, on an account with access (p_units_write)',
         exists (select 1 from pg_policies
                  where schemaname='public' and tablename='units' and policyname='p_units_write'
                    and cmd='ALL' and roles='{authenticated}'
                    and qual like '%fn_account_is_entitled(account_id)%'
                    and with_check like '%''owner''::member_role, ''manager''::member_role, ''kitchen''::member_role%'
                    and with_check like '%fn_account_is_entitled(account_id)%'), ''
  union all select 13, '118 policies in public, 102 fn_* functions',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 102,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 14, 'every live trial now ends at 23:59:59 Lagos time on its last day',
         not exists (select 1 from subscriptions
                      where status = 'trialing' and current_period_end > now()
                        and to_char(current_period_end at time zone 'Africa/Lagos', 'HH24:MI:SS') <> '23:59:59'),
         (select count(*)::text || ' live trial(s)' from subscriptions
           where status = 'trialing' and current_period_end > now())
  union all select 15, 'each trial 0066 moved has exactly one history row',
         not exists (select 1 from subscription_changes where reason like '0066:%'
                      group by subscription_id having count(*) > 1),
         (select count(*)::text || ' trial(s) moved later' from subscription_changes where reason like '0066:%')
  union all select 16, 'information: trials whose trial_ends_at still differs from current_period_end',
         true, (select count(*)::text from subscriptions
                 where status = 'trialing' and trial_ends_at is distinct from current_period_end)
  union all select 17, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
