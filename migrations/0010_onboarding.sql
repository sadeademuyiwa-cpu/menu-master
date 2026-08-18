-- ============================================================================
-- MENU MASTER NG
-- 0010: onboarding
--
-- One atomic call creates everything a new owner needs to reach the first
-- costing screen: account, owner membership, business, default location,
-- settings, starter catalogue and a trial subscription.
--
-- It seeds NO prices, NO conversions and NO purchase yields. Those are the
-- owner's data and the product is worthless if we guess them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Plans. These are OUR product prices, not food prices.
-- ----------------------------------------------------------------------------

insert into plans (id, name, monthly_price, currency, is_active) values
  ('trial',    'Free Trial',      0, 'NGN', true),
  ('costing',  'Costing',         0, 'NGN', true),
  ('trading',  'Costing + Sales', 0, 'NGN', true)
on conflict (id) do nothing;

-- Monthly prices are 0 pending your commercial decision. They are values in
-- a table, so changing them is an update, never a deployment.

insert into plan_features (plan_id, feature_key, limit_value, is_enabled) values
  ('trial',   'level',        1,    true),
  ('trial',   'businesses',   1,    true),
  ('trial',   'users',        2,    true),
  ('trial',   'recipes',      20,   true),
  ('costing', 'level',        1,    true),
  ('costing', 'businesses',   1,    true),
  ('costing', 'users',        3,    true),
  ('costing', 'recipes',      null, true),
  ('trading', 'level',        2,    true),
  ('trading', 'businesses',   3,    true),
  ('trading', 'users',        10,   true),
  ('trading', 'recipes',      null, true)
on conflict (plan_id, feature_key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Atomic account creation
-- ----------------------------------------------------------------------------

create or replace function fn_create_account_and_business(
  p_account_name   text,
  p_business_name  text,
  p_business_type  business_type default 'other',
  p_user_id        uuid default auth.uid(),
  p_currency       text default 'NGN',
  p_plan_id        text default 'trial',
  p_trial_days     integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account   uuid;
  v_business  uuid;
  v_location  uuid;
  v_slug      text;
  v_cloned    integer;
begin
  if p_user_id is null then
    raise exception 'A user is required to own the account';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User % does not exist', p_user_id;
  end if;
  if coalesce(btrim(p_account_name),'') = '' or coalesce(btrim(p_business_name),'') = '' then
    raise exception 'Account name and business name are required';
  end if;

  -- 1. account
  insert into accounts (name) values (btrim(p_account_name))
  returning id into v_account;

  -- 2. owner membership, account wide
  insert into memberships (account_id, business_id, user_id, role)
  values (v_account, null, p_user_id, 'owner');

  -- 3. business
  v_slug := regexp_replace(lower(btrim(p_business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  insert into businesses (account_id, name, slug, type)
  values (v_account, btrim(p_business_name), v_slug, p_business_type)
  returning id into v_business;

  -- 4. default location, hidden in the MVP UI
  insert into locations (account_id, business_id, name, is_default)
  values (v_account, v_business, 'Main', true)
  returning id into v_location;

  -- 5. settings. Financial defaults only, no market assumptions.
  insert into business_settings (business_id, account_id, currency)
  values (v_business, v_account, p_currency);

  -- 6. default sales channel
  insert into channels (account_id, business_id, name, is_default)
  values (v_account, v_business, 'Direct', true);

  -- 7. starter catalogue: names, categories, units. Nothing priced.
  v_cloned := fn_clone_starter_catalog(v_account, p_business_type);

  -- 8. trial subscription
  insert into subscriptions (account_id, plan_id, status, trial_ends_at, current_period_end)
  values (v_account, p_plan_id, 'trialing',
          now() + (p_trial_days || ' days')::interval,
          now() + (p_trial_days || ' days')::interval);

  return jsonb_build_object(
    'account_id',        v_account,
    'business_id',       v_business,
    'location_id',       v_location,
    'ingredients_added', v_cloned,
    'next_step',         'enter_your_own_prices');
end;
$$;

comment on function fn_create_account_and_business is
  'Atomic onboarding. Seeds no prices, no conversions and no purchase yields.';

-- ----------------------------------------------------------------------------
-- 3. Activation progress, drives the onboarding checklist
-- ----------------------------------------------------------------------------

create or replace view v_onboarding_status with (security_invoker = on) as
select
  b.account_id,
  b.id as business_id,
  b.name,
  (select count(*) from ingredients i
     where i.account_id = b.account_id and i.deleted_at is null)          as ingredients,
  (select count(*) from ingredient_prices ip
     where ip.account_id = b.account_id and ip.reversed_at is null)       as prices_entered,
  (select count(*) from recipes r
     where r.business_id = b.id and r.deleted_at is null)                 as recipes,
  (select count(*) from cost_snapshots s
     where s.business_id = b.id and s.is_complete)                        as complete_costings,
  (select count(*) from v_missing_unit_conversions m
     where m.account_id = b.account_id and m.reason <> 'suggested')       as blocking_conversions,
  (select count(*) from recipe_prices rp
     join recipes r2 on r2.id = rp.recipe_id
     where r2.business_id = b.id)                                         as selling_prices_set
from businesses b
where b.deleted_at is null;
