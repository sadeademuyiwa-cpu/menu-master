-- ============================================================================
-- MENU MASTER NG
-- 008: post-Phase-B check
--
-- DISPOSABLE PROJECT ONLY. READ ONLY: one SELECT.
--
-- Run AFTER the service_role tests, to see what the key actually changed.
-- S10 should have moved Boundary A to trading / active with provider_ref
-- PHASE-B-S10. S13 must have changed nothing at all.
-- ============================================================================

select
  a.name                                   as account_name,
  s.plan_id,
  s.status,
  coalesce(s.provider_ref, '-')            as provider_ref,
  coalesce(s.current_period_end::text, '-') as current_period_end,
  count(*) over (partition by s.account_id) as rows_for_account
from subscriptions s
join accounts a on a.id = s.account_id
order by a.name;
