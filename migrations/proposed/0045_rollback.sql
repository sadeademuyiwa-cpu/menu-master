-- Rollback for 0045.
--
-- Restores the insert-time freeze, the guard that refused every change to a
-- frozen cost, the 'confirmed' status default, and fn_finalise_order's own
-- body. fn_frozen_sale_cost and the frozen_sale_cost type are dropped last,
-- after fn_freeze_sale_cost has stopped depending on them.
--
-- Note: this restores the *mechanism*. It cannot un-freeze lines that were
-- frozen at confirmation, and must not try to -- those are confirmed sales.
begin;

alter table orders alter column status set default 'confirmed';

drop trigger if exists trg_orders_lifecycle on orders;
drop function if exists fn_guard_order_lifecycle();
drop function if exists fn_confirm_order(uuid);

create or replace function fn_finalise_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_o orders%rowtype; v_lines integer;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'finalising orders');

  if v_o.voided_at is not null then
    raise exception 'Order % is voided and cannot be finalised', p_order_id
      using errcode='check_violation';
  end if;
  if v_o.finalised_at is not null then
    raise exception 'Order % is already finalised', p_order_id
      using errcode='check_violation';
  end if;

  select count(*) into v_lines from order_lines where order_id = p_order_id;
  if v_lines = 0 then
    raise exception 'Order % has no lines', p_order_id using errcode='check_violation';
  end if;

  update orders set finalised_at = now(), finalised_by = auth.uid() where id = p_order_id;

  return jsonb_build_object('finalised', true, 'order_id', p_order_id, 'lines', v_lines);
end;
$fn$;

create or replace function fn_guard_frozen_cost()
returns trigger
language plpgsql
as $fn$
begin
  if new.cost_snapshot_id is distinct from old.cost_snapshot_id
     or new.unit_cost_at_sale is distinct from old.unit_cost_at_sale then
    raise exception
      'The cost frozen at sale time cannot be changed. Reverse the sale instead.'
      using errcode='check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_order_lines_frozen on order_lines;
create trigger trg_order_lines_frozen
  before update on order_lines
  for each row execute function fn_guard_frozen_cost();

create or replace function fn_freeze_sale_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  s cost_snapshots%rowtype;
begin
  if new.recipe_id is null then
    new.cost_snapshot_id  := null;
    new.unit_cost_at_sale := null;
    return new;
  end if;

  if new.variant_id is not null then
    -- what was actually sold is the variant, so that is what is frozen
    select * into s
    from cost_snapshots
    where variant_id = new.variant_id
    order by computed_at desc, seq desc
    limit 1;
  else
    -- unchanged legacy path: recipe-level snapshots only
    select * into s
    from cost_snapshots
    where recipe_id = new.recipe_id and variant_id is null
    order by computed_at desc, seq desc
    limit 1;
  end if;

  -- The gate applies here too. An incomplete cost is not a cost.
  if not found or not s.is_complete or s.cost_per_portion is null then
    new.cost_snapshot_id  := null;
    new.unit_cost_at_sale := null;
  else
    new.cost_snapshot_id  := s.id;
    new.unit_cost_at_sale := s.cost_per_portion;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_order_lines_freeze on order_lines;
create trigger trg_order_lines_freeze
  before insert on order_lines
  for each row execute function fn_freeze_sale_cost();

drop function if exists fn_frozen_sale_cost(uuid, uuid, uuid);
drop type if exists frozen_sale_cost;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('fn_confirm_order','fn_frozen_sale_cost',
                                  'fn_guard_order_lifecycle')) then
    raise exception '0045 rollback FAILED: a 0045 function survived.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'order_lines' and t.tgname = 'trg_order_lines_freeze') then
    raise exception '0045 rollback FAILED: the insert-time freeze was not restored.';
  end if;
  if (select column_default from information_schema.columns
       where table_name = 'orders' and column_name = 'status')
     is distinct from '''confirmed''::order_status' then
    raise exception '0045 rollback FAILED: the status default was not restored.';
  end if;
  raise notice '0045 rollback OK: insert-time freeze restored.';
end
$$;

commit;
