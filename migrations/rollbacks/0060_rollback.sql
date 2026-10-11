-- ============================================================================
-- 0060 ROLLBACK: back at 0059.
-- Drops the two new functions and the base-unit lock, restores the 0014
-- fn_reissue_order (empty replacement), and drops the two columns. Purchases
-- already corrected stay corrected: the original is still 'reversed' and the
-- corrected one still 'posted'; only the replaced_by link between them is
-- lost. A customer put away comes back into the list.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0060 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='purchases' and column_name='replaced_by') then
    raise exception '0060 rollback: purchases.replaced_by does not exist; 0060 is not applied.';
  end if;
end
$$;

drop function if exists fn_correct_purchase(uuid, date, uuid, text, text, jsonb);
drop function if exists fn_recompute_business_recipes(uuid);
drop trigger if exists trg_ingredients_base_unit_locked on ingredients;
drop function if exists fn_trg_ingredient_base_unit_locked();
alter table purchases drop column replaced_by;
alter table customers drop column deleted_at;

-- Byte-faithful to 0014.
create or replace function fn_reissue_order(p_voided_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_o orders%rowtype; v_new uuid; v_no text; v_n integer := 1;
begin
  select * into v_o from orders where id = p_voided_order_id for update;
  if not found then raise exception 'Order % not found', p_voided_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'reissuing orders');

  if v_o.voided_at is null then
    raise exception 'Only a voided order can be reissued' using errcode='check_violation';
  end if;

  -- orders carries unique (business_id, order_no), so the replacement needs a
  -- distinct reference. -R, -R2, -R3 ... until one is free.
  if v_o.order_no is not null then
    v_no := v_o.order_no || '-R';
    while exists (select 1 from orders where business_id = v_o.business_id and order_no = v_no) loop
      v_n := v_n + 1;
      v_no := v_o.order_no || '-R' || v_n;
    end loop;
  end if;

  insert into orders (account_id, business_id, location_id, customer_id, channel_id,
                      order_no, order_date, status, created_by, replaces)
  values (v_o.account_id, v_o.business_id, v_o.location_id, v_o.customer_id, v_o.channel_id,
          v_no, current_date, 'draft', auth.uid(), v_o.id)
  returning id into v_new;

  return jsonb_build_object('reissued', true,
    'replaces', p_voided_order_id, 'new_order_id', v_new, 'order_no', v_no,
    'next_step', 'add_corrected_lines_then_finalise');
end;
$$;

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 95 then
    raise exception '0060 rollback FAILED: fn_* count is %, expected 95.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0060 rollback OK: back at 0059.';
end
$$;
