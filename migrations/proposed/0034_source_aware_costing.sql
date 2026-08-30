-- ============================================================================
-- MENU MASTER NG
-- 0034: source-aware ingredient costing
--
-- Authority: owner decision of this date, Option A.
--   "Real purchase transactions are authoritative for ingredient costing.
--    Manual/estimated prices must NEVER be blended into the weighted-average
--    calculation with real purchases."
--
-- Requires: 0001-0033 applied.
--
-- THE DEFECT THIS CORRECTS
--   fn_ingredient_unit_cost computed sum(amount)/sum(qty_base) over EVERY
--   non-reversed ingredient_prices row in the window, filtered only by
--   ingredient, account, reversed_at and effective_date. It never looked at
--   `source`, although that column has recorded
--   'purchase' | 'manual' | 'benchmark_accepted' since 0001.
--
--   So a typed-in estimate stored as qty_base = 1 was averaged, by quantity
--   weight, against real purchases. Proven on the replica: 1,000 g at N1,000
--   plus 1,000 g at N3,000 gives N2.00/g; adding a manual estimate row shifts
--   that number by an amount the owner cannot see or reproduce from their own
--   receipts.
--
-- THE RULE THIS IMPLEMENTS
--   1. Weighted average of REAL PURCHASES inside the costing window.
--   2. Else the latest real purchase of any age -- still real evidence, and
--      never discarded in favour of a guess.
--   3. Else the latest manual/benchmark estimate, reported as an estimate.
--   4. Else NULL. Unknown stays unknown. Never zero.
--   Sources are never blended with one another at any step.
--
-- WHY A BASIS FUNCTION AND NOT AN EDIT IN PLACE
--   The page must show the customer WHICH purchases produced the number, and
--   0033's view had to mirror the window logic in SQL to do it -- a second
--   copy of the selection rule that would drift. fn_ingredient_cost_basis now
--   owns that logic once. fn_ingredient_unit_cost becomes a thin wrapper, so
--   its four callers are untouched, and the view reads provenance from the
--   same function that produced the cost. One implementation, no drift.
--
-- HISTORICAL DATA IS NOT REWRITTEN. cost_snapshots rows already stored keep
-- the values they were computed with. This changes what NEW computations
-- produce, which is the only honest treatment of a historical record.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_ingredient_unit_cost') then
    raise exception '0034 preflight FAILED: fn_ingredient_unit_cost is missing.';
  end if;
  if not exists (select 1 from pg_views where viewname = 'v_recipe_line_costs') then
    raise exception '0034 preflight FAILED: 0033 must be applied first.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0034 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
  if exists (select 1 from pg_type where typname = 'ingredient_cost_basis') then
    raise exception '0034 preflight FAILED: ingredient_cost_basis already exists.';
  end if;
end
$$;

create type ingredient_cost_basis as (
  unit_cost      numeric,   -- per BASE unit, before purchase yield
  basis          text,      -- purchase_window | purchase_latest | manual | none
  purchase_count integer,
  qty_base       numeric,   -- the quantity the cost was divided by
  amount         numeric,   -- the money that quantity cost
  from_date      date,
  to_date        date
);

comment on type ingredient_cost_basis is
  'What an ingredient costs per base unit AND the evidence it came from, so a '
  'customer can reproduce the division from their own records.';

-- ----------------------------------------------------------------------------
-- The single owner of the cost-selection rule.
-- Authorization is identical to the function it replaces the internals of:
-- cost access on the business account, and the ingredient must belong to that
-- same account (blocks the mix-and-match parameter attack from 0012).
-- ----------------------------------------------------------------------------
create or replace function fn_ingredient_cost_basis(
  p_ingredient_id uuid,
  p_business_id   uuid,
  p_as_of         date default current_date)
returns ingredient_cost_basis
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_account_id uuid;
  v_ing_acct   uuid;
  v_window     integer;
  r            ingredient_cost_basis;
begin
  r.basis := 'none';

  select account_id, wavg_window_days into v_account_id, v_window
  from business_settings where business_id = p_business_id;

  if v_account_id is null then
    return r;                                     -- unknown business
  end if;

  perform fn_require_cost_access(v_account_id);   -- AUTHORIZATION

  select account_id into v_ing_acct from ingredients where id = p_ingredient_id;
  if v_ing_acct is distinct from v_account_id then
    raise exception 'Ingredient does not belong to this account'
      using errcode = '42501';
  end if;

  -- 1. REAL PURCHASES INSIDE THE WINDOW. The authoritative case.
  select sum(ip.amount) / nullif(sum(ip.qty_base), 0),
         count(*)::int, sum(ip.qty_base), sum(ip.amount),
         min(ip.effective_date), max(ip.effective_date)
    into r.unit_cost, r.purchase_count, r.qty_base, r.amount, r.from_date, r.to_date
  from ingredient_prices ip
  where ip.ingredient_id = p_ingredient_id
    and ip.account_id    = v_account_id
    and ip.source        = 'purchase'
    and ip.reversed_at is null
    and ip.effective_date <= p_as_of
    and ip.effective_date >  p_as_of - (v_window || ' days')::interval;

  if r.unit_cost is not null then
    r.basis := 'purchase_window';
    return r;
  end if;

  -- 2. THE LATEST REAL PURCHASE OF ANY AGE. Stale, but real: a genuine
  --    receipt is never discarded in favour of a typed-in guess. The page
  --    shows its date so the owner can see it is old and act.
  select ip.unit_cost, 1, ip.qty_base, ip.amount, ip.effective_date, ip.effective_date
    into r.unit_cost, r.purchase_count, r.qty_base, r.amount, r.from_date, r.to_date
  from ingredient_prices ip
  where ip.ingredient_id = p_ingredient_id
    and ip.account_id    = v_account_id
    and ip.source        = 'purchase'
    and ip.reversed_at is null
    and ip.effective_date <= p_as_of
  order by ip.effective_date desc, ip.created_at desc
  limit 1;

  if r.unit_cost is not null then
    r.basis := 'purchase_latest';
    return r;
  end if;

  -- 3. AN ESTIMATE. Only when no real purchase evidence exists at all, and
  --    always labelled so it can never masquerade as a purchase.
  select ip.unit_cost, 0, ip.qty_base, ip.amount, ip.effective_date, ip.effective_date
    into r.unit_cost, r.purchase_count, r.qty_base, r.amount, r.from_date, r.to_date
  from ingredient_prices ip
  where ip.ingredient_id = p_ingredient_id
    and ip.account_id    = v_account_id
    and ip.source in ('manual', 'benchmark_accepted')
    and ip.reversed_at is null
    and ip.effective_date <= p_as_of
  order by ip.effective_date desc, ip.created_at desc
  limit 1;

  if r.unit_cost is not null then
    r.basis := 'manual';
    return r;
  end if;

  -- 4. Nothing known. NULL, never zero.
  r := (null, 'none', null, null, null, null, null)::ingredient_cost_basis;
  return r;
end;
$$;

comment on function fn_ingredient_cost_basis(uuid, uuid, date) is
  'Owner decision (Option A): real purchases are authoritative and are never '
  'blended with manual estimates. Returns the cost AND the evidence behind it.';

-- ----------------------------------------------------------------------------
-- The existing entry point keeps its exact signature, volatility, security and
-- authorization behaviour. Its four callers -- fn_ingredient_usable_unit_cost,
-- and through it fn__recipe_cost_core, fn_variant_cost, fn_variant_problem and
-- fn_compute_variant_cost_snapshot -- are unchanged.
-- ----------------------------------------------------------------------------
create or replace function fn_ingredient_unit_cost(
  p_ingredient_id uuid,
  p_business_id   uuid,
  p_as_of         date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return (fn_ingredient_cost_basis(p_ingredient_id, p_business_id, p_as_of)).unit_cost;
end;
$$;

-- ----------------------------------------------------------------------------
-- 0033's view re-pointed at the basis function. It previously mirrored the
-- window/reversed/as-of selection in SQL; that copy is now deleted and the
-- evidence comes from the same function that produced the cost, so the two
-- cannot disagree. Adds cost_basis so the page can say where the number
-- came from instead of implying a single receipt.
-- ----------------------------------------------------------------------------
drop view if exists v_recipe_line_costs;

create view v_recipe_line_costs with (security_invoker = on) as
select
  rl.id                              as line_id,
  rl.recipe_id,
  rl.account_id,
  r.business_id,
  rl.ingredient_id,
  rl.sub_recipe_id,
  coalesce(i.name, sr.name)          as item_name,
  i.kind                             as item_kind,
  rl.is_cost_bearing,
  rl.exclusion_reason,

  rl.qty                             as recipe_qty,
  u.code                             as recipe_unit,
  bu.code                            as base_unit,

  fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) as base_qty,
  fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) as unit_cost,

  case when rl.is_cost_bearing then
    fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id)
      * fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id)
  end                                as line_cost,

  b.qty_base                         as purchase_qty_base,
  b.amount                           as purchase_amount,
  b.to_date                          as purchase_date,
  b.purchase_count                   as purchase_count,
  b.basis                            as cost_basis,

  case
    when not rl.is_cost_bearing                                              then 'excluded'
    when rl.sub_recipe_id is not null                                        then 'sub_recipe'
    when fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) is null then 'missing_conversion'
    when fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) is null then 'missing_price'
    else                                                                          'ok'
  end                                as problem

from recipe_lines rl
join recipes r      on r.id = rl.recipe_id and r.deleted_at is null
left join ingredients i on i.id = rl.ingredient_id
left join recipes sr    on sr.id = rl.sub_recipe_id
left join units u       on u.id = rl.unit_id
left join units bu      on bu.id = i.base_unit_id
left join lateral (
  select * from fn_ingredient_cost_basis(rl.ingredient_id, r.business_id)
) b on true;

comment on view v_recipe_line_costs is
  'Per-line cost contribution and the evidence behind each unit cost, both '
  'from the same PostgreSQL functions the engine uses. Adds no costing rule. '
  'NULL means unknown and is never rendered as zero.';

grant select on v_recipe_line_costs to authenticated;

-- ----------------------------------------------------------------------------
-- SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_inv boolean; v_pol int; v_cols int;
begin
  select 'security_invoker=on' = any(reloptions) into v_inv
    from pg_class where relname = 'v_recipe_line_costs';
  if not coalesce(v_inv, false) then
    raise exception '0034 self-check FAILED: the view is not security_invoker.';
  end if;

  select count(*) into v_cols from information_schema.columns
   where table_name = 'v_recipe_line_costs';
  if v_cols <> 22 then
    raise exception '0034 self-check FAILED: view has % columns, expected 22.', v_cols;
  end if;

  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0034 self-check FAILED: policy count moved to %.', v_pol;
  end if;

  raise notice '0034 OK: source-aware costing live, view rebuilt with 22 columns, 116 policies unchanged.';
end
$$;
