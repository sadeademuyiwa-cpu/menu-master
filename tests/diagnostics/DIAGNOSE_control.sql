-- ============================================================================
-- MENU MASTER NG — diagnose why the boundary CONTROL test failed
--
-- READ ONLY. This selects and calls one STABLE function. It does not insert,
-- update, delete, create or drop anything.
--
-- Run in the Supabase SQL Editor of the DISPOSABLE project. Send back all
-- five result sets.
-- ============================================================================

-- 1. Does owner A's CURRENT auth id still match the membership the fixtures
--    created? If auth user A was deleted and re-created, memberships.user_id
--    was cascaded away and A is now a stranger to her own account.
select
  '1_identity'                                   as check,
  u.email,
  u.id::text                                     as current_auth_id,
  coalesce(m.role::text, 'NO MEMBERSHIP ROW')    as membership_role,
  coalesce(a.name, '-')                          as account_name
from auth.users u
left join memberships m on m.user_id = u.id
left join accounts a    on a.id = m.account_id
where u.email ilike '%boundary%'
order by u.email;

-- 2. Are there membership rows pointing at users that no longer exist,
--    or accounts with no owner at all?
select
  '2_orphan_accounts' as check,
  a.name              as account_name,
  a.id::text          as account_id,
  count(m.id)         as membership_rows,
  count(*) filter (where m.role = 'owner') as owner_rows
from accounts a
left join memberships m on m.account_id = a.id
where a.name in ('Boundary A','Boundary B')
group by a.name, a.id
order by a.name;

-- 3. Does business A have a settings row? fn_ingredient_unit_cost returns
--    NULL (not an error) when business_settings is missing, which the test
--    page correctly refuses to score as a pass.
select
  '3_settings'          as check,
  b.name                as business_name,
  b.id::text            as business_id,
  bs.business_id is not null as has_settings,
  bs.wavg_window_days,
  bs.currency
from businesses b
join accounts a on a.id = b.account_id
left join business_settings bs on bs.business_id = b.id
where a.name in ('Boundary A','Boundary B')
order by a.name;

-- 4. Is A's price row actually there, unreversed and in date window?
select
  '4_price'                as check,
  i.name                   as ingredient,
  ip.amount,
  ip.qty_base,
  round(ip.amount / nullif(ip.qty_base,0), 4) as implied_unit_cost,
  ip.effective_date,
  ip.reversed_at is null   as still_live
from ingredient_prices ip
join ingredients i on i.id = ip.ingredient_id
join accounts a    on a.id = ip.account_id
where a.name = 'Boundary A'
order by ip.effective_date desc;

-- 5. What does the costing function itself return with authorization bypassed?
--    The SQL Editor runs as a service context, so this reads the raw number.
--    If this says 15 the DATA is fine and the control failure is an identity
--    problem, not a costing problem.
select
  '5_service_context_cost' as check,
  fn_ingredient_unit_cost(
    (select i.id from ingredients i join accounts a on a.id = i.account_id
      where a.name = 'Boundary A' and i.name = 'Rice (local)'),
    (select b.id from businesses b join accounts a on a.id = b.account_id
      where a.name = 'Boundary A')
  )::text as cost_per_gram;
