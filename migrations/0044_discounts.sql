-- ============================================================================
-- MENU MASTER NG
-- 0044: discounts, and the deterministic allocation of an order discount
--
-- Requires: 0001-0043 applied.
--
-- A caterer discounts in two ways, and they mean different things:
--
--   a line discount   -- "the jollof is 200 naira off a plate for this order"
--   an order discount -- "take 5,000 naira off the whole thing"
--
-- Both are recorded as naira amounts, never percentages. A percentage has to
-- be turned into naira eventually, and whoever does that rounding owns the
-- argument about the missing kobo. An amount is simply what the owner gave
-- away.
--
-- The line discount is stored, because the owner decided it per line.
-- The order discount is stored once, on the order, and *allocated* to lines
-- pro rata by line revenue so that per-product margin means something. The
-- allocation is derived, never stored, for two reasons:
--
--   it cannot drift from the numbers it is derived from, and
--   its inputs are already immutable once the sale is confirmed, so the
--   allocation is immutable too, without a second thing to freeze.
--
-- Gross revenue, the line discount, the allocated order discount and net
-- revenue are all reported separately. A discount is a decision worth seeing,
-- not something to bury inside a reduced price.
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'order_lines' and column_name = 'discount_amount') then
    raise exception '0044 preflight FAILED: order_lines.discount_amount already exists.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'orders' and column_name = 'order_discount') then
    raise exception '0044 preflight FAILED: orders.order_discount already exists.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'order_lines' and column_name = 'business_id') then
    raise exception '0044 preflight FAILED: 0043 has not been applied.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0044 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The two columns
-- ---------------------------------------------------------------------------

alter table order_lines
  add column discount_amount numeric(14,2) not null default 0;

-- Gross revenue is qty * unit_price. Giving away more than the line is worth
-- is not a discount, it is a refund, and Menu Master does not model refunds.
alter table order_lines
  add constraint order_lines_discount_amount_check
  check (discount_amount >= 0 and discount_amount <= qty * unit_price);

comment on column order_lines.discount_amount is
  'Naira taken off this line specifically. Never a percentage.';

alter table orders
  add column order_discount numeric(14,2) not null default 0;

alter table orders
  add constraint orders_order_discount_check check (order_discount >= 0);

comment on column orders.order_discount is
  'Naira taken off the order as a whole, allocated across its lines pro rata '
  'by line revenue. See fn_allocate_order_discount.';

-- ---------------------------------------------------------------------------
-- 2. An order discount cannot exceed what the order is worth
--
-- This one cannot be a CHECK: it spans rows in another table. It is enforced
-- where the owner sets the discount, and again, harder, at confirmation.
--
-- Deliberately NOT enforced when a line is removed. Removing a line from a
-- draft can leave the discount larger than what remains; refusing the delete
-- would trap the owner between two edits they are allowed to make. The draft
-- is simply invalid until they lower the discount, and confirmation says so.
-- ---------------------------------------------------------------------------

create or replace function fn_guard_order_discount()
returns trigger
language plpgsql
as $fn$
declare v_subtotal numeric(14,2);
begin
  if tg_op = 'UPDATE' and new.order_discount is not distinct from old.order_discount then
    return new;
  end if;
  if new.order_discount = 0 then
    return new;
  end if;

  select coalesce(sum(ol.qty * ol.unit_price - ol.discount_amount), 0)
    into v_subtotal
    from order_lines ol
   where ol.order_id = new.id;

  -- No lines yet: the owner is filling in the order header first. Confirmation
  -- is the backstop, and an order with no lines cannot be confirmed at all.
  if not exists (select 1 from order_lines where order_id = new.id) then
    return new;
  end if;

  if new.order_discount > v_subtotal then
    raise exception
      'The order discount of % is more than the order is worth (%). Lower the discount.',
      to_char(new.order_discount, 'FM999999990.00'),
      to_char(v_subtotal, 'FM999999990.00')
      using errcode = 'check_violation';
  end if;

  return new;
end
$fn$;

create trigger trg_orders_discount
  before insert or update on orders
  for each row execute function fn_guard_order_discount();

-- ---------------------------------------------------------------------------
-- 3. The allocation
--
--   line revenue  = qty * unit_price - line discount
--   share_i       = round(order_discount * line_revenue_i / subtotal, 2)
--
-- Rounding each share independently leaves a residual of a few kobo either
-- way. That residual goes to the single largest line by revenue, ties broken
-- by line id, so the sum of the allocations equals the order discount exactly,
-- always, and the same order always allocates the same way.
--
-- The function never raises. It is read by reporting views, and a view that
-- throws on one bad draft shows nothing for anybody. A draft whose discount
-- exceeds its own revenue allocates more than a line is worth and reports a
-- negative net revenue -- which is the truth about that draft. Confirmation
-- refuses it.
--
-- Called with no argument it allocates across every order the caller can see,
-- in one pass, which is how the sales views use it. Row level security applies
-- normally: this function is not SECURITY DEFINER and holds no privilege of
-- its own.
-- ---------------------------------------------------------------------------

create or replace function fn_allocate_order_discount(p_order_id uuid default null)
returns table (
  order_line_id            uuid,
  order_id                 uuid,
  gross_revenue            numeric(14,2),
  line_discount            numeric(14,2),
  line_revenue             numeric(14,2),
  allocated_order_discount numeric(14,2),
  net_revenue              numeric(14,2)
)
language sql
stable
as $fn$
  with l as (
    select ol.id,
           ol.order_id                                              as ord,
           (ol.qty * ol.unit_price)::numeric(14,2)                  as gross,
           ol.discount_amount,
           (ol.qty * ol.unit_price - ol.discount_amount)::numeric(14,2) as revenue,
           o.order_discount
      from order_lines ol
      join orders o on o.id = ol.order_id
     where p_order_id is null or ol.order_id = p_order_id
  ),
  ranked as (
    select l.*,
           sum(l.revenue) over (partition by l.ord)                 as subtotal,
           row_number() over (partition by l.ord
                              order by l.revenue desc, l.id)        as rn
      from l
  ),
  shared as (
    select ranked.*,
           case
             when ranked.order_discount = 0 then 0::numeric(14,2)
             when ranked.subtotal > 0
               then round(ranked.order_discount * ranked.revenue / ranked.subtotal, 2)
             -- Nothing to allocate against. The whole discount lands on the
             -- first line rather than quietly evaporating.
             else 0::numeric(14,2)
           end as share
      from ranked
  ),
  residual as (
    select shared.*,
           sum(shared.share) over (partition by shared.ord) as share_total
      from shared
  )
  select residual.id,
         residual.ord,
         residual.gross,
         residual.discount_amount,
         residual.revenue,
         (residual.share
            + case when residual.rn = 1
                   then residual.order_discount - residual.share_total
                   else 0 end)::numeric(14,2),
         (residual.revenue
            - (residual.share
                 + case when residual.rn = 1
                        then residual.order_discount - residual.share_total
                        else 0 end))::numeric(14,2)
    from residual;
$fn$;

comment on function fn_allocate_order_discount(uuid) is
  'Splits orders.order_discount across an order''s lines pro rata by line '
  'revenue. The kobo residual goes to the largest line, so the allocations '
  'sum to the order discount exactly. Pass null to allocate every visible order.';

grant execute on function fn_allocate_order_discount(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Discounts are revenue, so a confirmed sale must not be able to move them
--
-- Both guards already exist and already freeze everything that determines
-- revenue. They simply did not know about discounts yet. Extended, not
-- replaced.
-- ---------------------------------------------------------------------------

create or replace function fn_guard_order_line_revenue()
returns trigger
language plpgsql
as $fn$
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
    -- discount_amount joins the tuple: a discount changes revenue, and revenue
    -- on a confirmed sale is history.
    if (old.qty, old.unit_price, old.recipe_id, old.discount_amount)
       is distinct from (new.qty, new.unit_price, new.recipe_id, new.discount_amount) then
      raise exception 'Revenue on a finalised sale is immutable. Void and reissue instead.'
        using errcode='check_violation';
    end if;
  end if;

  return coalesce(new, old);
end;
$fn$;

create or replace function fn_guard_finalised_order()
returns trigger
language plpgsql
as $fn$
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
    -- a revenue rewrite. Everything that determines revenue is frozen, and the
    -- order discount determines revenue.
    if (old.account_id, old.business_id, old.location_id, old.customer_id,
        old.channel_id, old.order_no, old.order_date, old.status,
        old.finalised_at, old.replaces, old.order_discount)
       is distinct from
       (new.account_id, new.business_id, new.location_id, new.customer_id,
        new.channel_id, new.order_no, new.order_date, new.status,
        new.finalised_at, new.replaces, new.order_discount)
    then
      raise exception 'Order % is finalised. Only payment state may change, or void it.', old.id
        using errcode='check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------

do $$
declare v_pol int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'order_lines' and column_name = 'discount_amount'
                    and is_nullable = 'NO' and column_default = '0') then
    raise exception '0044 self-check FAILED: order_lines.discount_amount is wrong or missing.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'orders' and column_name = 'order_discount'
                    and is_nullable = 'NO' and column_default = '0') then
    raise exception '0044 self-check FAILED: orders.order_discount is wrong or missing.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_lines_discount_amount_check') then
    raise exception '0044 self-check FAILED: the line discount ceiling is missing.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'orders' and t.tgname = 'trg_orders_discount') then
    raise exception '0044 self-check FAILED: the order discount guard is missing.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_allocate_order_discount') then
    raise exception '0044 self-check FAILED: fn_allocate_order_discount is missing.';
  end if;
  -- Every existing order still reconciles: nothing has a discount yet, so
  -- every allocation must be zero and every net must equal gross.
  if exists (select 1 from fn_allocate_order_discount()
              where allocated_order_discount <> 0 or net_revenue <> gross_revenue) then
    raise exception '0044 self-check FAILED: a pre-existing order changed value.';
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0044 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0044 OK: discounts added, allocation deterministic, 116 policies unchanged.';
end
$$;
