# PHASE 6 — CUSTOMERS, ORDERS, SALES AND FROZEN COGS
## Design for approval. Nothing has been implemented.

---

## 1. EXISTING ARCHITECTURE DISCOVERED

**Most of Phase 6 already exists in the database.** This is a completion and
correction exercise, not a build. Discovered by inspection:

| Object | State |
|---|---|
| `customers` | id, account_id, business_id, name, phone, email, created_at. **No `notes` or company field.** |
| `orders` | location_id, customer_id (**nullable**), channel_id, order_no, order_date, `status`, `payment_status`, `amount_paid`, finalised_at/by, voided_at/by, void_reason, `replaces` |
| `order_lines` | recipe_id, **variant_id**, description, qty, unit_price, `line_total` **generated `qty * unit_price`**, `cost_snapshot_id`, `unit_cost_at_sale`. **No business_id, no discount.** |
| `sales_entries` | a quick-sale path with the same freeze columns, void columns and `replaces` |
| `channels` | name, **commission_pct**, target_margin, is_default — a fee concept already modelled, used by `v_price_check` but never applied to a sale |
| `period_closes` | period_start/end, revenue, cogs, gross_profit, gross_margin_pct, cost_coverage_pct, closed_at/by |
| `business_settings` | **`tax_mode` (none/inclusive/exclusive)** and `tax_rate`, default `none`/`0` — **read by nothing** |
| Enums | `order_status` = draft, confirmed, **delivered**, cancelled · `payment_status` = unpaid, part_paid, paid |
| Views | `v_sales_unified` (orders ∪ sales_entries), `v_voided_sales`, `v_profit_by_product`, `v_profit_by_period`, `v_dashboard_waterfall` |
| Frontend | **zero screens** touch orders, order_lines, sales_entries or customers |

### The freeze machinery that already exists

- `fn_freeze_sale_cost` — **BEFORE INSERT** on `order_lines` and `sales_entries`.
  Selects the latest snapshot for the **variant** when one is given, else the
  recipe-level snapshot, and copies `cost_snapshot_id` + `cost_per_portion`
  into the line. **If the snapshot is missing or incomplete it writes NULL, not
  zero.** (0038 gave it a deterministic tie-breaker.)
- `fn_guard_frozen_cost` — BEFORE UPDATE: the frozen cost cannot be changed.
- `fn_guard_order_line_revenue` — a draft order is freely editable; once
  `finalised_at` is set, lines cannot be added, deleted, or have qty/price/recipe
  changed.
- `fn_guard_finalised_order` — a finalised order may only change payment state;
  a voided order is closed; a finalised order cannot be deleted.
- `fn_guard_sales_entry_immutable` + no UPDATE/DELETE policy → `sales_entries`
  is append-only.
- `fn_block_snapshot_mutation` — `cost_snapshots` rows are immutable, so a
  frozen `cost_snapshot_id` always resolves to the economics that applied.

**Conclusion: the immutability foundation the owner requires is already built
and tested. Phase 6 must not rebuild it.**

---

## 2. PROPOSED DOMAIN MODEL — the smallest set of additions

Nothing is duplicated. Four additions only:

1. **`customers.notes`** and **`customers.company`** (nullable text). Nothing
   else; Menu Master is not becoming a CRM. No address, no birthday, no
   marketing consent — data not collected cannot be leaked.
2. **`order_lines.discount_amount`** numeric(14,2) default 0, check `>= 0`, plus
   a check that it cannot exceed `qty * unit_price`.
3. **`orders.order_discount`** numeric(14,2) default 0, same checks against the
   order subtotal.
4. **`order_lines.business_id`** — every other tenant table carries it; its
   absence forces every query to join `orders` to scope by business.

**Rejected:** a separate `sales` table (duplicates `orders` + `sales_entries`);
an invoices table (Phase 6 is trading performance, not billing documents); a
payments ledger (see §8).

---

## 3. LIFECYCLE / STATUS MODEL

The enum already has four values. I propose giving exactly three of them
accounting meaning, and retiring the fourth from the product's vocabulary:

| Status | Meaning | Revenue? | COGS frozen? | Editable? |
|---|---|---|---|---|
| `draft` | being built | **No** | **No — recalculates** | Yes, freely |
| `confirmed` | economically committed | **Yes** | **Yes — frozen here** | No (void and reissue) |
| `delivered` | fulfilled | Yes (unchanged) | Already frozen | No |
| `cancelled` | never happened | **No** | Frozen figures retained, excluded | No |

`delivered` is an **operational** state after `confirmed`. It has **no**
accounting consequence: revenue does not change on delivery. Recording that
explicitly is the point — an undocumented status is how accounting drift starts.

`voided_at` is distinct from `cancelled`: cancelling is a *state*, voiding is
the *audit act* that closes the record. `replaces` supports void-and-reissue.

---

## 4. EXACT COGS FREEZE RULE — **a change is required**

**Current behaviour: cost freezes BEFORE INSERT on the line — that is, when the
line is first typed, while the order is still a draft.**

That does not match the owner's expected default, and it is wrong in a real
way: an owner building a 12-line catering order on Monday and confirming it on
Wednesday would freeze Monday's costs on line 1 and Wednesday's on line 12 —
**one order carrying two different economic worlds.**

### Recommended rule

> **COGS freezes once, for the whole order, at the moment it leaves `draft`.**
> While an order is a draft, its cost is live and recalculates. On the
> transition `draft → confirmed`, every line's cost is frozen together, from
> the snapshots current at that instant. After that the frozen figures never
> move.

Trade-offs considered:

- **At creation** (current): earliest certainty, but mixed economics within one
  order, and a draft cannot show today's cost. **Rejected.**
- **At confirmation** (recommended): matches "economically committed", one
  consistent instant per order, drafts stay useful as live quotes.
- **At completion/delivery**: cost would move after the customer agreed a
  price, so the margin shown at the point of sale would not be the margin
  recorded. **Rejected.**

`sales_entries` (the quick-sale path) has no draft state — it is a completed
sale on arrival — so it correctly keeps freeze-on-insert.

### Editing after freezing

Already enforced and unchanged: a finalised order refuses new lines, deleted
lines, and changes to qty/price/recipe. The only correction path is **void and
reissue**, which preserves both records and links them by `replaces`.

---

## 5. SNAPSHOT / PROVENANCE DESIGN — extend, do not duplicate

`order_lines.cost_snapshot_id` already points at an **immutable** `cost_snapshots`
row. That row already carries `ingredient_cost`, `packaging_cost`, `labour_cost`,
`overhead_cost`, `batch_cost`, `is_complete`, `unpriced_items`, `costing_method`,
`wavg_window_days` and `basis_used`.

**So the "why did it cost that" question is already answerable, permanently,
with no duplication.** Phase 6 adds one read-only view, `v_sale_cost_breakdown`,
joining a sale line to its frozen snapshot so the composition can be shown
without any caller re-deriving it.

The only figure not recoverable from the snapshot is the **per-format packaging**
attributable to the variant, which `fn_variant_cost` computes on the fly. The
variant snapshot stores the total. **Open question for the owner in §18.**

---

## 6. DISCOUNT TREATMENT

Two levels, both explicit:

- **Line discount** — `order_lines.discount_amount`, a naira amount, not a
  percentage. Percentages introduce rounding disputes; an amount is what the
  owner actually gave away. `line_revenue = qty * unit_price - discount_amount`.
- **Order discount** — `orders.order_discount`, allocated to lines **pro rata
  by line revenue** for margin reporting.

**Deterministic allocation, defined precisely:**

```
share_i = round(order_discount * line_revenue_i / subtotal, 2)
```
The kobo residual (`order_discount - Σ share_i`) is assigned to the **single
largest line by revenue**, ties broken by line id. Therefore
`Σ allocated = order_discount` **exactly**, always. Margin is never ambiguous
and never silently loses a kobo.

`line_total` remains the generated `qty * unit_price` — the gross figure. Net
revenue is derived in views, so the discount is always visible rather than
buried in a reduced price.

---

## 7. DELIVERY / SERVICE / TAX TREATMENT

- **Tax**: `tax_mode` and `tax_rate` exist and are read by nothing. **Phase 6
  does not build a tax engine.** It will not treat any amount as tax. The
  columns stay untouched so a later phase can adopt them.
- **Delivery and service charges**: **no concept exists.** Phase 6 does not
  invent one. If added later they must be **separate, non-food revenue** and
  must **never** enter COGS or food gross margin — a delivery fee is not food
  the business made.
- **Channel commission**: `channels.commission_pct` exists and informs
  recommended pricing. Phase 6 **does not deduct it from sales**, because doing
  so silently would change the meaning of gross profit. Flagged in §18.

**Rule adopted: Phase 6 reports FOOD gross profit only.** Fees, tax and
commission are out of scope and will not be quietly folded into the numbers.

---

## 8. PAYMENT SCOPE

`orders.payment_status` and `amount_paid` already exist, and the finalised-order
guard **deliberately allows payment state to change after the sale** — settling
later is not a revenue rewrite.

**Phase 6 keeps exactly that and adds nothing.** No payments ledger, no part-
payment allocation, no receipts. **Sale ≠ payment**, and reporting in §10 is
built on revenue, never on cash received. A payments table is a later phase and
nothing here blocks it.

---

## 9. CANCELLATION / REFUND TREATMENT

- **Cancelling** sets `status = 'cancelled'` and `voided_at`/`void_reason`.
  Nothing is deleted; the frozen COGS stays on the line as historical evidence.
- All trading views exclude cancelled and voided rows. `v_voided_sales` already
  exists so cancellations remain inspectable rather than invisible.
- **Refunds are explicitly OUT of Phase 6.** The `replaces` column and the
  void-and-reissue pattern mean a refund can later be modelled as a negative or
  reversing order **without touching frozen COGS**.

---

## 10. REPORTING MODEL

Four read-only `security_invoker` views, all excluding cancelled/voided:

- `v_sale_lines` — the authoritative per-line grain: quantity, unit price, line
  discount, allocated order discount, net revenue, frozen unit COGS, total
  COGS, gross profit, gross margin.
- `v_sales_summary` — by day/week/month: revenue, COGS, gross profit, margin,
  order count, and **cost coverage** (what share of revenue has a frozen cost),
  so an owner can see how much of the picture is trustworthy.
- `v_product_performance` — top sellers, lowest margins, loss-making lines.
- `v_orders_attention` — drafts left unconfirmed, confirmed sales with **no
  frozen cost**, orders unpaid beyond a threshold.

`v_profit_by_product`, `v_profit_by_period` and `v_dashboard_waterfall` already
exist and will be **extended for discounts if needed, not replaced**.

---

## 11. SECURITY / RLS DESIGN

Every existing table already carries 4 policies (`sales_entries` deliberately 2
— append-only). New objects:

| Object | Decision |
|---|---|
| `customers.notes`, `.company` | inherit existing policies; no change |
| `order_lines.discount_amount`, `.business_id` | inherit; `business_id` backfilled from `orders` and enforced by a composite FK, matching every other tenant table |
| `orders.order_discount` | inherit |
| All four new views | `security_invoker = on`, `grant select to authenticated` only, **asserted by `tests/027`** |
| `v_sale_cost_breakdown` | same |

Cross-tenant tests will assert **no row of another account is visible by
identity**, not by row count — the correction made in Phase 5.

---

## 12. WORKED EXAMPLES

All four costing shapes, with the figures the tests will assert.

| # | Sale | Qty | Price each | Frozen cost each | Revenue | COGS | Gross profit | Margin |
|---|---|---|---|---|---|---|---|---|
| 1 | Portion — plates of jollof | 25 | ₦1,500 | ₦850 | ₦37,500 | ₦21,250 | ₦16,250 | **43.33%** |
| 2 | Volume — 2.5 L soup bowls | 3 | ₦9,000 | ₦5,900 | ₦27,000 | ₦17,700 | ₦9,300 | **34.44%** |
| 3 | Weight — 500 g loaves | 10 | ₦1,000 | ₦600 | ₦10,000 | ₦6,000 | ₦4,000 | **40.00%** |
| 4 | Count — 6-piece packs | 8 | ₦800 | ₦450 | ₦6,400 | ₦3,600 | ₦2,800 | **43.75%** |
| 5 | Multi-line (1 + 3) | — | — | — | ₦47,500 | ₦27,250 | ₦20,250 | **42.63%** |
| 6 | Example 1 with ₦100/plate discount | 25 | ₦1,500 −₦100 | ₦850 | ₦35,000 | ₦21,250 | ₦13,750 | **39.29%** |

7. **Selling price changed after the sale** — a new `recipe_prices` row is
   added tomorrow. Example 1 still reports ₦37,500 / ₦21,250 / 43.33%.
8. **Recipe cost changed after the sale** — rice doubles, the recipe is
   recomputed. Example 1's COGS stays ₦21,250 because `cost_snapshot_id` points
   at an immutable row.
9. **Cancelled order** — example 4 cancelled: revenue, COGS and profit all fall
   out of every trading view; the row and its frozen cost remain readable.
10. **Cross-tenant** — account B sees none of A's orders, lines or customers.
11. **Incomplete costing** — see §18; the sale must not record ₦0 COGS.
12. **Multi-format** — one soup recipe sold as 1 L, 2.5 L and 4 L in one order;
    each line freezes **its own** variant snapshot, and packaging is counted
    once per item sold, not per litre.

---

## 13. FINANCIAL INVARIANTS TO BE PROVEN

1. `revenue = Σ (qty × unit_price − line_discount) − order_discount`
2. `Σ allocated_order_discount = order_discount` **exactly**, to the kobo.
3. `COGS = Σ (qty × frozen_unit_cost)`
4. `gross_profit = revenue − COGS`; `margin = gross_profit / revenue`
5. Frozen COGS is unchanged by later changes to: ingredient price, purchase
   history, recipe lines, packaging, labour, overhead, serving format, selling
   price. (Six separate assertions.)
6. Cancelled and voided transactions appear in **no** trading view.
7. No row of account A is visible to account B, asserted by identity.
8. A line with no frozen cost reports COGS **NULL, never 0**, and is excluded
   from margin while being **counted in cost coverage** so it cannot hide.

---

## 14. MIGRATION PLAN

| Migration | Contents |
|---|---|
| **0043** | `customers.notes`, `customers.company`; `order_lines.business_id` (backfilled from `orders`, composite FK, NOT NULL after backfill) |
| **0044** | `order_lines.discount_amount`, `orders.order_discount`, with CHECK constraints; `fn_allocate_order_discount` |
| **0045** | **Move the freeze point** — `fn_freeze_sale_cost` becomes freeze-on-confirm for `order_lines`; `sales_entries` unchanged |
| **0046** | Reporting views: `v_sale_lines`, `v_sales_summary`, `v_product_performance`, `v_orders_attention`, `v_sale_cost_breakdown` |

Every migration: preflight asserting the expected baseline, `security_invoker`
restated on every view, self-check asserting policy count and the structural
security guard, and a rollback verified from a **pristine** baseline with a
fingerprint that includes `reloptions` and grants.

**0045 is the only behavioural change to deployed logic** and is the one
needing explicit authorisation.

---

## 15. ROLLBACK PLAN

Each migration has a paired rollback restoring the prior definitions verbatim.
0043's `NOT NULL` on `order_lines.business_id` is applied only after a verified
backfill, and the rollback drops the column, so no data is stranded. 0045's
rollback restores freeze-on-insert byte-identically.

**No rollback deletes a frozen cost or a sale.**

---

## 16. TEST PLAN

`tests/032_sales_and_frozen_cogs.sql` — the twelve worked examples, the eight
invariants, the six "history does not move" assertions, cancellation, cross-
tenant by identity, and incomplete costing.
`tests/033_discounts.sql` — line and order discounts, exact kobo allocation,
residual assignment, and refusal of a discount exceeding the line.
Browser journeys for all four product shapes at 360/390/tablet/desktop.
`tests/027` extended to cover the five new views.

---

## 17. EXPLICIT PHASE 6 EXCLUSIONS

Not built: bookkeeping, general ledger, bank reconciliation, payroll,
procurement automation, **inventory depletion**, advanced CRM, marketing,
loyalty, **tax engine**, **payments ledger**, **refunds**, delivery/service
charges, channel commission deduction, multi-currency.

---

## 18. DECISIONS REQUIRING OWNER APPROVAL

**D-1 — Move the freeze point to confirmation.** Today cost freezes when a line
is typed, so a multi-day draft can carry two economic worlds in one order.
Recommendation: **freeze the whole order at `draft → confirmed`.** This changes
deployed behaviour and is the one material change in Phase 6.

**D-2 — What happens when a product cannot be costed and the owner confirms
the sale?** The freeze already writes NULL rather than ₦0, so nothing is
fabricated. The question is whether confirmation should be *allowed*.
- **Option A (recommended): allow, and mark it.** Record the sale with COGS
  NULL, exclude it from margin, and count it in **cost coverage** so the
  dashboard says "₦X of sales have no cost recorded". A real sale happened;
  refusing to record it would lose revenue history, and Nigerian food
  businesses sell before their costing is complete.
- **Option B: refuse confirmation** until the product is costed. Cleaner books,
  but the product blocks a real sale that already occurred.

**D-3 — Order discount allocation.** Confirming pro-rata by line revenue with
the kobo residual to the largest line. The alternative — leaving the discount
unallocated at order level — makes per-product margin unanswerable.

**D-4 — Should `delivered` carry any accounting meaning?** Recommending **no**:
revenue recognises at `confirmed`, and delivery is operational only.

**D-5 — Per-format packaging in the frozen breakdown.** The variant snapshot
stores total cost, not the packaging split. Options: (a) accept the total and
show the recipe-level composition only; (b) store the packaging figure on the
variant snapshot so a format's frozen breakdown is complete. **(b) is more
honest but adds a column to an immutable table.** Recommending (a) for Phase 6.
