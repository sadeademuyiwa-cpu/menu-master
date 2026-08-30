# PHASE 6 ACCEPTANCE AUDIT

Review only, except where a P0/P1 was found. **One P1 was found and fixed** —
§15. Nothing deployed.

Every figure below was produced by running the shipped code. The scripts are in
this directory so the owner can reproduce any of it:
`PHASE6_ACCEPTANCE_EVIDENCE.sql`, `PHASE6_LEGACY_REPLAY.sql`,
`scripts/verify_legacy.sh`, `web/e2e/shots-acceptance.mjs`.

---

## 1. REQUIREMENTS TRACEABILITY

The fifteen numbered requirements from the approved implementation instruction.

| # | Requirement | Implementation | Test | Verdict |
|---|---|---|---|---|
| **1** | D-5 with the investigated approach: minimum nullable provenance on the existing immutable snapshot; no second snapshot system, no duplicate engine, no child table; old rows stay NULL; one authoritative component implementation; frozen total = frozen breakdown | `0046` adds `cost_snapshots.portion_qty_at_snapshot` and `.variant_overhead_cost`. `fn_variant_cost_components` is the single implementation; `fn_variant_cost` and `fn_compute_variant_cost_snapshot` both call it. No table added | 032 #27; legacy replay #9, #10, #11; evidence §6 | **PASS** |
| **2** | Atomic confirmation: one operation, no partially frozen order, NULL COGS is valid and must not abort, technical failure aborts everything | `fn_confirm_order` — `FOR UPDATE` lock, one `UPDATE` across every line, one transaction | 032 #6, #7, #16; lifecycle #6 | **PASS** |
| **3** | C-1 strict one-way: `NULL → snapshot` once; A→B, A→NULL and direct mutation refused; explicit regression tests | `fn_guard_frozen_cost`, gated on a `SET LOCAL` marker only `fn_confirm_order` sets | 032 #10, #11, #12, #13 | **PASS** |
| **4** | C-2 default `draft`; creating an order is not an accounting event; historical orders not silently rewritten; all creation paths and tests checked deliberately | `0045` sets the default. Every write path was searched; only `fn_confirm_order` writes `status`/`finalised_at` | 032 #4, #35; lifecycle #1, #3; legacy replay #4 | **PASS** — see §15 for the historical half, which was **not** right until this audit |
| **5** | C-3: `status` and `finalised_at` through one operation; the normal application cannot produce `confirmed + finalised_at NULL`; service-role recovery preserved and documented | `fn_guard_order_lifecycle` + `trg_orders_lifecycle`, with an explicit `fn_is_service_context()` exemption | 032 #35, #36, #37; lifecycle #2, #3, #4 | **PASS** |
| **6** | Void + reissue; no direct editing of product, format, quantity, price, line discount, order discount or frozen cost; both records survive and stay traceable | `fn_guard_order_line_revenue` and `fn_guard_finalised_order`, both extended for discounts | 032 #28–#32; 033 #4, #15; lifecycle #7–#15; evidence §8 | **PASS** |
| **7** | Never `total_revenue − known_COGS`; expose total, costed, uncosted revenue and coverage; do not show unknown margin as 0% | `v_sales_summary`, `v_profit_by_period`, `v_profit_by_product`, `v_product_performance`, `v_sale_lines` | 032 #17, #20, #21, #22, #23; evidence §5 | **PASS** |
| **8** | Deterministic pro-rata allocation; gross, allocated and net all preserved; `Σ allocated = order discount` exactly | `fn_allocate_order_discount`, derived not stored | 033 #1, #5–#10, #16, #17; evidence §4 | **PASS** |
| **9** | End-to-end financial immutability across ten changed inputs | — | 032 #14, #15; evidence §7 | **PASS** |
| **10** | Format provenance explains the economics without today's configuration; legacy rows expose UNKNOWN rather than reconstructing | `v_sale_cost_breakdown` reads the frozen snapshot only | 032 #25, #26, #27; legacy replay #10, #11; evidence §6 | **PASS** |
| **11** | Void/reissue test: original remains, economics unchanged, excluded from active reporting, replacement traceable with its own economics, no double counting | — | 032 #28–#32; evidence §8 | **PASS** |
| **12** | 116 policies maintained; cross-tenant tested for every Phase 6 addition and changed function | No policy added or removed by any of 0043–0048 | 032 #33; 034 #4, #5; 26 cross-tenant probes, §9 | **PASS** |
| **13** | Each migration a clear purpose; apply from pristine, verify, full SQL suite, full browser suite, rollback, verify exact restoration, reapply, rerun; watch function grants when replacing functions | `0043`–`0048`, each with preflight, self-check and rollback | Fingerprint over 2,242 / 2,445 lines; 517 SQL; 130 browser; 034 | **PASS** |
| **14** | No internal terminology on owner screens; plain-language translations | `v_orders_attention.what_to_do`, `v_sale_lines.cost_status`, page copy | Measured on 19 screens at two widths, §12 | **PASS** |
| **15** | Scope lock; no fee, tax, commission or delivery in food gross profit | Nothing added outside customers/orders/sales/discounts/frozen economics | `tax_mode`/`tax_rate` still read by nothing | **PASS** |

Four items were built beyond the plan; each is named in §14 of the completion
report and none widens scope: `0048` and `tests/034` (a P2 that turned out to be
the vehicle for a P0), `fn_guard_order_lifecycle` (required by requirement 5),
`fn_order_line_scope` (a NOT NULL column every caller would otherwise have to
supply), and the `fn_freeze_sale_cost` refactor (provisionally accepted by the
owner).

---

## 2. REMAINING DEBT, ITEM BY ITEM

Eight items. Six carried from the completion report, two found by this audit.

### D-1 · `v_billing_reconciliation` has no `security_invoker`
- **Issue** — the view runs with the definer's rights, so RLS on the tables beneath it does not apply to its reader.
- **User impact** — none. No owner-facing screen reads it.
- **Financial / data-integrity** — none today. It is `service_role`-only; no `authenticated` grant exists, so no customer session can reach it. The exposure is latent, not live.
- **Mobile** — none. **Accessibility** — none.
- **Existed before Phase 6** — yes, since `0027`.
- **Recommendation** — **SAFE TO DEFER.** It is on the explicit allow-list in `tests/027`, so it cannot be forgotten, and the guard fails the moment anyone grants it to `authenticated`.

### D-2 · `order_status = 'delivered'` is unreachable
- **Issue** — `fn_guard_finalised_order` refuses every status change after finalisation, and confirmation is the only route to `confirmed`, so `delivered` can never be set.
- **User impact** — an owner cannot mark an order delivered. No screen offers it, so nothing is broken; a capability simply does not exist.
- **Financial** — none. D-4 gave `delivered` no accounting meaning; every trading view treats it exactly as `confirmed` would be treated.
- **Mobile / accessibility** — none.
- **Existed before Phase 6** — yes. Under the old rules the value was equally unreachable after finalisation; Phase 6 did not narrow it.
- **Recommendation** — **SAFE TO DEFER.** Delivery tracking is a Phase 7+ decision, not a Phase 6 omission.

### D-3 · `fn_void_order` sets `voided_at` but not `status = 'cancelled'`
- **Issue** — two markers of the same fact are not kept in step.
- **User impact** — none visible. Every screen and view keys on `voided_at`.
- **Financial** — none. `v_sales_unified`, `v_sale_lines` and `v_orders_attention` all exclude on `voided_at is not null` **and** `status <> 'cancelled'`, so a voided order is excluded by either marker alone.
- **Mobile / accessibility** — none.
- **Existed before Phase 6** — yes, since `0014`.
- **Recommendation** — **SAFE TO DEFER.** Aligning them is a one-line change with no behavioural effect; it belongs with whatever phase gives `cancelled` its own meaning.

### D-4 · Header wraps at 360px; three prose links at 16px; no skip-link or landmark roles
- **Issue** — carried from the Phase 5.5 audit.
- **User impact** — the masthead occupies a second line on a small phone. Minor.
- **Financial** — none.
- **Mobile** — real but cosmetic: this audit measured **zero horizontal overflow on all seven 360px screens** and no clipped naira amount anywhere.
- **Accessibility** — the real cost. A keyboard or screen-reader user has no skip-link and no `<main>`/`<nav>` landmark semantics, so every page must be traversed from the top.
- **Existed before Phase 6** — yes.
- **Recommendation** — **SAFE TO DEFER for Phase 6**, but the accessibility half should be scheduled, not carried indefinitely. It is a small, self-contained change touching one layout file.

### D-5 · `fn_payment_failure_grace` is `SECURITY DEFINER` with no membership check
- **Issue** — a definer function with no tenant check.
- **User impact** — none.
- **Financial / data-integrity** — none. It returns one global billing-config interval, not tenant data. `0048` has removed `PUBLIC` and `anon` from it.
- **Mobile / accessibility** — none.
- **Existed before Phase 6** — yes, since `0029`.
- **Recommendation** — **SAFE TO DEFER.** Verified by inspection during this audit: it reads `billing_config` only.

### D-6 · Nine tables still have no UI
- **Issue** — from the Phase 0 reconciliation.
- **User impact** — capabilities that exist in the database are not reachable.
- **Financial** — none; nothing is wrong, only absent.
- **Mobile / accessibility** — none.
- **Existed before Phase 6** — yes.
- **Recommendation** — **SAFE TO DEFER.** Phase 7+ scope.

### D-7 · Secondary naira amounts render at 12px on desktop — **new, found by this audit**
- **Issue** — `Stat`'s caption (`ui.tsx:125`) is `text-xs`. Money appears in it: "less ₦7,000.00 in discounts" and "35.26% of ₦47,806.45" on the order screen, and the same pattern on the customer screen.
- **User impact** — a supporting figure is small on a large screen. The headline figures beside it are 20–30px.
- **Financial** — none. The figures are correct; only their size is at issue.
- **Mobile** — **none — this is desktop-only.** At 360px the smallest naira amount measured 16px on the order screens and 18px on the customer screen.
- **Accessibility** — 12px is below a comfortable minimum for numeric text.
- **Existed before Phase 6** — the `Stat` component did; putting money in its caption is new to Phase 6.
- **Recommendation** — **SAFE TO DEFER.** One token change (`text-xs` → `text-sm` on `Stat`'s sub), but it touches every screen in the app, so it belongs in a deliberate pass rather than an acceptance patch.

### D-8 · The masthead link is a 24px target on desktop — **new, found by this audit**
- **Issue** — "Menu Master NG" in the header is 24px tall.
- **User impact** — negligible; it is a mouse target on a desktop screen.
- **Financial** — none.
- **Mobile** — **none.** Every tap target on all seven 360px screens measured at least 44px.
- **Accessibility** — the 44px guidance is a touch minimum; a pointer target of 24px meets normal desktop expectations.
- **Existed before Phase 6** — yes.
- **Recommendation** — **SAFE TO DEFER.** Reported for completeness rather than as a defect.

**No P0 or P1 remains.**

---

## 3. SALES ECONOMICS — ONE COMPLETE WORKED EXAMPLE

`ORD-0001` for Mrs Adeyemi: a portion line with its own discount, a
format line, an uncosted line, and a ₦5,000 order discount that does not divide.

Rice at ₦85,000 for 50 kg is **₦1.70/g**. A 500 g plate of Party Jollof is
**₦850**. Egusi Soup is ₦1.70/ml over a 5,000 ml batch; the 2.5 litre format is
2,500 × 1.70 + ₦400 for its tub = **₦4,650**.

| Product | Size | Qty | Price each | Gross | Line disc. | Order disc. share | Net | Cost each | Cost total | Kept | State |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Party Jollof | plate | 20 | ₦1,500.00 | ₦30,000.00 | ₦2,000.00 | ₦2,258.07 | ₦25,741.93 | ₦850.00 | ₦17,000.00 | ₦8,741.93 | costed |
| Egusi Soup | 2.5 litre | 3 | ₦8,000.00 | ₦24,000.00 | ₦0.00 | ₦1,935.48 | ₦22,064.52 | ₦4,650.00 | ₦13,950.00 | ₦8,114.52 | costed |
| Mystery Stew | plate | 5 | ₦2,000.00 | ₦10,000.00 | ₦0.00 | ₦806.45 | ₦9,193.55 | not known | not known | not known | sold_without_cost |

| Figure | Value |
|---|---|
| Gross revenue | ₦64,000.00 |
| Discounts given | ₦7,000.00 |
| **Revenue** | **₦57,000.00** |
| Costed revenue | ₦47,806.45 |
| Uncosted revenue | ₦9,193.55 |
| Known cost | ₦30,950.00 |
| **Gross profit** | **₦16,856.45** |
| Gross margin | 35.26% |
| Cost coverage | 83.87% |

**Reconciliation, displayed against stored.** Every figure above is read from
`v_sale_lines` and `v_sales_summary`, which are `security_invoker` views over
`order_lines` and `orders` — there is no second copy. Checked independently:

- 20 × 1,500 = 30,000 and 3 × 8,000 = 24,000 and 5 × 2,000 = 10,000 → gross **64,000** ✓
- line discounts 2,000 + order discount 5,000 = **7,000** ✓
- 64,000 − 7,000 = **57,000**, and `Σ net_revenue` across the three lines = 25,741.93 + 22,064.52 + 9,193.55 = **57,000.00** ✓
- COGS 20 × 850 + 3 × 4,650 = 17,000 + 13,950 = **30,950** ✓
- costed revenue 25,741.93 + 22,064.52 = **47,806.45** ✓
- 47,806.45 − 30,950 = **16,856.45**, and 16,856.45 / 47,806.45 = **35.26%** ✓
- 47,806.45 / 57,000 = **83.87%** ✓

The page's own totals are summed from the same view rows, not recomputed by a
second rule.

---

## 4. MIXED KNOWN / UNKNOWN COGS

Same sale. `fn_confirm_order` returned
`{"confirmed": true, "lines_frozen": 3, "lines_without_cost": 1}`.

| | |
|---|---|
| Total revenue | ₦57,000.00 |
| Costed revenue | ₦47,806.45 |
| Uncosted revenue | ₦9,193.55 |
| Known COGS | ₦30,950.00 |
| Gross profit | ₦16,856.45 |
| Gross margin | 35.26% |
| Cost coverage | 83.87% |

**The mathematical proof.** If the system used total revenue:

```
57,000.00 − 30,950.00 = 26,050.00      the flattering figure
57,000.00 reported as                    16,856.45
difference                                9,193.55
uncosted revenue                          9,193.55      ← identical, to the kobo
```

The entire difference **is** the uncosted revenue. Under the wrong arithmetic
every naira of revenue with no known cost would have been booked as pure
profit. The uncosted line contributes to revenue and to coverage, and to
neither profit nor margin.

**Owner-facing wording, verbatim from the screens:**

> "5 items on this sale have no known cost, so they are counted as money taken
> and left out of the profit below. Finish costing those dishes and future sales
> will be complete."

> Per line: **"Cost not known"**, with "we do not know what this cost you, so it
> is left out of the profit".

> Per order, from `v_orders_attention.what_to_do`: **"Sold, but we do not know
> what some of it cost you."**

> On reports: **"84% of revenue has a verified cost"** and a "Revenue without
> cost" figure in naira, so the gap cannot be waved away.

> Where no line on a sale has a known cost, the profit figure reads **"not known
> yet"** — never ₦0.00 and never 0%.

---

## 5. HISTORICAL IMMUTABILITY

The confirmed sale above, then every input changed: ingredient price, a posted
purchase, recipe composition, batch yield, portion size, packaging price, format
capacity, a labour rate, overhead configuration and its basis, and the menu
price. All snapshots recomputed.

| Stage | Revenue | COGS | Profit | Margin | Coverage | Jollof frozen | Soup frozen | Soup packaging |
|---|---|---|---|---|---|---|---|---|
| before any change | ₦57,000.00 | ₦30,950.00 | ₦16,856.45 | 35.26% | 83.87% | ₦850.00 | ₦4,650.00 | ₦400.00 |
| after ten changes | ₦57,000.00 | ₦30,950.00 | ₦16,856.45 | 35.26% | 83.87% | ₦850.00 | ₦4,650.00 | ₦400.00 |

The comparison is made on the whole tuple, including `cost_snapshot_id`, and
returns `IDENTICAL`. Frozen provenance is unmoved as well as frozen totals.

Meanwhile the products themselves were repriced, which is the point:

| Product | Size | Cost today |
|---|---|---|
| Party Jollof | plate | ₦4,518.06 *(was ₦850.00)* |
| Egusi Soup | 2.5 litre | ₦222,025.00 *(was ₦4,650.00)* |

The current costing moved by a factor of five and of forty-eight. The historical
sale did not move at all.

---

## 6. FORMAT SNAPSHOT

The 2.5 litre line's frozen breakdown, read from the snapshot on the line:

| Component | Value |
|---|---|
| Ingredients and labour | ₦4,250.0000 |
| Format packaging | ₦400.0000 |
| Overhead share | ₦0.0000 |
| Format quantity | 2,500.00 ml |
| Portion at snapshot | not recorded |
| **Frozen total** | **₦4,650.0000** |

4,250 + 400 + 0 = **4,650** — reconciles. Nothing here consults current
configuration: `ingredients_and_labour` is `cost_per_yield_unit × resolved_qty`,
both stored on the snapshot; packaging is `format_packaging_cost`, stored since
`0021`; overhead is `variant_overhead_cost`, stored since `0046`.

"Portion at snapshot" reads *not recorded* and that is correct, not a gap: a
format-based recipe has no portion size, so there was never a figure to store.

**A legacy snapshot, written before `0046`.** Built by replay on a database at
`0042` with overhead **enabled** at ₦1.00/ml, then migrated:

| | Ingredients & labour | Packaging | Overhead | Portion | Frozen total | Verdict |
|---|---|---|---|---|---|---|
| legacy line | ₦1,700.00 | ₦150.00 | **not recorded** | **not recorded** | ₦2,850.00 | incomplete — reported as not recorded, nothing invented |
| same variant, sold after `0046` | ₦1,700.00 | ₦150.00 | ₦1,000.00 | — | ₦2,850.00 | reconciles |

The legacy row's overhead share really is inside its ₦2,850 total and really was
never stored. The view reports the gap rather than filling it from today's
₦1.00/ml — which would have produced a number that *looked* right today and
would silently stop being right the moment the overhead basis changed. What was
already stored before `0046` is still shown.

---

## 7. DISCOUNT ALLOCATION

₦5,000 across line revenues of 28,000 / 24,000 / 10,000 — subtotal ₦62,000.

| Line | Line revenue | Share of order | Raw pro rata | Residual | Allocated | Net |
|---|---|---|---|---|---|---|
| Party Jollof | ₦28,000.00 | 45.1613% | ₦2,258.06 | **+₦0.01** | ₦2,258.07 | ₦25,741.93 |
| Egusi Soup | ₦24,000.00 | 38.7097% | ₦1,935.48 | ₦0.00 | ₦1,935.48 | ₦22,064.52 |
| Mystery Stew | ₦10,000.00 | 16.1290% | ₦806.45 | ₦0.00 | ₦806.45 | ₦9,193.55 |

Rounded independently the three shares sum to ₦4,999.99. The missing kobo goes
to the **largest line by revenue** — Party Jollof — ties broken by line id, so
the same order always splits the same way.

```
Σ allocated                                     5,000.00
order discount                                  5,000.00      EXACT

Σ net line revenue                             57,000.00
Σ line revenue − order discount                57,000.00      EXACT
```

---

## 8. VOID AND REISSUE

| Stage | Orders counted | Revenue | COGS | Profit |
|---|---|---|---|---|
| the confirmed original | 1 | ₦57,000.00 | ₦30,950.00 | ₦16,856.45 |
| after voiding | 0 | ₦0.00 | ₦0.00 | ₦0.00 |
| after the replacement is confirmed | 1 | ₦15,000.00 | ₦45,180.56 | −₦30,180.56 |

| Record | Order no | Status | Confirmed | Voided | Reason | Links | Frozen cost still readable |
|---|---|---|---|---|---|---|---|
| original | ORD-0001 | confirmed | yes | **yes** | customer moved the event | — | ₦30,950.00 |
| replacement | ORD-0001-R | confirmed | yes | no | — | points at the original | ₦45,180.56 |

**No double counting:**

| Order | State | Lines in active reporting |
|---|---|---|
| ORD-0001 | voided | **0** |
| ORD-0001-R | confirmed | **1** |

The replacement froze at the post-mutation cost of ₦4,518.06 a plate and
therefore reports a loss. That is correct: a replacement gets its **own**
confirmation-time economics, not the original's.

---

## 9. TENANT SECURITY

### The defect, and its regression evidence

`fn_frozen_sale_cost` was introduced by `0045` as `SECURITY DEFINER`, took an
`account_id`, checked nothing, and carried `PUBLIC` execute. Any caller — signed
in or not — could have named another business's account and recipe and been told
what their food costs them. It now calls `fn_require_member` first. `0048`
removed `PUBLIC` and `anon`. `tests/034` check 5 does not read the source; it
**calls the function** as another account's authenticated user and asserts the
answer is a refusal.

### Twenty-six probes, as an ordinary authenticated user of account B

Verdicts for mutations are decided **after `reset role`, by reading A's rows as
the owner**. Under RLS a forbidden UPDATE or DELETE matches zero rows and
succeeds silently, and B cannot see the row to check either way — asking B
whether the row changed always answers "no" and proves nothing. *(My first draft
of this probe made exactly that mistake and reported a false ALLOWED.)*

| Surface | Result |
|---|---|
| `fn_confirm_order` on A's draft | REFUSED — Not authorized for this account |
| `fn_finalise_order` on A's draft | REFUSED — Not authorized for this account |
| `fn_frozen_sale_cost` with A's account | REFUSED — Not authorized for this account |
| `fn_variant_cost_components` on A's variant | REFUSED |
| `fn_variant_cost` on A's variant | REFUSED |
| component packaging figure on A's variant | REFUSED |
| `fn_allocate_order_discount(A's order)` | REFUSED — 0 rows returned |
| `fn_allocate_order_discount()` unscoped, A's line | REFUSED — 0 rows |
| `fn_void_order` on A's confirmed sale | REFUSED |
| `fn_reissue_order` on A's order | REFUSED |
| `fn_compute_recipe_cost_snapshot` on A's recipe | REFUSED |
| INSERT `order_lines` into A's order as B | REFUSED — order not found; cannot scope this line |
| INSERT `order_lines` into A's order claiming A's account | REFUSED — same |
| INSERT `orders` under A's account | REFUSED — row-level security policy |
| INSERT `sales_entries` under A's account (the freeze path) | REFUSED — Not authorized for this account |
| INSERT `sales_entries` as B naming A's dish | REFUSED — foreign key violation |
| A's line discount, read back as A | unchanged, 0.00 → 0.00 |
| A's order discount, read back as A | unchanged, 0.00 → 0.00 |
| A's payment state, read back as A | unchanged, 0.00 → 0.00 |
| A's customer name, read back as A | unchanged |
| A's order line still exists, read back as A | 1 line → 1 line |
| A's frozen cost, read back as A | 850.0000 → 850.0000 |
| A's sale still not voided, read back as A | not voided → not voided |
| no replacement order appeared in A's account | 1 order → 1 order |
| no quick sale landed anywhere | 0 → 0 |
| no order landed in A's account | none |

**26 / 26 refused.**

### Every `SECURITY DEFINER` function Phase 6 touched

Not only the one that was found broken.

| Function | Rights | Kind | Tenant check | Who may execute |
|---|---|---|---|---|
| `fn_confirm_order` | DEFINER | callable | `fn_require_account_role` | authenticated |
| `fn_frozen_sale_cost` | DEFINER | callable | `fn_require_member` | authenticated |
| `fn_variant_cost_components` | DEFINER | callable | `fn_require_cost_access` | authenticated |
| `fn_compute_variant_cost_snapshot` | DEFINER | callable | `fn_require_cost_access` | authenticated |
| `fn_compute_recipe_cost_snapshot` | DEFINER | callable | `fn_require_cost_access` | authenticated |
| `fn_finalise_order` | DEFINER | callable | **delegates** to `fn_confirm_order` | authenticated |
| `fn_variant_cost` | DEFINER | callable | **delegates** to `fn_variant_cost_components` | authenticated |
| `fn_freeze_sale_cost` | DEFINER | trigger | **delegates** to `fn_frozen_sale_cost` | owner + service only |
| `fn_allocate_order_discount` | invoker | callable | none needed — RLS applies | authenticated |
| `fn_guard_order_lifecycle` | invoker | trigger | `fn_is_service_context` exemption | owner + service only |
| `fn_order_line_scope`, `fn_guard_order_discount`, `fn_guard_frozen_cost`, `fn_guard_order_line_revenue`, `fn_guard_finalised_order` | invoker | trigger | none needed — RLS applies | owner + service only |

The three **delegates** are thin wrappers; the check is one call away and is the
authoritative one. Each was proven refused by direct invocation, not assumed —
probes 2, 5 and the `sales_entries` probe above.

`tests/034` check 4 makes this a standing rule: **every** definer function
taking an `account_id` must reference a membership check, excluding the
authorization primitives themselves, which *are* the check.

**116 policies unchanged** — asserted in every migration preflight, every
self-check, and after every rollback.

---

## 10. ORDER LIFECYCLE INVARIANTS

Sixteen transitions, all driven as an ordinary authenticated user.

| # | Transition | Result |
|---|---|---|
| 1 | new order → draft | draft, no confirmation time |
| 2 | draft → confirmed by writing `status` | **REFUSED** — "This order is still a draft. Confirm it to record the sale." |
| 3 | INSERT an order already confirmed | **REFUSED** — "An order starts as a draft. Confirm it when the sale is agreed." |
| 4 | writing a confirmation time onto a draft | **REFUSED** — "A confirmed sale cannot also be a draft." |
| 5 | confirm an empty order | **REFUSED** — has no lines |
| 6 | draft → confirmed via `fn_confirm_order` | confirmed, time set, cost frozen at ₦850.0000 — all in one statement |
| 7 | confirmed → change revenue | **REFUSED** |
| 8 | confirmed → change frozen cost | **REFUSED** |
| 9 | confirmed → change the order header | **REFUSED** |
| 10 | confirmed → record a payment | **allowed** — collecting money later is not a revenue rewrite |
| 11 | confirmed → delete | **REFUSED** |
| 12 | confirmed → void with a reason | allowed, reason recorded |
| 13 | void → active again by clearing `voided_at` | **REFUSED** — "Order is voided. Its record is closed." |
| 14 | void → confirmed again | **REFUSED** — "is voided and cannot be confirmed" |
| 15 | correction → a new draft that points at the original | replacement starts as a draft, `replaces` set |
| 16 | draft → discarded | allowed, and moves no figure — a draft was never revenue |

**`confirmed + finalised_at NULL` is unreachable** by insert (#3), by status
update (#2), or by writing the timestamp (#4). Service context is exempt by
design, so an operator can still repair data through the service role; that
exemption is written into the migration rather than left implicit.

---

## 11. REPORTING BOUNDARY

| Requirement | Evidence |
|---|---|
| Drafts excluded from sales / revenue / profit | The draft above: **0 rows** in `v_sales_unified`, 0 lines with a frozen cost, while `v_orders_attention` says "Still a draft. Its costs are not locked in until you confirm it." |
| Voided records handled per active-sales semantics | Voided order: **0 lines** in active reporting; frozen cost still readable; one row in `v_voided_sales` with the reason |
| Confirmed records included once | The double-count table in §8, and legacy replay #6 — each record contributes exactly one set of lines |
| NULL COGS affects coverage but not profit | Coverage 83.87% with ₦9,193.55 of revenue carrying no cost, while profit is computed over the costed ₦47,806.45 only. The uncosted line's profit contribution is reported as *not known*, never as zero |

Revenue is recognised at `finalised_at` — the same instant that freezes the
cost — so revenue and COGS can never be recognised at different moments.

---

## 12. OWNER-FACING UI REVIEW

Nineteen screenshots in `web/e2e/shots/acceptance/`, captured by
`e2e/shots-acceptance.mjs`, which drives the whole journey and then measures
each screen.

**Desktop 1280px:** sales page and the record-a-sale form · customers · order
draft · order confirmed · sales list · reports · customer detail · the void form
· voided · reissued · dashboard.
**360px:** sales list · customers · a voided order · a reissued draft · reports
· dashboard · customer detail.

### Reading them as a caterer, not a developer

The order screen leads with three figures in the owner's language — **Charged**,
**You were paid**, **You kept** — and says what the third is measured over when
it is not the whole sale. A draft says so in a sentence, and says *why* it
matters: "the cost of each item will be worked out from your prices at the
moment you confirm — not from when you typed it." Confirming is a single
labelled button; there is no "save" that might or might not commit money.

A line that cannot be costed reads **"Cost not known"** beside the amount and
carries the explanation "we do not know what this cost you, so it is left out of
the profit". Nowhere does an unknown cost render as ₦0.00 — measured on every
screen.

Correction is not an edit button. A confirmed order offers **"Something is wrong
with this sale"**, which opens to plain text: cancel it with a reason and Menu
Master starts a replacement. That reads as consequential, which it is.

Discounts appear as decisions, not as smaller prices: "less ₦2,000.00 off" and
"less ₦2,258.07 share of the order discount", with the original price still
shown.

### Internal terminology

Automated on all 19 screens against `cost_snapshot_id`, `costed_revenue`,
`allocation residual`, `provenance`, `finalised_at`, `unit_cost_at_sale`,
`order_discount`, `discount_amount`, `NULL`, `COGS`, `snapshot`,
`security_invoker`, `account_id`, `business_id`, `variant_id`.

**Zero occurrences, on every screen, at both widths.**

---

## 13. MOBILE QUALITY — 360px

Measured on all seven 360px screens.

| Check | Result |
|---|---|
| Horizontal overflow | **0px on every screen** |
| Clipped financial values | **none on any screen** |
| Readable naira amounts | smallest measured **16px** on sales and order screens, **18px** on customer detail, **14px** on the dashboard |
| Tap targets | **every interactive element ≥ 44px on every screen** |
| Overlapping navigation | none; all five destinations on screen at 360px |
| Forms usable at 360px | the record-a-sale and add-item forms stack to one column; every control is full width and ≥ 44px |
| Confirmation action obvious | "Confirm sale" is the only primary button on a draft, in the accent colour, in its own card headed "Confirm this sale" |
| Destructive action differentiated | void is behind a disclosure headed "Something is wrong with this sale", requires a typed reason, and is never adjacent to Confirm; "Discard this draft" is a muted inline link, not a button |
| Errors visible without dev tools | every refusal returns through the URL as a `Notice` banner at the top of the page, so it survives a refresh — the database's own message, translated |

**Nothing failed at 360px.** The two findings in §2 (D-7, D-8) are desktop-only.

---

## 14. MIGRATION SAFETY

| Migration | Purpose | Forward | Rollback | Data-destructive risk | Function / grant implications |
|---|---|---|---|---|---|
| **0043** | Customer detail; tenant scope on order lines | Adds `customers.notes`/`.company`; adds `order_lines.business_id`, backfills from the parent order, refuses NOT NULL over unresolved rows, adds composite FK, adds a derive-and-guard trigger | Drops the trigger, function, constraint and three columns | **Low.** Rollback drops `notes`/`company`, so any customer notes typed after the deploy are lost. The tenant column is derived, so losing it loses nothing | Adds `fn_order_line_scope`; no grant change |
| **0044** | Discounts | Adds two columns with CHECKs; adds `fn_allocate_order_discount`; extends both revenue guards | Drops columns, constraints, trigger and function; **restores both guards to their 0043 text** rather than dropping them | **Low.** Rollback loses discounts recorded after the deploy — which changes reported revenue for those sales | Adds two functions. Rollback deliberately re-creates the guards: dropping them would leave a finalised sale editable, which is worse than the state being rolled back from |
| **0045** | The freeze moves to confirmation | Reconciles legacy orders (§15); drops `trg_order_lines_freeze`; rewrites `fn_guard_frozen_cost` to cover INSERT and one-way UPDATE; changes the status default; adds `fn_confirm_order`, `fn_frozen_sale_cost`, `fn_guard_order_lifecycle` | Restores the insert-time freeze, the old guard, the old default and `fn_finalise_order`'s own body; drops the new functions and the composite type | **Medium, and documented.** Cannot un-freeze lines frozen at confirmation, and must not try — those are confirmed sales. Does **not** blank the reconciled `finalised_at` values, because guessing wrong would unlock a real sale | The one place grants mattered: `revoke ... from public, anon` on both new functions, `grant execute ... to authenticated` restated. `fn_finalise_order` keeps its old **return shape**, so callers reading `->>'finalised'` do not start getting NULL |
| **0046** | Cost provenance | Two nullable columns on `cost_snapshots`; `fn_variant_cost_components`; refactors `fn_variant_cost` and both snapshot writers onto it | Restores the three functions to their 0045 text **before** dropping the columns and type | **Medium.** Dropping the columns discards component detail recorded while 0046 was in force. Frozen totals are untouched | `ADD COLUMN` is DDL, so `fn_block_snapshot_mutation` still refuses every UPDATE and DELETE on snapshots. Grants restated |
| **0047** | Sales reporting | Drops and recreates four views (a column had to be removed and reordered); adds five | Restores the four to their 0046 definitions with `security_invoker` and grants restated; drops the five | **None to data** — views hold none. But rollback restores two known defects, and the file says so plainly | `DROP VIEW` discards grants; every one is restated and asserted by the self-check and by `tests/027` |
| **0048** | The function grant surface | Removes `PUBLIC`/`anon` from every `fn_*`; re-grants the seven the application and views actually call | Re-grants `PUBLIC` on the twelve that had it, restoring the drift | **None.** Privileges only | The whole point. Does **not** restore `fn_frozen_sale_cost`'s missing membership check — that is a correctness fix in 0045, not a grant |

### Why 0048 prevents the class, not just the instance

`0018` ran a loop over the functions that existed that day and revoked `PUBLIC`
and `anon`. It was a **sweep, not an invariant** — nothing re-applied it, so
every function added afterwards arrived with PostgreSQL's default of `EXECUTE TO
PUBLIC`, and nine had accumulated by Phase 6 without anyone noticing, because no
test asked. `0048` alone would decay the same way.

What makes it permanent is `tests/034`, which asserts the property rather than
the fix:

- **check 1** — no Menu Master function is executable by `PUBLIC`
- **check 2** — none is executable by `anon`
- **check 3** — everything the application and the `security_invoker` views call
  is still callable by `authenticated`, so a future over-broad revoke fails here
  instead of in production
- **check 4** — every definer function taking an `account_id` references a
  membership check
- **check 6** — PostgREST's own pre-request hook is still callable

The next function added without a grant line fails the suite. That is the
difference between repairing eleven functions and closing the class.

---

## 15. EXISTING DATA COMPATIBILITY — the P1

### What was wrong

Until `0045`, `orders.status` defaulted to `'confirmed'` while `finalised_at`
was set only by `fn_finalise_order`. So an order inserted and never explicitly
finalised sat in a **third state**: counted as revenue by the reporting views,
which keyed on `status`, and never locked by the guards, which key on
`finalised_at`. Its lines were frozen at insert regardless.

Phase 6 keys revenue on `finalised_at`. Against a database holding such a row,
`0045` **refused to apply**:

```
0045 self-check FAILED: an order is confirmed with nothing frozen.
```

The migration was safe — it refused rather than corrupting — but it refused
**after `0043` and `0044` had already applied**, leaving the chain halted on a
half-migrated database with no way forward in the pack. On a production database
holding any such order, the deployment would have stopped there.

Worse, the assertion was a **post-DDL self-check**. Run with `psql -1` it rolls
back atomically; run statement-by-statement in the Supabase SQL editor — which
is how earlier runbooks deployed — it would have left the freeze trigger dropped
and the status default changed before failing. That is the `0033` lesson
repeating: an assertion that can refuse must run before the DDL.

### The fix

There were only two honest options: drop those orders from revenue, which
silently changes the owner's historical figures — the exact thing this phase
exists to prevent — or record when they were recognised, which is what the old
system meant by `confirmed` from the moment of creation.

`0045` now reconciles them, **at line 106, before any of its own DDL**:

```sql
update orders
   set finalised_at = created_at,
       finalised_by = created_by
 where status not in ('draft', 'cancelled')
   and finalised_at is null
   and voided_at is null;
```

`finalised_at` is read off the row, not invented. **No line is touched**, so
nothing is re-costed. It reports by `NOTICE`, never silently:

```
0045: 1 order(s) were recognised as sales under the old default and carry no
confirmation time. Recording their creation time as their confirmation time so
their revenue does not change.
```

Drafts and voided orders are left alone — both are excluded from reporting
before and after, so neither needs a decision. The self-check widened from
`status = 'confirmed'` to every status that reads as a sale.

### Proof

The ordinary suites cannot check this: they all run on a database already
migrated to head, so none can hold a row created under the old rules.
`scripts/verify_legacy.sh` builds a database at `0042`, seeds an order of each
historical shape, applies `0043`–`0048`, and asserts.

| # | Check | Result |
|---|---|---|
| 1 | historical revenue is unchanged | **PASS** — was ₦36,000.00, now ₦36,000.00 |
| 2 | historical cost of sales is unchanged | **PASS** — was ₦20,700.00, now ₦20,700.00 |
| 3 | every frozen cost is byte-for-byte what it was | **PASS** — ₦15,600.00 over 3 frozen lines |
| 4 | no historical status was rewritten | **PASS** — all still `confirmed` |
| 5 | the order the old default left behind now carries a confirmation time | **PASS** — taken from `created_at` |
| 6 | and it is still counted, exactly once | **PASS** — 1 line, ₦6,000.00 |
| 7 | no order reads as a sale without a confirmation time | **PASS** — 0 left |
| 8 | no historical sale was re-costed at today's prices | **PASS** — every frozen snapshot predates the order referencing it |
| 9 | a snapshot written before `0046` keeps NULL provenance | **PASS** |
| 10 | the provenance `0046` introduced reads as not recorded | **PASS** |
| 11 | wherever a full breakdown exists, it reconciles | **PASS** |

**11 / 11.** Against the owner's four questions: historical statuses were not
rewritten (#4); existing valid sales remain valid and keep their revenue to the
kobo (#1, #2, #6); existing frozen economics are unchanged (#3); no historical
transaction was re-frozen using current costs (#8).

### One thing the owner should know

I have no access to production, so I cannot say whether it holds any such order.
The fix handles both cases, so the answer no longer gates the deployment — but
the `0045` `NOTICE` will report the count when it runs, and the deployment pack
should capture it. If it reports 0, nothing was reconciled and nothing changed.

---

## 16. TEST QUALITY — what each critical test would catch

| Concern | Test | What it catches if the implementation regresses |
|---|---|---|
| **Tenant isolation** | `032` #33 | Any view or function that stops scoping by account. It holds a *named row id* from account A and asserts B cannot see it on twelve surfaces — a row-count test would pass while leaking, because B has its own data |
| | `034` #4, #5 | A new `SECURITY DEFINER` function that takes an `account_id` and forgets to check it. #5 calls one cross-tenant rather than reading the source, so a check that exists but does not fire still fails |
| **Atomic confirmation** | `032` #6, #7 | Freezing per line instead of per order — the Monday/Wednesday assertion fails the moment two lines can freeze at different instants. #7 catches a confirmation that reports success while freezing fewer lines than it has |
| | `032` #9 | Confirmation becoming re-runnable, which would re-freeze a sale at today's cost |
| **Immutable economics** | `032` #14, #15 | Any of ten inputs leaking into a confirmed sale. It compares the whole tuple — revenue, cost, profit, margin — so a change that moves only the margin is still caught |
| | `032` #10–#13 | The one-way freeze weakening: value→value, value→NULL, a caller writing a cost onto a draft, or a cost supplied at INSERT |
| | `lifecycle` #7–#11 | Revenue, header or frozen cost becoming editable after confirmation, or a confirmed order becoming deletable |
| **Mixed NULL COGS** | `032` #20, #21 | The single most dangerous regression: `gross_profit` reverting to `revenue − cogs`. #21 asserts the reported figure is *strictly less* than the flattering one, so the two cannot be confused |
| | `032` #17 | An uncosted line acquiring a zero cost, zero profit or 0% margin |
| **Discounts** | `033` #5, #7 | Allocation that does not sum to the order discount — #7 uses the case that will not divide, where naive rounding loses a kobo |
| | `033` #9, #10 | Non-determinism, and the residual moving off the largest line |
| | `033` #1, #6 | Gross or allocated revenue being overwritten by net, destroying the original price |
| **Void / reissue** | `032` #28–#32 | A voided sale still counted, a voided sale losing its frozen cost, a replacement that does not link back, or both records being counted together |
| **Draft exclusion** | `032` #4, #5 | The status default reverting, or drafts re-entering revenue — the defect `0047` fixed |
| | `032` #35–#37 | `confirmed + finalised_at NULL` becoming reachable again by insert or update |
| **Migration rollback** | fingerprint over 2,242 / 2,445 lines | A rollback that leaves a view without `security_invoker` (invisible to a definition diff, because `pg_views.definition` omits `reloptions`), or without its grants — both of which happened in `0036` and `0042` |
| | `verify_legacy.sh` | Any future migration that changes what historical data means. The ordinary suites structurally cannot catch this |
| **Grants** | `034` #1, #2, #3 | A new function arriving executable by `PUBLIC`/`anon`, and an over-broad revoke that breaks the application |
| | `027` (26 checks) | A view losing `security_invoker` or its `SELECT` grant on a `DROP`/recreate |
| **Mobile sales journey** | `journey-sales.mjs` (43) | Regressions the SQL cannot see: an uncosted line rendering ₦0.00, a draft counted on the page, a confirmed sale's figures moving after a price change, a discount shown as a lower price, sideways scroll or an off-screen destination at 360px |

**Totals:** 517 SQL checks across 19 suites · 130 browser checks across 2
journeys · 11 legacy replay checks · 26 cross-tenant probes · 16 lifecycle
transitions · 103 UI measurements across 19 screens. All green.

One honest note on the harness: `journey.mjs` failed roughly one run in three at
360px because a second browser context could reach the recipe page before its
own auth cookie was live. That is a harness defect, not a product one, and a
gate that fails intermittently is not a gate — it now polls the page it is about
to assert on. Three consecutive clean runs since.

---

## 17. FINAL ACCEPTANCE VERDICT

### A — PHASE 6 READY FOR OWNER ACCEPTANCE

No P0 or P1 defect remains. The eight P2/P3 items in §2 are each safe to defer,
and none has a financial or data-integrity impact.

**Two things to weigh before you sign it off:**

1. **The P1 in §15 was found and fixed during this audit.** The fix is new code
   you have not reviewed: `0045` now reconciles legacy orders before its own
   DDL, and `scripts/verify_legacy.sh` proves the owner's historical figures do
   not move. Accepting Phase 6 means accepting that change too.

2. **`0045` will report how many legacy orders it reconciled.** I have no
   production access, so I cannot tell you the number in advance. The deployment
   pack should capture that `NOTICE`. If it reports 0, nothing was reconciled.

Recommended before deployment, though neither is a Phase 6 defect: schedule the
accessibility half of **D-4** (skip-link and landmark roles), and fold **D-7**
(12px money captions on desktop) into the next design pass.

**Nothing deployed. Phase 7 not started.**
