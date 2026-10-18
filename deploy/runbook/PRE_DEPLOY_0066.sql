-- ============================================================================
-- 0066 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is at 0064 (with or without 0065), that 0066 is not
-- applied, and that each of the 16 functions 0066 replaces is exactly the
-- definition 0066 was written against: the md5 values below are the ones
-- baked into 0066's preflight, from a fresh repository build through 0064.
-- Then the facts 0066's design depends on (the plan's DB0 item), as COUNTS
-- ONLY: no email, no name, no token, no provider code is ever printed.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 35 rows, every one PASS. Rows 23-35 are information and always
-- PASS; read their detail and share it (it holds only counts).
-- ============================================================================
with expected(sig, md5_0064) as (values
  ('public.fn_post_purchase(uuid)', '16d9ae64b823fe3d78de5462368aa58e'),
  ('public.fn_correct_purchase(uuid,date,uuid,text,text,jsonb)', '3095b702a25df9da3619c72f13cdc564'),
  ('public.fn_reverse_purchase(uuid,text)', 'ac352ce89d9a1f5510e3e41b8917d9ed'),
  ('public.fn_recompute_business_recipes(uuid)', '2ada56ea6b542994b2f568d86bd5dc1d'),
  ('public.fn_recompute_recipes_for_ingredient(uuid,date)', 'eda4192882306f7caf6214d479d0b59a'),
  ('public.fn_compute_recipe_cost_snapshot(uuid,date,uuid)', '4a797100e1c9528ca129737a00827226'),
  ('public.fn_compute_variant_cost_snapshot(uuid,date)', '1345e544bdfa4c6c2b3ccade40489b83'),
  ('public.fn_clone_starter_catalog(uuid,business_type)', '0224cd77493b10a27d8532937c0a3613'),
  ('public.fn_confirm_order(uuid)', '0cf5c14e87b81f11d14e87ec159fd574'),
  ('public.fn_finalise_order(uuid)', '9f9261747a0696da2ba3685405d291ad'),
  ('public.fn_reissue_order(uuid)', '3464b49003e2d23b605440301e4e0510'),
  ('public.fn_void_order(uuid,text)', '619ce2471c80cb8300dba27509e5fec5'),
  ('public.fn_void_sales_entry(uuid,text)', '35eec0a0d43d71313802c22aa856be71'),
  ('public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)', '5f0ce0623573b39f28b390af5585936f'),
  ('public.fn_guard_subscription_writes()', 'c54df9df6edb9ed651f57ce4b8259cd1'),
  ('public.fn_my_entitlement_status()', '5bdd2fc80c1fe2cf0d3e1d5c7550755b')
),
md5s as (
  select row_number() over (order by sig) + 5 as n, sig, md5_0064,
         md5(pg_get_functiondef(to_regprocedure(sig))) as live
    from expected
),
acct as (
  select a.id, fn_account_is_entitled(a.id) as entitled,
         (select s.status from subscriptions s where s.account_id = a.id) as status
    from accounts a
),
checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0064 is applied (fn_menu_prices exists)',
         to_regprocedure('public.fn_menu_prices()') is not null, ''
  union all select 2, 'not yet applied: no fn_trial_end, fn_require_entitled or fn_record_order_payment',
         to_regprocedure('public.fn_trial_end(timestamptz)') is null
         and to_regprocedure('public.fn_require_entitled(uuid, boolean)') is null
         and not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                           and proname = 'fn_record_order_payment'), ''
  union all select 3, 'identity: 118 policies in public, 99 fn_* functions (0065 adds neither)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 99,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 4, 'order: 0065 (help videos) is independent of 0066; apply it first if it is ready',
         true,
         case when exists (select 1 from site_settings where key = 'help')
              then '0065 applied' else '0065 not applied (0066 does not need it)' end
  union all select 5, 'units: p_units_write is the 0018 policy 0066 replaces',
         exists (select 1 from pg_policies
                  where schemaname='public' and tablename='units' and policyname='p_units_write'
                    and cmd='ALL' and roles='{authenticated}'
                    and qual = '((account_id IS NOT NULL) AND fn_is_account_member(account_id))'
                    and with_check = '((account_id IS NOT NULL) AND fn_is_account_member(account_id))'), ''
  -- rows 6-21: the 16 replaced functions
  union all select n, 'definition md5: ' || sig, live is not distinct from md5_0064,
         coalesce(live, 'MISSING') || case when live is distinct from md5_0064
                                           then ' (0066 expects ' || md5_0064 || ')' else '' end
    from md5s
  union all select 22, 'the 0066 self-check will pass: every other elevated write function is on its open list',
         not exists (
           select 1 from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_%'
              and p.prosecdef and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
              and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname not in (
                'fn_post_purchase','fn_correct_purchase','fn_reverse_purchase',
                'fn_recompute_business_recipes','fn_recompute_recipes_for_ingredient',
                'fn_compute_recipe_cost_snapshot','fn_compute_variant_cost_snapshot',
                'fn_clone_starter_catalog','fn_confirm_order','fn_finalise_order',
                'fn_reissue_order','fn_void_order','fn_void_sales_entry',
                'fn_invite_member','fn_accept_invitations','fn_set_member_role',
                'fn_remove_member','fn_revoke_invitation',
                'fn_admin_resolve_alert','fn_admin_set_site_setting','fn_admin_scan',
                'fn_create_account_and_business')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_%'
                      and p.prosecdef and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and p.proname not in (
                        'fn_post_purchase','fn_correct_purchase','fn_reverse_purchase',
                        'fn_recompute_business_recipes','fn_recompute_recipes_for_ingredient',
                        'fn_compute_recipe_cost_snapshot','fn_compute_variant_cost_snapshot',
                        'fn_clone_starter_catalog','fn_confirm_order','fn_finalise_order',
                        'fn_reissue_order','fn_void_order','fn_void_sales_entry',
                        'fn_invite_member','fn_accept_invitations','fn_set_member_role',
                        'fn_remove_member','fn_revoke_invitation',
                        'fn_admin_resolve_alert','fn_admin_set_site_setting','fn_admin_scan',
                        'fn_create_account_and_business')), 'none outside the list')

  -- ---- the facts (information; always PASS) -------------------------------
  union all select 23, 'facts: subscription_changes rows so far, by source',
         true, (select count(*)::text || ' row(s)' ||
                       coalesce(' (' || string_agg(src, ', ') || ')', '')
                  from (select change_source || ' ' || count(*) as src
                          from subscription_changes group by change_source) x)
  union all select 24, 'facts: the database time zone (0066 names Africa/Lagos itself, so any is fine)',
         true, current_setting('TimeZone')
  union all select 25, 'facts: logins that belong to two or more accounts',
         true, (select count(*)::text from (select user_id from memberships
                                              group by user_id having count(distinct account_id) > 1) x)
  union all select 26, 'facts: accounts without access holding confirmed, not cancelled sales not fully paid',
         true, (select count(*)::text || ' sale(s) on ' || count(distinct o.account_id)::text || ' account(s)'
                       || coalesce(', ' || to_char(nullif(sum(v.amount_outstanding) filter (where v.amount_outstanding > 0), 0),
                                                   'FM999,999,999,990.00') || ' naira still owed by the lines'' figures', '')
                  from orders o
                  join acct a on a.id = o.account_id and not a.entitled
                  left join v_orders_attention v on v.order_id = o.id
                 where o.finalised_at is not null and o.voided_at is null and o.payment_status <> 'paid')
  union all select 27, 'facts: trials longer than the advertised 14 days (+1 minute)',
         true, (select count(*)::text from subscriptions
                 where status = 'trialing'
                   and current_period_end - created_at > interval '14 days 1 minute')
  union all select 28, 'facts: trials whose trial_ends_at differs from current_period_end',
         true, (select count(*)::text from subscriptions
                 where status = 'trialing' and trial_ends_at is distinct from current_period_end)
  union all select 29, 'facts: drafts on accounts without access (they cannot be recorded after 0066)',
         true, (select count(*)::text from purchases p join acct a on a.id = p.account_id and not a.entitled
                 where p.status = 'draft') || ' draft purchase(s), '
               || (select count(*)::text from orders o join acct a on a.id = o.account_id and not a.entitled
                    where o.finalised_at is null and o.voided_at is null) || ' draft sale(s)'
  union all select 30, 'facts: staff of accounts without access who own no account (0066 stops them self-onboarding)',
         true, (select count(distinct m.user_id)::text
                  from memberships m join acct a on a.id = m.account_id and not a.entitled
                 where m.role <> 'owner'
                   and not exists (select 1 from memberships o where o.user_id = m.user_id and o.role = 'owner'))
  union all select 31, 'facts: logins that are staff somewhere AND own another account (left as they are)',
         true, (select count(distinct m.user_id)::text from memberships m
                 where m.role <> 'owner'
                   and exists (select 1 from memberships o where o.user_id = m.user_id and o.role = 'owner'
                                 and o.account_id <> m.account_id))
  union all select 32, 'facts: live trials 0066 moves to 23:59:59 Lagos on their last day, and the most hours added',
         true, (select count(*)::text || ' trial(s)' ||
                       coalesce(', at most ' || round(max(extract(epoch from (
                         ((current_period_end at time zone 'Africa/Lagos')::date + time '23:59:59')
                           at time zone 'Africa/Lagos' - current_period_end)) / 3600.0), 1)::text || ' hour(s) added', '')
                  from subscriptions
                 where status = 'trialing' and current_period_end > now()
                   and ((current_period_end at time zone 'Africa/Lagos')::date + time '23:59:59')
                         at time zone 'Africa/Lagos' > current_period_end)
  union all select 33, 'facts: ended trials (left alone by 0066)',
         true, (select count(*)::text from subscriptions where status = 'trialing' and current_period_end <= now())
  union all select 34, 'facts: custom units (after 0066 only owner, manager and kitchen with access change them)',
         true, (select count(*)::text || ' unit(s) on ' || count(distinct account_id)::text || ' account(s)'
                  from units where account_id is not null)
  union all select 35, 'facts: accounts with no subscription row (told "no plan yet" after 0066)',
         true, (select count(*)::text from accounts a
                 where not exists (select 1 from subscriptions s where s.account_id = a.id))
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
