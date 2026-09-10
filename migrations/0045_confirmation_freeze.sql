-- ============================================================================
-- MENU MASTER NG
-- 0045: the freeze happens at confirmation, not at typing
--
-- Requires: 0001-0044 applied.
--
-- The problem this fixes
-- ---------------------
-- An order line froze its cost the instant it was typed. A caterer building a
-- Saturday order on Monday, adding to it on Tuesday and confirming it on
-- Wednesday ended up with three different days' economics inside one sale.
-- Worse, the Monday line froze a cost for a sale that had not happened and
-- might never happen.
--
-- The economics of a sale are the economics at the moment the sale is
-- committed. So the freeze moves to confirmation, and it freezes every line
-- together, from one instant, in one statement.
--
-- What that requires
-- ------------------
--   the BEFORE INSERT freeze on order_lines is removed; drafts stay live and
--     recost themselves as ingredient prices move, which is the point of a
--     draft
--
--   fn_guard_frozen_cost, which refused every change to a frozen cost, has to
--     permit exactly one: null -> value, performed by the confirmation itself.
--     It now recognises that operation rather than trusting any caller who
--     happens to be updating a draft line
--
--   orders.status defaulted to 'confirmed', so an order inserted without a
--     status was born committed and never made the transition that freezes it.
--     The default becomes 'draft'
--
--   status and finalised_at were independent, and every guard keyed on
--     finalised_at while status was decorative. Confirmation now sets both in
--     one statement, so there is one boundary rather than two
--
-- sales_entries is untouched. A quick sale has no draft state -- it is a
-- record of something that already happened -- so it still freezes on arrival.
-- The two paths now share one implementation of "what does this product cost
-- right now", so they cannot drift apart.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'order_lines' and t.tgname = 'trg_order_lines_freeze') then
    raise exception '0045 preflight FAILED: trg_order_lines_freeze is already gone.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'orders' and column_name = 'order_discount') then
    raise exception '0045 preflight FAILED: 0044 has not been applied.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'sales_entries' and t.tgname = 'trg_sales_entries_freeze') then
    raise exception '0045 preflight FAILED: the sales_entries freeze is missing.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0045 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 0. The orders the old default left behind
--
-- Until this migration, orders.status defaulted to 'confirmed' while
-- finalised_at was set only by fn_finalise_order. So an order inserted and
-- never explicitly finalised sat in a third state: counted as revenue by the
-- reporting views, which keyed on status, but not locked by the guards, which
-- key on finalised_at. Its lines were frozen at insert regardless.
--
-- Phase 6 merges those two tiers into one boundary. These rows have to land
-- somewhere, and there are only two honest choices:
--
--   drop them from revenue -- which silently changes the owner's historical
--     figures, the exact thing this phase exists to prevent; or
--   record when they were recognised -- which is what the old system meant by
--     'confirmed' from the moment of creation.
--
-- The second. finalised_at takes the order's own created_at and finalised_by
-- its created_by: not invented, read off the row. NO LINE IS TOUCHED, so no
-- historical sale is re-costed and every frozen figure stays exactly as it was.
--
-- Reported, never silent. Voided orders and drafts are left alone; both are
-- excluded from reporting before and after, so neither needs a decision.
-- ---------------------------------------------------------------------------

do $$
declare v_n int;
begin
  select count(*) into v_n from orders
   where status not in ('draft', 'cancelled')
     and finalised_at is null and voided_at is null;
  if v_n > 0 then
    raise notice '0045: % order(s) were recognised as sales under the old default '
                 'and carry no confirmation time. Recording their creation time as '
                 'their confirmation time so their revenue does not change.', v_n;
  else
    raise notice '0045: no legacy orders need reconciling.';
  end if;
end
$$;

update orders
   set finalised_at = created_at,
       finalised_by = created_by
 where status not in ('draft', 'cancelled')
   and finalised_at is null
   and voided_at is null;

-- ---------------------------------------------------------------------------
-- 1. One answer to "what does this product cost right now"
--
-- fn_freeze_sale_cost held this rule for quick sales. Confirmation needs the
-- identical rule for order lines. Rather than write it twice -- which is
-- exactly how the 0040 defect happened -- it moves into one function that both
-- callers use. The rule itself is unchanged, including the gate that an
-- incomplete cost is not a cost.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'frozen_sale_cost') then
    create type frozen_sale_cost as (
      cost_snapshot_id  uuid,
      unit_cost_at_sale numeric(18,4)
    );
  end if;
end
$$;

-- SECURITY DEFINER, so it must scope itself twice over: it refuses a caller
-- who is not a member of the account it is asked about, and it filters on that
-- account explicitly rather than inferring it from whatever snapshot it finds.
-- Without the first check a definer function taking an account id is simply a
-- cost-reading service for anybody who can guess one.
--
-- Membership, not cost access: a sales user may confirm an order, and the
-- freeze runs on their behalf, while they still cannot read a cost figure
-- anywhere in the product. That boundary is Gate 1's and does not move here.
create or replace function fn_frozen_sale_cost(
  p_account_id uuid,
  p_recipe_id  uuid,
  p_variant_id uuid
)
returns frozen_sale_cost
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare s cost_snapshots%rowtype; r frozen_sale_cost;
begin
  perform fn_require_member(p_account_id);

  r := row(null, null)::frozen_sale_cost;

  if p_recipe_id is null then
    return r;                       -- an ad hoc line has no product to cost
  end if;

  if p_variant_id is not null then
    -- what was actually sold is the variant, so that is what is frozen
    select * into s
      from cost_snapshots
     where account_id = p_account_id and variant_id = p_variant_id
     order by computed_at desc, seq desc
     limit 1;
  else
    select * into s
      from cost_snapshots
     where account_id = p_account_id
       and recipe_id = p_recipe_id and variant_id is null
     order by computed_at desc, seq desc
     limit 1;
  end if;

  -- The gate. An incomplete cost is not a cost, and a missing cost stays
  -- missing: it is never rounded down to zero.
  if not found or not s.is_complete or s.cost_per_portion is null then
    return r;
  end if;

  return row(s.id, s.cost_per_portion)::frozen_sale_cost;
end
$fn$;

comment on function fn_frozen_sale_cost(uuid, uuid, uuid) is
  'The cost to freeze against a sale of this product right now, or (null,null) '
  'when the product is not fully costed. Shared by quick sales and by order '
  'confirmation so the two cannot diverge.';

-- fn_freeze_sale_cost keeps its exact behaviour; only its body moves.
create or replace function fn_freeze_sale_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare c frozen_sale_cost;
begin
  c := fn_frozen_sale_cost(new.account_id, new.recipe_id, new.variant_id);
  new.cost_snapshot_id  := c.cost_snapshot_id;
  new.unit_cost_at_sale := c.unit_cost_at_sale;
  return new;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Drafts stay live
-- ---------------------------------------------------------------------------

drop trigger if exists trg_order_lines_freeze on order_lines;

-- ---------------------------------------------------------------------------
-- 3. The frozen cost becomes writable exactly once, by exactly one operation
--
-- The old guard refused every change on UPDATE, which would have made the
-- confirmation freeze impossible. It now permits the single transition
-- null -> value, and only while fn_confirm_order is performing it. The marker
-- is set with SET LOCAL inside that function, so it dies with the transaction
-- and cannot be forged from a session that is not confirming this order.
--
-- Everything else is still refused: value -> different value, value -> null,
-- and null -> value written by anyone other than the confirmation.
--
-- The guard now also covers INSERT. Without the old BEFORE INSERT freeze,
-- nothing else would stop a caller inserting a draft line with a cost of its
-- own choosing.
-- ---------------------------------------------------------------------------

create or replace function fn_guard_frozen_cost()
returns trigger
language plpgsql
as $fn$
declare v_confirming text;
begin
  if tg_op = 'INSERT' then
    if new.cost_snapshot_id is not null or new.unit_cost_at_sale is not null then
      raise exception
        'A cost is frozen when the sale is confirmed, not when the line is added.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.cost_snapshot_id  is not distinct from old.cost_snapshot_id
 and new.unit_cost_at_sale is not distinct from old.unit_cost_at_sale then
    return new;                          -- the frozen cost is not moving
  end if;

  v_confirming := current_setting('menumaster.confirming_order', true);

  if old.cost_snapshot_id is null
 and old.unit_cost_at_sale is null
 and v_confirming is not null
 and v_confirming <> ''
 and v_confirming = new.order_id::text then
    return new;                          -- the confirmation freeze: once, one way
  end if;

  raise exception
    'The cost frozen at sale time cannot be changed. Void the sale and reissue instead.'
    using errcode = 'check_violation';
end
$fn$;

drop trigger if exists trg_order_lines_frozen on order_lines;
create trigger trg_order_lines_frozen
  before insert or update on order_lines
  for each row execute function fn_guard_frozen_cost();

-- ---------------------------------------------------------------------------
-- 4. An order is born a draft
-- ---------------------------------------------------------------------------

alter table orders alter column status set default 'draft';

-- ---------------------------------------------------------------------------
-- 5. Confirmation
--
-- One transaction, one row lock, one UPDATE across every line. There is no
-- path to a half-frozen confirmed order: if anything raises, the whole
-- confirmation rolls back and the order is still a draft.
--
-- A line whose product is not fully costed freezes to NULL. That is a valid
-- outcome, not a failure -- the sale really did happen, and Menu Master will
-- not invent a cost for it. The function reports how many lines are in that
-- state so the caller can say so plainly.
-- ---------------------------------------------------------------------------

create or replace function fn_confirm_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_o        orders%rowtype;
  v_lines    integer;
  v_subtotal numeric(14,2);
  v_costed   integer;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'confirming orders');

  if v_o.voided_at is not null then
    raise exception 'Order % is voided and cannot be confirmed', p_order_id
      using errcode='check_violation';
  end if;
  if v_o.finalised_at is not null then
    raise exception 'Order % is already confirmed', p_order_id
      using errcode='check_violation';
  end if;

  select count(*), coalesce(sum(qty * unit_price - discount_amount), 0)
    into v_lines, v_subtotal
    from order_lines where order_id = p_order_id;

  if v_lines = 0 then
    raise exception 'Order % has no lines', p_order_id using errcode='check_violation';
  end if;

  -- The order-level check 0044 could not express as a CHECK constraint. A
  -- draft is allowed to be temporarily inconsistent; a confirmed sale is not.
  if v_o.order_discount > v_subtotal then
    raise exception
      'The order discount of % is more than the order is worth (%). Lower the discount before confirming.',
      to_char(v_o.order_discount, 'FM999999990.00'),
      to_char(v_subtotal, 'FM999999990.00')
      using errcode='check_violation';
  end if;

  -- Opens the one-way window in fn_guard_frozen_cost. SET LOCAL: it is gone at
  -- the end of this transaction whether it commits or rolls back.
  perform set_config('menumaster.confirming_order', p_order_id::text, true);

  -- Every line, one statement, one instant. now() is the transaction time, so
  -- every line freezes against the same moment by construction.
  --
  -- The lateral call lives in a subquery rather than the UPDATE's own FROM
  -- clause: an UPDATE's FROM cannot reference the row being updated.
  update order_lines ol
     set cost_snapshot_id  = f.cost_snapshot_id,
         unit_cost_at_sale = f.unit_cost_at_sale
    from (
      select l.id, c.cost_snapshot_id, c.unit_cost_at_sale
        from order_lines l
        cross join lateral fn_frozen_sale_cost(l.account_id, l.recipe_id, l.variant_id) c
       where l.order_id = p_order_id
    ) f
   where ol.id = f.id;

  perform set_config('menumaster.confirming_order', '', true);

  select count(*) into v_costed
    from order_lines where order_id = p_order_id and unit_cost_at_sale is not null;

  update orders
     set status       = 'confirmed',
         finalised_at = now(),
         finalised_by = auth.uid()
   where id = p_order_id;

  return jsonb_build_object(
    'confirmed',          true,
    'order_id',           p_order_id,
    'lines_frozen',       v_lines,
    'lines_without_cost', v_lines - v_costed);
end
$fn$;

comment on function fn_confirm_order(uuid) is
  'Commits a draft order: freezes every line''s cost from one instant and sets '
  'status and finalised_at together. The only way an order reaches confirmed.';

grant execute on function fn_confirm_order(uuid) to authenticated;

-- 0018 removed PUBLIC and anon from every fn_*. It was a sweep, not a standing
-- rule, so every function added since has quietly arrived executable by
-- everyone. Restated here for the two this migration adds; 0048 restores the
-- rule for the whole schema and tests/034 keeps it restored.
revoke all on function fn_confirm_order(uuid) from public, anon;
revoke all on function fn_frozen_sale_cost(uuid, uuid, uuid) from public, anon;
grant execute on function fn_frozen_sale_cost(uuid, uuid, uuid) to authenticated;

-- fn_finalise_order keeps working, and keeps its old return shape: callers
-- reading ->>'finalised' must not start getting NULL. It is the same operation
-- under an older name, so it delegates rather than holding a second copy of
-- the rules.
create or replace function fn_finalise_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  v := fn_confirm_order(p_order_id);
  return jsonb_build_object(
    'finalised', true,
    'order_id',  p_order_id,
    'lines',     v->'lines_frozen');
end
$fn$;

comment on function fn_finalise_order(uuid) is
  'Superseded by fn_confirm_order, which it calls. Kept so existing callers '
  'do not break.';

-- ---------------------------------------------------------------------------
-- 6. An order cannot be talked into being confirmed
--
-- Every guard in the schema keys on finalised_at, and status was decorative.
-- With status now meaning something, an ordinary UPDATE could set it to
-- 'confirmed' while finalised_at stayed null -- an order that looks like a sale
-- to a reader and like a draft to every guard, with no frozen cost. An INSERT
-- could do the same in one step.
--
-- So status and finalised_at move together, and only fn_confirm_order moves
-- them. Cancelling is exempt: it is its own path and is not a confirmation.
--
-- Service context is exempt, deliberately. An operator repairing data through
-- the service role is not the 'normal application', and taking that away would
-- remove the only recovery route. It is recorded here rather than hidden.
-- ---------------------------------------------------------------------------

create or replace function fn_guard_order_lifecycle()
returns trigger
language plpgsql
as $fn$
begin
  if fn_is_service_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.finalised_at is not null then
      raise exception
        'An order starts as a draft. Confirm it when the sale is agreed.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status <> 'cancelled'
     and old.finalised_at is null
     and new.finalised_at is null then
    raise exception
      'This order is still a draft. Confirm it to record the sale.'
      using errcode = 'check_violation';
  end if;

  if new.finalised_at is not null and new.status = 'draft' then
    raise exception 'A confirmed sale cannot also be a draft.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$fn$;

revoke all on function fn_guard_order_lifecycle() from public, anon;

create trigger trg_orders_lifecycle
  before insert or update on orders
  for each row execute function fn_guard_order_lifecycle();

-- ---------------------------------------------------------------------------
-- 7. Self-check
-- ---------------------------------------------------------------------------

do $$
declare v_pol int;
begin
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'order_lines' and t.tgname = 'trg_order_lines_freeze') then
    raise exception '0045 self-check FAILED: the insert-time freeze survived.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'sales_entries' and t.tgname = 'trg_sales_entries_freeze') then
    raise exception '0045 self-check FAILED: the sales_entries freeze was disturbed.';
  end if;
  if (select column_default from information_schema.columns
       where table_name = 'orders' and column_name = 'status')
     is distinct from '''draft''::order_status' then
    raise exception '0045 self-check FAILED: orders.status does not default to draft.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_confirm_order') then
    raise exception '0045 self-check FAILED: fn_confirm_order is missing.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'order_lines' and t.tgname = 'trg_order_lines_frozen'
                    and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16) then
    raise exception '0045 self-check FAILED: the frozen-cost guard does not cover insert and update.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'orders' and t.tgname = 'trg_orders_lifecycle') then
    raise exception '0045 self-check FAILED: the lifecycle guard is missing.';
  end if;
  -- Every order that reads as a sale must carry a confirmation time. Anything
  -- left here would be counted by the old reporting and ignored by the new.
  if exists (select 1 from orders
              where status not in ('draft', 'cancelled')
                and finalised_at is null and voided_at is null) then
    raise exception '0045 self-check FAILED: % order(s) read as sales with no confirmation time.',
      (select count(*) from orders where status not in ('draft', 'cancelled')
        and finalised_at is null and voided_at is null);
  end if;
  -- A definer function that takes an account id and does not check it is a
  -- cost-reading service for anyone who can guess one.
  if pg_get_functiondef((select oid from pg_proc
                          where proname = 'fn_frozen_sale_cost'
                            and pronamespace = 'public'::regnamespace))
     !~ 'fn_require_member' then
    raise exception '0045 self-check FAILED: fn_frozen_sale_cost does not check membership.';
  end if;
  -- Nothing already confirmed may have been disturbed by any of this.
  if exists (select 1 from order_lines ol join orders o on o.id = ol.order_id
              where o.finalised_at is not null and ol.recipe_id is not null
                and ol.cost_snapshot_id is null and ol.unit_cost_at_sale is not null) then
    raise exception '0045 self-check FAILED: a confirmed line lost its snapshot.';
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0045 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0045 OK: freeze moved to confirmation, drafts live, 116 policies unchanged.';
end
$$;
