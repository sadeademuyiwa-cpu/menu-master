-- ============================================================================
-- 0050 -- PRE-DEPLOY AUDIT           READ ONLY. Changes nothing.
--
-- Proves production is at EXACTLY 0049 and that no part of 0050 is applied.
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 12 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'identity: 0049 is applied (founder_slots exists, exactly 100 rows)',
         (select count(*) from information_schema.tables
           where table_schema='public' and table_name='founder_slots') = 1
     and (select count(*) from founder_slots) = 100,
         coalesce((select count(*)::text||' slots' from founder_slots),'no table')
  union all select 2, 'identity: 117 policies',
         (select count(*) from pg_policies where schemaname='public') = 117,
         (select count(*)::text from pg_policies where schemaname='public')
  union all select 3, 'identity: the four priced plans are present, in kobo',
         (select count(*) from plans where id in
            ('costing','trading','founding_costing','founding_trading')
            and price_kobo > 0) = 4,
         (select string_agg(id||'='||price_kobo, ', ' order by id) from plans
           where id in ('costing','trading','founding_costing','founding_trading'))

  union all select 4, 'requires: fn_billing_apply exists (0029)',
         exists(select 1 from pg_proc where proname='fn_billing_apply'
                  and pronamespace='public'::regnamespace), ''
  union all select 5, 'requires: fn_billing_ingest exists (0029)',
         exists(select 1 from pg_proc where proname='fn_billing_ingest'
                  and pronamespace='public'::regnamespace), ''
  union all select 6, 'requires: the three founder functions exist (0049)',
         (select count(*) from pg_proc where pronamespace='public'::regnamespace
            and proname in ('fn_claim_founder_slot','fn_confirm_founder_slot',
                            'fn_forfeit_founding_price')) = 3, ''
  union all select 7, 'requires: the five 0049 subscription columns exist',
         (select count(*) from information_schema.columns where table_name='subscriptions'
            and column_name in ('price_kobo','provider_customer_code',
                                'provider_subscription_code','cancel_at_period_end',
                                'founding_price_active')) = 5, ''

  union all select 8, 'not yet applied: fn_checkout_quote absent',
         not exists(select 1 from pg_proc where proname='fn_checkout_quote'
                      and pronamespace='public'::regnamespace), ''
  union all select 9, 'not yet applied: fn_apply_billing_side_effects absent',
         not exists(select 1 from pg_proc where proname='fn_apply_billing_side_effects'
                      and pronamespace='public'::regnamespace), ''
  union all select 10, 'not yet applied: fn_billing_apply does not call the boundary',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
            and pronamespace='public'::regnamespace) not like '%fn_apply_billing_side_effects%', ''

  -- the two facts that decide whether this is safe RIGHT NOW
  union all select 11, 'live data: no founder slot is claimed yet (rollback window open)',
         (select count(*) from founder_slots where claimed_at is not null) = 0,
         (select count(*)::text||' claimed' from founder_slots where claimed_at is not null)
  union all select 12, 'live data: plan codes and subscribers, for the record',
         true,
         coalesce((select string_agg(p.id||'='||coalesce(p.provider_plan_code,'UNMAPPED')
                                       ||'('||c||' subs)', ', ' order by p.id)
                     from plans p join lateral
                          (select count(*) c from subscriptions s where s.plan_id=p.id) x on true),
                  'no plans')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
