-- ============================================================================
-- MENU MASTER NG
-- 0043: customer detail, and tenant scope on order lines
--
-- Requires: 0001-0042 applied.
--
-- Two small additions, no behaviour change.
--
--   customers.notes / .company  -- what a caterer needs to remember about a
--     client. Deliberately nothing more: no address, no birthday, no marketing
--     consent. Data not collected cannot be leaked.
--
--   order_lines.business_id  -- every other tenant table carries it. Without
--     it, every sales query must join orders to scope by business, and a
--     reporting view can silently lose that join. Backfilled from the parent
--     order, then made NOT NULL, with the composite foreign key the rest of
--     the schema uses so a line can never point at another account's order.
--
--     A denormalised column is only safe while it cannot disagree with the
--     row it was copied from, so it is not the caller's to set. A trigger
--     derives it from the parent order on every insert and update, and
--     refuses a value that contradicts that order. Callers that already
--     insert order lines keep working unchanged; callers that try to place
--     a line in another business are stopped.
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'order_lines' and column_name = 'business_id') then
    raise exception '0043 preflight FAILED: order_lines.business_id already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0043 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

alter table customers
  add column notes   text,
  add column company text;

comment on column customers.company is
  'The organisation a customer orders for, when that differs from their name.';

alter table order_lines add column business_id uuid;

update order_lines ol
   set business_id = o.business_id
  from orders o
 where o.id = ol.order_id
   and ol.business_id is null;

do $$
declare v_orphan int;
begin
  select count(*) into v_orphan from order_lines where business_id is null;
  if v_orphan > 0 then
    raise exception '0043 FAILED: % order line(s) have no business after backfill. '
                    'Refusing to add NOT NULL over unresolved rows.', v_orphan;
  end if;
end
$$;

alter table order_lines alter column business_id set not null;

alter table order_lines
  add constraint fk_order_lines_business_id_account
  foreign key (business_id, account_id) references businesses(id, account_id);

-- The line always belongs to whatever business the order belongs to. Derived,
-- never supplied. A caller that supplies a different one is making a mistake
-- that would put revenue under the wrong business, so it is refused loudly
-- rather than silently overwritten.
create or replace function fn_order_line_scope()
returns trigger
language plpgsql
as $fn$
declare v_business uuid;
begin
  select o.business_id into v_business from orders o where o.id = new.order_id;
  if v_business is null then
    raise exception 'Order % not found; cannot scope this line.', new.order_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.business_id is not null and new.business_id <> v_business then
    raise exception
      'This line belongs to an order in a different business. Add it to that order instead.'
      using errcode = 'check_violation';
  end if;

  new.business_id := v_business;
  return new;
end
$fn$;

-- Fires before the tenant foreign key is checked, and before the revenue and
-- freeze guards care about it, so an ordinary insert never has to name it.
create trigger trg_order_lines_scope
  before insert or update on order_lines
  for each row execute function fn_order_line_scope();

do $$
declare v_pol int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'order_lines' and column_name = 'business_id'
                    and is_nullable = 'NO') then
    raise exception '0043 self-check FAILED: business_id is missing or nullable.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'fk_order_lines_business_id_account') then
    raise exception '0043 self-check FAILED: the tenant foreign key is missing.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'order_lines' and t.tgname = 'trg_order_lines_scope') then
    raise exception '0043 self-check FAILED: the scope trigger is missing.';
  end if;
  if exists (select 1 from order_lines ol join orders o on o.id = ol.order_id
              where ol.business_id <> o.business_id) then
    raise exception '0043 self-check FAILED: a line disagrees with its order.';
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0043 self-check FAILED: policy count moved to %.', v_pol;
  end if;
  raise notice '0043 OK: customer detail added, order lines scoped and derived, 116 policies unchanged.';
end
$$;
