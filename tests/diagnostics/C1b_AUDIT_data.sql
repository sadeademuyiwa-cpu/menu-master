-- ============================================================================
-- MENU MASTER NG — C1b: PRODUCTION AUDIT, part 2 of 2 (DATA VOLUME)
--
--   *** PURE SELECT. NO SESSION OR DATABASE STATE IS CHANGED. ***
--
-- One statement: a single SELECT. No DO block, no set_config, no dynamic SQL,
-- no SET, no RESET, no temp objects, no advisory locks, no nextval, no CALL,
-- no DDL, no DML.
--
-- RUN THIS ONLY IF C1a REPORTS "0001 accounts table = present".
-- It references application tables by name, and a static reference to a
-- missing table fails at PARSE time -- which is precisely why the audit is
-- split rather than using dynamic SQL to work around it.
--
-- Reads no personal data: auth.users is COUNTED, never listed. No email
-- address, name or identifier is returned.
--
-- Note on locks: any SELECT takes a transient ACCESS SHARE lock, which does
-- not block reads or writes. On a large table count(*) is a full scan; on a
-- pre-launch database it is instant.
-- ============================================================================

select * from (
  -- ---- B. is production empty, or does it hold real data? -----------------
  select 'B data volume' as section, 'accounts'      as item, count(*)::text as observed from accounts
  union all select 'B data volume','businesses',                 count(*)::text from businesses
  union all select 'B data volume','memberships',                count(*)::text from memberships
  union all select 'B data volume','subscriptions',              count(*)::text from subscriptions
  union all select 'B data volume','ingredients',                count(*)::text from ingredients
  union all select 'B data volume','ingredient_prices',          count(*)::text from ingredient_prices
  union all select 'B data volume','ingredient_unit_conversions',count(*)::text from ingredient_unit_conversions
  union all select 'B data volume','recipes',                    count(*)::text from recipes
  union all select 'B data volume','recipe_lines',               count(*)::text from recipe_lines
  union all select 'B data volume','cost_snapshots',             count(*)::text from cost_snapshots
  union all select 'B data volume','purchases',                  count(*)::text from purchases
  union all select 'B data volume','purchase_lines',             count(*)::text from purchase_lines
  union all select 'B data volume','orders',                     count(*)::text from orders
  union all select 'B data volume','order_lines',                count(*)::text from order_lines
  union all select 'B data volume','sales_entries',              count(*)::text from sales_entries
  union all select 'B data volume','period_closes',              count(*)::text from period_closes
  union all select 'B data volume','auth.users (count only)',    count(*)::text from auth.users

  -- ---- D. 0017's preflight, SIMULATED. The migration is NOT run. ----------
  union all
  select 'D 0017 preflight (simulated)', 'statuses outside the four',
         count(*)::text || ' row(s)' ||
         coalesce(': ' || string_agg(distinct status, ', '), '')
  from subscriptions
  where status not in ('trialing','active','past_due','cancelled')

  union all
  select 'D 0017 preflight (simulated)', 'accounts with >1 subscription',
         coalesce(string_agg(account_id::text || ' (' || n || ')', ', '), 'none')
  from (select account_id, count(*) as n from subscriptions
         group by account_id having count(*) > 1) d
) as audit
order by section, item;
