-- ============================================================================
-- MENU MASTER NG
-- 0013: reject zero-value acquisition amounts
--
-- GATE 1 CLOSURE, item A3.
--
-- THE DEFECT
--   0001 declared `check (amount >= 0)` on both purchase_lines and
--   ingredient_prices. ingredient_prices.unit_cost is
--   `generated always as (amount / qty_base) stored`, so a zero amount
--   produces a REAL unit cost of 0.000000. The completeness gate then counts
--   that ingredient as priced, and a fabricated zero flows into batch cost,
--   cost per portion, margin and recommended price.
--
--   That is precisely the failure the governing rule forbids:
--     A missing price is NULL. It is never zero.
--   A zero is worse than a missing price, because NULL is visibly incomplete
--   while 0.00 looks like an answer.
--
-- SCOPE
--   Both tables are tightened in this one migration because they are two ends
--   of a single write path: fn_post_purchase copies purchase_lines.amount
--   straight into ingredient_prices.amount. Closing one and leaving the other
--   open would leave the manual-price route wide open. Same invariant, same
--   migration.
--
-- OUT OF SCOPE (deliberate, per founder ruling C2)
--   Gifted, free, transferred, sampled and owner-supplied stock are NOT
--   modelled here. When they are needed they must be represented as their own
--   acquisition mechanism with their own cost semantics, never as a purchase
--   that happened to cost nothing. A zero-value purchase is not a cheap
--   purchase; it is an unpriced one wearing a price.
--
-- ADDITIVE. No earlier migration is rewritten. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRE-FLIGHT ASSERTION
--
-- Fail loudly rather than silently coercing. If real zero-value rows already
-- exist, the owner must decide what they meant before we harden the rule --
-- deleting or rewriting their data to make a constraint fit would be exactly
-- the kind of silent mutation this system exists to prevent.
-- ----------------------------------------------------------------------------

do $$
declare
  v_pl integer;
  v_ip integer;
begin
  select count(*) into v_pl from purchase_lines    where amount <= 0;
  select count(*) into v_ip from ingredient_prices where amount <= 0;

  if v_pl > 0 or v_ip > 0 then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Cannot apply 0013: %s purchase_lines and %s ingredient_prices rows have amount <= 0',
        v_pl, v_ip),
      hint = 'Reverse the offending purchases, or correct the amounts, then re-run. '
             'This migration will not delete or rewrite financial history.';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. TIGHTEN THE CONSTRAINTS
--
-- The 0001 constraints are inline and therefore auto-named by Postgres:
--   purchase_lines_amount_check, ingredient_prices_amount_check
-- They are replaced with explicitly named constraints so future migrations
-- can reference them without guessing.
-- ----------------------------------------------------------------------------

alter table purchase_lines    drop constraint if exists purchase_lines_amount_check;
alter table ingredient_prices drop constraint if exists ingredient_prices_amount_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_purchase_lines_amount_positive') then
    alter table purchase_lines
      add constraint ck_purchase_lines_amount_positive check (amount > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ck_ingredient_prices_amount_positive') then
    alter table ingredient_prices
      add constraint ck_ingredient_prices_amount_positive check (amount > 0);
  end if;
end
$$;

comment on constraint ck_purchase_lines_amount_positive on purchase_lines is
  'A purchase line must carry a real price. Zero is not a cheap purchase, it is '
  'an unpriced one. Free or gifted stock needs its own acquisition mechanism.';

comment on constraint ck_ingredient_prices_amount_positive on ingredient_prices is
  'Closes the manual-price route to the same fabricated-zero defect. A price row '
  'exists only because a real amount was paid.';

-- ----------------------------------------------------------------------------
-- 3. DEFENCE IN DEPTH IN fn_post_purchase
--
-- The constraint above already makes a zero line unstorable, so this branch is
-- unreachable while the constraint stands. It is here because a future
-- migration that relaxes or drops the constraint must not silently re-open the
-- posting path. Reported in the same structured shape as the existing
-- unresolved_conversions blocker so the UI needs no new error handling.
--
-- This body is 0012's authorization-hardened version with the zero-value
-- blocker added. Every guard from 0012 is preserved verbatim:
--   - row lock via SELECT ... FOR UPDATE
--   - fn_require_account_role(owner, manager) on the account derived from the
--     purchase row itself, never from a caller-supplied id
-- ----------------------------------------------------------------------------

create or replace function fn_post_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_p purchases%rowtype; v_blockers jsonb; v_zero jsonb; v_lines integer;
  v_written integer := 0; r record; v_base numeric;
begin
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

  -- 0013: refuse rather than record a fabricated zero cost.
  select coalesce(jsonb_agg(jsonb_build_object(
           'purchase_line_id', pl.id,
           'ingredient_id',    pl.ingredient_id,
           'ingredient_name',  i.name,
           'amount',           pl.amount,
           'problem',          'zero_value_line')), '[]'::jsonb)
    into v_zero
  from purchase_lines pl
  join ingredients i on i.id = pl.ingredient_id
  where pl.purchase_id = p_purchase_id
    and pl.amount <= 0;

  if jsonb_array_length(v_zero) > 0 then
    return jsonb_build_object('posted', false,
      'reason', 'zero_value_lines', 'blockers', v_zero);
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
