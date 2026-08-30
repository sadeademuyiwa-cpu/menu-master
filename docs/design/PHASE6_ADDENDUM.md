# PHASE 6 ADDENDUM — answers to the owner's review
## Design only. No migration, no application code, nothing deployed.

---

## 1. D-5 PROVENANCE INVESTIGATION

### First, a correction to my own design

§5 of the Phase 6 design said the per-format packaging figure was not
recoverable. **That was wrong.** `cost_snapshots.format_packaging_cost` has
existed since 0021, and `fn_compute_variant_cost_snapshot` already writes the
variant's own packaging into it. The blind spot I described does not exist.

### What is actually stored, proven by query

A 2.5 L soup variant — ₦2.00/ml base, ₦150 bowl, 4 h labour at ₦500,
₦60,000 overhead over 600 L:

| Component | Value | Stored? |
|---|---|---|
| Ingredients + labour share | ₦5,500 | **Yes** — `cost_per_yield_unit` (₦2.20) × `resolved_qty` (2,500), both stored |
| Format packaging | ₦150 | **Yes** — `format_packaging_cost` |
| Overhead share | ₦250 | **No** — had to be recomputed live from current config |
| **Total** | **₦5,900** | **Yes** — `cost_per_portion` |

Components reconcile exactly: 5,500 + 150 + 250 = **5,900**.

### The two real blind spots

**B-1 — the variant's overhead share is not stored.** `overhead_cost` is NULL
on a format-based variant snapshot, because a format-based recipe has no
per-portion overhead. The ₦250 above was reconstructed by calling
`fn_overhead_rate` against **today's** configuration. Change the overhead basis
tomorrow and the frozen *total* is still right, but the *breakdown* silently
stops summing to it.

**B-2 — `portion_qty` is not stored on the snapshot.** For a portion sale,
`cost_per_portion = cost_per_yield_unit × portion_qty (+ overhead)`. The
portion size lives on `recipes`, which is mutable. ₦1.70/g × ? = ₦850 — change
the portion size and the "?" is gone, so the breakdown cannot be rebuilt.

### Recommendation — smallest additive mechanism, no second source of truth

**Do not add a child table.** A breakdown table would be a second place where
component figures live, and would need its own RLS, its own immutability
trigger and its own reconciliation. The snapshot row is already immutable
(`fn_block_snapshot_mutation`) and already holds every other component.

**Two nullable columns on `cost_snapshots`, and one refactor:**

1. `portion_qty_at_snapshot numeric` — the portion size used at compute time.
2. `variant_overhead_cost numeric` — the variant's own overhead share.

**The refactor is the important half.** Rather than have the snapshot writer
recompute overhead — creating exactly the duplicate rule that caused the 0040
defect — extract the component arithmetic into one function:

```
fn_variant_cost_components(variant_id, as_of)
  -> (ingredients_labour, packaging, overhead, total)
```

`fn_variant_cost` becomes a thin wrapper returning `.total`, and
`fn_compute_variant_cost_snapshot` stores the components it returns. **One
implementation, two callers** — the same shape as `fn_ingredient_cost_basis`
in 0034, which was introduced to end precisely this class of drift.

**Immutability is untouched.** `ALTER TABLE ADD COLUMN` is DDL, not row
mutation; the trigger still blocks every UPDATE and DELETE. Snapshots written
before this migration keep NULL in the new columns, and that is honest: detail
that was never recorded cannot be invented. The invariant is therefore worded
as the owner worded it — *where component detail exists, it reconciles.*

---

## 2. ATOMIC CONFIRMATION / FREEZE DESIGN

**`fn_finalise_order` already exists** and already does most of this: it takes
`for update` on the order, enforces role, and refuses a voided order, an
already-finalised order, and an order with no lines — all in one transaction.

**Design: extend that function; do not add a parallel one.**

```
fn_confirm_order(order_id):
  lock the order FOR UPDATE
  refuse: voided / already finalised / no lines        (existing behaviour)
  freeze EVERY line in ONE UPDATE statement, from the
    snapshots current at this instant
  set status = 'confirmed', finalised_at = now(), finalised_by = auth.uid()
  return { confirmed, lines_frozen, lines_without_cost }
```

**Atomicity** comes from three things together: the row lock prevents a
concurrent confirmation; the lines are frozen by a **single UPDATE statement**,
which is atomic by definition; and everything runs in one transaction, so any
exception rolls the whole confirmation back. **There is no path to a partially
frozen confirmed order.**

Per the owner's ruling, a line that freezes to NULL COGS under D-2 is a
**valid outcome**, not an error, and does not abort the transaction. The
function reports `lines_without_cost` so the caller can tell the owner plainly.

The row-level `BEFORE INSERT` freeze on `order_lines` is **removed**; drafts
stay live. The identical trigger on `sales_entries` is **kept** — a quick sale
has no draft state and is complete on arrival.

---

## 3. CONFIRMED-ORDER EDITING RULE

**Rule: a confirmed order is never edited. It is voided and reissued.**

This is not a new mechanism — it is the one already built. `fn_void_order`
exists; `orders.replaces` exists; `fn_guard_finalised_order` already refuses
every change to a finalised order except payment state; and
`fn_guard_order_line_revenue` already refuses added, deleted or repriced lines.

```
correction = fn_void_order(original, reason)      -- original preserved, closed
           + new draft cloned from it, replaces = original
           + fn_confirm_order(new)                -- fresh economics, fresh freeze
```

Both records survive and are linked. Nothing historical is rewritten, and no
reversal engine is built. Payment state remains the single thing that may move
after confirmation, because collecting money later is not a revenue rewrite.

---

## 4. MIXED KNOWN / NULL COGS ORDERS

An order with line A costed and line B not must never produce a flattering
margin. The rule:

> **Margin is computed on the costed subset only, and coverage is always shown
> beside it.**

Each reporting grain exposes five figures:

| Figure | Definition |
|---|---|
| `revenue` | all lines, costed or not |
| `costed_revenue` | revenue of lines whose COGS is known |
| `cogs` | Σ frozen COGS of those lines |
| `gross_profit` | **`costed_revenue − cogs`** — never `revenue − cogs` |
| `cost_coverage_pct` | `costed_revenue / revenue` |

Computing `revenue − cogs` would credit uncosted revenue as pure profit and
**overstate margin exactly in the case where least is known** — the failure
mode the owner named. `gross_profit` and `margin` are NULL when
`costed_revenue` is zero.

In the product: **"Cost not available"** on the line, and
**"94% of sales have complete cost information"** on reports, with the
uncosted amount stated in naira so it cannot be waved away.

---

## 5. REVISED FINANCIAL INVARIANTS

The owner's ten, restated as testable assertions, plus the four carried
forward from the original design.

1. **Confirmation-time economics.** Lines added Monday and Wednesday to one
   draft all freeze at the Wednesday confirmation state — not their insertion
   states.
2. **Atomicity.** If any line's freeze raises, the order stays `draft` and no
   line is frozen. A deliberate NULL COGS does not abort.
3. **History does not move.** After confirmation, changing ingredient price,
   purchases, recipe quantity, recipe yield, packaging, labour, overhead,
   format definition or current selling price leaves revenue, COGS, profit and
   margin unchanged. *(Nine separate assertions.)*
4. **NULL stays NULL** through SQL, views, `COALESCE`, reporting and frontend
   formatting. Asserted at each layer, including a browser assertion that no
   uncosted line renders `₦0.00`.
5. **Mixed orders.** A order with one costed and one uncosted line reports
   `gross_profit = costed_revenue − cogs`, and coverage below 100%.
6. **Discount allocation** sums to the order discount exactly, to the kobo.
7. **Component reconciliation.** Where component detail exists, frozen
   components sum to frozen total.
8. **Format economics.** A 2.5 L sale freezes the 2.5 L variant's economics,
   including its own packaging — proven distinct from the 1 L variant's.
9. **Cross-tenant** isolation on customers, orders, order_lines,
   sales_entries, cost_snapshots and every new view — asserted **by identity**,
   not row count.
10. **Cancellation** removes a sale from active reporting while its frozen row
    and cost remain readable.
11. `revenue = Σ(qty × unit_price − line_discount) − order_discount`.
12. `COGS = Σ(qty × frozen_unit_cost)` over costed lines.
13. Gross line revenue, allocated discount and net line revenue are all
    preserved; the original selling price is never destroyed.
14. No missing cost is ever converted to zero.

---

## 6. EXACT MIGRATIONS, FUNCTIONS AND VIEWS THAT WILL CHANGE

| Migration | Changes |
|---|---|
| **0043** | `customers.notes`, `customers.company`; `order_lines.business_id` (backfilled, composite FK, NOT NULL after backfill) |
| **0044** | `order_lines.discount_amount`, `orders.order_discount` + CHECKs; `fn_allocate_order_discount` (new) |
| **0045** | **Freeze point.** Drop `trg_order_lines_freeze`. Amend `fn_guard_frozen_cost` (see §7). Extend `fn_finalise_order` → `fn_confirm_order`. `sales_entries` untouched |
| **0046** | **D-5.** `cost_snapshots.portion_qty_at_snapshot`, `.variant_overhead_cost`; new `fn_variant_cost_components`; `fn_variant_cost` and `fn_compute_variant_cost_snapshot` refactored onto it; `fn_compute_recipe_cost_snapshot` stores `portion_qty_at_snapshot` |
| **0047** | Views: `v_sale_lines`, `v_sales_summary`, `v_product_performance`, `v_orders_attention`, `v_sale_cost_breakdown` |

**Functions changed:** `fn_guard_frozen_cost`, `fn_finalise_order`,
`fn_variant_cost`, `fn_compute_variant_cost_snapshot`,
`fn_compute_recipe_cost_snapshot`.
**Functions added:** `fn_confirm_order`, `fn_allocate_order_discount`,
`fn_variant_cost_components`.
**Trigger removed:** `trg_order_lines_freeze`.
**Unchanged:** `fn_freeze_sale_cost` on `sales_entries`, `fn_void_order`,
`fn_guard_finalised_order`, `fn_guard_order_line_revenue`,
`fn_block_snapshot_mutation`, every RLS policy (count stays 116).

Every migration carries a preflight, `security_invoker` restated on every view,
a self-check asserting the policy count and the structural security guard, and
a rollback verified from a pristine baseline with a fingerprint including
`reloptions` and grants.

---

## 7. CONFLICTS WITH THE EXISTING ARCHITECTURE

Three, all found by inspection. **The first blocks D-1 outright.**

**C-1 — `fn_guard_frozen_cost` would refuse the freeze itself.**
It raises whenever `cost_snapshot_id` changes on UPDATE. Freezing at
confirmation *is* an UPDATE from NULL to a value, so as written it would make
D-1 impossible. **Amendment required:** permit the one-way transition
`NULL → value` while the order is being confirmed, and refuse everything
afterwards — including value → different value, and value → NULL. Without this
amendment D-1 cannot be built.

**C-2 — `orders.status` defaults to `'confirmed'`, not `'draft'`.**
An order inserted without an explicit status is born confirmed and never makes
the `draft → confirmed` transition, so it would never freeze. **Resolution:**
change the default to `'draft'`, and have `fn_confirm_order` be the only way to
reach `confirmed`. Recording it here because it changes what an existing
`INSERT` does.

**C-3 — `status` and `finalised_at` are currently independent.**
Every guard keys on `finalised_at`; `status` is decorative. Rather than build a
second immutability boundary, `fn_confirm_order` sets **both** in the same
statement, so the existing guards engage at exactly the freeze point and there
is one boundary, not two.

**No conflict** with D-2, D-3 or D-4: NULL-not-zero is already the freeze
behaviour; discounts are new columns; `delivered` gains no accounting meaning
and needs no change.

---

## STOPPING HERE FOR REVIEW

Nothing implemented. Awaiting approval of §1 (D-5 approach), §2, §3, §4 and the
three conflict resolutions in §7 — particularly **C-1** and **C-2**, which
change existing deployed behaviour.
