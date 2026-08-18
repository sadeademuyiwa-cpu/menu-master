-- ============================================================================
-- MENU MASTER NG
-- 0006: purchase posting
--
-- Flow:  CREATE PURCHASE -> ADD LINES -> POST -> PRICES WRITTEN -> IMMUTABLE
--
-- A purchase only becomes a costing input when every line resolves to the
-- ingredient's base unit. If one conversion is missing, posting is refused
-- and the caller is told which line. We never invent qty_base to get past it.
--
-- Corrections are reversals. A posted purchase is never edited, and its
-- price rows are never deleted: they are marked reversed and every cost
-- function ignores them from that moment on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A posted purchase is immutable
-- ----------------------------------------------------------------------------

create or replace function fn_guard_posted_purchase()
returns trigger language plpgsql as $$
declare v_status purchase_status;
begin
  if tg_table_name = 'purchases' then
    if tg_op = 'DELETE' then
      if old.status <> 'draft' then
        raise exception 'Purchase % is % and cannot be deleted. Reverse it instead.',
          old.id, old.status using errcode='check_violation';
      end if;
      return old;
    end if;
    -- Allow only the lifecycle transition itself
    if old.status = 'posted' and new.status = 'posted'
       and (old.purchase_date, old.supplier_id, old.business_id, old.location_id)
        is distinct from
           (new.purchase_date, new.supplier_id, new.business_id, new.location_id) then
      raise exception 'Posted purchase % is immutable', old.id
        using errcode='check_violation';
    end if;
    if old.status = 'reversed' and new.status <> 'reversed' then
      raise exception 'Reversed purchase % cannot be reopened', old.id
        using errcode='check_violation';
    end if;
    return new;
  else
    select p.status into v_status from purchases p
     where p.id = coalesce(new.purchase_id, old.purchase_id);
    if v_status <> 'draft' then
      raise exception 'Purchase is % . Its lines cannot be changed.', v_status
        using errcode='check_violation';
    end if;
    return coalesce(new, old);
  end if;
end;
$$;

create trigger trg_purchases_guard
  before update or delete on purchases
  for each row execute function fn_guard_posted_purchase();

create trigger trg_purchase_lines_guard
  before insert or update or delete on purchase_lines
  for each row execute function fn_guard_posted_purchase();

-- ----------------------------------------------------------------------------
-- 2. Price rows are append only and reversal marked
-- ----------------------------------------------------------------------------

create or replace function fn_guard_ingredient_prices()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ingredient_prices is append only. Reverse the purchase instead.'
      using errcode='check_violation';
  end if;
  -- The only permitted update is stamping a reversal
  if (old.ingredient_id, old.qty_base, old.amount, old.source,
      old.effective_date, old.supplier_id, old.account_id)
     is distinct from
     (new.ingredient_id, new.qty_base, new.amount, new.source,
      new.effective_date, new.supplier_id, new.account_id) then
    raise exception 'A recorded price is immutable. Only reversal may be stamped.'
      using errcode='check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_ingredient_prices_guard
  before update or delete on ingredient_prices
  for each row execute function fn_guard_ingredient_prices();

-- ----------------------------------------------------------------------------
-- 3. Pre flight check: what stops this purchase from posting?
-- ----------------------------------------------------------------------------

create or replace function fn_purchase_blockers(p_purchase_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'purchase_line_id', pl.id,
           'ingredient_id',    pl.ingredient_id,
           'ingredient_name',  i.name,
           'unit_id',          pl.unit_id,
           'unit_code',        u.code,
           'problem',          'missing_conversion'
         )), '[]'::jsonb)
  from purchase_lines pl
  join ingredients i on i.id = pl.ingredient_id
  join units u on u.id = pl.unit_id
  where pl.purchase_id = p_purchase_id
    and fn_resolve_qty_to_base(pl.ingredient_id, pl.qty, pl.unit_id) is null;
$$;

-- ----------------------------------------------------------------------------
-- 4. POST
-- ----------------------------------------------------------------------------

create or replace function fn_post_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p         purchases%rowtype;
  v_blockers  jsonb;
  v_lines     integer;
  v_written   integer := 0;
  r           record;
  v_base      numeric;
begin
  select * into v_p from purchases where id = p_purchase_id;
  if not found then
    raise exception 'Purchase % not found', p_purchase_id;
  end if;
  if v_p.status <> 'draft' then
    raise exception 'Purchase % is already %', p_purchase_id, v_p.status
      using errcode='check_violation';
  end if;

  select count(*) into v_lines from purchase_lines where purchase_id = p_purchase_id;
  if v_lines = 0 then
    raise exception 'Purchase % has no lines', p_purchase_id
      using errcode='check_violation';
  end if;

  -- Refuse rather than invent
  v_blockers := fn_purchase_blockers(p_purchase_id);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object(
      'posted', false,
      'reason', 'unresolved_conversions',
      'blockers', v_blockers);
  end if;

  for r in select * from purchase_lines where purchase_id = p_purchase_id loop
    v_base := fn_resolve_qty_to_base(r.ingredient_id, r.qty, r.unit_id);

    -- Belt and braces: never write a price row without a resolved quantity
    if v_base is null or v_base <= 0 then
      raise exception 'Line % did not resolve. Refusing to post.', r.id
        using errcode='check_violation';
    end if;

    update purchase_lines set qty_base = v_base where id = r.id;

    insert into ingredient_prices (
      account_id, ingredient_id, supplier_id, purchase_line_id,
      qty_base, amount, source, effective_date, entered_by)
    values (
      v_p.account_id, r.ingredient_id, v_p.supplier_id, r.id,
      v_base, r.amount, 'purchase', v_p.purchase_date, auth.uid());

    v_written := v_written + 1;
  end loop;

  update purchases
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_purchase_id;

  return jsonb_build_object(
    'posted', true,
    'purchase_id', p_purchase_id,
    'price_rows_written', v_written);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. REVERSE
-- The original purchase and its price rows stay on record. They are marked
-- reversed, which removes them from every future cost calculation while
-- leaving the history reproducible.
-- ----------------------------------------------------------------------------

create or replace function fn_reverse_purchase(
  p_purchase_id uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p        purchases%rowtype;
  v_rev_id   uuid;
  v_marked   integer;
begin
  select * into v_p from purchases where id = p_purchase_id;
  if not found then
    raise exception 'Purchase % not found', p_purchase_id;
  end if;
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

  return jsonb_build_object(
    'reversed', true,
    'original_purchase_id', p_purchase_id,
    'reversal_purchase_id', v_rev_id,
    'price_rows_reversed', v_marked);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Cost resolution must ignore reversed prices
-- Replaces the 0001 version of fn_ingredient_unit_cost.
-- ----------------------------------------------------------------------------

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
  v_window     integer;
  v_cost       numeric;
begin
  select account_id, wavg_window_days
    into v_account_id, v_window
  from business_settings where business_id = p_business_id;

  if v_account_id is null then
    return null;
  end if;

  -- Weighted average across this account's own, non reversed purchase history
  select sum(amount) / nullif(sum(qty_base), 0)
    into v_cost
  from ingredient_prices
  where ingredient_id  = p_ingredient_id
    and account_id     = v_account_id
    and reversed_at is null
    and effective_date <= p_as_of
    and effective_date >  p_as_of - (v_window || ' days')::interval;

  if v_cost is null then
    select unit_cost into v_cost
    from ingredient_prices
    where ingredient_id  = p_ingredient_id
      and account_id     = v_account_id
      and reversed_at is null
      and effective_date <= p_as_of
    order by effective_date desc, created_at desc
    limit 1;
  end if;

  return v_cost;   -- NULL means not entered. Never zero.
end;
$$;
