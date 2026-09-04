-- ============================================================================
-- 0049 ROLLBACK: back to the 0048 entitlement model
--
-- Restores the thirteen Sales write policies to their 0048 form -- role lists
-- intact, fn_account_has_sales removed -- and drops everything 0049 added.
--
-- WHAT THIS DELIBERATELY DOES NOT UNDO
--   Nothing: 0049 wrote no customer data. founder_slots is dropped with its
--   hundred seeded rows because no slot can have been claimed while checkout
--   does not exist. If ANY slot has been claimed, this refuses to run -- a
--   claimed slot is a commercial promise and must not vanish silently.
-- ============================================================================

-- Same guard as the forward migration. A rollback that half-applies is worse
-- than no rollback at all: it is the recovery path, and it runs at the moment
-- something has already gone wrong. Two statements in one transaction share
-- one xid; under autocommit they do not.
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0049 rollback ABORT: this executor is not honouring '
      'transaction control (each statement is committing on its own). Do NOT '
      'run it here. Run it with psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='founder_slots') then
    raise exception '0049 rollback: founder_slots does not exist; 0049 is not applied.';
  end if;
  if exists (select 1 from founder_slots where claimed_at is not null) then
    raise exception '0049 rollback REFUSED: % founder slot(s) have been claimed. '
                    'Rolling back would erase a commercial commitment.',
      (select count(*) from founder_slots where claimed_at is not null);
  end if;
end
$$;

-- orders
drop policy p_orders_insert on orders;
create policy p_orders_insert on orders for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_orders_update on orders;
create policy p_orders_update on orders for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_orders_delete on orders;
create policy p_orders_delete on orders for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id));

-- order_lines
drop policy p_order_lines_insert on order_lines;
create policy p_order_lines_insert on order_lines for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_order_lines_update on order_lines;
create policy p_order_lines_update on order_lines for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_order_lines_delete on order_lines;
create policy p_order_lines_delete on order_lines for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));

-- customers
drop policy p_customers_insert on customers;
create policy p_customers_insert on customers for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_customers_update on customers;
create policy p_customers_update on customers for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_customers_delete on customers;
create policy p_customers_delete on customers for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id));

-- channels
drop policy p_channels_insert on channels;
create policy p_channels_insert on channels for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_channels_update on channels;
create policy p_channels_update on channels for update using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id))
with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager']::member_role[])
  and fn_account_is_entitled(account_id));
drop policy p_channels_delete on channels;
create policy p_channels_delete on channels for delete using (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner']::member_role[])
  and fn_account_is_entitled(account_id));

-- sales_entries
drop policy p_sales_entries_insert on sales_entries;
create policy p_sales_entries_insert on sales_entries for insert with check (
  fn_is_account_member(account_id)
  and fn_has_account_role(account_id, array['owner','manager','sales']::member_role[])
  and fn_account_is_entitled(account_id));

drop function if exists fn_forfeit_founding_price(uuid, text);
drop function if exists fn_confirm_founder_slot(uuid);
drop function if exists fn_claim_founder_slot(uuid, interval);
drop function if exists fn_account_has_sales(uuid);

drop table if exists founding_price_policy;
drop table if exists founder_slots;

delete from plan_features where plan_id in ('founding_costing','founding_trading');
delete from plans        where id      in ('founding_costing','founding_trading');

alter table subscriptions drop constraint if exists subscriptions_price_kobo_check;
alter table subscriptions drop column if exists founding_price_active;
alter table subscriptions drop column if exists cancel_at_period_end;
alter table subscriptions drop column if exists provider_subscription_code;
alter table subscriptions drop column if exists provider_customer_code;
alter table subscriptions drop column if exists price_kobo;

update plans set monthly_price = 0 where id in ('costing','trading');
alter table plans drop constraint if exists plans_price_kobo_check;
alter table plans drop constraint if exists plans_price_tier_check;
alter table plans drop constraint if exists plans_tier_check;
alter table plans drop column if exists price_kobo;
alter table plans drop column if exists price_tier;
alter table plans drop column if exists tier;

do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 116 then
    raise exception '0049 rollback FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if exists (select 1 from pg_proc where proname='fn_account_has_sales'
               and pronamespace='public'::regnamespace) then
    raise exception '0049 rollback FAILED: fn_account_has_sales still exists.';
  end if;
  raise notice '0049 rollback OK: back at the 0048 entitlement model, 116 policies.';
end
$$;
