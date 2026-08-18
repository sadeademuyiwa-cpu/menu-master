-- ============================================================================
-- MENU MASTER NG
-- 0012: GATE 1 AUTHORIZATION HARDENING
--
-- Closes the four P0 vulnerabilities proven in the forensic audit. Additive.
-- No earlier migration is rewritten.
--
-- THE DESIGN RULE THIS MIGRATION INTRODUCES:
--
--   A function must NEVER derive authority from a parameter the caller
--   supplied. It derives the owning account from the target row's own
--   relational chain, then asks whether THIS caller may act on THAT account.
--
-- Every SECURITY DEFINER function below previously trusted its arguments.
-- That is the whole vulnerability class, and it is closed uniformly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. AUTHORIZATION PRIMITIVES
-- ----------------------------------------------------------------------------

-- Trusted backend context: the service role, a scheduled job, a migration,
-- or the SQL editor.
--
-- CRITICAL DETAIL, learned the hard way during Gate 1 testing:
-- do NOT use current_user or session_user here. Inside a SECURITY DEFINER
-- function both report the function OWNER, not the caller, so every guard
-- silently believed it was running as the billing system. The `role` GUC is
-- set by SET ROLE at the connection edge and is NOT changed by SECURITY
-- DEFINER, so it still reports what the client actually is.
--
-- A hostile client always arrives as 'authenticated' or 'anon'. PostgREST
-- connects as `authenticator`, which may only SET ROLE to anon,
-- authenticated or service_role, and a client cannot issue raw SQL through
-- PostgREST to change it.
--
-- Defence in depth: `authenticator` IS granted service_role, so anyone who
-- reaches a raw SQL channel could SET ROLE service_role. We therefore also
-- require the absence of an end-user JWT subject. A genuine service_role
-- key carries no `sub` claim; a hijacking end user always does.
create or replace function fn_is_service_context()
returns boolean
language sql stable
as $$
  select coalesce(current_setting('role', true), 'none')
           not in ('authenticated', 'anon')
     and coalesce(current_setting('request.jwt.claim.sub', true), '') = '';
$$;

create or replace function fn_has_account_role(
  p_account_id uuid,
  p_roles      member_role[]
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.account_id = p_account_id
      and m.user_id    = auth.uid()
      and m.role       = any(p_roles)
  );
$$;

-- Raising, rather than returning NULL, matters here. NULL already means
-- "not entered" in this system. An authorization failure must be
-- distinguishable from missing data, or the client cannot tell a locked
-- door from an empty room.
create or replace function fn_require_member(p_account_id uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if fn_is_service_context() then return; end if;
  if p_account_id is null or not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function fn_require_cost_access(p_account_id uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if fn_is_service_context() then return; end if;
  if p_account_id is null or not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account' using errcode = '42501';
  end if;
  if not fn_can_see_costs(p_account_id) then
    raise exception 'Your role does not permit access to cost information'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function fn_require_account_role(
  p_account_id uuid, p_roles member_role[], p_action text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if fn_is_service_context() then return; end if;
  if p_account_id is null or not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account' using errcode = '42501';
  end if;
  if not fn_has_account_role(p_account_id, p_roles) then
    raise exception 'Your role does not permit %', p_action using errcode = '42501';
  end if;
end;
$$;

-- ============================================================================
-- P0-1: COSTING AND CONVERSION RPCs
-- ============================================================================

-- The account comes from the BUSINESS ROW, not from the caller. Passing
-- another tenant's ingredient id now fails the ownership cross-check rather
-- than returning their cost.
create or replace function fn_ingredient_unit_cost(
  p_ingredient_id uuid,
  p_business_id   uuid,
  p_as_of         date default current_date
)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_ing_acct   uuid;
  v_window     integer;
  v_cost       numeric;
begin
  select account_id, wavg_window_days into v_account_id, v_window
  from business_settings where business_id = p_business_id;

  if v_account_id is null then
    return null;                                  -- unknown business
  end if;

  perform fn_require_cost_access(v_account_id);   -- AUTHORIZATION

  -- The ingredient must belong to the same account as the business.
  -- This blocks the mix-and-match parameter attack.
  select account_id into v_ing_acct from ingredients where id = p_ingredient_id;
  if v_ing_acct is distinct from v_account_id then
    raise exception 'Ingredient does not belong to this account'
      using errcode = '42501';
  end if;

  select sum(amount) / nullif(sum(qty_base), 0) into v_cost
  from ingredient_prices
  where ingredient_id = p_ingredient_id
    and account_id    = v_account_id
    and reversed_at is null
    and effective_date <= p_as_of
    and effective_date >  p_as_of - (v_window || ' days')::interval;

  if v_cost is null then
    select unit_cost into v_cost
    from ingredient_prices
    where ingredient_id = p_ingredient_id
      and account_id    = v_account_id
      and reversed_at is null
      and effective_date <= p_as_of
    order by effective_date desc, created_at desc
    limit 1;
  end if;

  return v_cost;   -- NULL still means not entered. Never zero.
end;
$$;

create or replace function fn_ingredient_usable_unit_cost(
  p_ingredient_id uuid, p_business_id uuid, p_as_of date default current_date)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare v_cost numeric; v_yield numeric;
begin
  -- Delegates authorization to fn_ingredient_unit_cost, which raises.
  v_cost := fn_ingredient_unit_cost(p_ingredient_id, p_business_id, p_as_of);
  if v_cost is null then return null; end if;
  select purchase_yield_pct into v_yield from ingredients where id = p_ingredient_id;
  if v_yield is null or v_yield <= 0 then return null; end if;
  return v_cost / (v_yield / 100.0);
end;
$$;

-- A conversion is private measurement data: how many kg of rice fit in
-- this owner's paint. The account is derived from the ingredient itself.
create or replace function fn_resolve_qty_to_base(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_unit_id       uuid
)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_acct        uuid;
  v_base_unit   uuid;
  v_base_kind   unit_kind;
  v_base_factor numeric;
  v_kind        unit_kind;
  v_factor      numeric;
  v_unit_acct   uuid;
  v_specific    numeric;
begin
  if p_ingredient_id is null or p_unit_id is null or p_qty is null then
    return null;
  end if;

  select i.account_id, i.base_unit_id into v_acct, v_base_unit
  from ingredients i where i.id = p_ingredient_id and i.deleted_at is null;

  if v_base_unit is null then
    return null;                                  -- unknown ingredient
  end if;

  perform fn_require_member(v_acct);              -- AUTHORIZATION

  if p_unit_id = v_base_unit then
    return p_qty;
  end if;

  select u.kind, u.factor_to_base, u.account_id
    into v_kind, v_factor, v_unit_acct
  from units u where u.id = p_unit_id;

  if v_kind is null then return null; end if;
  if v_unit_acct is not null and v_unit_acct <> v_acct then return null; end if;

  select u.kind, u.factor_to_base into v_base_kind, v_base_factor
  from units u where u.id = v_base_unit;

  if v_factor is not null and v_kind = v_base_kind and coalesce(v_base_factor,0) > 0 then
    return p_qty * v_factor / v_base_factor;
  end if;

  select c.qty_in_base into v_specific
  from ingredient_unit_conversions c
  where c.ingredient_id = p_ingredient_id
    and c.unit_id       = p_unit_id
    and c.account_id    = v_acct;

  if v_specific is null then return null; end if;
  return p_qty * v_specific;
end;
$$;

create or replace function fn_recipes_using_ingredient(p_ingredient_id uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
declare v_acct uuid;
begin
  select account_id into v_acct from ingredients where id = p_ingredient_id;
  if v_acct is null then return; end if;
  perform fn_require_member(v_acct);              -- AUTHORIZATION

  return query
  with recursive direct as (
    select distinct rl.recipe_id from recipe_lines rl
    where rl.ingredient_id = p_ingredient_id
  ),
  ascend as (
    select recipe_id from direct
    union
    select rl.recipe_id from recipe_lines rl
    join ascend a on rl.sub_recipe_id = a.recipe_id
  )
  select distinct a.recipe_id
  from ascend a join recipes r on r.id = a.recipe_id
  where r.deleted_at is null;
end;
$$;

create or replace function fn_compute_recipe_cost_snapshot(
  p_recipe_id  uuid,
  p_as_of      date default current_date,
  p_created_by uuid default auth.uid()
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  r recipes%rowtype; bs business_settings%rowtype; core recipe_cost_result;
  v_overhead numeric := 0; v_oh_total numeric;
  v_required integer; v_priced integer; v_unpriced jsonb; v_complete boolean;
  v_floor_pp numeric; v_snapshot uuid;
begin
  select * into r from recipes where id = p_recipe_id and deleted_at is null;
  if not found then raise exception 'Recipe % not found', p_recipe_id; end if;

  perform fn_require_cost_access(r.account_id);   -- AUTHORIZATION

  select * into bs from business_settings where business_id = r.business_id;
  if not found then
    raise exception 'Business settings missing for business %', r.business_id;
  end if;

  core := fn__recipe_cost_core(p_recipe_id, p_as_of, 0);

  v_required := core.required_inputs;
  v_priced   := core.priced_inputs;
  v_unpriced := core.unpriced_items;
  v_complete := core.is_complete;

  if bs.overhead_enabled then
    v_required := v_required + 1;
    select sum(monthly_cost) into v_oh_total
    from overhead_items
    where business_id = r.business_id and is_active and monthly_cost is not null;

    if bs.expected_monthly_units is null or bs.expected_monthly_units <= 0
       or v_oh_total is null
       or exists (select 1 from overhead_items
                   where business_id = r.business_id and is_active and monthly_cost is null)
    then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'business_id', r.business_id,
        'problem', 'missing_overhead_config');
      v_overhead := null;
    else
      v_overhead := v_oh_total / bs.expected_monthly_units;
      v_priced   := v_priced + 1;
    end if;
  end if;

  if r.kind = 'dish' then
    v_required := v_required + 1;
    if r.portion_qty is null then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'problem', 'missing_portion_size');
    else
      v_priced := v_priced + 1;
    end if;
  end if;

  if core.priced_inputs = 0 then
    v_floor_pp := null;
  elsif core.cost_per_yield_unit is not null and r.portion_qty is not null then
    v_floor_pp := core.cost_per_yield_unit * r.portion_qty + coalesce(v_overhead, 0);
  else
    v_floor_pp := null;
  end if;

  if jsonb_array_length(v_unpriced) > 0 then
    v_complete := false;
  end if;

  insert into cost_snapshots (
    account_id, business_id, recipe_id, computed_at,
    costing_method, wavg_window_days,
    is_complete, required_inputs, priced_inputs, excluded_inputs, unpriced_items,
    ingredient_cost, packaging_cost, labour_cost, overhead_cost,
    batch_cost, cost_per_yield_unit, cost_per_portion,
    floor_batch_cost, floor_cost_per_yield_unit, floor_cost_per_portion,
    created_by)
  values (
    r.account_id, r.business_id, p_recipe_id, now(),
    bs.costing_method, bs.wavg_window_days,
    v_complete, v_required, v_priced, core.excluded_inputs, v_unpriced,
    core.ingredient_cost, core.packaging_cost, core.labour_cost, v_overhead,
    case when v_complete then core.batch_cost end,
    case when v_complete then core.cost_per_yield_unit end,
    case when v_complete then v_floor_pp end,
    case when core.priced_inputs > 0 then core.batch_cost end,
    case when core.priced_inputs > 0 then core.cost_per_yield_unit end,
    v_floor_pp,
    p_created_by)
  returning id into v_snapshot;

  return v_snapshot;
end;
$$;

create or replace function fn_recompute_recipes_for_ingredient(
  p_ingredient_id uuid, p_as_of date default current_date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_n integer := 0; v_acct uuid;
begin
  select account_id into v_acct from ingredients where id = p_ingredient_id;
  if v_acct is null then return 0; end if;
  perform fn_require_cost_access(v_acct);         -- AUTHORIZATION

  for v_id in select * from fn_recipes_using_ingredient(p_ingredient_id) loop
    perform fn_compute_recipe_cost_snapshot(v_id, p_as_of, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ============================================================================
-- P0-2: PURCHASE POSTING AND REVERSAL
-- Posting and reversing are financial acts. Owner or manager only.
-- ============================================================================

create or replace function fn_purchase_blockers(p_purchase_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_acct uuid; v_out jsonb;
begin
  select account_id into v_acct from purchases where id = p_purchase_id;
  if v_acct is null then return '[]'::jsonb; end if;
  perform fn_require_member(v_acct);              -- AUTHORIZATION

  select coalesce(jsonb_agg(jsonb_build_object(
           'purchase_line_id', pl.id,
           'ingredient_id',    pl.ingredient_id,
           'ingredient_name',  i.name,
           'unit_id',          pl.unit_id,
           'unit_code',        u.code,
           'problem',          'missing_conversion')), '[]'::jsonb)
    into v_out
  from purchase_lines pl
  join ingredients i on i.id = pl.ingredient_id
  join units u on u.id = pl.unit_id
  where pl.purchase_id = p_purchase_id
    and fn_resolve_qty_to_base(pl.ingredient_id, pl.qty, pl.unit_id) is null;

  return v_out;
end;
$$;

create or replace function fn_post_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_p purchases%rowtype; v_blockers jsonb; v_lines integer;
  v_written integer := 0; r record; v_base numeric;
begin
  -- Lock the row: closes the concurrent double-post race as a side effect
  -- of having to fetch it for the authorization check anyway.
  select * into v_p from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase % not found', p_purchase_id; end if;

  perform fn_require_account_role(v_p.account_id,
    array['owner','manager']::member_role[], 'posting purchases');   -- AUTHORIZATION

  if v_p.status <> 'draft' then
    raise exception 'Purchase % is already %', p_purchase_id, v_p.status
      using errcode='check_violation';
  end if;

  select count(*) into v_lines from purchase_lines where purchase_id = p_purchase_id;
  if v_lines = 0 then
    raise exception 'Purchase % has no lines', p_purchase_id using errcode='check_violation';
  end if;

  v_blockers := fn_purchase_blockers(p_purchase_id);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('posted', false,
      'reason', 'unresolved_conversions', 'blockers', v_blockers);
  end if;

  for r in select * from purchase_lines where purchase_id = p_purchase_id loop
    v_base := fn_resolve_qty_to_base(r.ingredient_id, r.qty, r.unit_id);
    if v_base is null or v_base <= 0 then
      raise exception 'Line % did not resolve. Refusing to post.', r.id
        using errcode='check_violation';
    end if;
    update purchase_lines set qty_base = v_base where id = r.id;
    insert into ingredient_prices (
      account_id, ingredient_id, supplier_id, purchase_line_id,
      qty_base, amount, source, effective_date, entered_by)
    values (v_p.account_id, r.ingredient_id, v_p.supplier_id, r.id,
      v_base, r.amount, 'purchase', v_p.purchase_date, auth.uid());
    v_written := v_written + 1;
  end loop;

  update purchases set status='posted', posted_at=now(), posted_by=auth.uid()
   where id = p_purchase_id;

  return jsonb_build_object('posted', true,
    'purchase_id', p_purchase_id, 'price_rows_written', v_written);
end;
$$;

create or replace function fn_reverse_purchase(
  p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_p purchases%rowtype; v_rev_id uuid; v_marked integer;
begin
  select * into v_p from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase % not found', p_purchase_id; end if;

  -- AUTHORIZATION. Ownership is derived from the purchase row itself,
  -- never from a business id the caller supplied.
  perform fn_require_account_role(v_p.account_id,
    array['owner','manager']::member_role[], 'reversing purchases');

  if v_p.status <> 'posted' then
    raise exception 'Only a posted purchase can be reversed. This one is %', v_p.status
      using errcode='check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reversal requires a reason' using errcode='check_violation';
  end if;

  insert into purchases (
    account_id, business_id, location_id, supplier_id, purchase_date,
    reference, note, status, reverses, reversal_reason, created_by, posted_at, posted_by)
  values (
    v_p.account_id, v_p.business_id, v_p.location_id, v_p.supplier_id, current_date,
    coalesce(v_p.reference,'') || ' (reversal)', v_p.note, 'reversed',
    v_p.id, p_reason, auth.uid(), now(), auth.uid())
  returning id into v_rev_id;

  update ingredient_prices ip
     set reversed_at = now(), reversed_by_purchase_id = v_rev_id
   where ip.purchase_line_id in (select id from purchase_lines where purchase_id = p_purchase_id)
     and ip.reversed_at is null;
  get diagnostics v_marked = row_count;

  update purchases set status = 'reversed' where id = p_purchase_id;

  return jsonb_build_object('reversed', true,
    'original_purchase_id', p_purchase_id,
    'reversal_purchase_id', v_rev_id,
    'price_rows_reversed', v_marked);
end;
$$;

-- ============================================================================
-- P0-3: MEMBERSHIP AND ROLE ELEVATION
--
-- The old policy asked only "are you in this account". The row that GRANTS
-- authority was therefore writable by anyone it would grant authority over.
-- Writes now require an EXISTING owner, which a self-promoting cashier
-- by definition is not.
-- ============================================================================

drop policy if exists p_memberships on memberships;

create policy p_memberships_select on memberships
  for select using (fn_is_account_member(account_id));

create policy p_memberships_insert on memberships
  for insert with check (fn_has_account_role(account_id, array['owner']::member_role[]));

create policy p_memberships_update on memberships
  for update using      (fn_has_account_role(account_id, array['owner']::member_role[]))
             with check (fn_has_account_role(account_id, array['owner']::member_role[]));

create policy p_memberships_delete on memberships
  for delete using (fn_has_account_role(account_id, array['owner']::member_role[]));

-- An account must never lose its last owner, or it becomes unadministrable
-- and no one can ever grant a role in it again.
create or replace function fn_guard_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owners integer; v_acct uuid;
begin
  v_acct := coalesce(old.account_id, new.account_id);
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*) into v_owners from memberships
     where account_id = v_acct and role = 'owner'
       and id <> old.id;
    if v_owners = 0 then
      raise exception 'An account must retain at least one owner'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_memberships_last_owner
  before update or delete on memberships
  for each row execute function fn_guard_last_owner();

-- Onboarding creates the first owner. Force the owner to be the caller, so
-- the function cannot be used to mint an owner membership for anyone else.
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
language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid; v_business uuid; v_location uuid; v_slug text;
  v_cloned integer; v_user uuid;
begin
  -- A client may only create an account for itself. Service context may
  -- still act on behalf of a user, for support and migration purposes.
  if fn_is_service_context() then
    v_user := coalesce(p_user_id, auth.uid());
  else
    v_user := auth.uid();
    if p_user_id is not null and p_user_id <> v_user then
      raise exception 'You may only create an account for yourself'
        using errcode = '42501';
    end if;
  end if;

  if v_user is null then
    raise exception 'A user is required to own the account';
  end if;
  if not exists (select 1 from auth.users where id = v_user) then
    raise exception 'User % does not exist', v_user;
  end if;
  if coalesce(btrim(p_account_name),'') = '' or coalesce(btrim(p_business_name),'') = '' then
    raise exception 'Account name and business name are required';
  end if;

  insert into accounts (name) values (btrim(p_account_name)) returning id into v_account;

  insert into memberships (account_id, business_id, user_id, role)
  values (v_account, null, v_user, 'owner');

  v_slug := btrim(regexp_replace(lower(btrim(p_business_name)), '[^a-z0-9]+', '-', 'g'), '-');
  insert into businesses (account_id, name, slug, type)
  values (v_account, btrim(p_business_name), v_slug, p_business_type)
  returning id into v_business;

  insert into locations (account_id, business_id, name, is_default)
  values (v_account, v_business, 'Main', true) returning id into v_location;

  insert into business_settings (business_id, account_id, currency)
  values (v_business, v_account, p_currency);

  insert into channels (account_id, business_id, name, is_default)
  values (v_account, v_business, 'Direct', true);

  v_cloned := fn_clone_starter_catalog(v_account, p_business_type);

  insert into subscriptions (account_id, plan_id, status, trial_ends_at, current_period_end)
  values (v_account, p_plan_id, 'trialing',
          now() + (p_trial_days || ' days')::interval,
          now() + (p_trial_days || ' days')::interval);

  return jsonb_build_object(
    'account_id', v_account, 'business_id', v_business, 'location_id', v_location,
    'ingredients_added', v_cloned, 'next_step', 'enter_your_own_prices');
end;
$$;

-- The catalogue clone writes into an account. Owners only.
create or replace function fn_clone_starter_catalog(
  p_account_id uuid, p_type business_type default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  perform fn_require_account_role(p_account_id,
    array['owner']::member_role[], 'loading the starter catalogue');  -- AUTHORIZATION

  insert into ingredient_categories (account_id, name)
  select p_account_id, c.name from catalog_categories c
  where not exists (select 1 from ingredient_categories ic
                     where ic.account_id = p_account_id and ic.name = c.name);

  insert into ingredients (account_id, kind, name, category_id, base_unit_id)
  select p_account_id, ci.kind, ci.name, ic.id, u.id
  from catalog_ingredients ci
  join ingredient_categories ic on ic.account_id = p_account_id and ic.name = ci.category_name
  join units u on u.account_id is null and u.code = ci.base_unit
  where (ci.applies_to is null or p_type is null or p_type = any(ci.applies_to))
    and not exists (select 1 from ingredients i
                     where i.account_id = p_account_id and lower(i.name) = lower(ci.name));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================================
-- P0-4: SUBSCRIPTION ENTITLEMENT
-- Entitlement is not client state. Read only from the client; changes come
-- from the payment webhook or support tooling running as service role.
-- ============================================================================

drop policy if exists p_subscriptions on subscriptions;

create policy p_subscriptions_select on subscriptions
  for select using (fn_is_account_member(account_id));

revoke insert, update, delete on subscriptions from authenticated;

-- Belt and braces: even if a future migration re-grants DML by accident,
-- the trigger refuses a client-originated write.
-- Entitlement is not client state. But onboarding legitimately creates a
-- TRIAL subscription on behalf of a brand new user, so a blanket
-- service-only rule breaks self-signup. The rule is therefore:
--   a client may create ONE trialing subscription on a plan explicitly
--   marked self-serve, and may never update or delete any subscription.
alter table plans add column if not exists is_self_serve_trial boolean not null default false;
update plans set is_self_serve_trial = true where id = 'trial';

create or replace function fn_guard_subscription_writes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_existing integer;
begin
  if fn_is_service_context() then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'Subscription changes must go through the billing system'
      using errcode = '42501';
  end if;

  select count(*) into v_existing from subscriptions where account_id = new.account_id;
  if v_existing > 0 then
    raise exception 'This account already has a subscription' using errcode = '42501';
  end if;

  if new.status <> 'trialing'
     or not exists (select 1 from plans
                     where id = new.plan_id and is_active and is_self_serve_trial) then
    raise exception 'Only a trial subscription can be created without billing'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_subscriptions_guard
  before insert or update or delete on subscriptions
  for each row execute function fn_guard_subscription_writes();

-- The legitimate path, for the Paystack webhook running as service role.
create or replace function fn_set_subscription_plan(
  p_account_id uuid,
  p_plan_id    text,
  p_status     text default 'active',
  p_period_end timestamptz default null,
  p_provider_ref text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not fn_is_service_context() then
    raise exception 'Only the billing system may change a subscription'
      using errcode = '42501';
  end if;
  if not exists (select 1 from plans where id = p_plan_id and is_active) then
    raise exception 'Unknown or inactive plan %', p_plan_id;
  end if;

  update subscriptions
     set plan_id = p_plan_id,
         status  = p_status,
         current_period_end = coalesce(p_period_end, current_period_end),
         provider_ref = coalesce(p_provider_ref, provider_ref)
   where account_id = p_account_id;

  return jsonb_build_object('account_id', p_account_id, 'plan_id', p_plan_id);
end;
$$;

-- ============================================================================
-- SWEEP: nothing internal should be callable by a client
-- ============================================================================

revoke execute on function fn_trg_price_change_recompute()      from public, anon, authenticated;
revoke execute on function fn_trg_ingredient_change_recompute() from public, anon, authenticated;
revoke execute on function fn_assert_unit_visible()             from public, anon, authenticated;
revoke execute on function fn_prevent_recipe_cycle()            from public, anon, authenticated;
revoke execute on function fn_guard_last_owner()                from public, anon, authenticated;
revoke execute on function fn_guard_subscription_writes()       from public, anon, authenticated;
revoke execute on function fn_set_subscription_plan(uuid, text, text, timestamptz, text)
                                                                from public, anon, authenticated;

grant execute on function
  fn_has_account_role(uuid, member_role[]),
  fn_is_service_context()
  to authenticated;
