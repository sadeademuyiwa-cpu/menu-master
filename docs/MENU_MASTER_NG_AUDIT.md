# MENU MASTER NG
# FORENSIC ARCHITECTURE AND DATABASE AUDIT

Auditor role: Lead Database Architect / Backend / Security / Technical Product
Method: live execution against PostgreSQL 16.14, clean rebuild from migration 0001, plus adversarial probes executed as the `authenticated` role with forged JWT subjects.
Date: 17 August 2026
Scope audited: the system that exists, not the system intended.

**Nothing in this audit was changed, created or deleted. No fixes applied.**

---

# 1. EXECUTIVE VERDICT

## 🔴 DO NOT PROCEED — ARCHITECTURE REQUIRES CORRECTION

**Is the current Menu Master NG database safe enough to build the application layer on top of?**

# NO.

Three vulnerabilities were **proven by execution**, not inferred from reading SQL:

1. A user of Account B read Account A's confidential ingredient cost (₦15.00/g) and Account A's private paint-to-kg conversion, through a granted `SECURITY DEFINER` function. **Cross-tenant data breach.**
2. A user of Account B **destroyed Account A's cost basis** by calling `fn_reverse_purchase()` on Account A's posted purchase. Account A's rice cost went from ₦15/g to NULL. **Cross-tenant destructive write.**
3. Any member of an account, including a `kitchen` or `sales` user who is explicitly barred from seeing costs, can **insert an `owner` membership row for themselves** and gain full cost visibility. **Privilege escalation.**

The important nuance: **the relational architecture is sound.** The costing engine is correct, the completeness gate genuinely cannot be bypassed from the client, tenant isolation on direct table access holds, and financial history is immutable where it matters. What fails is the **authorization boundary around the RPC surface**. Migration 0011 granted EXECUTE on `SECURITY DEFINER` functions that contain no ownership check whatsoever, which quietly hands every caller a key that bypasses the RLS everything else depends on.

This is roughly one day of work to fix. It is not a redesign. But it must be fixed before a single line of frontend is written, because the frontend will be built against an API surface that is currently unsafe, and correcting it afterwards changes the contract.

---

# 2. 16-ARTIFACT INVENTORY

Verified: 16 artifacts. **Only 11 are live migrations.** Five are documentation or stale duplicates. That distinction is itself a P1 finding, because two of the stale files are earlier, broken copies of live migrations and running them would fail or double-apply.

## 2.1 LIVE MIGRATIONS

### 0001_init.sql (35,543 bytes)
- **Purpose:** MVP core schema, Level 1 plus Level 2.
- **Tables (33):** accounts, profiles, businesses, locations, memberships, plans, plan_features, subscriptions, units, ingredient_categories, ingredients, ingredient_unit_conversions, suppliers, ingredient_prices, business_settings, costing_method_changes, recipes, recipe_lines, labour_rates, recipe_labour, overhead_items, cost_snapshots, channels, recipe_prices, purchases, purchase_lines, customers, orders, order_lines, sales_entries, period_closes.
- **Types:** business_type, member_role, unit_kind, item_kind, price_source, costing_method, tax_mode, recipe_kind, recipe_status, exclusion_reason, order_status, payment_status.
- **Functions:** fn_ingredient_unit_cost, fn_block_snapshot_mutation, fn_is_account_member, fn_can_see_costs() **[zero-arg, the security defect]**.
- **Triggers:** trg_cost_snapshots_immutable.
- **Views:** v_recipe_cost_current, v_price_check, v_sales_unified, v_profit_by_period, v_profit_by_product.
- **Policies:** 30, created by two DO loops.
- **Dependencies:** none upstream. Everything downstream depends on it.
- **Necessary:** yes.
- **Risk:** ⚠️ **This file did not run until repaired.** Three inline `unique (account_id, lower(name))` constraints are invalid Postgres. The migration aborted at line 172, meaning 0002 and 0003 had never applied either. Repaired as three `create unique index` statements. Anyone holding an older copy has a file that cannot execute.

### 0002_add_container_unit.sql (926 bytes)
- **Purpose:** `alter type unit_kind add value 'container'`.
- **Necessary:** yes. **Must run alone**, since Postgres refuses to use a new enum value in the transaction that created it.
- **Risk:** low. Correctly isolated.

### 0003_seed_catalog.sql (24,699 bytes)
- **Purpose:** 45 global units (33 container, all with `factor_to_base` NULL), 16 categories, 180 catalogue items, `fn_clone_starter_catalog`, `v_missing_unit_conversions`.
- **Tables created:** catalog_categories, catalog_ingredients.
- **Risk:** 🟡 **A seed migration creates structural tables.** `catalog_categories` and `catalog_ingredients` are schema, not seed data. They belong in 0001. Harmless today, confusing at migration 0040.

### 0004_integrity_and_security_fixes.sql (9,720 bytes)
- **Purpose:** account-scoped `fn_can_see_costs(uuid)`, nullability corrections, purchase lifecycle columns, cross-account composite foreign keys.
- **Constraints added:** 14 `unique (id, account_id)` keys, **37 composite foreign keys** binding every child row to its parent's account.
- **Necessary:** yes. This is the strongest migration in the set.
- **Risk:** low. Verified working: a recipe line cannot reference another account's ingredient (test T19).

### 0005_unit_conversion_engine.sql (5,427 bytes)
- **Functions:** fn_resolve_qty_to_base, fn_can_resolve_unit. **View:** v_missing_unit_conversions rebuilt with blocking_recipe / blocking_purchase / suggested reasons.
- **Risk:** 🔴 `fn_resolve_qty_to_base` is `SECURITY DEFINER`, granted to `authenticated`, and **performs no membership check**. Proven leak vector.

### 0006_purchase_posting.sql (10,536 bytes)
- **Functions:** fn_guard_posted_purchase, fn_guard_ingredient_prices, fn_purchase_blockers, fn_post_purchase, fn_reverse_purchase, and a replacement fn_ingredient_unit_cost that excludes reversed rows.
- **Triggers:** trg_purchases_guard, trg_purchase_lines_guard, trg_ingredient_prices_guard.
- **Risk:** 🔴 `fn_post_purchase` and `fn_reverse_purchase` are `SECURITY DEFINER`, granted to `authenticated`, **with no ownership check**. Proven cross-tenant destructive write.
- **Duplication:** redefines `fn_ingredient_unit_cost` from 0001. Correct approach, but the 0001 definition is now dead code that still reads as authoritative.

### 0007_recipe_cost_engine.sql (15,757 bytes)
- **Columns added:** floor_batch_cost, floor_cost_per_yield_unit, floor_cost_per_portion on cost_snapshots.
- **Type:** recipe_cost_result.
- **Functions:** fn_prevent_recipe_cycle, fn_convert_between_units, fn_ingredient_usable_unit_cost, fn__recipe_cost_core (recursive), fn_compute_recipe_cost_snapshot.
- **Necessary:** yes. This is the product.
- **Risk:** 🔴 `fn_compute_recipe_cost_snapshot` granted to `authenticated` with no ownership check. 🟢 `fn__recipe_cost_core` correctly revoked.

### 0008_snapshot_and_pricing_engine.sql (6,759 bytes)
- **Functions:** fn_recipes_using_ingredient, fn_recompute_recipes_for_ingredient, fn_trg_price_change_recompute, fn_trg_ingredient_change_recompute.
- **Triggers:** trg_ingredient_prices_recompute, trg_conversion_recompute, trg_ingredients_recompute.
- **Views:** v_price_check rebuilt on floor columns, v_costing_blockers.
- **Risk:** 🟠 **synchronous fan-out.** Every price row recomputes every dependent recipe inside the posting transaction. Confirmed architectural bottleneck.

### 0009_sales_freeze_and_profitability.sql (6,176 bytes)
- **Functions:** fn_freeze_sale_cost, fn_guard_frozen_cost.
- **Triggers:** trg_order_lines_freeze, trg_sales_entries_freeze, trg_order_lines_frozen, trg_sales_entries_frozen.
- **Views:** v_sales_unified, v_profit_by_period, v_profit_by_product, v_dashboard_waterfall.
- **Risk:** 🔴 **freezes cost but not revenue.** See section 9.

### 0010_onboarding.sql (6,043 bytes)
- **Seed:** 3 plans, 12 plan_features. **Function:** fn_create_account_and_business. **View:** v_onboarding_status.
- **Risk:** 🟡 accepts an arbitrary `p_user_id`, so a caller can create an account owned by another user.

### 0011_grants_and_api_surface.sql (4,299 bytes)
- **Purpose:** explicit grants to anon and authenticated; revokes on internal functions.
- **Risk:** 🔴 **This migration is the proximate cause of all three P0 findings.** It grants EXECUTE on thirteen `SECURITY DEFINER` functions, none of which authorize the caller. The intent was to make the API surface explicit; the effect was to publish a bypass.

## 2.2 NON-MIGRATION ARTIFACTS

| Artifact | Nature | Disposition |
|---|---|---|
| 001_correctness_and_isolation.sql | Test suite, 26 tests | **KEEP.** Not a migration. Move to `tests/`. |
| menu-master-ng-blueprint.md | Approved blueprint | **KEEP.** |
| menu-master-ng-schema-mvp.sql | **Stale pre-repair copy of 0001** | **REMOVE.** Contains the invalid unique constraints. Will not run. |
| menu-master-ng-seed.sql | **Stale copy of 0003** | **REMOVE.** Still contains the enum alter that must live in 0002. |
| menu_master_ng_schema.sql | Discarded v0 single-tenant schema | **REMOVE.** Superseded by the approved blueprint. |

---

# 3. BLUEPRINT TRACEABILITY MATRIX

| # | Blueprint requirement | Status | Evidence and reason |
|---|---|---|---|
| 1 | Personal data is the source of truth | ✅ | `fn_ingredient_unit_cost` filters `account_id`; test T01 proves account B gets NULL where A has a price |
| 2 | Missing price is NULL, never zero | 🟡 | Holds for absent data. **Fails for a zero-amount purchase**: `amount >= 0` permits ₦0, which posts as a real cost of 0.00. Proven in probe P6 |
| 3 | Missing conversion is NULL, never zero | ✅ | T04; resolver returns NULL |
| 4 | No seeded prices | ✅ | `catalog_ingredients` has no price column at all |
| 5 | No seeded conversions | ✅ | 33 container units, all `factor_to_base` NULL (T14) |
| 6 | No seeded yields | ✅ | All catalogue items inherit the default 100 |
| 7 | Ingredient-specific conversions | ✅ | T02: rice paint 4000g does not apply to beans |
| 8 | Completeness gate, no margin when incomplete | ✅ | T05, T06. Enforced in `v_price_check` at DB level |
| 9 | Labelled cost floor when incomplete | ✅ | `floor_cost_per_portion`, NULL when nothing priced (T21) |
| 10 | unpriced_items identifies what to fix | ✅ | JSONB with ingredient_id, name, unit, problem |
| 11 | Recursive sub-recipes, completeness propagates | ✅ | T17 |
| 12 | Cycle prevention | ✅ | T18, direct and indirect |
| 13 | Purchase yield affects usable cost | ✅ | T16: ₦5/g at 70% becomes ₦7.1429/g |
| 14 | Cooking yield affects portion cost | ✅ | Applied in `fn__recipe_cost_core` |
| 15 | Packaging as first-class cost | ✅ | `item_kind='packaging'`, separate `packaging_cost` column |
| 16 | Labour, NULL rate makes incomplete | ✅ | Verified in engine logic |
| 17 | Overhead, missing config does not become zero | ✅ | Sets `v_overhead := null` and flags incomplete |
| 18 | Immutable cost snapshots | ✅ | T07, T08 |
| 19 | Price change writes new snapshot, never rewrites | ✅ | T09 |
| 20 | Sales freeze cost at moment of sale | ✅ | T10: ₦2,250 survives a later tripling of rice |
| 21 | Incomplete cost means revenue but no COGS | ✅ | T11 |
| 22 | cost_coverage_pct exposes trustworthy share | ✅ | T12: 50.00 with one covered and one uncovered sale |
| 23 | Costing method configurable, weighted average default | 🟡 | Column exists and is honoured. **`costing_method_changes` table is never written to.** Changing the method is a silent UPDATE, violating approved Decision 2 |
| 24 | Method change must not rewrite history | ⚠️ | Snapshots record their method, so history is safe. But nothing prevents or records the change itself |
| 25 | Recommended price = cost / (1 − margin), rounded up | ✅ | Verified: ₦1,500 at 40% target rounds to ₦2,500 |
| 26 | Channel-specific target margins | ✅ | `coalesce(ch.target_margin, bs.default_target_margin)` |
| 27 | Channel commission affects economics | ❌ | `channels.commission_pct` is stored, selected in the view, and **used in no calculation** |
| 28 | Tax configuration in MVP scope | ❌ | `tax_mode` and `tax_rate` exist. **Nothing anywhere reads them.** Locked MVP explicitly lists Tax |
| 29 | Role matrix: kitchen cannot see cost | 🟡 | Read side enforced. **Write side absent**: every policy is `FOR ALL`, so kitchen can delete recipes and orders |
| 30 | Kitchen/sales cannot see margins | 🔴 | Defeated by privilege escalation, probe P2 |
| 31 | Closed periods immutable | ❌ | `period_closes` exists; nothing writes to it and nothing enforces it |
| 32 | Append-only ledger, corrections by reversal | 🟡 | True for purchases and prices. **False for sales**: order line price is freely editable |
| 33 | Cross-account references impossible | ✅ | 37 composite FKs, T19 |
| 34 | RLS on every tenant table | ✅ | 33 of 33 tables |
| 35 | Anonymous callers see nothing | ✅ | T23 |
| 36 | Atomic onboarding | ✅ | `fn_create_account_and_business` |
| 37 | Starter catalogue cloned without prices | ✅ | 180 items, no prices |
| 38 | Multi-business under one account | ✅ | account → business → location |
| 39 | Stock lots, production, waste, finished goods, supplier balances | ⚪ | Correctly absent. See section 16 |

**Score: 26 ✅ · 6 🟡 · 2 ⚠️ · 4 ❌ · 1 🔴 · 1 ⚪**

---

# 4. DATABASE ARCHITECTURE AUDIT

## Strong
- **Every table has a UUID primary key** with `gen_random_uuid()`. No sequence contention, no ID guessing.
- **No floating point anywhere.** All money is `numeric`. Costs `numeric(18,6)`, money `numeric(14,2)`, portions `numeric(14,3)`. Correct for a financial application.
- **`timestamptz` throughout** for instants. No naive timestamps.
- **Generated columns** for `unit_cost` and `line_total` mean derived money cannot drift from its inputs.
- **Check constraints** on quantities (`qty > 0`), percentages (`0 < pct <= 100`), and the `one_target` constraint forcing a recipe line to be either an ingredient or a sub-recipe, never both.
- **`reason_required_when_excluded`** enforces that an exclusion carries a reason, exactly as the blueprint requires.

## Weaknesses

**W1. `amount >= 0` permits a real zero cost.** `ingredient_prices.amount` and `purchase_lines.amount` allow 0. A zero-amount purchase posts a genuine ₦0.00 unit cost that is indistinguishable in every downstream calculation from a properly priced ingredient. This directly contradicts the source-of-truth rule. Complimentary items are supposed to be handled by `is_cost_bearing = false`, which is why zero should be rejected. **Proven in probe P6.**

**W2. Delete semantics contradict themselves.** `cost_snapshots.recipe_id` is `ON DELETE CASCADE`, but `trg_cost_snapshots_immutable` fires `BEFORE DELETE` and raises. Deleting a recipe therefore fails with `cost_snapshots is append only`, which is a confusing error for what is a legitimate operation. **The foreign key declares a behaviour the trigger forbids.** Soft delete via `deleted_at` is the intended path, but nothing enforces it.

**W3. Soft delete is inconsistently applied.** `deleted_at` exists on accounts, businesses, ingredients and recipes. `v_sales_unified` does not filter it, `v_profit_by_product` inner-joins `recipes` and would silently drop revenue for a soft-deleted dish.

**W4. Timezone boundary.** `effective_date`, `sale_date` and `order_date` default to `current_date`, which is the **server's** date. Supabase runs UTC; Lagos is UTC+1. A purchase entered at 00:30 Lagos time is dated to the previous day. `businesses.timezone` is stored and never used.

**W5. No non-negative check on `orders.amount_paid`,** and `payment_status` is a free-standing enum with no constraint tying it to `amount_paid` versus the order total. Nothing prevents `status='paid'` with `amount_paid = 0`.

**W6. Duplicate recipe lines permitted.** No unique constraint on `(recipe_id, ingredient_id)`. Adding tomato twice double-counts silently. This may be deliberate (an ingredient added at two cooking stages) and so is flagged as **REQUIRES PRODUCT DECISION**, not a defect.

**W7. `units` uniqueness uses a magic UUID.** `coalesce(account_id, '00000000-...')` in a unique index works but is fragile and non-obvious.

---

# 5. MULTI-TENANT ISOLATION AUDIT

Isolation was tested three ways: direct table access, function access, and privilege manipulation. **Direct table access is solid. The other two are not.**

## ✅ What holds

- RLS enabled on 33 of 33 tenant tables.
- `anon` holds no grant on any tenant table (T23).
- A user of Account B selecting from `ingredients` sees zero Account A rows and zero Account A prices (T22).
- 37 composite foreign keys make a cross-account reference a constraint violation, not a policy question (T19).
- `fn_can_see_costs(p_account_id)` correctly scopes by account (T13). The original zero-argument version was a genuine cross-tenant hole and is fixed.

## 🔴 VULN-1: Cross-tenant read via SECURITY DEFINER RPC — **P0, PROVEN**

**Scenario.** Any authenticated user calls, over the public PostgREST endpoint, `fn_ingredient_unit_cost(<competitor's ingredient uuid>, <competitor's business uuid>)`.

**Why it works.** The function is `SECURITY DEFINER`, so it executes as the owner and RLS does not apply. It contains no membership check. Migration 0011 granted EXECUTE to `authenticated`.

**Proof.**
```
set role authenticated;
select set_config('request.jwt.claim.sub', <user B>, true);
select fn_ingredient_unit_cost(<A's rice>, <A's business>);
  → 15.0000000000000000
select fn_resolve_qty_to_base(<A's rice>, 1, <paint>);
  → 4000.000000
```
Account B obtained Account A's confidential unit cost and Account A's privately measured conversion.

**Exposed functions:** `fn_ingredient_unit_cost`, `fn_ingredient_usable_unit_cost`, `fn_resolve_qty_to_base`, `fn_can_resolve_unit`, `fn_convert_between_units`, `fn_purchase_blockers`, `fn_recipes_using_ingredient`.

**Mitigating factor:** UUIDs must be obtained first. They are not guessable, but they leak through shared links, screenshots, support tickets, exports and any future public menu feature. **Obscurity is not the control that was designed.**

**Severity: P0.** The product's single promise is that your competitor's numbers are not yours and yours are not theirs.

**Fix.** Every `SECURITY DEFINER` function must resolve the target's `account_id` and assert `fn_is_account_member()`, plus `fn_can_see_costs()` for anything returning money.

## 🔴 VULN-2: Cross-tenant destructive write — **P0, PROVEN**

**Scenario.** User B calls `fn_reverse_purchase(<A's purchase uuid>, 'anything')`.

**Proof.**
```
→ {"reversed": true, "price_rows_reversed": 1, ...}
Account A's rice cost: 15.00 → NULL
```
Account A's entire cost basis for that ingredient was destroyed by a stranger. Every recipe using rice silently became incomplete. Every dish lost its margin and its recommended price.

**Also exposed:** `fn_post_purchase` (post another tenant's draft), `fn_compute_recipe_cost_snapshot` (write rows into another tenant's ledger), `fn_recompute_recipes_for_ingredient` (mass-write across a tenant).

**Severity: P0.** This is financial data destruction by an unauthorized party, and because reversal is itself an append-only operation, there is no undo.

## 🔴 VULN-3: Privilege escalation inside a tenant — **P0, PROVEN**

**Scenario.** A cashier hired last week, holding role `sales`, inserts a row into `memberships` granting themselves `owner`.

**Why it works.** `create policy p_memberships on memberships for all using (fn_is_account_member(account_id)) with check (fn_is_account_member(account_id))`. Membership in the account is the only test. The policy never asks what role the caller holds.

**Proof.** `insert into memberships(account_id, business_id, user_id, role) values (<own account>, null, <self>, 'owner') → SUCCEEDED`.

**Consequence.** Every cost protection in the system is downstream of `memberships.role`. `fn_can_see_costs` is correct and complete, and it is trivially defeated by writing the row it reads. Cross-account takeover was correctly blocked, which is the only reason this is not catastrophic.

**Severity: P0.** The blueprint's kitchen-cannot-see-margins guarantee is the stated commercial selling point of the role model.

## 🟡 VULN-4: `fn_create_account_and_business` accepts an arbitrary `p_user_id` — P2

A caller can create an account whose owner is a different user. Low impact today (it creates data rather than exposing it), but it is an unauthenticated-intent write and should default to `auth.uid()` with no override.

## 🟡 VULN-5: Direct reversal stamping bypasses the reversal function — P2

`trg_ingredient_prices_guard` permits an UPDATE that changes only `reversed_at`. A cost-privileged user can therefore mark any price row reversed without going through `fn_reverse_purchase`, leaving no reversal record and no reason.

---

# 6. COSTING ENGINE AUDIT

**This is the strongest part of the system.** It was tested against the exact scenarios requested.

## Requested case 1: ₦8,000 per 1kg, recipe uses 250g
```
base unit = g; kg → g via universal factor 1000
unit_cost = 8000 / 1000 = ₦8.000000 per g
250 g × 8 = ₦2,000.00   ✅ CORRECT
```

## Requested case 2: ₦5,000 per 5 litres, recipe uses 750ml
```
base unit = ml; l → ml via universal factor 1000
unit_cost = 5000 / 5000 = ₦1.000000 per ml
750 ml × 1 = ₦750.00     ✅ CORRECT
```

## Nigerian case: 1 paint of rice at ₦60,000, recipe uses 1kg
```
paint is kind='container', factor_to_base IS NULL
→ resolver consults ingredient_unit_conversions for (rice, paint) IN THIS ACCOUNT
→ 4000 g, entered by the owner
unit_cost = 60000 / 4000 = ₦15.000000 per g
1000 g × 15 = ₦15,000.00  ✅ CORRECT, and NULL for any account that has not measured it
```

## Full stack verification
```
batch: 1000 g rice @ ₦15/g       = ₦15,000
yield: 5000 g, cooking yield 100% = ₦3.00 per g
portion 500 g                     = ₦1,500.00 per portion
selling price ₦3,500              = 57.14% margin
target 40%, rounding ₦50          = recommended ₦2,500
```
Every figure verified against the live database.

## Silent-mismatch analysis

The question asked was where a unit mismatch could produce a **silently incorrect** cost. Answer: **it cannot, with one exception.**

`fn_resolve_qty_to_base` requires either (a) an identical unit, (b) the same `unit_kind` with universal factors on both sides, or (c) an explicit per-ingredient conversion in the same account. Every other path returns NULL, and NULL propagates to `is_complete = false`. A cross-kind conversion such as grams to millilitres cannot succeed without the owner supplying a density-equivalent conversion herself.

**The exception is W1: a zero-amount purchase.** ₦0 / 4000g = ₦0.000000 per gram, which flows through the whole stack as a legitimate cost, produces a complete snapshot, and yields a 100% margin. This is the one place the engine will report a confident, materially wrong number.

## Cost stack completeness
| Element | Implemented | Note |
|---|---|---|
| Purchase yield | ✅ | Divides, not multiplies. Verified 5/0.7 |
| Cooking yield | ✅ | Applied to batch yield |
| Sub-recipes | ✅ | Recursive, depth-capped at 10 |
| Packaging | ✅ | Separate column |
| Labour | ✅ | NULL rate blocks completion |
| Overhead | ✅ | Missing config blocks completion |
| Wastage assumptions | ⚪ | Deliberately not seeded |

---

# 7. PRICE HISTORY AUDIT

## Methodology: locked and defensible
Weighted average over a configurable rolling window (`wavg_window_days`, default 90), scoped to the account, excluding reversed rows, with fallback to the most recent price when the window is empty. This is a defensible methodology and it matches approved Decision 2.

## The Jan ₦4,000 / Feb ₦5,500 / Mar ₦7,000 test

| Question | Answer | Evidence |
|---|---|---|
| Do old recipes retain historical costing? | ✅ Yes | Snapshots are immutable (T07, T08); each records its own method and window |
| Does new costing use current prices? | ✅ Yes | Weighted average over the window, recomputed on every price insert |
| Are price changes auditable? | ✅ Yes | `ingredient_prices` is append-only with `source`, `effective_date`, `entered_by`, `purchase_line_id` |
| Can historical sales change when today's price changes? | ✅ No | T10: rice tripled after the sale; `unit_cost_at_sale` stayed ₦2,250 |

## ⚠️ Two unlocked decisions

**Backdating.** Weighted average keys off `effective_date`, not posting time. A purchase backdated into January changes today's computed cost and produces new snapshots. Correct for costing, surprising for an owner, and **it can change a reported figure for a period an accountant has already seen** because `period_closes` is not enforced.

**Reversal is not retroactive.** Reversing a purchase removes it from future calculations but does not revisit snapshots computed while it was live. This is the right choice, and it is undocumented.

---

# 8. RECIPE / MENU ARCHITECTURE AUDIT

Tested mentally against the requested Nigerian cases.

| Scenario | Supported | Mechanism |
|---|---|---|
| Jollof rice | ✅ | Standard recipe with portions |
| Efo riro with a pepper base | ✅ | Sub-recipe, recursive costing |
| Chicken, beef, fish with different yields | ✅ | Per-ingredient `purchase_yield_pct` |
| Soups and sauces sold by volume | ✅ | Base unit ml, portion in ml |
| Party trays | ✅ | Recipe with a large `portion_qty` |
| **Different bowl sizes: 1.5L, 2.5L, 4L, 5L** | 🔴 **NO** | See below |
| Custom orders | 🟡 | `order_lines.description` with NULL recipe_id gives revenue but never COGS |

## 🔴 The portion-size modelling defect

`recipes.portion_qty` is **a single scalar column on the recipe**. Scenario B, your own soup business, sells the same egusi in four sizes. The current model forces one of two bad options:

1. **Four separate recipes.** Four ingredient lists to maintain, four sets of conversions, four snapshots, and product profitability reports four "different" soups. When palm oil moves, the owner edits four recipes and will eventually miss one.
2. **One recipe, sizes handled in the UI.** But then `cost_per_portion` is meaningless, and the frozen `unit_cost_at_sale` is wrong for every size except the base.

Neither is acceptable, and **option 2 silently corrupts COGS**, which is the product's core promise.

**This is a missing table, not a bug:** `recipe_variants (recipe_id, name, portion_qty, portion_unit_id)`, with `cost_snapshots` and `order_lines` referencing the variant. Retrofitting it after sales data exists means migrating every historical `order_line` and every snapshot.

**This is the single most expensive thing to defer.** It affects Slim Ọlọbẹ directly and is central to the soup-seller persona the blueprint names first.

---

# 9. TRADING / SALES AUDIT

| Capability | Status | Note |
|---|---|---|
| Customers | ✅ | |
| Orders and order lines | ✅ | |
| Quantities and prices | ✅ | numeric, generated `line_total` |
| **Discounts** | ❌ | Not modelled anywhere |
| Totals | 🟡 | Computed in views only; no stored order total |
| Payment status | 🟡 | Enum exists, unconstrained against `amount_paid` |
| Order status | ✅ | Cancelled orders excluded from `v_sales_unified` |
| Sales dates | 🟡 | Server-date, see W4 |
| Channels | ✅ | |
| Cancellations | ✅ | |
| **Refunds** | ❌ | Not modelled |
| Historical sales | 🔴 | See below |
| Profitability | ✅ | With `cost_coverage_pct` |

## 🔴 Historical revenue is mutable — P1, PROVEN

```
insert order_line qty 1 @ ₦5,000 → line_total 5000.00
update order_lines set unit_price = 1
→ line_total 1.00
```

The sales freeze protects `unit_cost_at_sale` and `cost_snapshot_id`. It does not protect `unit_price` or `qty`. **Revenue, the other half of every profit figure, can be rewritten at will by anyone with an account membership** — including, per VULN-3, a cashier who promoted themselves.

`orders` has no finalisation state that locks its lines. `order_status` includes `delivered`, but nothing prevents editing a delivered order's lines.

This means: gross profit is only as immutable as its weakest half, and the weakest half has no protection at all.

## Other findings
- **Orphaned order lines:** not possible; `order_id` cascades.
- **Deleted products breaking history:** `order_lines.recipe_id ON DELETE SET NULL` preserves revenue and `unit_cost_at_sale`, so COGS survives. But `v_profit_by_product` inner-joins `recipes`, so **that revenue vanishes from product profitability** without any warning that it did.
- **Duplicate orders:** `unique (business_id, order_no)` protects only when `order_no` is supplied; it is nullable, and NULLs do not conflict.
- **Decimal handling:** clean throughout. No float anywhere in the schema.

---

# 10. SALES FREEZE AUDIT

**What is frozen:** `cost_snapshot_id` and `unit_cost_at_sale`, and only those.

**At what point:** `BEFORE INSERT` on `order_lines` and `sales_entries`, via `fn_freeze_sale_cost`.

**Why:** so that a historical sale's COGS remains reproducible after prices, recipes, conversions and yields change.

**How immutability is enforced:** `trg_order_lines_frozen` and `trg_sales_entries_frozen` fire `BEFORE UPDATE` and raise if either frozen column changes. **Database level, not application level.** A malicious client cannot bypass it: verified by T11b.

**Can historical transactions be changed?** **Partly, and this is the defect.**

| Field | Protected | |
|---|---|---|
| `unit_cost_at_sale` | ✅ | Trigger enforced |
| `cost_snapshot_id` | ✅ | Trigger enforced |
| `unit_price` | ❌ | **Freely editable** |
| `qty` | ❌ | **Freely editable** |
| `order_date` | ❌ | Freely editable |
| Line deletion | ❌ | No guard at all |

**Can order lines be edited after finalization?** Yes. There is no finalization concept.

**Can records be deleted after finalization?** Yes. `delete from order_lines` has no guard.

**Verdict on this component: 🔴.** The freeze is correctly implemented for what it covers and enforced at the right layer. It covers half the equation. A system where COGS is immutable and revenue is not does not produce trustworthy profit; it produces a number that looks authoritative and can be edited afterwards, which is precisely the failure mode the blueprint was written to prevent.

---

# 11. ONBOARDING AUDIT

Traced end to end: business creation → membership → permissions → configuration → first data entry → costing → menu → sale. **The chain is unbroken.** `fn_create_account_and_business` executed successfully in every probe and produced a working tenant reaching a complete costed dish and a recorded sale.

Creates: account, owner membership, business, default location, business_settings, default `Direct` channel, 180 catalogue items, trial subscription. Atomic: a single function body, so any failure rolls the whole thing back.

**Findings:**
- 🟡 `p_user_id` overridable (VULN-4).
- 🟡 **Slug collision.** `businesses.slug` is unique per account and derived by regex. Two businesses named "Lunch Loft" in one account raise a raw unique-violation rather than disambiguating.
- 🟡 **No plan-limit enforcement.** `plan_features` defines `businesses`, `users` and `recipes` limits. Nothing reads them. A trial account can create unlimited businesses.
- 🟢 No race condition found. `fn_clone_starter_catalog` is idempotent via `not exists`.

---

# 12. GRANTS / API / SECURITY AUDIT

Nineteen `SECURITY DEFINER` functions exist. Thirteen are executable by `authenticated`.

| Function | Sec | Authed | Ownership check | Verdict |
|---|---|---|---|---|
| fn_ingredient_unit_cost | DEFINER | ✅ | **NONE** | 🔴 P0 leak |
| fn_ingredient_usable_unit_cost | DEFINER | ✅ | **NONE** | 🔴 P0 leak |
| fn_resolve_qty_to_base | DEFINER | ✅ | **NONE** | 🔴 P0 leak |
| fn_can_resolve_unit | DEFINER | ✅ | **NONE** | 🔴 P0 leak |
| fn_convert_between_units | DEFINER | ✅ | n/a (global units only) | 🟡 |
| fn_purchase_blockers | DEFINER | ✅ | **NONE** | 🔴 leaks supplier and ingredient names |
| fn_post_purchase | DEFINER | ✅ | **NONE** | 🔴 P0 write |
| fn_reverse_purchase | DEFINER | ✅ | **NONE** | 🔴 P0 destructive |
| fn_compute_recipe_cost_snapshot | DEFINER | ✅ | **NONE** | 🔴 P0 write |
| fn_recompute_recipes_for_ingredient | DEFINER | ✅ | **NONE** | 🔴 P0 mass write |
| fn_recipes_using_ingredient | DEFINER | ✅ | **NONE** | 🔴 enumerates another tenant |
| fn_clone_starter_catalog | DEFINER | ✅ | **NONE** | 🟡 pollutes another tenant's catalogue |
| fn_create_account_and_business | DEFINER | ✅ | n/a | 🟡 VULN-4 |
| fn_is_account_member | DEFINER | ✅ | self-scoped | 🟢 |
| fn_can_see_costs | DEFINER | ✅ | self-scoped | 🟢 |
| fn__recipe_cost_core | DEFINER | ❌ revoked | — | 🟢 |
| fn_freeze_sale_cost | DEFINER | ❌ revoked | — | 🟢 |
| fn_trg_* recompute | DEFINER | ✅ | **NONE** | 🟡 trigger functions should be revoked |

**The pattern is uniform and therefore easy to fix:** eleven functions need the same four-line guard. There is no case requiring a different approach.

**Assuming an attacker manipulates client requests, as instructed:** the attacker needs one UUID belonging to a target tenant. With it they read costs, read private conversions, enumerate recipe dependencies, post and reverse purchases, and write snapshots. They cannot read recipes, orders or customers directly, because those go through RLS-protected tables rather than functions.

---

# 13. RLS AUDIT

## Matrix

| Table | RLS | Policy | SELECT | INSERT | UPDATE | DELETE | Role-aware |
|---|---|---|---|---|---|---|---|
| accounts | ✅ | SELECT only | ✅ | ❌ none | ❌ none | ❌ none | no |
| profiles | ✅ | ALL, self | ✅ | ✅ | ✅ | ✅ | n/a |
| businesses | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| locations | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| **memberships** | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | 🔴 **escalation** |
| subscriptions | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | 🔴 self-upgrade plan |
| business_settings | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| ingredients | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| ingredient_prices | ✅ | ALL + cost role | ✅ | ✅ | ✅ | ✅ | ✅ |
| cost_snapshots | ✅ | ALL + cost role | ✅ | ✅ | blocked | blocked | ✅ |
| recipe_prices | ✅ | ALL + cost role | ✅ | ✅ | ✅ | ✅ | ✅ |
| recipes, recipe_lines | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| purchases, purchase_lines | ✅ | ALL | ✅ | ✅ | guarded | guarded | **no** |
| orders, order_lines | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| sales_entries | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| period_closes | ✅ | ALL | ✅ | ✅ | ✅ | ✅ | **no** |
| units | ✅ | 2 policies | ✅ | scoped | scoped | scoped | n/a |
| plans, plan_features, catalog_* | ✅ | SELECT true | ✅ | ❌ | ❌ | ❌ | n/a |

## Findings

**R1 🔴 `memberships` is writable by any member.** Privilege escalation, VULN-3.

**R2 🔴 `subscriptions` is writable by any member.** A trial user can `update subscriptions set plan_id='trading', status='active', current_period_end='2099-01-01'`. **Revenue loss, and it requires no exploit, only a REST call.**

**R3 🟡 `FOR ALL` collapses four operations into one predicate.** Twenty-four tables grant SELECT, INSERT, UPDATE and DELETE to any account member. The blueprint's role matrix says kitchen staff record batches and see no money; today a kitchen user can delete every recipe in the business.

**R4 🟡 Policies invoke `SECURITY DEFINER` functions per row.** `using (fn_is_account_member(account_id))` is re-evaluated per row rather than cached as an InitPlan. Wrapping as `using ((select fn_is_account_member(account_id)))` is the standard Supabase optimisation and materially changes large-scan cost.

**R5 🟢 NULL tenant IDs cannot bypass.** `account_id` is `NOT NULL` on every tenant table and `fn_is_account_member(NULL)` returns false.

**R6 🟢 `accounts` has no INSERT policy,** so accounts can only be created through the onboarding function. Correct, though it also means an owner cannot rename their own account.

---

# 14. DATA INTEGRITY AUDIT

| Case | Result |
|---|---|
| Negative price | ✅ Blocked, `amount >= 0` |
| **Zero price** | 🔴 **Permitted, becomes a real ₦0 cost** |
| Negative quantity | ✅ Blocked |
| Zero quantity | ✅ Blocked, `qty > 0` |
| Absurd quantity | 🟡 `numeric(14,3)` allows 99 billion units. No sanity ceiling |
| Duplicate ingredients | ✅ Blocked, unique index on `(account_id, lower(name))` |
| **Duplicate recipe lines** | 🟡 Permitted. Product decision |
| Invalid units | ✅ FK plus `trg_*_unit_scope` |
| Invalid conversions | ✅ `qty_in_base > 0` |
| Deleted ingredients | 🟡 `ON DELETE RESTRICT` from recipe_lines, but `ON DELETE CASCADE` from ingredient_prices, so hard-deleting an unused ingredient destroys its price history |
| Archived ingredients | 🟡 `is_active` exists; the costing engine ignores it |
| Deleted recipes | 🔴 Fails with a misleading append-only error (W2) |
| Cancelled orders | ✅ Excluded from revenue |
| Duplicate orders | 🟡 Only if `order_no` is supplied |
| Partial payments | 🟡 `amount_paid` unconstrained |
| Concurrent updates | See section 14 |

---

# 15. CONCURRENCY AUDIT

**C1 🟠 Snapshot ties are non-deterministic.** `distinct on (recipe_id) ... order by computed_at desc` with no tiebreak. Two snapshots written in the same transaction share `now()` exactly, since `now()` is transaction time. Which one `v_price_check` and `fn_freeze_sale_cost` select is arbitrary. **Two simultaneous sales of the same dish can freeze different costs.** Fix: add `id desc` to every ordering.

**C2 🟠 Recompute fan-out is not serialised.** Two users posting purchases for the same ingredient concurrently both trigger full recomputation. No advisory lock. Result: duplicate snapshots, wasted work, and C1's ambiguity made more likely.

**C3 🟡 `fn_post_purchase` does not lock the purchase row.** Two concurrent calls both read `status='draft'` and both write price rows. `SELECT ... FOR UPDATE` is needed.

**C4 🟡 Order number races.** `unique (business_id, order_no)` raises a raw constraint error under concurrency rather than retrying.

**C5 🟢 Onboarding is atomic** and cannot half-complete.

---

# 16. PERFORMANCE AUDIT

**P-1 🟠 Forty-plus unindexed foreign keys.** Including `order_lines.order_id`, `order_lines.recipe_id`, `purchase_lines.purchase_id`, `cost_snapshots.business_id`, `ingredient_prices.supplier_id`. Every order detail view is a sequential scan on `order_lines`.

**P-2 🟠 Synchronous recompute fan-out.** A 40-line purchase where each ingredient appears in 30 recipes is 1,200 snapshot computations inside the posting transaction, each recursive. At 100 businesses this is a lock-contention and timeout source.

**P-3 🟡 Unbounded snapshot growth.** Every price change writes a snapshot per dependent recipe, forever. A business with 200 recipes and daily price entry generates roughly 70,000 snapshot rows a year with no partitioning or archival strategy.

**P-4 🟡 Per-row RLS function calls** (R4).

## Scale assessment

| Scale | Verdict |
|---|---|
| 10 businesses | 🟢 Fine as built |
| 100 businesses | 🟡 Needs P-1 indexes |
| 1,000 businesses | 🟠 Needs P-1, P-2 queue, P-4 InitPlan wrapping |
| 10,000+ | 🔴 Needs the above plus snapshot partitioning and archival |

The bottlenecks are **additive fixes, not redesigns.** The schema shape scales; the write amplification does not.

---

# 17. PHASE 1 / PHASE 2 BOUNDARY AUDIT

## SHOULD EXIST NOW — and does
Identity and tenancy, plans, units and conversions, catalogue, ingredients, prices, recipes and sub-recipes, labour, packaging, overhead, cost snapshots, pricing, channels, purchases, customers, orders, sales entries, profitability views, period_closes.

## MUST NOT EXIST YET — and correctly does not
Verified by inspection: **no** `stock_lots`, `stock_movements`, `stock_counts`, `production_batches`, `batch_consumption`, `batch_outputs`, `waste_events`, `finished_goods`, `supplier_balances`, or any accounts-payable structure. **The boundary is clean.**

## Phase 2 hooks present

| Hook | Disposition | Reason |
|---|---|---|
| `locations` table, one default row | **RETAIN** | Explicitly approved. Prevents altering purchases and orders later |
| `business_settings.finished_goods_enabled` | **RETAIN** | Dormant boolean, zero cost |
| `costing_method = 'fifo'` enum value | **RETAIN** | Selectable but inert. **Needs a guard** so a business cannot select FIFO today and silently receive weighted average |
| Purchase reversal machinery | **RETAIN** | Required by MVP, not a Phase 2 leak |
| `costing_method_changes` table | **REQUIRES DECISION** | Approved in Decision 2 but never written to. Either wire it up or remove it |
| `period_closes` table | **REQUIRES DECISION** | Nothing writes or enforces it |

**No unnecessary Phase 2 contamination found.** This part of the build was disciplined.

---

# 18. MIGRATION CHAIN AUDIT

**Executed, not assumed.** Clean rebuild from an empty database, four times during this audit.

```
  ok  0000_supabase_shim.sql        (local auth emulation, not a project migration)
  ok  0001_init.sql
  ok  0002_add_container_unit.sql
  ok  0003_seed_catalog.sql
  ok  0004_integrity_and_security_fixes.sql
  ok  0005_unit_conversion_engine.sql
  ok  0006_purchase_posting.sql
  ok  0007_recipe_cost_engine.sql
  ok  0008_snapshot_and_pricing_engine.sql
  ok  0009_sales_freeze_and_profitability.sql
  ok  0010_onboarding.sql
  ok  0011_grants_and_api_surface.sql
ALL MIGRATIONS APPLIED
```
**Build: SUCCESS. Zero failures, zero dependency errors, correct ordering.**

## Quality findings

**M1 🔴 Not idempotent.** No migration is re-runnable. `create type`, `create trigger` and `alter table add column` all fail on a second run. A partial failure mid-migration leaves the database in a state that cannot be resumed. **Proven during this build:** a partially applied 0004 required a full database drop to recover.

**M2 🟡 No rollback scripts.** No down-migrations exist.

**M3 🟡 No migration ledger.** Nothing records what has been applied. The Supabase CLI provides this; the raw SQL files do not.

**M4 🟡 Environment assumption.** Every migration assumes `auth.users` and `auth.uid()` exist. True on Supabase, false anywhere else, which is why a shim was needed to test.

**M5 🔴 Stale duplicates in the artifact set.** `menu-master-ng-schema-mvp.sql` is a pre-repair copy of 0001 containing the invalid unique constraints. Running it fails. `menu-master-ng-seed.sql` contains the enum alter that must be isolated. **These must be removed before anyone else touches the repository.**

**M6 🟡 Structural tables in a seed migration** (0003 creates `catalog_*`).

---

# 19. BUSINESS REALITY TESTS

## Scenario A — Restaurant ✅ PASSES
Buys, costs, prices, sells. Verified end to end with real numbers.

## Scenario B — Soup business at 1.5L / 2.5L / 4L / 5L 🔴 **FAILS**
The defect in section 8. One `portion_qty` per recipe cannot represent four sizes. Either four duplicate recipes or corrupted per-portion COGS. **This is your own business and it does not fit the model.**

## Scenario C — Catering, 100 guests, multiple items 🟡 PARTIAL
Orders and lines handle it. No event or quote concept, no per-head costing, no service or logistics lines. Catering quoting is Phase 3 in the blueprint, so this is scope-consistent, but a caterer cannot use the product for its main job today.

## Scenario D — Tomato price inflation ✅ PASSES
New purchase → new price row → recompute → new snapshots → margins fall → `v_costing_blockers` and `v_price_check` show it. **Historical sales unaffected**, verified.

## Scenario E — Owner, manager, cashier, kitchen 🔴 **FAILS**
Cost visibility is correctly restricted by role. Everything else is not: any of them can delete recipes, edit orders, change settings, and **promote themselves to owner**. The role model exists on the read path only.

## Scenario F — Two businesses, complete separation 🔴 **FAILS**
Isolation holds for direct table access (T22, T19, T13). **It fails through the RPC surface**: proven read of another tenant's costs and proven destruction of another tenant's cost basis.

## Scenario G — Menu price changes after a completed sale ✅ PASSES
`recipe_prices` is append-only with `effective_from`. The sale keeps its recorded `unit_price` and its frozen `unit_cost_at_sale`. Correct — **provided nobody edits the order line**, which they currently can.

---

# 20. 🔴 CRITICAL ISSUES

## P0 — Must fix before anything else

**P0-1. Cross-tenant read through SECURITY DEFINER RPCs.** PROVEN. Seven functions granted to `authenticated` with no ownership check return another tenant's costs and private conversions. Location: 0005, 0006, 0007, 0008, granted in 0011.

**P0-2. Cross-tenant destructive write through SECURITY DEFINER RPCs.** PROVEN. `fn_reverse_purchase` destroyed another account's cost basis. `fn_post_purchase`, `fn_compute_recipe_cost_snapshot` and `fn_recompute_recipes_for_ingredient` are equally exposed.

**P0-3. Privilege escalation via `memberships`.** PROVEN. Any member can insert an `owner` row for themselves, defeating the entire cost-visibility model.

**P0-4. Subscription self-upgrade.** Any member can set their own plan and period end. Direct revenue loss, no exploit required.

## P1 — Must fix before production

**P1-1. Historical revenue is mutable.** PROVEN, ₦5,000 → ₦1. Sales freeze covers cost only. No order finalisation, no delete guard.

**P1-2. Zero-amount purchase creates a real ₦0 cost.** PROVEN. Violates the source-of-truth rule and produces a confident 100% margin.

**P1-3. Portion-size model cannot express bowl sizes.** Scenario B fails. Cheap now, very expensive after sales data exists.

**P1-4. Write-side role enforcement absent.** `FOR ALL` policies on 24 tables. Kitchen staff can delete recipes.

**P1-5. Tax is in locked MVP scope and is not implemented.** `tax_mode` and `tax_rate` are read by nothing.

**P1-6. Migrations are not idempotent and have no rollback.** A partial failure in production requires a manual repair with no defined path.

**P1-7. Stale duplicate artifacts.** Two are broken copies of live migrations.

**P1-8. Synchronous recompute fan-out.** Timeout risk at modest scale.

## P2 — Important but can follow
Snapshot tie non-determinism (C1); missing FK indexes (P-1); per-row RLS function calls (R4); UTC date boundary (W4); `costing_method_changes` unwired; `period_closes` unenforced; channel commission unused; `fn_create_account_and_business` arbitrary user; direct reversal stamping; recipe hard-delete contradiction (W2); soft-delete filtering in views; plan limits unenforced.

## P3 — Nice to have
Absurd-quantity ceilings; slug collision handling; order number retry; `is_active` respected in costing; snapshot archival.

---

# 21. 🟢 ARCHITECTURAL STRENGTHS

Credit given only where the implementation was verified to support it.

1. **The completeness gate is real and unbypassable.** `v_price_check` returns NULL for profit, margin and recommended price whenever the snapshot is incomplete. Enforced in the database, not the client. This is the blueprint's central promise and it holds (T05, T06).
2. **Cost snapshots are genuinely immutable.** Trigger-enforced against UPDATE and DELETE (T07, T08).
3. **Composite foreign keys are excellent.** Thirty-seven `(id, account_id)` pairs make a cross-account reference structurally impossible rather than policy-dependent. This is stronger than most production multi-tenant systems achieve and it is what contained the blast radius of the RPC vulnerabilities.
4. **The unit model is correct and locally right.** Container units with NULL factors force per-ingredient conversions. Rice paint cannot contaminate beans paint (T02). This is the product's local moat and it is implemented properly.
5. **Purchase posting refuses rather than invents.** Missing conversion returns a structured blocker list and leaves the purchase in draft (T15).
6. **NULL is never coalesced to zero** anywhere in the costing path, with the single zero-amount exception.
7. **No floating point anywhere.** Correct numeric precision throughout, generated columns for derived money.
8. **The cost stack is complete and correct:** purchase yield, cooking yield, recursive sub-recipes, packaging, labour, overhead. Verified against real arithmetic.
9. **Sales cost freeze works** and survives a tripling of input prices (T10).
10. **`cost_coverage_pct` is intellectually honest.** Rather than hiding uncovered revenue, it reports exactly what share of revenue has a trustworthy cost. Few systems in this category do this.
11. **Phase boundary discipline.** No stock, production, waste or finished-goods contamination. Hooks are dormant and justified.
12. **Anonymous access is properly closed** (T23).
13. **The test suite exists and is meaningful.** Twenty-six tests, all passing, covering isolation and correctness rather than just syntax.

---

# 22. REQUIRED FIXES BEFORE NEXT PHASE

## Gate 1 — before ANY further work (P0)
1. Add an ownership guard to all eleven exposed `SECURITY DEFINER` functions: resolve target `account_id`, assert `fn_is_account_member`, and assert `fn_can_see_costs` for anything returning money.
2. Revoke EXECUTE on trigger functions from `authenticated`.
3. Replace the `memberships` `FOR ALL` policy with role-aware policies: only `owner` may INSERT, UPDATE or DELETE membership rows.
4. Make `subscriptions` read-only to clients; plan changes through a guarded function or service role only.
5. Re-run the test suite plus new tests reproducing all four P0 probes.

## Gate 2 — before production (P1)
6. Add order finalisation: a status transition after which `unit_price`, `qty` and deletion are trigger-blocked, with corrections by credit note.
7. Change `amount > 0` on purchase lines and price rows; route genuine zero-cost items through `is_cost_bearing = false`.
8. Add `recipe_variants` and repoint `cost_snapshots` and `order_lines` at it, **before any real sales data exists**.
9. Split `FOR ALL` policies into per-command, role-aware policies matching the blueprint role matrix.
10. Implement tax in the pricing engine, or formally defer it out of the locked MVP.
11. Add idempotency guards and down-migrations.
12. Delete the three stale artifacts.
13. Move recompute to a queue table with a worker.

## Gate 3 — before scale (P2)
14. Index every foreign key; add `id desc` tiebreaks; wrap RLS predicates in `(select ...)`; resolve dates in business timezone; wire or remove `costing_method_changes` and `period_closes`; guard FIFO selection.

---

# 23. FINAL GO / NO-GO DECISION

## 🔴 DO NOT PROCEED — ARCHITECTURE REQUIRES CORRECTION

**Is the current Menu Master NG database safe enough to build the application layer on top of? NO.**

**Why not, precisely:**

Four P0 issues are proven by execution, three of which breach the single promise the product is built on: that one business's numbers never touch another's. A competitor holding one UUID can read your food costs and destroy your cost basis. A cashier can promote themselves to owner. A trial user can grant themselves a paid plan.

**What is not wrong, and this matters:**

The relational model, the costing engine, the completeness gate, the unit system and the immutability guarantees are correct and, in several places, better than commercial products in this category. The composite foreign key work is genuinely strong and is the reason the RPC vulnerabilities could not be escalated into full cross-tenant takeover.

The failure is confined to the **authorization boundary** and to **two modelling gaps** (order finalisation, recipe variants). Gate 1 is approximately one day. Gate 2 is approximately three to five days. Neither requires discarding anything already built.

**Recommendation:** authorize Gate 1 immediately, re-audit, then proceed to Gate 2 in parallel with API layer design. Do not begin frontend work against the current RPC surface, because that surface must change and the frontend contract would have to change with it.

---

*Every claim marked PROVEN was executed against a live PostgreSQL 16.14 instance built from migration 0001. Claims about production Supabase behaviour under its own auth stack are marked UNVERIFIED where they could not be reproduced locally: specifically, Supabase's default privilege grants and the behaviour of the `service_role` key, which bypasses RLS entirely and was not available for testing.*
