-- ============================================================================
-- MENU MASTER NG
-- 0014: sales void-and-reissue, and revenue immutability
--
-- GATE 1 CLOSURE, item A2.
--
-- THE DEFECT
--   fn_guard_frozen_cost (0009) protects cost_snapshot_id and
--   unit_cost_at_sale, and nothing else. order_lines.unit_price, qty and
--   recipe_id stayed freely editable after a sale, and lines could be inserted
--   or deleted at will. COGS was frozen; revenue was not. Historical gross
--   profit could therefore be rewritten after the fact, which defeats the
--   entire purpose of freezing cost in the first place.
--
-- THE RULE (founder ruling C3)
--   Corrections are void-and-reissue. The original sale is preserved, its
--   reversal is recorded with a reason and an actor, and a corrected
--   replacement is issued. History is never silently rewritten.
--
-- WHY NO NEW ENUM VALUE
--   Adding 'voided' to order_status would need ALTER TYPE ... ADD VALUE, which
--   Postgres refuses to use in the transaction that created it -- the exact
--   hazard that forces 0002 to run alone. Lifecycle is carried on explicit
--   columns instead. This also keeps 'voided' distinct from the existing
--   'cancelled', which means something different: cancelled = the order never
--   happened; voided = a recognised sale was later reversed.
--
-- WHY FINALISATION IS OPT-IN
--   Orders default to status 'confirmed' and the recovered baseline suites
--   create orders and then add lines to them. Making finalisation automatic
--   would block those inserts and regress the verified 80/80 baseline, which
--   is not permitted. finalised_at therefore defaults to NULL and the
--   immutability guards engage only once fn_finalise_order is called.
--   sales_entries have no draft stage and are immutable from insert.
--   See docs/GATE1_CLOSURE_REPORT.md for the residual this leaves.
--
-- ADDITIVE. No earlier migration is rewritten. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. KEYS AND COLUMNS
-- ----------------------------------------------------------------------------

-- sales_entries was not in 0004's composite-key list, so it needs the
-- (id, account_id) key before a same-account self reference can be enforced.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='ux_sales_entries_id_account') then
    alter table sales_entries add constraint ux_sales_entries_id_account unique (id, account_id);
  end if;
end $$;

alter table orders
  add column if not exists finalised_at timestamptz,
  add column if not exists finalised_by uuid references auth.users(id) on delete set null,
  add column if not exists voided_at    timestamptz,
  add column if not exists voided_by    uuid references auth.users(id) on delete set null,
  add column if not exists void_reason  text,
  add column if not exists replaces     uuid;

alter table sales_entries
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text,
  add column if not exists replaces    uuid;

-- Cross-account containment, same discipline as 0004's 37 composite keys.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='fk_orders_replaces_account') then
    alter table orders add constraint fk_orders_replaces_account
      foreign key (replaces, account_id) references orders (id, account_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='fk_sales_entries_replaces_account') then
    alter table sales_entries add constraint fk_sales_entries_replaces_account
      foreign key (replaces, account_id) references sales_entries (id, account_id);
  end if;
end $$;

comment on column orders.finalised_at is
  'Once set, revenue on this order is immutable. Corrections go through '
  'fn_void_order + fn_reissue_order, never through an UPDATE.';
comment on column orders.replaces is
  'For a reissued order: the voided order it corrects.';

create index if not exists ix_orders_open      on orders (business_id) where voided_at is null;
create index if not exists ix_sales_entries_open on sales_entries (business_id, sale_date) where voided_at is null;

-- ----------------------------------------------------------------------------
-- 2. LIFECYCLE FUNCTIONS
--
-- Authorization follows the 0012 rule without exception: the owning account is
-- derived from the target row's own relational chain, never from a parameter
-- the caller supplied.
-- ----------------------------------------------------------------------------

-- Finalising is a sales-desk act: owner, manager or sales.
create or replace function fn_finalise_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_o orders%rowtype; v_lines integer;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'finalising orders');

  if v_o.voided_at is not null then
    raise exception 'Order % is voided and cannot be finalised', p_order_id
      using errcode='check_violation';
  end if;
  if v_o.finalised_at is not null then
    raise exception 'Order % is already finalised', p_order_id
      using errcode='check_violation';
  end if;

  select count(*) into v_lines from order_lines where order_id = p_order_id;
  if v_lines = 0 then
    raise exception 'Order % has no lines', p_order_id using errcode='check_violation';
  end if;

  update orders set finalised_at = now(), finalised_by = auth.uid() where id = p_order_id;

  return jsonb_build_object('finalised', true, 'order_id', p_order_id, 'lines', v_lines);
end;
$$;

-- Voiding reverses recognised revenue. Owner or manager only, matching
-- fn_reverse_purchase. Accountant is deliberately excluded here: founder ruling
-- C3 forbids the accountant rewriting finalised historical sales.
create or replace function fn_void_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_o orders%rowtype;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager']::member_role[], 'voiding sales');

  if v_o.finalised_at is null then
    raise exception 'Only a finalised order can be voided. Delete the draft instead.'
      using errcode='check_violation';
  end if;
  if v_o.voided_at is not null then
    raise exception 'Order % is already voided', p_order_id using errcode='check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A void requires a reason' using errcode='check_violation';
  end if;

  update orders
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_order_id;

  return jsonb_build_object('voided', true, 'order_id', p_order_id, 'reason', btrim(p_reason));
end;
$$;

-- The replacement is created EMPTY on purpose. Copying the lines would carry
-- the mistake forward; the corrected figures must be entered deliberately.
create or replace function fn_reissue_order(p_voided_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_o orders%rowtype; v_new uuid; v_no text; v_n integer := 1;
begin
  select * into v_o from orders where id = p_voided_order_id for update;
  if not found then raise exception 'Order % not found', p_voided_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'reissuing orders');

  if v_o.voided_at is null then
    raise exception 'Only a voided order can be reissued' using errcode='check_violation';
  end if;

  -- orders carries unique (business_id, order_no), so the replacement needs a
  -- distinct reference. -R, -R2, -R3 ... until one is free.
  if v_o.order_no is not null then
    v_no := v_o.order_no || '-R';
    while exists (select 1 from orders where business_id = v_o.business_id and order_no = v_no) loop
      v_n := v_n + 1;
      v_no := v_o.order_no || '-R' || v_n;
    end loop;
  end if;

  insert into orders (account_id, business_id, location_id, customer_id, channel_id,
                      order_no, order_date, status, created_by, replaces)
  values (v_o.account_id, v_o.business_id, v_o.location_id, v_o.customer_id, v_o.channel_id,
          v_no, current_date, 'draft', auth.uid(), v_o.id)
  returning id into v_new;

  return jsonb_build_object('reissued', true,
    'replaces', p_voided_order_id, 'new_order_id', v_new, 'order_no', v_no,
    'next_step', 'add_corrected_lines_then_finalise');
end;
$$;

-- sales_entries are immutable from insert: there is no draft stage to correct in.
create or replace function fn_void_sales_entry(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_e sales_entries%rowtype;
begin
  select * into v_e from sales_entries where id = p_entry_id for update;
  if not found then raise exception 'Sales entry % not found', p_entry_id; end if;

  perform fn_require_account_role(v_e.account_id,
    array['owner','manager']::member_role[], 'voiding sales');

  if v_e.voided_at is not null then
    raise exception 'Sales entry % is already voided', p_entry_id using errcode='check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A void requires a reason' using errcode='check_violation';
  end if;

  update sales_entries
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_entry_id;

  return jsonb_build_object('voided', true, 'sales_entry_id', p_entry_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. IMMUTABILITY GUARDS
-- ----------------------------------------------------------------------------

create or replace function fn_guard_finalised_order()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.finalised_at is not null then
      raise exception 'Order % is finalised and cannot be deleted. Void it instead.', old.id
        using errcode='check_violation';
    end if;
    return old;
  end if;

  if old.voided_at is not null then
    raise exception 'Order % is voided. Its record is closed.', old.id
      using errcode='check_violation';
  end if;

  if old.finalised_at is not null then
    -- Settlement may still move after the sale: collecting payment later is not
    -- a revenue rewrite. Everything that determines revenue is frozen.
    if (old.account_id, old.business_id, old.location_id, old.customer_id,
        old.channel_id, old.order_no, old.order_date, old.status,
        old.finalised_at, old.replaces)
       is distinct from
       (new.account_id, new.business_id, new.location_id, new.customer_id,
        new.channel_id, new.order_no, new.order_date, new.status,
        new.finalised_at, new.replaces)
    then
      raise exception 'Order % is finalised. Only payment state may change, or void it.', old.id
        using errcode='check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_finalised on orders;
create trigger trg_orders_finalised
  before update or delete on orders
  for each row execute function fn_guard_finalised_order();

create or replace function fn_guard_order_line_revenue()
returns trigger language plpgsql as $$
declare v_final timestamptz; v_void timestamptz; v_order uuid;
begin
  v_order := coalesce(new.order_id, old.order_id);
  select finalised_at, voided_at into v_final, v_void from orders where id = v_order;

  if v_final is null then
    return coalesce(new, old);            -- still a draft: freely editable
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Order % is finalised. No further lines may be added.', v_order
      using errcode='check_violation';
  elsif tg_op = 'DELETE' then
    raise exception 'Order % is finalised. Lines cannot be deleted. Void the order instead.', v_order
      using errcode='check_violation';
  else
    if (old.qty, old.unit_price, old.recipe_id)
       is distinct from (new.qty, new.unit_price, new.recipe_id) then
      raise exception 'Revenue on a finalised sale is immutable. Void and reissue instead.'
        using errcode='check_violation';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_order_lines_revenue on order_lines;
create trigger trg_order_lines_revenue
  before insert or update or delete on order_lines
  for each row execute function fn_guard_order_line_revenue();

create or replace function fn_guard_sales_entry_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A recorded sale cannot be deleted. Void it instead.'
      using errcode='check_violation';
  end if;

  if (old.account_id, old.business_id, old.location_id, old.channel_id, old.sale_date,
      old.recipe_id, old.qty, old.unit_price)
     is distinct from
     (new.account_id, new.business_id, new.location_id, new.channel_id, new.sale_date,
      new.recipe_id, new.qty, new.unit_price)
  then
    raise exception 'A recorded sale is immutable. Void and re-enter instead.'
      using errcode='check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sales_entries_immutable on sales_entries;
create trigger trg_sales_entries_immutable
  before update or delete on sales_entries
  for each row execute function fn_guard_sales_entry_immutable();

-- ----------------------------------------------------------------------------
-- 4. PROFITABILITY VIEWS REBUILT
--
-- Voided sales leave revenue and COGS. They remain fully queryable as rows, so
-- the audit trail is intact; they simply stop counting as money.
-- Grants are restated because DROP VIEW discards them (0011 granted these).
-- ----------------------------------------------------------------------------

drop view if exists v_dashboard_waterfall;
drop view if exists v_profit_by_product;
drop view if exists v_profit_by_period;
drop view if exists v_sales_unified;

create view v_sales_unified with (security_invoker = on) as
select
  ol.account_id, o.business_id, o.order_date as sale_date, o.channel_id,
  ol.recipe_id, ol.qty, ol.unit_price,
  ol.line_total as revenue,
  ol.unit_cost_at_sale,
  ol.cost_snapshot_id,
  case when ol.unit_cost_at_sale is not null
       then ol.qty * ol.unit_cost_at_sale end as cogs,
  'order'::text as source
from order_lines ol
join orders o on o.id = ol.order_id
where o.status <> 'cancelled'
  and o.voided_at is null                      -- 0014: voided sales do not count
union all
select
  se.account_id, se.business_id, se.sale_date, se.channel_id,
  se.recipe_id, se.qty, se.unit_price,
  se.qty * se.unit_price,
  se.unit_cost_at_sale,
  se.cost_snapshot_id,
  case when se.unit_cost_at_sale is not null
       then se.qty * se.unit_cost_at_sale end,
  'daily_total'
from sales_entries se
where se.voided_at is null;                    -- 0014

create view v_profit_by_period with (security_invoker = on) as
select
  account_id,
  business_id,
  date_trunc('month', sale_date)::date as period,
  round(sum(revenue), 2)                                  as revenue,
  round(sum(cogs), 2)                                     as cogs,
  round(sum(revenue) - coalesce(sum(cogs), 0), 2)         as gross_profit,
  round(100.0 * (sum(revenue) - coalesce(sum(cogs), 0))
        / nullif(sum(revenue), 0), 2)                     as gross_margin_pct,
  round(100.0 * sum(case when unit_cost_at_sale is not null then revenue else 0 end)
        / nullif(sum(revenue), 0), 2)                     as cost_coverage_pct,
  round(sum(case when unit_cost_at_sale is null then revenue else 0 end), 2)
                                                          as revenue_without_cost
from v_sales_unified
group by account_id, business_id, date_trunc('month', sale_date);

create view v_profit_by_product with (security_invoker = on) as
select
  s.account_id, s.business_id, s.recipe_id, r.name,
  round(sum(s.qty), 3)                                as units_sold,
  round(sum(s.revenue), 2)                            as revenue,
  round(sum(s.cogs), 2)                               as cogs,
  round(sum(s.revenue) - coalesce(sum(s.cogs), 0), 2) as gross_profit,
  round(100.0 * (sum(s.revenue) - coalesce(sum(s.cogs), 0))
        / nullif(sum(s.revenue), 0), 2)               as gross_margin_pct,
  round(100.0 * sum(case when s.unit_cost_at_sale is not null then s.revenue else 0 end)
        / nullif(sum(s.revenue), 0), 2)               as cost_coverage_pct
from v_sales_unified s
join recipes r on r.id = s.recipe_id
group by s.account_id, s.business_id, s.recipe_id, r.name;

create view v_dashboard_waterfall with (security_invoker = on) as
select
  business_id, account_id, period, revenue, cogs, gross_profit,
  gross_margin_pct, cost_coverage_pct, revenue_without_cost,
  case when cost_coverage_pct is null then 'no_sales'
       when cost_coverage_pct >= 100 then 'complete'
       when cost_coverage_pct >= 80  then 'mostly_covered'
       else 'partial' end as confidence
from v_profit_by_period;

grant select on v_sales_unified, v_profit_by_period,
                v_profit_by_product, v_dashboard_waterfall
  to authenticated;

-- A voided-sales audit surface, so a reversal is visible rather than merely absent.
create or replace view v_voided_sales with (security_invoker = on) as
select 'order'::text as source, o.account_id, o.business_id, o.id as record_id,
       o.order_no as reference, o.order_date as sale_date,
       o.voided_at, o.voided_by, o.void_reason,
       (select id from orders r where r.replaces = o.id) as replaced_by
from orders o
where o.voided_at is not null
union all
select 'daily_total', se.account_id, se.business_id, se.id, null, se.sale_date,
       se.voided_at, se.voided_by, se.void_reason,
       (select id from sales_entries r where r.replaces = se.id)
from sales_entries se
where se.voided_at is not null;

grant select on v_voided_sales to authenticated;
