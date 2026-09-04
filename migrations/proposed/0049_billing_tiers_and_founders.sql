-- ============================================================================
-- MENU MASTER NG
-- 0049: billing tiers, founding pricing, and the Costing / Costing+Sales split
--
-- Authority: owner decisions of 2026-09-04.
--   Standard  Costing N7,500/mo   Costing + Sales N15,000/mo
--   Founding  Costing N3,500/mo   Costing + Sales  N7,500/mo   (first 100 only)
--   Monthly only in V1. No quarterly, biannual or annual.
--   The 14-day trial includes the FULL product, Sales included.
--   A forfeited founder slot NEVER returns to the pool.
--
-- Requires: 0001-0048 applied.
--
-- THE DEFECT THIS CORRECTS
--   plan_features carries a `level` of 1 for costing and 2 for trading, and
--   NOTHING READS IT. Entitlement is binary: fn_account_is_entitled asks only
--   whether the account has paid at all. A Costing subscriber at N7,500 gets
--   the identical product to a Costing + Sales subscriber at N15,000, so the
--   two tiers cannot be sold as different things.
--
-- WHAT THIS DOES NOT DO
--   No checkout, no Paystack call, no payment path. This migration builds the
--   entitlement foundation ONLY, deliberately, so it can be proven while
--   nobody is able to pay. Prices are recorded here; charging them is later
--   work behind its own gate.
--
-- MONEY IS INTEGER KOBO
--   Paystack transacts in kobo. plans.price_kobo is the authority for what an
--   account is charged; plans.monthly_price stays for display only. Integers
--   remove rounding from money entirely.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN IN AN EXECUTOR THAT DOES NOT HONOUR TRANSACTION CONTROL
--
-- The Supabase SQL Editor commits every statement individually and halts at the
-- first error. That is how a previous deployment left production part-migrated.
-- A BEGIN at the top of the file does not help: the editor ignores it.
--
-- Two statements in one transaction share one xid. Under autocommit they do
-- not. This costs nothing, runs before a single object is touched, and makes
-- the wrong executor abort instead of half-applying the migration.
-- ---------------------------------------------------------------------------
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0049 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Do NOT run 0049 here. Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_account_is_entitled'
                   and pronamespace = 'public'::regnamespace) then
    raise exception '0049 preflight FAILED: fn_account_is_entitled is missing (0018).';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='plans') then
    raise exception '0049 preflight FAILED: plans is missing.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_name='plans' and column_name='price_kobo') then
    raise exception '0049 preflight FAILED: plans.price_kobo already exists.';
  end if;
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='founder_slots') then
    raise exception '0049 preflight FAILED: founder_slots already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 116 then
    raise exception '0049 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. What a plan GRANTS, and what it COSTS -- two different things
--
-- tier decides entitlement. price_tier decides price. Separating them is what
-- lets a founder pay N3,500 and still receive exactly the Costing product,
-- and it keeps one plans row per Paystack Plan so provider_plan_code stays a
-- single column.
-- ---------------------------------------------------------------------------
alter table plans add column tier       text not null default 'costing';
alter table plans add column price_tier text not null default 'standard';
alter table plans add column price_kobo integer not null default 0;

alter table plans add constraint plans_tier_check
  check (tier in ('trial','costing','trading'));
alter table plans add constraint plans_price_tier_check
  check (price_tier in ('trial','standard','founding'));
alter table plans add constraint plans_price_kobo_check
  check (price_kobo >= 0);

update plans set tier='trial',   price_tier='trial',    price_kobo=0       where id='trial';
update plans set tier='costing', price_tier='standard', price_kobo=750000  where id='costing';
update plans set tier='trading', price_tier='standard', price_kobo=1500000 where id='trading';

insert into plans (id, name, monthly_price, currency, is_active, is_self_serve_trial,
                   tier, price_tier, price_kobo)
values ('founding_costing', 'Founding Costing',         3500,  'NGN', true, false,
        'costing', 'founding', 350000),
       ('founding_trading', 'Founding Costing + Sales', 7500,  'NGN', true, false,
        'trading', 'founding', 750000);

update plans set monthly_price = price_kobo / 100.0 where id in ('costing','trading');

-- founding plans grant exactly what their standard counterpart grants
insert into plan_features (plan_id, feature_key, limit_value, is_enabled)
select 'founding_costing', feature_key, limit_value, is_enabled
  from plan_features where plan_id='costing';
insert into plan_features (plan_id, feature_key, limit_value, is_enabled)
select 'founding_trading', feature_key, limit_value, is_enabled
  from plan_features where plan_id='trading';

comment on column plans.tier is
  'What the plan GRANTS: trial and trading include Sales, costing does not. '
  'Read by fn_account_has_sales. Never infer entitlement from price.';
comment on column plans.price_kobo is
  'The authority for what an account is charged, in integer kobo. '
  'monthly_price is display only.';

-- ---------------------------------------------------------------------------
-- 2. The first hundred, as a data invariant
--
-- The cap is NOT a count(*) < 100 check, which two concurrent claimants can
-- both pass. Exactly one hundred rows exist and no more can be created, so
-- customer 101 cannot be sold founding pricing however the race falls.
-- ---------------------------------------------------------------------------
create table founder_slots (
  seq            integer primary key check (seq between 1 and 100),
  account_id     uuid unique references accounts(id) on delete set null,
  reserved_until timestamptz,
  claimed_at     timestamptz,
  forfeited_at   timestamptz,
  created_at     timestamptz not null default now(),
  -- a slot cannot be claimed without an account, nor forfeited unclaimed
  constraint founder_slots_claim_needs_account
    check (claimed_at is null or account_id is not null),
  constraint founder_slots_forfeit_needs_claim
    check (forfeited_at is null or claimed_at is not null)
);

insert into founder_slots (seq) select generate_series(1,100);

alter table founder_slots enable row level security;
-- Read-only to signed-in users so the checkout page can say how many remain.
-- Nobody may write: allocation happens only through fn_claim_founder_slot,
-- which is SECURITY DEFINER.
create policy p_founder_slots_select on founder_slots for select
  using (auth.uid() is not null);
grant select on founder_slots to authenticated;

comment on table founder_slots is
  'Exactly 100 rows, seeded once. The founding-price cap is the row count '
  'itself, not a computed check, so no race can create a 101st founder. '
  'A forfeited slot is NEVER returned to the pool -- owner decision 2026-09-04.';

-- ---------------------------------------------------------------------------
-- 3. What the subscription actually costs, and who it is at the provider
--
-- provider_ref is one column doing three jobs (transaction reference, event
-- id, subscription code). Paystack needs the customer code and the
-- subscription code separately to disable or re-enable a subscription.
--
-- price_kobo on the subscription LOCKS the founding price: a later change to
-- plans.price_kobo cannot silently re-price an existing founder.
-- ---------------------------------------------------------------------------
alter table subscriptions add column price_kobo                integer;
alter table subscriptions add column provider_customer_code    text;
alter table subscriptions add column provider_subscription_code text;
alter table subscriptions add column cancel_at_period_end      boolean not null default false;
alter table subscriptions add column founding_price_active     boolean not null default false;
alter table subscriptions add constraint subscriptions_price_kobo_check
  check (price_kobo is null or price_kobo >= 0);

comment on column subscriptions.price_kobo is
  'What this account is actually charged, in kobo, fixed at the moment the '
  'subscription was created. Protects a founder from a later price change.';

-- ---------------------------------------------------------------------------
-- 4. The founding-price rule, written down once
--
-- Modelled explicitly as data rather than inferred from behaviour, so the
-- commercial rule can be read, audited and changed without reading PL/pgSQL.
-- ---------------------------------------------------------------------------
create table founding_price_policy (
  effective_from       timestamptz not null default now(),
  forfeit_on_lapse     boolean not null,
  slot_returns_to_pool boolean not null,
  authorised_by        text not null,
  reason               text not null,
  created_at           timestamptz not null default now(),
  primary key (effective_from)
);

insert into founding_price_policy
  (forfeit_on_lapse, slot_returns_to_pool, authorised_by, reason)
values (true, false, 'owner decision 2026-09-04',
        'Founding price is held only while the founding subscription remains '
        'continuously subscribed. It is forfeited when entitlement lapses -- '
        'past_due beyond grace, or cancelled past current_period_end. Founder '
        'status is retained historically with forfeited_at set, and the slot '
        'is NEVER returned to the pool: the founding offer belongs to the '
        'first 100 businesses that became founding subscribers.');

alter table founding_price_policy enable row level security;
-- no policy: service context only, like billing_config

-- ---------------------------------------------------------------------------
-- 5. THE ENTITLEMENT SPLIT
--
-- fn_account_is_entitled answers "has this account paid at all". It is
-- unchanged, and the 69 policies that call it are unchanged.
--
-- fn_account_has_sales answers "has this account paid for SALES". Only the
-- Sales write policies consult it. Reads are deliberately NOT gated: an
-- account that downgrades from Costing + Sales keeps reading its own trading
-- history, it simply cannot record anything new. Losing sight of your own
-- past sales because you changed plan would be indefensible.
-- ---------------------------------------------------------------------------
create or replace function fn_account_has_sales(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  -- SECURITY DEFINER taking an account id, so it answers only to a member of
  -- that account (or to the service context). Every calling policy already
  -- requires membership, which makes this redundant there and deliberately so:
  -- the function must be safe when it is called directly, not only safe in the
  -- one place it happens to be called from today. tests/034 asserts this rule
  -- over every definer function; fn_account_has_sales is not exempt from it.
  select (fn_is_service_context() or fn_is_account_member(p_account_id))
     and fn_account_is_entitled(p_account_id)
     and exists (
       select 1
         from subscriptions s
         join plans p on p.id = s.plan_id
        where s.account_id = p_account_id
          -- trial includes the full product, Sales included, for its 14 days.
          -- When the trial lapses fn_account_is_entitled above is already
          -- false, so an expired trial writes nothing.
          and p.tier in ('trading','trial')
     );
$fn$;

comment on function fn_account_has_sales(uuid) is
  'Whether the CALLER''s account has paid for the Sales tier. Consulted ONLY '
  'by the thirteen Sales write policies. Returns false to a non-member, so it '
  'cannot be used to read another business''s plan. Reads stay governed by '
  'fn_account_is_entitled so history survives a downgrade.';

revoke all on function fn_account_has_sales(uuid) from public, anon;
grant execute on function fn_account_has_sales(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Founder slot allocation, safe under concurrency
--
-- FOR UPDATE SKIP LOCKED makes concurrent claimants take DIFFERENT rows
-- instead of queueing on the same one; the unique index on account_id stops
-- one account holding two. When no row is free the function returns null and
-- the caller must fall back to standard pricing -- it never invents a slot.
-- ---------------------------------------------------------------------------
create or replace function fn_claim_founder_slot(p_account_id uuid, p_hold interval default '30 minutes')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_seq integer;
begin
  if not fn_is_service_context() then
    raise exception 'fn_claim_founder_slot is a service-context function'
      using errcode = '42501';
  end if;

  -- already holding one? return it rather than consuming a second
  select seq into v_seq from founder_slots
   where account_id = p_account_id and forfeited_at is null;
  if found then return v_seq; end if;

  update founder_slots
     set account_id = p_account_id,
         reserved_until = now() + p_hold
   where seq = (
     select seq from founder_slots
      where account_id is null
         or (claimed_at is null and reserved_until is not null and reserved_until < now())
      order by seq
        for update skip locked
      limit 1)
  returning seq into v_seq;

  return v_seq;   -- null when the hundred are gone
end;
$fn$;

create or replace function fn_confirm_founder_slot(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_seq integer;
begin
  if not fn_is_service_context() then
    raise exception 'fn_confirm_founder_slot is a service-context function'
      using errcode = '42501';
  end if;
  update founder_slots
     set claimed_at = coalesce(claimed_at, now()), reserved_until = null
   where account_id = p_account_id and forfeited_at is null
  returning seq into v_seq;
  return v_seq;
end;
$fn$;

create or replace function fn_forfeit_founding_price(p_account_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_forfeit boolean; v_hit boolean := false;
begin
  if not fn_is_service_context() then
    raise exception 'fn_forfeit_founding_price is a service-context function'
      using errcode = '42501';
  end if;

  select forfeit_on_lapse into v_forfeit from founding_price_policy
   order by effective_from desc limit 1;
  if not coalesce(v_forfeit, true) then return false; end if;

  -- The slot is marked forfeited and KEPT. It is not cleared and not reissued:
  -- slot_returns_to_pool is false, so customer 101 can never inherit it.
  update founder_slots
     set forfeited_at = now()
   where account_id = p_account_id and claimed_at is not null and forfeited_at is null;
  v_hit := found;

  update subscriptions set founding_price_active = false
   where account_id = p_account_id and founding_price_active;

  return v_hit;
end;
$fn$;

revoke all on function fn_claim_founder_slot(uuid, interval)   from public, anon;
revoke all on function fn_confirm_founder_slot(uuid)           from public, anon;
revoke all on function fn_forfeit_founding_price(uuid, text)   from public, anon;

comment on function fn_claim_founder_slot(uuid, interval) is
  'Reserves one of the hundred founder slots, or returns null when none is '
  'free. FOR UPDATE SKIP LOCKED so concurrent claimants take different rows.';

-- ---------------------------------------------------------------------------
-- 7. THE THIRTEEN SALES WRITE POLICIES
--
-- Each is dropped and recreated with its ORIGINAL role list intact and one
-- extra conjunct: fn_account_has_sales(account_id). Nothing else changes.
-- The five SELECT policies on these tables are deliberately untouched.
-- ---------------------------------------------------------------------------

-- orders
drop policy p_orders_insert on orders;
create policy p_orders_insert on orders for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_orders_update on orders;
create policy p_orders_update on orders for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_orders_delete on orders;
create policy p_orders_delete on orders for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));

-- order_lines
drop policy p_order_lines_insert on order_lines;
create policy p_order_lines_insert on order_lines for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_order_lines_update on order_lines;
create policy p_order_lines_update on order_lines for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_order_lines_delete on order_lines;
create policy p_order_lines_delete on order_lines for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));

-- customers
drop policy p_customers_insert on customers;
create policy p_customers_insert on customers for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_customers_update on customers;
create policy p_customers_update on customers for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_customers_delete on customers;
create policy p_customers_delete on customers for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));

-- channels
drop policy p_channels_insert on channels;
create policy p_channels_insert on channels for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_channels_update on channels;
create policy p_channels_update on channels for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));
drop policy p_channels_delete on channels;
create policy p_channels_delete on channels for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));

-- sales_entries
drop policy p_sales_entries_insert on sales_entries;
create policy p_sales_entries_insert on sales_entries for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id) and fn_account_has_sales(account_id));

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_pol int; v_gated int; v_slots int; v_left text;
begin
  -- 116 before, plus exactly one new read-only policy on founder_slots.
  select count(*) into v_pol from pg_policies where schemaname='public';
  if v_pol <> 117 then
    raise exception '0049 self-check FAILED: policy count is % (expected 117 = 116 + founder_slots).', v_pol;
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='founder_slots') <> 1 then
    raise exception '0049 self-check FAILED: founder_slots must carry exactly one policy.';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename <> 'founder_slots') <> 116 then
    raise exception '0049 self-check FAILED: the pre-existing 116 policies changed in number.';
  end if;

  select count(*) into v_gated from pg_policies
   where schemaname='public' and cmd <> 'SELECT'
     and tablename in ('orders','order_lines','customers','channels','sales_entries')
     and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%';
  if v_gated <> 13 then
    raise exception '0049 self-check FAILED: % of 13 Sales write policies gated.', v_gated;
  end if;

  select count(*) into v_gated from pg_policies
   where schemaname='public' and cmd = 'SELECT'
     and tablename in ('orders','order_lines','customers','channels','sales_entries')
     and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%';
  if v_gated <> 0 then
    raise exception '0049 self-check FAILED: % SELECT policies were gated; reads must stay open.', v_gated;
  end if;

  select count(*) into v_slots from founder_slots;
  if v_slots <> 100 then
    raise exception '0049 self-check FAILED: % founder slots, expected exactly 100.', v_slots;
  end if;

  select string_agg(id, ', ') into v_left from plans
   where is_active and price_tier <> 'trial' and price_kobo = 0;
  if v_left is not null then
    raise exception '0049 self-check FAILED: active paid plans still priced at zero: %', v_left;
  end if;

  if (select price_kobo from plans where id='costing')          <> 750000
  or (select price_kobo from plans where id='trading')          <> 1500000
  or (select price_kobo from plans where id='founding_costing') <> 350000
  or (select price_kobo from plans where id='founding_trading') <> 750000 then
    raise exception '0049 self-check FAILED: plan prices do not match the approved model.';
  end if;

  if (select count(*) from plans where tier='trading' and is_active) <> 2 then
    raise exception '0049 self-check FAILED: expected exactly 2 active Sales-granting plans.';
  end if;

  raise notice '0049 OK: 13 Sales write policies gated, 5 SELECT policies untouched, '
               '100 founder slots seeded, the pre-existing 116 policies unchanged.';
end
$$;
