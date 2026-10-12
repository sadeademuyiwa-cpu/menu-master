-- ============================================================================
-- 0061 ROLLBACK: back at 0060.
-- Restores the 0045 fn_confirm_order, the 0060 fn_reissue_order and the 0047
-- v_sale_lines, then drops the column. Sales already confirmed keep the cost
-- that was frozen onto their extras (unit_cost_at_sale is never rewritten);
-- only the typed figure on draft lines is lost.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0061 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost') then
    raise exception '0061 rollback: order_lines.extra_unit_cost does not exist; 0061 is not applied.';
  end if;
end
$$;

-- Byte-faithful to 0045.
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

  if v_o.order_discount > v_subtotal then
    raise exception
      'The order discount of % is more than the order is worth (%). Lower the discount before confirming.',
      to_char(v_o.order_discount, 'FM999999990.00'),
      to_char(v_subtotal, 'FM999999990.00')
      using errcode='check_violation';
  end if;

  perform set_config('menumaster.confirming_order', p_order_id::text, true);

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

-- Byte-faithful to 0060.
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
                           qty, unit_price, discount_amount)
  select ol.account_id, v_new, ol.recipe_id, ol.variant_id, ol.description,
         ol.qty, ol.unit_price, ol.discount_amount
  from order_lines ol where ol.order_id = v_o.id;
  get diagnostics v_lines = row_count;

  return jsonb_build_object('reissued', true,
    'replaces', p_voided_order_id, 'new_order_id', v_new, 'order_no', v_no,
    'lines_copied', v_lines, 'next_step', 'edit_the_wrong_line_then_confirm');
end;
$$;

-- Byte-faithful to 0047.
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
         case when ol.unit_cost_at_sale is not null
              then round(a.net_revenue - ol.qty * ol.unit_cost_at_sale, 2) end as gross_profit,
         case when ol.unit_cost_at_sale is not null and a.net_revenue <> 0
              then round(100.0 * (a.net_revenue - ol.qty * ol.unit_cost_at_sale)
                         / a.net_revenue, 2) end as gross_margin_pct,
         case
           when ol.recipe_id is null              then 'no_product'
           when ol.unit_cost_at_sale is not null  then 'costed'
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

alter table order_lines drop column extra_unit_cost;

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0061 rollback FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0061 rollback OK: back at 0060.';
end
$$;
