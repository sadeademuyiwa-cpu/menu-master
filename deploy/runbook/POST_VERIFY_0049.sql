-- ============================================================================
-- 0049 -- POST-VERIFY              READ ONLY. Changes nothing.
--
-- Run immediately after 0049 commits. It re-proves, against the live
-- catalogue, everything the rehearsal proved against the replica.
--
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 20 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  -- structure
  select 1, 'plans carries tier, price_tier and price_kobo',
         (select count(*) from information_schema.columns
           where table_name='plans' and column_name in ('tier','price_tier','price_kobo')) = 3,
         (select count(*)::text from information_schema.columns
           where table_name='plans' and column_name in ('tier','price_tier','price_kobo'))
  union all select 2, 'subscriptions carries the five billing columns',
         (select count(*) from information_schema.columns where table_name='subscriptions'
            and column_name in ('price_kobo','provider_customer_code','provider_subscription_code',
                                'cancel_at_period_end','founding_price_active')) = 5,
         (select count(*)::text from information_schema.columns where table_name='subscriptions'
            and column_name in ('price_kobo','provider_customer_code','provider_subscription_code',
                                'cancel_at_period_end','founding_price_active'))
  union all select 3, 'founder_slots and founding_price_policy exist',
         (select count(*) from information_schema.tables where table_schema='public'
            and table_name in ('founder_slots','founding_price_policy')) = 2, ''

  -- the cap, as a data invariant
  union all select 4, 'exactly 100 founder slots, numbered 1..100',
         (select count(*) from founder_slots) = 100
         and (select min(seq) from founder_slots) = 1
         and (select max(seq) from founder_slots) = 100,
         (select count(*)::text || ' slots' from founder_slots)
  union all select 5, 'no slot has been claimed yet',
         (select count(*) from founder_slots where account_id is not null) = 0,
         (select count(*)::text || ' held' from founder_slots where account_id is not null)
  union all select 6, 'the 100-row cap is enforced by a CHECK, not by convention',
         exists(select 1 from pg_constraint where conrelid='founder_slots'::regclass
                  and contype='c' and pg_get_constraintdef(oid) like '%100%'), ''
  union all select 7, 'one account cannot hold two slots',
         exists(select 1 from pg_indexes where tablename='founder_slots'
                  and indexdef like '%UNIQUE%account_id%'), ''

  -- the prices, in integer kobo
  union all select 8, 'the four approved prices are present, in kobo',
         (select price_kobo from plans where id='costing')          = 750000
     and (select price_kobo from plans where id='trading')          = 1500000
     and (select price_kobo from plans where id='founding_costing') = 350000
     and (select price_kobo from plans where id='founding_trading') = 750000,
         (select string_agg(id||'='||price_kobo, ', ' order by id) from plans
           where id in ('costing','trading','founding_costing','founding_trading'))
  union all select 9, 'no active paid plan is priced at zero',
         not exists(select 1 from plans where is_active and price_tier <> 'trial' and price_kobo = 0),
         coalesce((select string_agg(id, ', ') from plans
                    where is_active and price_tier <> 'trial' and price_kobo = 0), 'none')
  union all select 10, 'exactly two active plans grant Sales',
         (select count(*) from plans where tier='trading' and is_active) = 2,
         (select string_agg(id, ', ' order by id) from plans where tier='trading' and is_active)
  union all select 11, 'the founding plans grant what their standard twin grants',
         (select count(*) from plan_features where plan_id='founding_costing')
           = (select count(*) from plan_features where plan_id='costing')
     and (select count(*) from plan_features where plan_id='founding_trading')
           = (select count(*) from plan_features where plan_id='trading'), ''

  -- the entitlement split
  union all select 12, 'fn_account_has_sales exists and is SECURITY DEFINER',
         exists(select 1 from pg_proc where proname='fn_account_has_sales'
                  and pronamespace='public'::regnamespace and prosecdef), ''
  union all select 13, 'and it refuses a caller who is not a member',
         (select pg_get_functiondef(oid) from pg_proc where proname='fn_account_has_sales'
            and pronamespace='public'::regnamespace) like '%fn_is_account_member%', ''
  union all select 14, 'exactly 13 Sales WRITE policies consult it',
         (select count(*) from pg_policies where schemaname='public' and cmd <> 'SELECT'
            and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%') = 13,
         (select count(*)::text from pg_policies where schemaname='public' and cmd <> 'SELECT'
            and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%')
  union all select 15, 'and NO read policy does -- history survives a downgrade',
         (select count(*) from pg_policies where schemaname='public' and cmd = 'SELECT'
            and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%') = 0,
         (select count(*)::text from pg_policies where schemaname='public' and cmd = 'SELECT'
            and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%')
  union all select 16, 'the policy count is 117 = the pre-existing 116 plus founder_slots',
         (select count(*) from pg_policies where schemaname='public') = 117
     and (select count(*) from pg_policies where schemaname='public' and tablename='founder_slots') = 1,
         (select count(*)::text from pg_policies where schemaname='public')

  -- the grant surface
  union all select 17, 'a signed-in user cannot allocate a founder slot',
         not has_function_privilege('authenticated','fn_claim_founder_slot(uuid,interval)','execute'), ''
  union all select 18, 'a logged-out caller can read no billing function',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
            and p.proname in ('fn_account_has_sales','fn_claim_founder_slot',
                              'fn_confirm_founder_slot','fn_forfeit_founding_price')
            and has_function_privilege('anon', p.oid, 'EXECUTE')) = 0, ''
  union all select 19, 'founder_slots is readable but not writable by signed-in users',
         (select count(*) from information_schema.role_table_grants
           where table_name='founder_slots' and grantee='authenticated') = 1
     and (select privilege_type from information_schema.role_table_grants
           where table_name='founder_slots' and grantee='authenticated') = 'SELECT', ''

  -- the customers who were already here
  union all select 20, 'every pre-existing subscription still resolves to a real plan',
         not exists(select 1 from subscriptions s
                     where not exists (select 1 from plans p where p.id = s.plan_id)),
         coalesce((select string_agg(p.id||'='||c, ', ' order by p.id)
                     from plans p join lateral
                          (select count(*) c from subscriptions s where s.plan_id=p.id) x on true
                    where c > 0), 'no subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
