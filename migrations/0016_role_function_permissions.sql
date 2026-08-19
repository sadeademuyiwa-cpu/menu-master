-- ============================================================================
-- MENU MASTER NG
-- 0016: role-aware function permissions
--
-- GATE 1 CLOSURE. Three concerns, all about who may invoke what.
--
--   1. An internal recompute path, so a kitchen user can record a production
--      fact without holding cost access.
--   2. Accountant purchase posting and controlled reversal (founder ruling Q3b).
--   3. EXECUTE grants and revokes for everything 0013 and 0014 introduced.
--
-- ADDITIVE. No earlier migration is rewritten. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TRIGGER-INITIATED RECOMPUTATION
--
-- THE CONFLICT, found by test 005 rather than by reading the SQL:
--   Founder ruling Q2 gives kitchen INSERT/UPDATE on ingredients.purchase_yield_pct
--   and ingredient_unit_conversions.qty_in_base -- production facts the kitchen
--   is the authority on. But 0008 puts recompute triggers on both tables, that
--   recompute reaches fn_ingredient_unit_cost, and 0012 guards it with
--   fn_require_cost_access. A kitchen user therefore held the RLS right to
--   record a yield and was still refused with
--   "Your role does not permit access to cost information", because recording a
--   production fact recomputes costs and kitchen cannot see costs.
--
--   The same wall blocks any sales user whose action triggers a recompute.
--
-- THE RESOLUTION
--   Inside a trigger, the ROLE half of the cost check is relaxed. The ACCOUNT
--   half is not: cross-account access still raises, so no tenant boundary moves.
--
--   This is the shape Gate 1 already ships and proves in report section 5 (R5):
--   a user without cost access performs an operation whose CONSEQUENCE is a cost
--   write, executed by a SECURITY DEFINER trigger, while that user still cannot
--   read a single cost figure. Causing a snapshot to exist is not reading it.
--
-- WHY pg_trigger_depth() CANNOT BE FORGED BY A CLIENT
--   It is non-zero only while Postgres is executing a trigger. A client reaches
--   that state only by performing a DML that migration 0015 already authorises
--   for its role, on its own account's rows. It cannot install a trigger of its
--   own: CREATE TRIGGER requires table ownership, which `authenticated` does not
--   have. There is no GUC or parameter here for a caller to set -- a deliberate
--   choice, because a settable bypass flag would be exactly the "authority taken
--   from the request instead of from the data" defect Gate 1 was called to fix.
--
--   Direct RPC calls are unaffected and remain fully guarded at trigger depth 0.
--   Attacks A1-A4, X6 and X7 in suite 002 continue to prove this.
-- ----------------------------------------------------------------------------

create or replace function fn_require_cost_access(p_account_id uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if fn_is_service_context() then return; end if;

  -- Account boundary: enforced identically in every context.
  if p_account_id is null or not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account' using errcode = '42501';
  end if;

  -- Role boundary: relaxed ONLY for trigger-initiated recomputation, so that
  -- recording a production fact does not require permission to read costs.
  if pg_trigger_depth() > 0 then
    return;
  end if;

  if not fn_can_see_costs(p_account_id) then
    raise exception 'Your role does not permit access to cost information'
      using errcode = '42501';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. ACCOUNTANT PURCHASE RIGHTS (founder ruling Q3b, with its restriction)
--
--   MAY   create and post purchases, and reverse a posted purchase through the
--         sanctioned fn_reverse_purchase, which preserves the original and
--         writes a compensating reversal.
--   MAY NOT  delete, rewrite or mutate a posted purchase directly. That is not
--         enforced here but by the 0006 immutability triggers, which refuse any
--         edit or deletion of a non-draft purchase regardless of role.
--   MAY NOT  void or rewrite finalised sales: fn_void_order and
--         fn_void_sales_entry (0014) deliberately exclude accountant.
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
    array['owner','manager','accountant']::member_role[], 'posting purchases');

  if v_p.status <> 'draft' then
    raise exception 'Purchase % is already %', p_purchase_id, v_p.status
      using errcode='check_violation';
  end if;

  select count(*) into v_lines from purchase_lines where purchase_id = p_purchase_id;
  if v_lines = 0 then
    raise exception 'Purchase % has no lines', p_purchase_id using errcode='check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'purchase_line_id', pl.id, 'ingredient_id', pl.ingredient_id,
           'ingredient_name', i.name, 'amount', pl.amount,
           'problem', 'zero_value_line')), '[]'::jsonb)
    into v_zero
  from purchase_lines pl join ingredients i on i.id = pl.ingredient_id
  where pl.purchase_id = p_purchase_id and pl.amount <= 0;

  if jsonb_array_length(v_zero) > 0 then
    return jsonb_build_object('posted', false, 'reason', 'zero_value_lines', 'blockers', v_zero);
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

create or replace function fn_reverse_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_p purchases%rowtype; v_rev_id uuid; v_marked integer;
begin
  select * into v_p from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase % not found', p_purchase_id; end if;

  perform fn_require_account_role(v_p.account_id,
    array['owner','manager','accountant']::member_role[], 'reversing purchases');

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
    'original_purchase_id', p_purchase_id, 'reversal_purchase_id', v_rev_id,
    'price_rows_reversed', v_marked);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. API SURFACE FOR 0013 / 0014 / 0016
-- ----------------------------------------------------------------------------

revoke execute on function fn_guard_finalised_order()        from public, anon, authenticated;
revoke execute on function fn_guard_order_line_revenue()     from public, anon, authenticated;
revoke execute on function fn_guard_sales_entry_immutable()  from public, anon, authenticated;

grant execute on function
  fn_finalise_order(uuid),
  fn_void_order(uuid, text),
  fn_reissue_order(uuid),
  fn_void_sales_entry(uuid, text)
  to authenticated;

grant select on v_voided_sales to authenticated;
