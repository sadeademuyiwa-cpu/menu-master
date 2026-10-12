-- ============================================================================
-- MENU MASTER NG
-- 0061: what an extra costs you
--
-- Requires: 0001-0060 applied.
--
-- WHY
--   A sale can carry things that are not dishes: delivery, serving staff,
--   crockery hire, drinks bought in, "extra plantain". They were recorded as a
--   description and a price, with no cost, so every one of them counted as
--   money in and was left out of profit, and the sale was flagged "cost not
--   known". Caterers' sales are full of them.
--
-- HOW
--   order_lines.extra_unit_cost   what ONE of a non-dish line cost the owner,
--                                 entered by the owner. Ignored on a dish line:
--                                 a dish's cost is its frozen snapshot, never
--                                 a typed figure.
--   fn_confirm_order              REPLACED. At confirmation a non-dish line
--                                 freezes unit_cost_at_sale from its
--                                 extra_unit_cost, through the same one-way
--                                 window as every other line. Dish lines are
--                                 untouched.
--   fn_reissue_order              REPLACED. The copied lines carry the extra
--                                 cost too.
--   v_sale_lines                  REPLACED. A non-dish line with a frozen cost
--                                 reads 'costed'; one without reads
--                                 'no_product' as before. Columns unchanged.
--
-- WHAT DOES NOT CHANGE
--   No policy (118 before and after); fn_* 98 -> 98. The frozen-cost guard
--   (0045) is untouched: the extra cost reaches unit_cost_at_sale only inside
--   fn_confirm_order's window, so nothing else can write a frozen cost.
--   Reports read unit_cost_at_sale as they always have, so an extra with a
--   cost now counts in cost of goods and in profit.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0061 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='purchases' and column_name='replaced_by') then
    raise exception '0061 preflight FAILED: purchases.replaced_by is missing. Apply 0060 first.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost') then
    raise exception '0061 preflight FAILED: order_lines.extra_unit_cost already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0061 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0061 preflight FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table order_lines add column extra_unit_cost numeric(18,4)
  constraint ck_order_lines_extra_cost_positive check (extra_unit_cost is null or extra_unit_cost >= 0);

comment on column order_lines.extra_unit_cost is
  'What one of a NON-DISH line cost the owner (delivery, staff, drinks bought '
  'in), typed by the owner. Frozen into unit_cost_at_sale at confirmation. '
  'Ignored on a dish line, whose cost is its snapshot.';

-- ---------------------------------------------------------------------------
-- 2. Confirmation freezes the extra cost too
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

  -- Every line, one statement, one instant. A dish line freezes its snapshot
  -- cost; a non-dish line freezes the cost the owner typed for it (0061),
  -- or stays NULL and is reported as sold without a known cost.
  update order_lines ol
     set cost_snapshot_id  = f.cost_snapshot_id,
         unit_cost_at_sale = coalesce(f.unit_cost_at_sale,
                                      case when ol.recipe_id is null then ol.extra_unit_cost end)
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

-- ---------------------------------------------------------------------------
-- 3. A replacement sale carries the extra cost too
-- ---------------------------------------------------------------------------
create or replace function fn_reissue_order(p_voided_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_o orders%rowtype; v_new uuid; v_no text; v_n integer := 1; v_lines integer;
begin
  select * into v_o from orders where id = p_voided_order_id for update;
  if not found then raise exception 'Order % not found', p_voided_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'reissuing orders');

  if v_o.voided_at is null then
    raise exception 'Only a voided order can be reissued' using errcode='check_violation';
  end if;
  if exists (select 1 from orders where replaces = v_o.id and voided_at is null) then
    raise exception 'This sale already has a replacement. Open that one instead.'
      using errcode='check_violation';
  end if;

  if v_o.order_no is not null then
    v_no := v_o.order_no || '-R';
    while exists (select 1 from orders where business_id = v_o.business_id and order_no = v_no) loop
      v_n := v_n + 1;
      v_no := v_o.order_no || '-R' || v_n;
    end loop;
  end if;

  insert into orders (account_id, business_id, location_id, customer_id, channel_id,
                      order_no, order_date, status, created_by, replaces, order_discount)
  values (v_o.account_id, v_o.business_id, v_o.location_id, v_o.customer_id, v_o.channel_id,
          v_no, v_o.order_date, 'draft', auth.uid(), v_o.id, v_o.order_discount)
  returning id into v_new;

  insert into order_lines (account_id, order_id, recipe_id, variant_id, description,
                           qty, unit_price, discount_amount, extra_unit_cost)
  select ol.account_id, v_new, ol.recipe_id, ol.variant_id, ol.description,
         ol.qty, ol.unit_price, ol.discount_amount, ol.extra_unit_cost
  from order_lines ol where ol.order_id = v_o.id;
  get diagnostics v_lines = row_count;

  return jsonb_build_object('reissued', true,
    'replaces', p_voided_order_id, 'new_order_id', v_new, 'order_no', v_no,
    'lines_copied', v_lines, 'next_step', 'edit_the_wrong_line_then_confirm');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A costed extra reads as costed
-- ---------------------------------------------------------------------------
create or replace view v_sale_lines with (security_invoker = on) as
  select ol.id                              as line_id,
         ol.account_id,
         ol.business_id,
         o.id                               as order_id,
         o.order_no,
         o.order_date,
         o.status                           as order_status,
         (o.finalised_at is not null)       as is_confirmed,
         o.payment_status,
         o.customer_id,
         c.name                             as customer_name,
         o.channel_id,
         ol.recipe_id,
         r.name                             as product_name,
         ol.variant_id,
         f.name                             as format_name,
         ol.description,
         ol.qty,
         ol.unit_price,
         a.gross_revenue,
         a.line_discount,
         a.allocated_order_discount,
         a.net_revenue,
         ol.unit_cost_at_sale,
         case when ol.unit_cost_at_sale is not null
              then round(ol.qty * ol.unit_cost_at_sale, 2) end as cogs,
         -- Profit only where the cost is known. Never net_revenue - 0.
         case when ol.unit_cost_at_sale is not null
              then round(a.net_revenue - ol.qty * ol.unit_cost_at_sale, 2) end as gross_profit,
         case when ol.unit_cost_at_sale is not null and a.net_revenue <> 0
              then round(100.0 * (a.net_revenue - ol.qty * ol.unit_cost_at_sale)
                         / a.net_revenue, 2) end as gross_margin_pct,
         case
           when ol.unit_cost_at_sale is not null  then 'costed'
           when ol.recipe_id is null              then 'no_product'
           when o.finalised_at is null            then 'not_costed_yet'
           else                                        'sold_without_cost'
         end                                as cost_status
    from order_lines ol
    join orders o   on o.id = ol.order_id
    join fn_allocate_order_discount() a on a.order_line_id = ol.id
    left join customers c on c.id = o.customer_id
    left join recipes r   on r.id = ol.recipe_id
    left join recipe_variants rv on rv.id = ol.variant_id
    left join serving_formats f  on f.id = rv.format_id
   where o.voided_at is null
     and o.status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0061 self-check FAILED: 0061 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0061 self-check FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost') then
    raise exception '0061 self-check FAILED: order_lines.extra_unit_cost is missing.';
  end if;
  if (select prosrc not like '%extra_unit_cost%' from pg_proc
       where proname='fn_confirm_order' and pronamespace='public'::regnamespace) then
    raise exception '0061 self-check FAILED: fn_confirm_order does not freeze the extra cost.';
  end if;
  if not (select relrowsecurity is not null from pg_class where relname='v_sale_lines') then
    raise exception '0061 self-check FAILED: v_sale_lines is missing.';
  end if;
  raise notice '0061 OK: order_lines.extra_unit_cost; fn_confirm_order freezes it; fn_reissue_order copies it; v_sale_lines reads a costed extra as costed.';
end
$$;
