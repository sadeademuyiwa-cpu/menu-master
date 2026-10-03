-- ============================================================================
-- 0051 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
--
-- Proves production is at EXACTLY 0050 and that no part of 0051 is applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 12 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0050 is applied (fn_checkout_quote exists)',
         exists(select 1 from pg_proc where proname='fn_checkout_quote'
                  and pronamespace='public'::regnamespace), ''
  union all select 2, 'identity: fn_billing_apply calls the 0049 payment boundary',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) like '%fn_apply_billing_side_effects%', ''
  union all select 3, 'identity: 117 policies',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 4, 'identity: exactly 100 founder slots',
         (select count(*) from founder_slots) = 100,
         (select count(*)::text from founder_slots)

  union all select 5, 'not yet applied: fn_my_has_sales absent',
         not exists(select 1 from pg_proc where proname='fn_my_has_sales'
                      and pronamespace='public'::regnamespace), ''
  union all select 6, 'not yet applied: fn_billing_apply does not derive a paid period',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) not like '%paid_at%', ''

  union all select 7, 'requires: fn_account_has_sales exists (0049)',
         exists(select 1 from pg_proc where proname='fn_account_has_sales'
                  and pronamespace='public'::regnamespace), ''
  union all select 8, 'requires: memberships is readable for the lookup',
         exists(select 1 from information_schema.columns
                 where table_name='memberships' and column_name='user_id'), ''

  -- THE FAULT ITSELF, on live data. This is what 0051 fixes.
  union all select 9, 'live: paid subscriptions still carrying the trial end date',
         true,
         coalesce((select string_agg(s.plan_id || ' (period=' || s.current_period_end::date || ')', ', ')
                     from subscriptions s join plans p on p.id = s.plan_id
                    where s.status='active' and p.price_tier <> 'trial'
                      and s.trial_ends_at is not null
                      and s.current_period_end = s.trial_ends_at), 'none -- nothing to repair')
  union all select 10, 'live: is there a recorded charge to repair FROM?',
         true,
         coalesce((select count(*)::text || ' applied charge.success event(s) carrying paid_at'
                     from billing_events
                    where event_type='charge.success' and status='applied'
                      and nullif(payload #>> '{data,paid_at}','') is not null), '0')
  union all select 11, 'live: the plans and their subscribers',
         true,
         coalesce((select string_agg(p.id || '=' || c, ', ' order by p.id)
                     from plans p join lateral
                          (select count(*) c from subscriptions s where s.plan_id=p.id) x on true
                    where c > 0), 'no subscriptions')
  union all select 12, 'live: no founder slot is at risk (0051 touches none)',
         true,
         (select count(*)::text || ' slot(s) claimed' from founder_slots where claimed_at is not null)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
