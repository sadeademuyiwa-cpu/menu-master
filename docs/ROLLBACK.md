# Menu Master NG — Rollback Procedure

Founder ruling C6: idempotence guards plus a documented manual rollback. No
down-migrations were built for Gate 1.

## What is and is not idempotent

| Migrations | Idempotent | Why |
|---|---|---|
| `0001`–`0012` | **No** | Recovered forensic originals. They are immutable and cannot be edited to add guards without destroying their provenance. Apply them **once, to an empty database, in order**. |
| `0013`–`0016` | **Yes** | Verified by re-applying all four to an already-migrated database: clean, no duplication. |

`0002` must always be executed **alone**, and confirmed, before `0003`. Postgres
refuses to use an enum value in the transaction that created it.

## Rollback by scenario

### A migration fails mid-run

Each migration is applied in its own transaction with `ON_ERROR_STOP=1`, so a
failure rolls that migration back whole. Fix the cause and re-run it. For
`0013`–`0016` re-running is always safe.

### 0013 refuses to apply

By design. It found rows with `amount <= 0` and stopped rather than mutate
financial history. Reverse the offending purchases through
`fn_reverse_purchase`, or correct the amounts, then re-run. **Do not delete the
rows to make the constraint fit.**

### Undoing 0016 (role function permissions)

```sql
-- restores the 0012 definition: no trigger-depth relaxation
create or replace function fn_require_cost_access(p_account_id uuid)
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if fn_is_service_context() then return; end if;
  if p_account_id is null or not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account' using errcode = '42501';
  end if;
  if not fn_can_see_costs(p_account_id) then
    raise exception 'Your role does not permit access to cost information'
      using errcode = '42501';
  end if;
end; $$;
```
**Consequence:** kitchen and sales users can no longer perform any action that
triggers a cost recomputation. Re-apply 0016 to restore.

### Undoing 0015 (write-side role enforcement)

```sql
do $$ declare t text; begin
  foreach t in array array[
    'businesses','locations','ingredient_categories','ingredients',
    'ingredient_unit_conversions','suppliers','business_settings',
    'costing_method_changes','recipes','recipe_lines','labour_rates',
    'recipe_labour','overhead_items','channels','purchases','purchase_lines',
    'customers','orders','order_lines','sales_entries','period_closes']
  loop
    execute format('drop policy if exists p_%I_select on %I', t, t);
    execute format('drop policy if exists p_%I_insert on %I', t, t);
    execute format('drop policy if exists p_%I_update on %I', t, t);
    execute format('drop policy if exists p_%I_delete on %I', t, t);
    execute format('create policy p_%I on %I for all
       using (fn_is_account_member(account_id))
       with check (fn_is_account_member(account_id))', t, t);
  end loop;
end $$;
```
**Consequence:** returns to the 0001 blanket policy. Every member regains write
access to all 21 tables. This re-opens P1.4 and should be a last resort.

### Undoing 0014 (sales void-and-reissue)

Drop the triggers to restore mutable revenue; leave the columns in place, since
dropping them would destroy void history.

```sql
drop trigger if exists trg_orders_finalised     on orders;
drop trigger if exists trg_order_lines_revenue  on order_lines;
drop trigger if exists trg_sales_entries_immutable on sales_entries;
```
Views keep excluding voided sales, which remains correct.

### Undoing 0013 (zero-value amounts)

```sql
alter table purchase_lines    drop constraint if exists ck_purchase_lines_amount_positive;
alter table ingredient_prices drop constraint if exists ck_ingredient_prices_amount_positive;
```
`fn_post_purchase` keeps its zero-value blocker, which is the second line of
defence and harmless to leave in place.

### Full rollback

There is none that preserves data. The chain is not reversible to an
intermediate state because `0001`–`0012` are single-shot. Full rollback means
**restore from backup**. Take one before applying anything to a database that
holds real records.

## Before any production run

1. Take a verified backup and record the timestamp.
2. Apply to a disposable copy first, and run all four suites.
3. Confirm `0002` committed alone before `0003`.
4. Only then apply to production.
