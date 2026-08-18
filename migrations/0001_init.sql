-- ============================================================================
-- MENU MASTER NG
-- Schema v1.0, MVP scope: Level 1 (Costing) plus Level 2 (Trading)
--
-- Built to the approved blueprint. Scope is locked. Phase 2 structures
-- (stock lots, production, waste, finished goods, supplier balances) are
-- NOT in this file. Where a Phase 2 hook costs nothing today it is noted
-- in a comment so the later migration is additive, not a rewrite.
--
-- Governing rule, Section 1.6 of the blueprint:
--   PERSONAL DATA IS THE SOURCE OF TRUTH.
--   No account's data may influence another account's calculation.
--   A missing price is NULL. It is never zero.
--
-- Save as: supabase/migrations/0001_init.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. IDENTITY AND TENANCY
-- account  →  business  →  location
-- Isolation is by account_id on every row, enforced by RLS.
-- ============================================================================

create table accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  country_code      text not null default 'NG',
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text,
  phone             text,
  created_at        timestamptz not null default now()
);

create type business_type as enum (
  'soup_seller', 'caterer', 'restaurant', 'baker', 'small_chops',
  'meal_prep', 'cloud_kitchen', 'corporate_supplier', 'other'
);

create table businesses (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  name              text not null,
  slug              text not null,
  type              business_type not null default 'other',
  timezone          text not null default 'Africa/Lagos',
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (account_id, slug)
);

-- One default location per business in the MVP. The table exists now so
-- Phase 2 stock and production attach without altering purchases or sales.
create table locations (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  name              text not null default 'Main',
  is_default        boolean not null default true,
  created_at        timestamptz not null default now()
);

create type member_role as enum ('owner', 'manager', 'kitchen', 'sales', 'accountant');

-- business_id null means account wide access (owner, accountant)
create table memberships (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid references businesses(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              member_role not null default 'sales',
  created_at        timestamptz not null default now(),
  unique (account_id, business_id, user_id)
);

create index on memberships (user_id);

-- ============================================================================
-- 2. PLANS AND ENTITLEMENTS
-- Limits are rows, never constants in code.
-- ============================================================================

create table plans (
  id                text primary key,
  name              text not null,
  monthly_price     numeric(14,2) not null default 0,
  currency          text not null default 'NGN',
  is_active         boolean not null default true
);

create table plan_features (
  plan_id           text not null references plans(id) on delete cascade,
  feature_key       text not null,
  limit_value       integer,          -- null means unlimited
  is_enabled        boolean not null default true,
  primary key (plan_id, feature_key)
);

create table subscriptions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  plan_id           text not null references plans(id),
  status            text not null default 'trialing',
  trial_ends_at     timestamptz,
  current_period_end timestamptz,
  provider          text default 'paystack',
  provider_ref      text,
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- 3. UNITS AND CONVERSIONS
-- The local moat. A recipe entered in "2 paint of rice" must resolve to grams.
-- ============================================================================

create type unit_kind as enum ('mass', 'volume', 'count');

-- account_id null means a global unit available to everyone
create table units (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id) on delete cascade,
  code              text not null,
  name              text not null,
  kind              unit_kind not null,
  is_base           boolean not null default false,
  -- factor to the base unit of the same kind, where the ratio is universal
  -- (1 kg = 1000 g). NULL means the ratio depends on the ingredient
  -- (a paint of rice and a paint of garri are different masses).
  factor_to_base    numeric(18,6),
  created_at        timestamptz not null default now()
);

create unique index on units (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));

-- ============================================================================
-- 4. CATALOG
-- Ingredients and packaging share one table. Both are purchased, both carry
-- price history, both appear on recipes. Splitting them duplicates every
-- mechanism for no gain.
-- ============================================================================

create type item_kind as enum ('ingredient', 'packaging');

create table ingredient_categories (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id) on delete cascade,
  name              text not null
);

create table ingredients (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  kind              item_kind not null default 'ingredient',
  name              text not null,
  category_id       uuid references ingredient_categories(id) on delete set null,
  base_unit_id      uuid not null references units(id),
  -- Purchase yield: usable share after peeling, boning, trimming.
  -- 70 means 1 kg purchased gives 700 g usable.
  purchase_yield_pct numeric(5,2) not null default 100
                     check (purchase_yield_pct > 0 and purchase_yield_pct <= 100),
  shelf_life_days   integer,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- Expression uniqueness must be an index, not an inline table constraint.
create unique index ux_ingredients_account_name
  on ingredients (account_id, lower(name)) where deleted_at is null;

-- Per ingredient local unit conversions. This is what makes
-- "1 paint of rice = 4 kg" possible without corrupting garri.
create table ingredient_unit_conversions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  ingredient_id     uuid not null references ingredients(id) on delete cascade,
  unit_id           uuid not null references units(id) on delete cascade,
  qty_in_base       numeric(18,6) not null check (qty_in_base > 0),
  unique (ingredient_id, unit_id)
);

create table suppliers (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  name              text not null,
  phone             text,
  location          text,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- 5. PRICE HISTORY
-- Append only. Scoped hard to one account. NULL amount is impossible here:
-- a row exists only because a real price was entered. "Not entered" is the
-- ABSENCE of a row, which is how the completeness gate detects it.
-- ============================================================================

create type price_source as enum ('purchase', 'manual', 'benchmark_accepted');

create table ingredient_prices (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  ingredient_id     uuid not null references ingredients(id) on delete cascade,
  supplier_id       uuid references suppliers(id) on delete set null,
  purchase_line_id  uuid,             -- set by trigger when sourced from a purchase
  qty_base          numeric(18,6) not null check (qty_base > 0),
  amount            numeric(14,2) not null check (amount >= 0),
  unit_cost         numeric(18,6) generated always as (amount / qty_base) stored,
  source            price_source not null,        -- NO DEFAULT. Always explicit.
  effective_date    date not null default current_date,
  entered_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index on ingredient_prices (ingredient_id, effective_date desc, created_at desc);
create index on ingredient_prices (account_id);

-- ============================================================================
-- 6. BUSINESS SETTINGS
-- Nothing financial is hard-coded. Every knob lives here.
-- ============================================================================

create type costing_method as enum ('weighted_average', 'fifo');
create type tax_mode as enum ('none', 'inclusive', 'exclusive');

create table business_settings (
  business_id             uuid primary key references businesses(id) on delete cascade,
  account_id              uuid not null references accounts(id) on delete cascade,
  currency                text not null default 'NGN',

  -- Costing. FIFO is accepted here but only takes effect from Phase 2 when
  -- lots exist. MVP computes weighted average over purchase history.
  costing_method          costing_method not null default 'weighted_average',
  wavg_window_days        integer not null default 90 check (wavg_window_days > 0),

  -- Pricing
  default_target_margin   numeric(5,2) not null default 40.00,
  price_rounding_to       numeric(10,2) not null default 50.00,
  show_markup_alongside   boolean not null default true,

  -- Tax
  tax_mode                tax_mode not null default 'none',
  tax_rate                numeric(5,2) not null default 0,

  -- Overhead absorption
  overhead_enabled        boolean not null default false,
  expected_monthly_units  integer,

  -- Phase 2 capability flag, present now so the toggle has a home
  finished_goods_enabled  boolean not null default false,

  updated_at              timestamptz not null default now()
);

-- A costing method change is a dated event, never a silent field update.
-- Historical snapshots keep the method that produced them.
create table costing_method_changes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  from_method       costing_method,
  to_method         costing_method not null,
  effective_from    date not null default current_date,
  changed_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- 7. RECIPES
-- A recipe is either a dish (sold) or a sub recipe (used inside dishes).
-- Sub recipes nest recursively. Completeness propagates up the tree.
-- ============================================================================

create type recipe_kind as enum ('dish', 'sub_recipe');
create type recipe_status as enum ('draft', 'active', 'archived');

create table recipes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  kind              recipe_kind not null default 'dish',
  name              text not null,
  category          text,

  -- What one batch produces, before cooking loss
  batch_yield_qty   numeric(14,3) not null check (batch_yield_qty > 0),
  yield_unit_id     uuid not null references units(id),

  -- Reduction, evaporation, spillage. 92 means 5 L becomes 4.6 L.
  cooking_yield_pct numeric(5,2) not null default 100
                    check (cooking_yield_pct > 0 and cooking_yield_pct <= 100),

  -- Portion sold, expressed in the yield unit
  portion_qty       numeric(14,3) check (portion_qty > 0),

  status            recipe_status not null default 'draft',
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create unique index ux_recipes_business_name
  on recipes (business_id, lower(name)) where deleted_at is null;

create type exclusion_reason as enum
  ('complimentary', 'self_produced', 'negligible', 'counted_elsewhere');

create table recipe_lines (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  recipe_id         uuid not null references recipes(id) on delete cascade,

  -- Exactly one of these two
  ingredient_id     uuid references ingredients(id) on delete restrict,
  sub_recipe_id     uuid references recipes(id) on delete restrict,

  qty               numeric(14,3) not null check (qty > 0),
  unit_id           uuid not null references units(id),

  -- Section 1.6. Never defaults to false. Exemption is deliberate.
  is_cost_bearing   boolean not null default true,
  exclusion_reason  exclusion_reason,

  note              text,

  constraint one_target check (
    (ingredient_id is not null and sub_recipe_id is null) or
    (ingredient_id is null and sub_recipe_id is not null)
  ),
  constraint reason_required_when_excluded check (
    is_cost_bearing or exclusion_reason is not null
  ),
  constraint no_self_reference check (sub_recipe_id is null or sub_recipe_id <> recipe_id)
);

create index on recipe_lines (recipe_id);
create index on recipe_lines (sub_recipe_id);

create table labour_rates (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  name              text not null,
  rate_per_hour     numeric(14,2) check (rate_per_hour >= 0),   -- NULL = not entered
  is_active         boolean not null default true
);

create table recipe_labour (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  recipe_id         uuid not null references recipes(id) on delete cascade,
  labour_rate_id    uuid not null references labour_rates(id) on delete restrict,
  hours             numeric(8,2) not null check (hours >= 0),
  unique (recipe_id, labour_rate_id)
);

create table overhead_items (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  name              text not null,
  monthly_cost      numeric(14,2) check (monthly_cost >= 0),
  is_active         boolean not null default true
);

-- ============================================================================
-- 8. COST RESOLUTION
-- Weighted average over the business's OWN purchase history, inside its own
-- account, within its configured window. Never touches another account.
-- ============================================================================

create or replace function fn_ingredient_unit_cost(
  p_ingredient_id uuid,
  p_business_id   uuid,
  p_as_of         date default current_date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id  uuid;
  v_window      integer;
  v_cost        numeric;
begin
  select account_id, wavg_window_days
    into v_account_id, v_window
  from business_settings where business_id = p_business_id;

  if v_account_id is null then
    return null;
  end if;

  -- Weighted average within the window, scoped to this account only
  select sum(amount) / nullif(sum(qty_base), 0)
    into v_cost
  from ingredient_prices
  where ingredient_id = p_ingredient_id
    and account_id    = v_account_id
    and effective_date <= p_as_of
    and effective_date >  p_as_of - (v_window || ' days')::interval;

  -- Fall back to the most recent price on record, still same account
  if v_cost is null then
    select unit_cost into v_cost
    from ingredient_prices
    where ingredient_id = p_ingredient_id
      and account_id    = v_account_id
      and effective_date <= p_as_of
    order by effective_date desc, created_at desc
    limit 1;
  end if;

  -- NULL means not entered. It is never coalesced to zero.
  return v_cost;
end;
$$;

-- ============================================================================
-- 9. COST SNAPSHOTS
-- Versioned, immutable, and carrying the completeness gate. A snapshot with
-- is_complete = false is structurally incapable of yielding a margin,
-- a recommended price, or a dashboard figure.
-- ============================================================================

create table cost_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references accounts(id) on delete cascade,
  business_id           uuid not null references businesses(id) on delete cascade,
  recipe_id             uuid not null references recipes(id) on delete cascade,
  computed_at           timestamptz not null default now(),
  costing_method        costing_method not null,
  wavg_window_days      integer,

  -- Completeness gate, Section 1.6
  is_complete           boolean not null,
  required_inputs       integer not null,
  priced_inputs         integer not null,
  excluded_inputs       integer not null default 0,
  unpriced_items        jsonb not null default '[]'::jsonb,

  -- Cost stack. On an incomplete snapshot these are the FLOOR, not the cost.
  ingredient_cost       numeric(18,4),
  packaging_cost        numeric(18,4),
  labour_cost           numeric(18,4),
  overhead_cost         numeric(18,4),
  batch_cost            numeric(18,4),
  cost_per_yield_unit   numeric(18,6),
  cost_per_portion      numeric(18,4),

  created_by            uuid references auth.users(id) on delete set null
);

create index on cost_snapshots (recipe_id, computed_at desc);

-- Snapshots are immutable. Recompute writes a new row.
create or replace function fn_block_snapshot_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'cost_snapshots is append only. Recompute instead of editing.';
end;
$$;

create trigger trg_cost_snapshots_immutable
  before update or delete on cost_snapshots
  for each row execute function fn_block_snapshot_mutation();

-- Latest snapshot per recipe
create view v_recipe_cost_current with (security_invoker = on) as
select distinct on (recipe_id) *
from cost_snapshots
order by recipe_id, computed_at desc;

-- ============================================================================
-- 10. PRICING
-- ============================================================================

create table channels (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  name              text not null,
  commission_pct    numeric(5,2) not null default 0,
  target_margin     numeric(5,2),        -- null falls back to business default
  is_default        boolean not null default false,
  is_active         boolean not null default true
);

create unique index ux_channels_business_name
  on channels (business_id, lower(name));

-- Selling price history. Append only, so last month's margin stays true.
create table recipe_prices (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  recipe_id         uuid not null references recipes(id) on delete cascade,
  channel_id        uuid references channels(id) on delete cascade,
  price             numeric(14,2) not null check (price >= 0),
  effective_from    date not null default current_date,
  set_by            uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index on recipe_prices (recipe_id, channel_id, effective_from desc);

-- Price Check. Margin, profit and recommended price are NULL unless the
-- underlying snapshot is complete. The gate lives here, not in the UI.
create view v_price_check with (security_invoker = on) as
select
  r.id                        as recipe_id,
  r.business_id,
  r.name,
  s.is_complete,
  s.required_inputs,
  s.priced_inputs,
  s.excluded_inputs,
  s.unpriced_items,
  s.cost_per_portion          as cost_or_floor,
  case when s.is_complete then s.cost_per_portion end as cost_per_portion,
  p.price                     as selling_price,
  case when s.is_complete and p.price is not null
       then round(p.price - s.cost_per_portion, 2) end as profit,
  case when s.is_complete and p.price is not null and p.price > 0
       then round(100.0 * (p.price - s.cost_per_portion) / p.price, 2) end as margin_pct,
  case when s.is_complete and s.cost_per_portion > 0
       then round(
         ceil(
           (s.cost_per_portion / nullif(1 - coalesce(c.target_margin, bs.default_target_margin) / 100.0, 0))
           / bs.price_rounding_to
         ) * bs.price_rounding_to
       , 2) end as recommended_price,
  coalesce(c.target_margin, bs.default_target_margin) as target_margin
from recipes r
join business_settings bs on bs.business_id = r.business_id
left join v_recipe_cost_current s on s.recipe_id = r.id
left join channels c on c.business_id = r.business_id and c.is_default
left join lateral (
  select price from recipe_prices rp
  where rp.recipe_id = r.id
    and (rp.channel_id is null or rp.channel_id = c.id)
    and rp.effective_from <= current_date
  order by rp.effective_from desc, rp.created_at desc
  limit 1
) p on true
where r.kind = 'dish' and r.deleted_at is null;

-- ============================================================================
-- 11. PURCHASES (Level 2)
-- Recording a purchase writes an ingredient_price row with source='purchase'.
-- Phase 2 will add lots against these same purchase lines.
-- ============================================================================

create table purchases (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  location_id       uuid references locations(id) on delete set null,
  supplier_id       uuid references suppliers(id) on delete set null,
  purchase_date     date not null default current_date,
  reference         text,
  note              text,
  reversed_by       uuid references purchases(id),   -- corrections are reversals
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create table purchase_lines (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  purchase_id       uuid not null references purchases(id) on delete cascade,
  ingredient_id     uuid not null references ingredients(id) on delete restrict,
  qty               numeric(14,3) not null check (qty > 0),
  unit_id           uuid not null references units(id),
  qty_base          numeric(18,6) not null check (qty_base > 0),
  amount            numeric(14,2) not null check (amount >= 0)
);

-- ============================================================================
-- 12. SALES (Level 2)
-- Two modes, both supported: order level, or daily totals per dish.
-- Both freeze the cost snapshot in force at the moment of sale, which is
-- what makes theoretical COGS reproducible a year later.
-- ============================================================================

create table customers (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  name              text not null,
  phone             text,
  email             text,
  created_at        timestamptz not null default now()
);

create type order_status as enum ('draft', 'confirmed', 'delivered', 'cancelled');
create type payment_status as enum ('unpaid', 'part_paid', 'paid');

create table orders (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  location_id       uuid references locations(id) on delete set null,
  customer_id       uuid references customers(id) on delete set null,
  channel_id        uuid references channels(id) on delete set null,
  order_no          text,
  order_date        date not null default current_date,
  status            order_status not null default 'confirmed',
  payment_status    payment_status not null default 'unpaid',
  amount_paid       numeric(14,2) not null default 0,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (business_id, order_no)
);

create table order_lines (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  order_id          uuid not null references orders(id) on delete cascade,
  recipe_id         uuid references recipes(id) on delete set null,
  description       text,
  qty               numeric(14,3) not null check (qty > 0),
  unit_price        numeric(14,2) not null check (unit_price >= 0),
  line_total        numeric(14,2) generated always as (qty * unit_price) stored,
  -- Frozen at sale time. NULL when the recipe cost was incomplete, which
  -- means this line contributes revenue but not COGS, and says so.
  cost_snapshot_id  uuid references cost_snapshots(id) on delete set null,
  unit_cost_at_sale numeric(18,4)
);

-- Daily totals mode for businesses that do not record individual orders
create table sales_entries (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  location_id       uuid references locations(id) on delete set null,
  channel_id        uuid references channels(id) on delete set null,
  sale_date         date not null default current_date,
  recipe_id         uuid references recipes(id) on delete set null,
  qty               numeric(14,3) not null check (qty > 0),
  unit_price        numeric(14,2) not null check (unit_price >= 0),
  cost_snapshot_id  uuid references cost_snapshots(id) on delete set null,
  unit_cost_at_sale numeric(18,4),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index on sales_entries (business_id, sale_date);

-- ============================================================================
-- 13. PROFITABILITY (Level 2, theoretical COGS)
-- Revenue always counts. COGS counts only where a complete cost existed at
-- the time of sale. Coverage is reported so the owner can see how much of
-- their revenue has a trustworthy cost behind it.
-- ============================================================================

create view v_sales_unified with (security_invoker = on) as
select
  o.business_id, o.order_date as sale_date, ol.recipe_id,
  ol.qty, ol.unit_price, ol.line_total as revenue,
  ol.unit_cost_at_sale, ol.cost_snapshot_id
from order_lines ol
join orders o on o.id = ol.order_id
where o.status <> 'cancelled'
union all
select
  se.business_id, se.sale_date, se.recipe_id,
  se.qty, se.unit_price, se.qty * se.unit_price,
  se.unit_cost_at_sale, se.cost_snapshot_id
from sales_entries se;

create view v_profit_by_period with (security_invoker = on) as
select
  business_id,
  date_trunc('month', sale_date)::date as period,
  sum(revenue) as revenue,
  sum(case when unit_cost_at_sale is not null then qty * unit_cost_at_sale end) as cogs,
  sum(revenue) - coalesce(sum(case when unit_cost_at_sale is not null
                                   then qty * unit_cost_at_sale end), 0) as gross_profit,
  round(100.0 * (sum(revenue) - coalesce(sum(case when unit_cost_at_sale is not null
                                   then qty * unit_cost_at_sale end), 0))
        / nullif(sum(revenue), 0), 2) as gross_margin_pct,
  -- Share of revenue backed by a complete cost. Below 100 percent the
  -- profit figure must be shown as partial.
  round(100.0 * sum(case when unit_cost_at_sale is not null then revenue else 0 end)
        / nullif(sum(revenue), 0), 2) as cost_coverage_pct
from v_sales_unified
group by business_id, date_trunc('month', sale_date);

create view v_profit_by_product with (security_invoker = on) as
select
  s.business_id,
  s.recipe_id,
  r.name,
  sum(s.qty) as units_sold,
  sum(s.revenue) as revenue,
  sum(case when s.unit_cost_at_sale is not null then s.qty * s.unit_cost_at_sale end) as cogs,
  sum(s.revenue) - coalesce(sum(case when s.unit_cost_at_sale is not null
                                     then s.qty * s.unit_cost_at_sale end), 0) as gross_profit
from v_sales_unified s
join recipes r on r.id = s.recipe_id
group by s.business_id, s.recipe_id, r.name;

-- Frozen period figures. A closed period never silently changes.
create table period_closes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null references businesses(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  revenue           numeric(16,2) not null,
  cogs              numeric(16,2),
  gross_profit      numeric(16,2),
  gross_margin_pct  numeric(6,2),
  cost_coverage_pct numeric(6,2),
  closed_at         timestamptz not null default now(),
  closed_by         uuid references auth.users(id) on delete set null,
  unique (business_id, period_start, period_end)
);

-- ============================================================================
-- 14. ROW LEVEL SECURITY
-- Not optional. Without it the anon key reads every account in the database.
-- ============================================================================

create or replace function fn_is_account_member(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where account_id = p_account_id and user_id = auth.uid()
  );
$$;

create or replace function fn_can_see_costs()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and role in ('owner','manager','accountant')
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','accounts','businesses','locations','memberships','subscriptions',
    'units','ingredient_categories','ingredients','ingredient_unit_conversions',
    'suppliers','ingredient_prices','business_settings','costing_method_changes',
    'recipes','recipe_lines','labour_rates','recipe_labour','overhead_items',
    'cost_snapshots','channels','recipe_prices','purchases','purchase_lines',
    'customers','orders','order_lines','sales_entries','period_closes'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy p_profiles on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy p_accounts on accounts
  for select using (fn_is_account_member(id));

-- Every account scoped table shares one policy shape
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','locations','memberships','subscriptions',
    'ingredient_categories','ingredients','ingredient_unit_conversions',
    'suppliers','business_settings','costing_method_changes',
    'recipes','recipe_lines','labour_rates','recipe_labour','overhead_items',
    'channels','recipe_prices','purchases','purchase_lines',
    'customers','orders','order_lines','sales_entries','period_closes'
  ]
  loop
    execute format(
      'create policy p_%I on %I for all
         using (fn_is_account_member(account_id))
         with check (fn_is_account_member(account_id))', t, t);
  end loop;
end $$;

-- Units: global rows readable by all, account rows scoped
create policy p_units_read on units
  for select using (account_id is null or fn_is_account_member(account_id));
create policy p_units_write on units
  for all using (account_id is not null and fn_is_account_member(account_id))
  with check (account_id is not null and fn_is_account_member(account_id));

-- Costs are hidden from kitchen and sales roles
create policy p_ingredient_prices on ingredient_prices
  for all using (fn_is_account_member(account_id) and fn_can_see_costs())
  with check (fn_is_account_member(account_id) and fn_can_see_costs());

create policy p_cost_snapshots on cost_snapshots
  for all using (fn_is_account_member(account_id) and fn_can_see_costs())
  with check (fn_is_account_member(account_id) and fn_can_see_costs());

create policy p_plans on plans for select using (true);
create policy p_plan_features on plan_features for select using (true);
alter table plans enable row level security;
alter table plan_features enable row level security;

-- ============================================================================
-- 15. SOURCE OF TRUTH TEST
-- Run in CI. Must return zero rows, forever.
-- Any ingredient_price whose account does not match its ingredient's account
-- is a contamination bug.
-- ============================================================================

-- select p.id from ingredient_prices p
-- join ingredients i on i.id = p.ingredient_id
-- where p.account_id <> i.account_id;
