-- Rollback for 0044.
--
-- The two revenue guards are restored to their 0043 text, not merely dropped:
-- dropping them would leave a finalised sale editable, which is worse than the
-- state we are rolling back from.
begin;

drop trigger if exists trg_orders_discount on orders;
drop function if exists fn_guard_order_discount();
drop function if exists fn_allocate_order_discount(uuid);

alter table order_lines drop constraint if exists order_lines_discount_amount_check;
alter table order_lines drop column if exists discount_amount;

alter table orders drop constraint if exists orders_order_discount_check;
alter table orders drop column if exists order_discount;

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
    if (old.qty, old.unit_price, old.recipe_id)
       is distinct from (new.qty, new.unit_price, new.recipe_id) then
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
$fn$;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'order_lines' and column_name = 'discount_amount')
   or exists (select 1 from information_schema.columns
              where table_name = 'orders' and column_name = 'order_discount') then
    raise exception '0044 rollback FAILED: a discount column survived.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'order_lines' and t.tgname = 'trg_order_lines_revenue')
   or not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'orders' and t.tgname = 'trg_orders_finalised') then
    raise exception '0044 rollback FAILED: a revenue guard is no longer attached.';
  end if;
  raise notice '0044 rollback OK: discounts removed, revenue guards restored.';
end
$$;

commit;
