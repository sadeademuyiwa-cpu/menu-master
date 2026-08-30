# PHASE 6 COMPLETION REPORT
## Customers, orders, sales, discounts and frozen sales economics

Nothing deployed. Local verification only, against PostgreSQL 17.6 and
PostgREST 12.2.3 with RLS enabled.

**Headline:** the sale's economics now freeze when the sale is confirmed, not
when a line is typed; a cost that is not known is reported as not known
everywhere, including on the page; and four defects were found and fixed on the
way, two of them mine and two pre-existing.

---

## 1. Migrations created or changed

Six, each with a preflight, a self-check and a rollback. None deployed.

| Migration | Purpose |
|---|---|
| `0043_customer_and_line_scope.sql` | `customers.notes` / `.company`; `order_lines.business_id`, backfilled, NOT NULL, composite FK, and **derived by trigger** so it cannot disagree with its order |
| `0044_discounts.sql` | `order_lines.discount_amount`, `orders.order_discount` with CHECKs; `fn_allocate_order_discount`; both revenue guards extended to cover discounts |
| `0045_confirmation_freeze.sql` | The freeze moves to confirmation. `fn_confirm_order`, `fn_frozen_sale_cost`, `fn_guard_order_lifecycle`; `trg_order_lines_freeze` dropped; `orders.status` defaults to `draft` |
| `0046_cost_provenance.sql` | `cost_snapshots.portion_qty_at_snapshot` / `.variant_overhead_cost`; `fn_variant_cost_components` as the single component implementation |
| `0047_sales_reporting.sql` | Five new views; four existing sales views rebuilt, correcting two defects |
| `0048_function_grant_surface.sql` | **Added, not in the approved plan.** Restores the EXECUTE surface 0018 established and every migration since had eroded. Reason in §18 |

`0043` was amended after its first application to derive `business_id` by
trigger rather than require every caller to supply it: a NOT NULL column that
every existing INSERT must now name breaks those callers, and a denormalised
column that a caller can set can disagree with the row it was copied from.

---

## 2. Functions created or changed

**Created (6)**

| Function | What it is for |
|---|---|
| `fn_confirm_order(uuid)` | The only way an order becomes a sale. Freezes every line from one instant in one statement, and sets `status` and `finalised_at` together |
| `fn_frozen_sale_cost(uuid,uuid,uuid)` | "What does this product cost right now", shared by quick sales and by order confirmation so the two cannot diverge |
| `fn_variant_cost_components(uuid)` | Ingredients-and-labour, packaging, overhead and total, in one place |
| `fn_allocate_order_discount(uuid)` | Splits an order discount across its lines pro rata, exactly |
| `fn_order_line_scope()` | Derives `order_lines.business_id` from the parent order and refuses a contradicting value |
| `fn_guard_order_discount()` | An order discount may not exceed what the order is worth |
| `fn_guard_order_lifecycle()` | `status` and `finalised_at` move together, and only the confirmation moves them |

**Changed (7)**

`fn_guard_frozen_cost` (strict one-way, now covers INSERT) ·
`fn_guard_order_line_revenue` (discount joins the immutable tuple) ·
`fn_guard_finalised_order` (order discount joins the immutable tuple) ·
`fn_freeze_sale_cost` (body moved to the shared helper; **behaviour unchanged**) ·
`fn_finalise_order` (delegates to `fn_confirm_order`, keeps its old return shape) ·
`fn_variant_cost` (thin wrapper over the components) ·
`fn_compute_variant_cost_snapshot` and `fn_compute_recipe_cost_snapshot` (store provenance).

**Deviation from the approved plan.** §6 of the addendum listed
`fn_freeze_sale_cost` as unchanged. Its body moved onto `fn_frozen_sale_cost`
so that quick sales and order confirmation share one implementation of the
freeze rule. Its semantics, including the gate that an incomplete cost is not a
cost, are identical — asserted by test 032 check 40. Writing that rule twice is
exactly how the 0040 defect happened.

---

## 3. Tables and columns changed

| Table | Column | Note |
|---|---|---|
| `customers` | `notes`, `company` | nullable text. Nothing else — no address, no birthday, no marketing consent |
| `order_lines` | `business_id` | NOT NULL, composite FK, derived by trigger |
| `order_lines` | `discount_amount` | `numeric(14,2) not null default 0`, `>= 0` and `<= qty * unit_price` |
| `orders` | `order_discount` | `numeric(14,2) not null default 0`, `>= 0`; the ceiling against the order total is a trigger, then a hard gate at confirmation |
| `orders` | `status` | default `'confirmed'` → `'draft'` |
| `cost_snapshots` | `portion_qty_at_snapshot`, `variant_overhead_cost` | nullable. NULL on every pre-0046 row, and left NULL |

New constraints: `fk_order_lines_business_id_account`,
`order_lines_discount_amount_check`, `orders_order_discount_check`.
New composite types: `frozen_sale_cost`, `variant_cost_components`.

No existing row's value was altered by any migration. Each self-check asserts it.

---

## 4. Views changed

**Five new:** `v_sale_lines`, `v_sales_summary`, `v_product_performance`,
`v_orders_attention`, `v_sale_cost_breakdown`.

**Four rebuilt:** `v_sales_unified`, `v_profit_by_period`, `v_profit_by_product`,
`v_dashboard_waterfall` — dropped and recreated, because `CREATE OR REPLACE
VIEW` can neither reorder nor remove a column and this needed both.

All nine carry `with (security_invoker = on)`, restated explicitly. Two defects
corrected here are in §18.

---

## 5. Triggers and guards changed

| Trigger | Change |
|---|---|
| `trg_order_lines_freeze` | **Removed.** Drafts stay live and recost themselves |
| `trg_order_lines_frozen` | `BEFORE UPDATE` → `BEFORE INSERT OR UPDATE` |
| `trg_order_lines_scope` | New. Derives the line's business from its order |
| `trg_orders_discount` | New. Refuses a discount larger than the order |
| `trg_orders_lifecycle` | New. Refuses `confirmed` without `finalised_at` |
| `trg_sales_entries_freeze` | **Untouched.** A quick sale has no draft state |

`fn_guard_frozen_cost` permits exactly one transition — `NULL → value`, and
only while `fn_confirm_order` is performing it, recognised through a `SET LOCAL`
marker that dies with the transaction. Everything else is refused: value →
different value, value → NULL, `NULL → value` written by anyone else, and a cost
supplied on INSERT.

---

## 6. RLS and grants

- **116 policies, unchanged.** Every migration preflight and self-check asserts
  the count, and it is asserted again after each rollback.
- Every new view: `security_invoker = on`, `SELECT` to `authenticated`.
- Restated grants after each `DROP VIEW`, which discards them — the defect that
  had to be repaired twice, in 0036 and 0042.
- **One deliberate narrowing.** The four rebuilt views lost
  `authenticated INSERT/UPDATE/DELETE` (12 grant rows). They are multi-table
  joins and were never updatable; the privileges were Supabase defaults that did
  nothing. `SELECT` is unchanged.
- **`0048`:** no `fn_*` is executable by `PUBLIC` or by `anon`. The functions
  the application and the security_invoker views call are granted to
  `authenticated` by name.

---

## 7. D-5 reconciliation proof

`tests/032` check 32, on a 2.5 litre format sale:

```
4250.0000 + 400.0000 + 0.0000000000000000 = 4650.0000
```

Ingredients-and-labour, this format's own packaging, and its own overhead share,
read from the snapshot frozen onto the line — never from today's configuration.
Check 31 proves the ₦400 tub and not the ₦150 bowl.

Pre-0046 snapshots keep NULL in the new columns and `v_sale_cost_breakdown`
reports them as NULL. Nothing was inferred or backfilled from current mutable
configuration. The 0046 self-check refuses to proceed if any pre-existing
snapshot gained detail.

---

## 8. Atomic freeze proof

`tests/032` checks 9–12:

```
monday line=1275.0000  wednesday line=1275.0000
  (both must be 1275, the cost at confirmation -- not 850,
   the cost when the Monday line was typed)
{"confirmed": true, "lines_frozen": 2, "lines_without_cost": 0}
status = confirmed / finalised_at = 2026-08-30 16:29:37
a second confirmation is refused
```

Atomicity comes from three things together: `SELECT ... FOR UPDATE` on the
order, a **single UPDATE statement** across every line, and one transaction, so
any exception rolls the whole confirmation back. There is no path to a partially
frozen confirmed order. A line that freezes to NULL COGS is a valid outcome and
does not abort.

The browser proves the same thing at 1280px: rice doubles between typing the
line and confirming, and the sale freezes at ₦12,750, not the ₦8,500 in force
when the line was typed.

---

## 9. Mixed known / NULL COGS proof

`tests/032` checks 21–28:

```
{"lines_frozen": 2, "lines_without_cost": 1}
uncosted line: cogs NULL / profit NULL / margin NULL / sold_without_cost
but revenue 1000.00 -- the sale did happen
costed_revenue=26000.00 - cogs=19280.56 = 6719.44
reported=6719.44 vs the flattering figure 7719.44
coverage=96.30%   revenue without cost=1000.00
```

`gross_profit` is `costed_revenue − cogs`, never `revenue − cogs`. The
difference is ₦1,000 in the fixture, and it always runs in the flattering
direction: the old arithmetic reported the best margin exactly where the least
was known.

Total revenue, costed revenue, uncosted revenue and cost coverage are all
exposed separately. The browser asserts no uncosted line renders `₦0.00`
anywhere — sale page, reports, or customer page.

---

## 10. Discount reconciliation proof

`tests/033`:

```
gross=37500.00  discount=2500.00  net=35000.00      (all three preserved)
N30,000 line -> 3000.00,  N10,000 line -> 1000.00   (pro rata, 3:1)
allocated 33.33 + 33.33 + 33.34 = 100.00            (the kobo that will not divide)
33.34, 33.33, 33.33  vs  33.34, 33.33, 33.33        (same order, same split)
A=33.33  B=33.34  C=33.33                           (residual follows the largest line)
gross=42500.00 - given away=3500.00 = 39000.00
view says 39000.00, raw arithmetic says 39000.00
```

The allocation is **derived, not stored**. Its inputs are already immutable once
the sale is confirmed, so the allocation is immutable too, without a second
thing to freeze and without a second place the figure can drift.

---

## 11. Historical immutability proof

`tests/032` checks 17–20. One confirmed sale, then every lever an owner has is
pulled: ingredient price, a posted purchase, recipe quantity, recipe yield,
portion size, packaging price, a labour rate, overhead configuration and its
basis, a format's capacity, and the menu price.

```
before  revenue=20000.00 cogs=12750.00 profit=7250.00 margin=36.25
after   revenue=20000.00 cogs=12750.00 profit=7250.00 margin=36.25
current cost_per_portion moved 1275.0000 -> 3980.5556
```

The dish's current cost moved by a factor of three. The sale did not move at
all. The reporting views agree (check 19).

The browser asserts the same on the page after a further price rise: ₦12,750,
₦2,250, 15.00%, unchanged.

---

## 12. Void / reissue proof

`tests/032` checks 33–38:

```
voided with a reason, not edited
revenue 38500.00 -> 18500.00        (leaves active reporting)
frozen cost still 1275.0000         (kept as evidence)
1 row in v_voided_sales with the reason
replacement: replaces -> original, status draft, finalised_at null
revenue now 28500.00                (only the correction counts)
```

Both records survive, are linked through `orders.replaces`, and cannot be
double-counted: every trading view excludes voided and cancelled orders. The
browser walks the same path.

---

## 13. Cross-tenant isolation proof

`tests/032` check 39 — asserted **by identity**, not by row count. Account B
holds one named row id from account A and is refused on all twelve surfaces:

```
customers · orders · order_lines · sales_entries · cost_snapshots ·
v_sale_lines · v_sales_unified · v_orders_attention · v_sale_cost_breakdown ·
v_sales_summary · v_product_performance · fn_allocate_order_discount
```

`tests/034` check 5 additionally **calls** `fn_frozen_sale_cost` with another
account's id as an ordinary authenticated user and asserts it is refused rather
than answered. That is a real hole I introduced and closed — see §18.

116 policies unchanged throughout.

---

## 14. SQL test totals

**517 checks across 19 suites, 0 failures**, from a pristine build of 0001–0048.

| Suite | Checks | | Suite | Checks |
|---|---|---|---|---|
| 001 correctness and isolation | 27 | | 027 view security | 26 |
| 002 gate 1 attack and regression | 56 | | 028 formats, labour, overhead | 26 |
| 004 gate 1 closure | 23 | | 029 costing models | 35 |
| 005 role write matrix | 51 | | 030 overhead allocation | 26 |
| 018 entitlement | 15 | | 031 dashboard | 21 |
| 021 costing MVP journey | 22 | | **032 sales and frozen COGS** | **43** |
| 022 entitlement final | 26 | | **033 discounts** | **20** |
| 023 recipe costing experience | 27 | | **034 function surface** | **6** |
| 024 source-aware costing | 23 | | | |
| 025 purchase ledger | 19 | | | |
| 026 recipe worksheet | 25 | | | |

Existing suites updated deliberately, not to make them pass:

- **001** now proves a draft carries no frozen cost, then that confirmation
  freezes it (+1 check).
- **002 R5** had the cashier rely on an insert trigger; the cashier now
  *confirms*. R5b asserts the boundary that actually matters — `cost_snapshots`
  stays invisible to them (+2 checks). While correcting it I found my first
  draft of R5b asserted something false: a sales user *can* read
  `unit_cost_at_sale` on a line they raised. That is pre-existing and correct —
  what Gate 1 denies them is the costing engine.
- **004** and **005** needed no changes: they call `fn_finalise_order`, which is
  now the confirmation path.
- **027** pins the nine sales views by name and asserts their grants, since a
  `DROP VIEW` discards both.

---

## 15. Browser / E2E totals

**130 checks across 2 journeys, 0 failures**, in Chromium against real
PostgREST → real PostgreSQL with RLS on.

- `e2e/journey.mjs` — **87/87**. Unchanged in substance; `settled()` now polls
  for 10s rather than 6 (§18).
- `e2e/journey-sales.mjs` — **43/43**, new. Proves in the page itself that a
  draft is not counted and says so; that the cost freezes at confirmation at
  that moment's prices; that a later price rise moves nothing; that an uncosted
  sale never renders `₦0.00`; that discounts are shown as discounts and margin
  is measured after them; and that void-and-reissue keeps both records.

Hygiene assertions in both: no `NaN`, no `undefined`, no `null`, no console
errors, no failed network requests.

---

## 16. Pristine → migrate → rollback → reapply

From a pristine build at 0042:

| Step | Result |
|---|---|
| Forward 0043 → 0048 | every self-check passed |
| Rollback 0048 → 0043 | **identical to pristine 0042 at all 2,242 fingerprint lines** |
| Reapply 0043 → 0048 | identical to the first forward run |
| Against an independent pristine build to 0048 | **identical at all 2,445 lines** |

The fingerprint deliberately includes what a definition diff misses: view
`reloptions` (so a lost `security_invoker` cannot hide — `pg_views.definition`
does not show it), every grant, every policy, every trigger definition, every
constraint definition and every composite type.

The first rollback run was *not* identical: two functions came back with their
comments missing. The code was the same; the explanation was not. Both rollback
files were corrected until the restoration was exact.

The dev database the browser suites run against was rebuilt from the same
pristine chain and verified byte-identical before the final runs.

---

## 17. Screenshots

Desktop 1280px, and both phone widths, in `web/e2e/shots/`:

| Desktop | 390px | 360px |
|---|---|---|
| `p6-sale-draft.png` | `p6-sale-mobile-390.png` | `p6-sale-mobile-360.png` |
| `p6-sale-confirmed.png` | `p6-sales-mobile-390.png` | `p6-sales-mobile-360.png` |
| `p6-sale-no-cost.png` | `p6-customers-mobile-390.png` | `p6-customers-mobile-360.png` |
| `p6-sale-discounts.png` | | |
| `p6-sale-reissued.png` | | |
| `p6-customers.png`, `p6-customer.png` | | |

Both phone widths assert **no sideways scroll** and **no destination off
screen**, and that a confirmed sale's figures read correctly.

---

## 18. Regressions found and corrected

Six. Two were mine, introduced during this phase; four were pre-existing and
found by asking questions the tests had never asked.

**P0 — `fn_frozen_sale_cost` was a cross-tenant cost read. Mine.**
`SECURITY DEFINER`, taking an account id, checking nothing, executable by
`PUBLIC` — so any caller, logged in or not, could have passed another business's
account and recipe and been told what their food costs them. It now calls
`fn_require_member` first. Membership, not cost access: a sales user may confirm
an order and the freeze runs on their behalf, while they still cannot read a
cost figure anywhere. Proven by calling it — `tests/034` check 5.

**P0 — `v_sales_unified` counted drafts as revenue. Pre-existing, activated by
0045.** It admitted every order whose status was not `cancelled`. Until 0045 an
order was born `confirmed`, so drafts were rare and the filter looked harmless.
Once an order is born a draft, an unconfirmed order would have been reported as
money taken. Revenue is now recognised at `finalised_at` — the same boundary
that freezes the cost, so revenue and COGS can never be recognised at different
moments.

**P1 — gross profit credited uncosted revenue as pure profit. Pre-existing.**
`v_profit_by_period` and `v_profit_by_product` computed
`revenue − coalesce(sum(cogs), 0)`. `sum()` skips NULLs, so a line with no
frozen cost contributed its full revenue and no cost. `cost_coverage_pct`
already existed to warn about this; the profit figure did not listen to it.

**P1 — an order could be talked into being a sale. Mine, and named by
requirement 5.** Every guard keys on `finalised_at`, and `status` was
decorative. Once `status` meant something, an ordinary INSERT or UPDATE could
set it to `confirmed` while `finalised_at` stayed NULL: an order that reads as a
sale and is treated as a draft by every guard, with no frozen cost behind it.
`fn_guard_order_lifecycle` refuses it.

**P1 — `UPDATE ... FROM LATERAL` cannot reference the row being updated. Mine.**
The first `fn_confirm_order` used exactly that. Caught by `tests/004`, which
failed five checks that had nothing to do with confirmation — the finalise call
raised, so the immutability guards never engaged. It is why those guards are
tested at all.

**P2 — the function grant surface had been decaying since 0018. Pre-existing.**
0018 removed EXECUTE from `PUBLIC` and `anon` on every `fn_*`. It did that once,
in a loop, over the functions that existed that day. Nothing re-applied it, so
nine functions added since — from 0034, 0041, 0043, 0044, 0045 and 0046 — had
arrived executable by everybody. Most were harmless in practice: trigger
functions cannot be usefully called by hand, and invoker-rights functions still
meet RLS. The one that mattered is the P0 above. `0048` restores the surface and
`tests/034` keeps it restored, so the next function added without a grant line
fails the suite instead of shipping.

**Harness, not product.** `journey.mjs`'s `settled()` polled for six seconds. A
cold database took longer than that to write the auth cookie once, and the
harness failed where the product had not. Now ten.

---

## 19. Remaining debt

| | Item | Where |
|---|---|---|
| **P2** | `v_billing_reconciliation` has no `security_invoker`. Service-role-only, so latent, and on the accepted list in `tests/027`. Deferred since Phase 5.5 | `0027` |
| **P2** | `order_status = 'delivered'` is unreachable. `fn_guard_finalised_order` refuses every status change after finalisation, and confirmation is the only route to `confirmed`. Pre-existing behaviour, and D-4 gave `delivered` no accounting meaning, so nothing is wrong — but the value exists and cannot be set | `0001` |
| **P2** | `fn_void_order` sets `voided_at` but not `status = 'cancelled'`. Every trading view excludes both, so reporting is correct; the two markers are simply not kept in step | `0014` |
| **P2** | The header wraps at 360px; three prose links render at 16px; no skip-link or landmark roles. Carried from the Phase 5.5 audit | frontend |
| **P3** | `fn_payment_failure_grace` is `SECURITY DEFINER` with no membership check. It returns a global billing-config interval, not tenant data, and 0048 has removed `PUBLIC`/`anon` from it | `0029` |
| **P3** | Nine tables still have no UI, from the Phase 0 reconciliation | frontend |

No P0 or P1 outstanding.

---

## 20. Not implemented

**Deliberately out of scope**, per the scope lock, and none of it partially
built: inventory depletion, general ledger, bank reconciliation, a tax engine
(`tax_mode` and `tax_rate` exist and are still read by nothing), channel
commission accounting, delivery profitability, a refund accounting engine, CRM
automation, loyalty, marketing automation. No fee, tax, commission or delivery
charge is included in food gross profit anywhere.

**Approved but not built:**

- Nothing. Every item in the approved plan is implemented.

**Built beyond the approved plan, and why:**

- `0048_function_grant_surface.sql` and `tests/034` — the P2 above turned out to
  be the vehicle for a P0, and a sweep that is not asserted decays. Reported
  here rather than folded into another migration.
- `fn_guard_order_lifecycle` and `trg_orders_lifecycle` — required by
  requirement 5, which forbids the state `confirmed + finalised_at NULL`.
- `fn_order_line_scope` and `trg_order_lines_scope` — a NOT NULL `business_id`
  that every caller must supply breaks every existing caller, and a
  denormalised column a caller can set can contradict its parent.
- `fn_freeze_sale_cost` refactored onto the shared helper (§2).
- `v_sales_unified`, `v_profit_by_period`, `v_profit_by_product` and
  `v_dashboard_waterfall` rebuilt rather than extended, because of the two
  defects in §18.
- `/sales`, `/sales/[id]`, `/customers`, `/customers/[id]`; Sales replaces
  Ingredients in the five-item bottom nav, and Ingredients moves under More.

**Nothing deployed.** No production database, Vercel project, Paystack
configuration, billing plan or entitlement was touched.

---

## Language check

No `COGS`, `snapshot`, `costed_revenue`, `residual`, `provenance`,
`finalised_at`, `NULL` or `allocation` reaches an owner-facing screen. What they
read instead:

> "Still a draft. Its costs are not locked in until you confirm it."
> "Cost not known" · "Cost known" · "Not locked in yet"
> "Sold, but we do not know what some of it cost you."
> "94% of revenue has a verified cost"
> "less ₦2,000.00 off" · "less ₦3,000.00 share of the order discount"
> "You kept — not known yet"
> "Cancelled. It no longer counts in your figures, but the record stays."

Asserted in the browser, at every width.

---

**Stopping here for owner review. Nothing deployed.**
