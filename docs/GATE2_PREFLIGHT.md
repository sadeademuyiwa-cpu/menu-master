# GATE 2 — PREFLIGHT

**Read-only. No SQL written for 0021, nothing executed in production.**

Scope authority: `docs/GATE2_FINAL_DESIGN.md`, followed exactly. Nothing from
Gate 3 (billing, entitlement, revenue) appears here.

Preflight script: `deploy/runbook/G2_PREFLIGHT.sql`
sha256 `f8be9f6494bc9bfb85160510479802e122cabd1146533c79fb7ebfb91ed585e6`
Pure SELECT, 31 rows, no transaction required, safe to re-run.

---

## 1. Baseline — the exact state 0021 is built against

Verified on a PostgreSQL **17.6** replica built from `0001`–`0018` + the `0020`
schema body, seeded to match production (5 auth users, 0 tenant rows):

| | Value |
|---|---|
| `fn_*` functions in `public` | **40** |
| Relations in `public` | **44** |
| Policies in `public` | **93** |
| RLS | enabled on every base table |
| Onboarding RPC | `fn_create_account_and_business`, 9 args (0020) |
| `handle_new_user` | neutralised (0019c) |
| `trg_memberships_last_owner` | present, enabled |
| `auth.users` | 5, protected, untouched |
| Tenant rows | 0 |
| `anon` | SELECT on exactly 5 reference tables, EXECUTE on 0 functions |

Preflight result on that replica: **28 GO, 3 INFORMATIONAL, 0 STOP.**

The same script must return the same verdicts against production before 0021
is written. Rows 3/4/5 are the ones that matter most — if the shape is not
40/44/93, the schema has drifted since C5 and everything below is void.

## 2. Dependencies — all present, none created by 0021

Functions `fn_is_account_member`, `fn_can_see_costs`, `fn_require_member`,
`fn_require_cost_access`, `fn_assert_unit_visible`, `fn_can_resolve_unit`,
`fn_resolve_qty_to_base` — 7 of 7 present.

Tables `accounts`, `businesses`, `business_settings`, `units`, `ingredients`,
`recipes`, `recipe_lines`, `recipe_prices`, `cost_snapshots`, `order_lines`,
`sales_entries` — 11 of 11 present.

Enums: `unit_kind` includes `container` (0002) — required for the D3 capacity
basis. `item_kind` includes `packaging` (D4). `exclusion_reason` already exists
with the four labels `serving_format_packaging` needs, so **no new exclusion
enum is required** — 0021 reuses it.

Composite-key parents `ux_businesses_id_account` and `ux_ingredients_id_account`
exist (0004).

## 3. Two findings that change how 0021 must be written

Both were proven on the replica, not inferred.

### F1 — `fn_assert_unit_visible` cannot be reused as the design assumes

`GATE2_FINAL_DESIGN.md` §3 says the unit-visibility trigger reuses
`fn_assert_unit_visible`. It cannot. The 0004 function hardcodes `new.unit_id`,
and the Gate 2 columns are `capacity_unit_id`, `sellable_unit_id` and
`overhead_basis_unit_id`. Attaching it to such a table and inserting gives:

```
record "new" has no field "unit_id"
```

**Resolution, within the lock:** 0021 adds a new sibling
`fn_assert_unit_visible_col()` reading the column name from `TG_ARGV[0]`, and
leaves the 0004 function untouched. `0001`–`0016` are not modified and the
existing three triggers keep their current behaviour bit for bit.

### F2 — `recipes` has no `unique (id, business_id)`; 0021 must add it

The design requires `recipe_variants` FK `(recipe_id, business_id)` →
`recipes(id, business_id)`. 0004 created `(id, account_id)` composite keys on
14 tables; it created **no `(id, business_id)` key anywhere**. On the replica:

```
there is no unique constraint matching given keys for referenced table "recipes"
```

**Resolution:** 0021 adds `ux_recipes_id_business unique (id, business_id)`.
Purely additive and always satisfiable, since `id` is already the primary key.
This is the only structural change 0021 makes to a pre-existing Gate 1 table
beyond adding nullable columns, and it is required by the approved design.

## 4. Scope of migration 0021 — Phase 1 (structural) only

`GATE2_FINAL_DESIGN.md` §9 defines five phases. **0021 is Phase 1 and nothing
else.** Zero behavioural change: no costing formula moves, no view repoints, no
existing read path changes.

**Types (+1)** — `variant_costing_basis` as enum `('capacity','explicit_qty')`

**Tables (+4)** — `serving_formats`, `recipe_variants`,
`serving_format_packaging`, `serving_format_changes`, with the columns,
constraints and composite keys in §2 and §3 of the design.

**Nullable columns on existing tables (+10), nothing dropped**

| Table | Columns |
|---|---|
| `business_settings` | `overhead_basis_qty`, `overhead_basis_unit_id` |
| `cost_snapshots` | `variant_id`, `resolved_qty`, `resolved_unit_id`, `basis_used`, `format_packaging_cost` |
| `recipe_prices` | `variant_id` |
| `order_lines` | `variant_id` |
| `sales_entries` | `variant_id` |

**Constraints on existing tables (+4)** — `ux_recipes_id_business` (F2);
`chk_variant_matches_recipe` on `order_lines` and on `sales_entries`;
`chk_complete_requires_resolution` on `cost_snapshots`.

**Trigger functions (+7, all `fn_*`)** — `fn_assert_unit_visible_col` (F1),
`fn_assert_packaging_item_kind`, `fn_log_serving_format_change`,
`fn_block_format_change_mutation`, `fn_reject_variant_on_inactive_format`,
`fn_reject_sale_on_inactive_format`, `fn_assert_no_packaging_double_count`.

**Policies (+14)** — SELECT/INSERT/UPDATE/DELETE on each of `serving_formats`,
`recipe_variants` and `serving_format_packaging` (12), plus SELECT/INSERT only
on the append-only `serving_format_changes` (2). Cost-role gating via
`fn_can_see_costs` on `serving_format_packaging`, per design §8.

**Grants** — `authenticated` only. `anon` receives nothing: the 0018 invariant
(`anon` holds SELECT on exactly 5 reference tables and EXECUTE on no `fn_*`)
must be unchanged after 0021, and the gate asserts it.

### Expected counts after 0021

| | Before | After |
|---|---|---|
| `fn_*` | 40 | **47** |
| Relations | 44 | **48** |
| Policies | 93 | **107** |
| `anon` SELECT tables | 5 | **5** (unchanged) |
| `anon` EXECUTE on `fn_*` | 0 | **0** (unchanged) |

These become the gate's assertions. They also supersede the `40/44/93` literals
in `C2_PART5_GATE.sql`, `C3_0019C_GATE.sql`, `C4_0020_GATE.sql` and
`C4_0020_PREFLIGHT.sql`, which will report a false STOP once 0021 is applied.
Those files are historical records of passed gates; they are **not** to be
edited retroactively. The Gate 2 gate carries the new numbers.

### Explicitly out of scope for 0021

Phase 2 backfill (0022), Phase 3 overhead basis (0023), Phase 4 cutover
regression (0024), Phase 5 view and `fn_freeze_sale_cost` repoint (0025).
`recipes.portion_qty` and `business_settings.expected_monthly_units` are
**retained and deprecated**, never dropped. No Gate 3 work of any kind.

## 5. Rollback strategy

Phase 1 is additive throughout and writes no data, so rollback removes objects
rather than restoring state. `G2_0021_ROLLBACK.sql` will drop, in dependency
order: the 4 tables, the 14 policies with them, the 4 constraints, the 10
columns, the 7 functions, and the enum. Nothing pre-existing is touched.

Two properties make this safe rather than merely reversible:

1. **No existing read path changes in 0021**, so a rollback cannot alter a cost,
   a price or a snapshot. Every legacy column survives.
2. **Production holds 0 tenant rows**, so there is no Gate 2 data to lose. This
   also means the Phase 2 backfill will be a **no-op in production** — it must
   still be written and tested, because the test suites do build data.

`chk_complete_requires_resolution` is the one constraint that could fail on a
populated database: an existing `is_complete` snapshot has `resolved_qty` NULL.
Preflight row 31 counts them. Production returns **0**, so it can be added
`VALID`. Any environment returning non-zero must add it `NOT VALID` instead —
the migration will branch on the count rather than assume.

## 6. Gate for this preflight

Proceed to write 0021 only when `G2_PREFLIGHT.sql` returns, against production:

- rows 1–27 all **GO**
- rows 23, 28, 29 **INFORMATIONAL** (row 23 must read `absent, as expected`)
- rows 30, 31 **GO** — if either reads OPERATOR CHECK or STOP, the D1 exposure
  or the snapshot constraint needs resolving first
- **zero STOP anywhere**
