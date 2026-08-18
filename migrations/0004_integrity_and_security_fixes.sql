-- ============================================================================
-- MENU MASTER NG
-- 0004: integrity and security fixes
--
-- BLOCKER FIXED HERE: fn_can_see_costs() checked whether the user held a
-- privileged role ANYWHERE. A manager of account B could therefore read
-- account A's ingredient prices and cost snapshots. It is now scoped to the
-- account being accessed.
--
-- Also: RLS is not enough. RLS protects reads and writes from the client.
-- It does nothing to stop a SECURITY DEFINER function or a bad join from
-- pulling another account's row into a calculation. Composite foreign keys
-- on (id, account_id) make a cross-account reference structurally impossible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE BLOCKER: account scoped cost visibility
-- ----------------------------------------------------------------------------

drop policy if exists p_ingredient_prices on ingredient_prices;
drop policy if exists p_cost_snapshots  on cost_snapshots;
drop function if exists fn_can_see_costs();

create function fn_can_see_costs(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.account_id = p_account_id
      and m.user_id    = auth.uid()
      and m.role in ('owner','manager','accountant')
  );
$$;

comment on function fn_can_see_costs(uuid) is
  'True only if the current user holds a cost bearing role IN THIS ACCOUNT. '
  'A role in another account grants nothing here.';

create policy p_ingredient_prices on ingredient_prices
  for all using      (fn_is_account_member(account_id) and fn_can_see_costs(account_id))
      with check (fn_is_account_member(account_id) and fn_can_see_costs(account_id));

create policy p_cost_snapshots on cost_snapshots
  for all using      (fn_is_account_member(account_id) and fn_can_see_costs(account_id))
      with check (fn_is_account_member(account_id) and fn_can_see_costs(account_id));

-- Selling prices and margins are cost adjacent. Kitchen and sales roles
-- should not read them either.
drop policy if exists p_recipe_prices on recipe_prices;
create policy p_recipe_prices on recipe_prices
  for all using      (fn_is_account_member(account_id) and fn_can_see_costs(account_id))
      with check (fn_is_account_member(account_id) and fn_can_see_costs(account_id));

-- ----------------------------------------------------------------------------
-- 2. NULLABILITY CORRECTIONS
-- ----------------------------------------------------------------------------

-- Global categories are unreachable under RLS. Categories are per account.
delete from ingredient_categories where account_id is null;
alter table ingredient_categories alter column account_id set not null;

-- CONFLICT FOUND: purchase_lines.qty_base was NOT NULL, which forced the
-- caller to invent a base quantity when no conversion exists. That is
-- exactly the behaviour the source of truth rule forbids. Unresolved lines
-- must be storable; they simply cannot be POSTED.
alter table purchase_lines alter column qty_base drop not null;

-- ----------------------------------------------------------------------------
-- 3. PURCHASE LIFECYCLE COLUMNS (posting flow, implemented in 0006)
-- ----------------------------------------------------------------------------

create type purchase_status as enum ('draft', 'posted', 'reversed');

alter table purchases
  add column status     purchase_status not null default 'draft',
  add column posted_at  timestamptz,
  add column posted_by  uuid references auth.users(id) on delete set null,
  add column reverses   uuid references purchases(id),
  add column reversal_reason text;

-- ----------------------------------------------------------------------------
-- 4. PRICE ROW PROVENANCE AND REVERSAL
-- A posted price is never edited or deleted. A reversal marks it superseded
-- and every cost function ignores superseded rows from that point forward.
-- ----------------------------------------------------------------------------

alter table ingredient_prices
  add column reversed_at timestamptz,
  add column reversed_by_purchase_id uuid references purchases(id),
  add constraint fk_ip_purchase_line
    foreign key (purchase_line_id) references purchase_lines(id) on delete restrict;

create index ix_ingredient_prices_active
  on ingredient_prices (ingredient_id, effective_date desc)
  where reversed_at is null;

-- ----------------------------------------------------------------------------
-- 5. CROSS ACCOUNT REFERENTIAL INTEGRITY
--
-- Every parent gets a unique key on (id, account_id). Every child then
-- references (child_col, account_id) instead of (child_col). The child's own
-- account_id becomes part of the constraint, so pointing at another account's
-- row raises a foreign key violation rather than silently costing a recipe
-- with someone else's ingredient.
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'businesses','locations','ingredient_categories','ingredients','suppliers',
    'recipes','labour_rates','overhead_items','channels','purchases',
    'purchase_lines','customers','orders','cost_snapshots'
  ]
  loop
    execute format('alter table %I add constraint ux_%I_id_account unique (id, account_id)', t, t);
  end loop;
end $$;

do $$
declare
  r record;
  specs text[][] := array[
    -- child table,            child column,       parent table
    array['locations',                  'business_id',    'businesses'],
    array['memberships',                'business_id',    'businesses'],
    array['business_settings',          'business_id',    'businesses'],
    array['ingredients',                'category_id',    'ingredient_categories'],
    array['ingredient_unit_conversions','ingredient_id',  'ingredients'],
    array['ingredient_prices',          'ingredient_id',  'ingredients'],
    array['ingredient_prices',          'supplier_id',    'suppliers'],
    array['recipes',                    'business_id',    'businesses'],
    array['recipe_lines',               'recipe_id',      'recipes'],
    array['recipe_lines',               'ingredient_id',  'ingredients'],
    array['recipe_lines',               'sub_recipe_id',  'recipes'],
    array['labour_rates',               'business_id',    'businesses'],
    array['recipe_labour',              'recipe_id',      'recipes'],
    array['recipe_labour',              'labour_rate_id', 'labour_rates'],
    array['overhead_items',             'business_id',    'businesses'],
    array['channels',                   'business_id',    'businesses'],
    array['recipe_prices',              'recipe_id',      'recipes'],
    array['recipe_prices',              'channel_id',     'channels'],
    array['cost_snapshots',             'recipe_id',      'recipes'],
    array['cost_snapshots',             'business_id',    'businesses'],
    array['purchases',                  'business_id',    'businesses'],
    array['purchases',                  'location_id',    'locations'],
    array['purchases',                  'supplier_id',    'suppliers'],
    array['purchase_lines',             'purchase_id',    'purchases'],
    array['purchase_lines',             'ingredient_id',  'ingredients'],
    array['customers',                  'business_id',    'businesses'],
    array['orders',                     'business_id',    'businesses'],
    array['orders',                     'customer_id',    'customers'],
    array['orders',                     'channel_id',     'channels'],
    array['order_lines',                'order_id',       'orders'],
    array['order_lines',                'recipe_id',      'recipes'],
    array['order_lines',                'cost_snapshot_id','cost_snapshots'],
    array['sales_entries',              'business_id',    'businesses'],
    array['sales_entries',              'recipe_id',      'recipes'],
    array['sales_entries',              'channel_id',     'channels'],
    array['sales_entries',              'cost_snapshot_id','cost_snapshots'],
    array['period_closes',              'business_id',    'businesses']
  ];
  i int;
begin
  for i in 1 .. array_length(specs,1) loop
    execute format(
      'alter table %I add constraint fk_%I_%I_account
         foreign key (%I, account_id) references %I (id, account_id)',
      specs[i][1], specs[i][1], specs[i][2],
      specs[i][2], specs[i][3]);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. A recipe line's unit must be global or belong to the same account
-- ----------------------------------------------------------------------------

create or replace function fn_assert_unit_visible()
returns trigger language plpgsql as $$
declare v_unit_account uuid;
begin
  select account_id into v_unit_account from units where id = new.unit_id;
  if v_unit_account is not null and v_unit_account <> new.account_id then
    raise exception 'Unit % belongs to another account', new.unit_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_recipe_lines_unit_scope
  before insert or update on recipe_lines
  for each row execute function fn_assert_unit_visible();

create trigger trg_purchase_lines_unit_scope
  before insert or update on purchase_lines
  for each row execute function fn_assert_unit_visible();

create trigger trg_iuc_unit_scope
  before insert or update on ingredient_unit_conversions
  for each row execute function fn_assert_unit_visible();
