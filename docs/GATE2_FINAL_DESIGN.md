# MENU MASTER NG — GATE 2 FINAL DESIGN
## Serving Formats and Recipe Variants

Design review only. No SQL written, no migration created, no table altered.
Grounded in the live schema at migration 0012, inspected directly.

**One architectural contradiction was found. It is stated in section 11 and it concerns D1.**

---

# 1. FINAL ENTITY RELATIONSHIP MODEL

```
accounts ───────────────────────────────────────── [ACCOUNT scope]
  │
  ├── ingredients (kind = 'ingredient' | 'packaging')
  │      └── ingredient_prices · ingredient_unit_conversions
  │
  └── businesses ──────────────────────────────── [BUSINESS scope]
        ├── business_settings   (+ overhead basis, D1)
        ├── channels · labour_rates · overhead_items
        │
        ├── serving_formats                              ◀ NEW
        │     ├── serving_format_packaging               ◀ NEW → ingredients(packaging)
        │     └── serving_format_changes  (append-only)  ◀ NEW (D6)
        │
        └── recipes                    [formula: the source of truth, D5]
              ├── recipe_lines · recipe_labour
              │
              └── recipe_variants      [commercial representation]   ◀ NEW
                     ├── recipe_prices    (+ variant_id)
                     ├── cost_snapshots   (+ variant_id, + basis audit)
                     └── order_lines / sales_entries (+ variant_id)
                                   │
                                   └── frozen ▶ cost_snapshots
```

**The separation that makes D5 structural rather than a convention:** a recipe owns the formula, a variant owns the commercial representation. There is no table on which a variant could carry an ingredient, so a variant cannot alter a formula even by mistake.

---

# 2. FINAL TABLE DEFINITIONS

## 2.1 `serving_formats` (business owned)

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO | |
| business_id | uuid | NO | |
| name | text | NO | |
| description | text | YES | |
| capacity_qty | numeric(14,3) | **YES** | |
| capacity_unit_id | uuid | YES | |
| is_active | boolean | NO | true |
| sort_order | integer | NO | 0 |
| created_at / updated_at | timestamptz | NO | now() |

Capacity is a property of the **physical container** (D3). NULL is a valid and honest state.

## 2.2 `recipe_variants` (the recipe × format intersection)

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | |
| account_id | uuid | NO | tenancy |
| business_id | uuid | NO | denormalised so a composite FK can enforce same business |
| recipe_id | uuid | NO | |
| format_id | uuid | NO | |
| costing_basis | enum `variant_costing_basis` | NO | `'capacity'` \| `'explicit_qty'` |
| sellable_qty | numeric(14,3) | YES | required for `explicit_qty`; forbidden for `capacity` |
| sellable_unit_id | uuid | YES | as above |
| is_active | boolean | NO | true |
| created_at / updated_at | timestamptz | NO | |

Named `sellable_qty`, not `basis_qty`, because D3 makes it a distinct commercial concept: the quantity actually sold, which may differ from container capacity.

## 2.3 `serving_format_packaging` (D4, format level)

| Column | Type | Null | Notes |
|---|---|---|---|
| id, account_id, business_id | uuid | NO | |
| format_id | uuid | NO | |
| packaging_item_id | uuid | NO | → ingredients, must be `kind='packaging'` |
| qty | numeric(14,3) | NO | 1 bowl, 1 lid, 2 bags |
| is_cost_bearing | boolean | NO | true, mirrors `recipe_lines` |
| exclusion_reason | enum | YES | required when not cost bearing |

One-to-many from day one, so lids, spoons, labels and carrier bags need no redesign.

## 2.4 `serving_format_changes` (D6, append-only audit)

| Column | Type | Null |
|---|---|---|
| id, account_id, business_id, format_id | uuid | NO |
| changed_at | timestamptz | NO |
| changed_by | uuid | YES |
| field | text | NO |
| old_value / new_value | text | YES |

Written by trigger. Insert-only: UPDATE and DELETE blocked by the same guard pattern as `cost_snapshots`.

## 2.5 Additive changes to existing tables

| Table | Added | Why |
|---|---|---|
| `business_settings` | `overhead_basis_qty numeric(14,3) NULL`, `overhead_basis_unit_id uuid NULL` | D1 |
| `cost_snapshots` | `variant_id uuid NULL`, `resolved_qty numeric(18,6) NULL`, `resolved_unit_id uuid NULL`, `basis_used variant_costing_basis NULL`, `format_packaging_cost numeric(18,4) NULL` | keying and explainability |
| `recipe_prices` | `variant_id uuid NULL` | price belongs to what is sold |
| `order_lines`, `sales_entries` | `variant_id uuid NULL` | sale references the variant |
| `recipes.portion_qty` | **retained**, deprecated | migration safety |
| `business_settings.expected_monthly_units` | **retained**, deprecated | see section 11 |

Every column nullable. Nothing dropped. Pre-migration rows stay valid.

---

# 3. FINAL CONSTRAINTS

**serving_formats**
- PK `(id)`; unique `(id, account_id)`, `(id, business_id)`
- Unique index `(business_id, lower(name))`
- `chk_capacity_pair`: `(capacity_qty IS NULL) = (capacity_unit_id IS NULL)` — never a bare number, never a bare unit
- `chk_capacity_positive`: `capacity_qty > 0` when present
- FK `(business_id, account_id)` → `businesses(id, account_id)`
- Unit-visibility trigger, reusing `fn_assert_unit_visible`

**recipe_variants**
- Unique `(recipe_id, format_id)` — the duplicate rule
- Unique `(id, account_id)`, `(id, business_id)`
- FK `(recipe_id, business_id)` → `recipes(id, business_id)`
- FK `(format_id, business_id)` → `serving_formats(id, business_id)`
- `chk_basis_explicit`: `costing_basis='explicit_qty'` ⟹ `sellable_qty IS NOT NULL AND sellable_unit_id IS NOT NULL`
- `chk_basis_capacity`: `costing_basis='capacity'` ⟹ `sellable_qty IS NULL AND sellable_unit_id IS NULL`
- `chk_sellable_positive`: `sellable_qty > 0` when present
- **D7 trigger**: INSERT rejected when the format is inactive

The last capacity check is how D3 becomes non-negotiable rather than a precedence rule someone has to remember. A variant cannot hold both a capacity basis and an explicit quantity, so the system can never silently pick the wrong one.

**serving_format_packaging**
- Unique `(format_id, packaging_item_id)`
- FK `(packaging_item_id, account_id)` → `ingredients(id, account_id)`
- Trigger asserting `kind='packaging'`
- `chk_reason`: `is_cost_bearing OR exclusion_reason IS NOT NULL`
- **D4 anti-double-count trigger**, section 6

**order_lines / sales_entries**
- `chk_variant_matches_recipe`: when both present, the variant's `recipe_id` must equal the row's `recipe_id`
- **D7 trigger**: new sales rejected against a variant whose format is inactive

**cost_snapshots**
- Existing immutability trigger unchanged
- `chk_complete_requires_resolution`: `is_complete` ⟹ `resolved_qty IS NOT NULL`

---

# 4. FINAL COSTING FORMULAS

## Step 1 — resolve the sellable quantity

**Basis A, capacity:**
```
resolved_qty = convert(format.capacity_qty, format.capacity_unit → recipe.yield_unit)
```
Resolves only when capacity exists, the units are the same measurement kind, and both carry a universal `factor_to_base`. A container-kind unit (bowl, tray, paint) has no universal factor and a recipe has no ingredient against which to look one up, so it cannot resolve. That is correct behaviour, and such formats use Basis B.

**Basis B, explicit quantity:**
```
resolved_qty = convert(variant.sellable_qty, variant.sellable_unit → recipe.yield_unit)
```

Per D3, when the business has stated an actual sellable quantity, that quantity is used and container capacity is never substituted for it. The check constraints make the two mutually exclusive at the row level.

## Step 2 — variant cost

```
recipe_component  = cost_per_yield_unit × resolved_qty      [existing engine, unchanged]
format_packaging  = Σ (spk.qty × usable_unit_cost(item))    [D4, per sold unit]
overhead          = overhead_rate_per_yield_unit × resolved_qty   [D1]

variant_cost_per_unit = recipe_component + format_packaging + overhead
```

`cost_per_yield_unit` already carries ingredients, sub-recipes, purchase yield, cooking yield and **labour divided by effective yield** (D2, unchanged).

## Step 3 — completeness gate

No cost, no margin, no recommended price, and a named reason:

| Condition | problem code |
|---|---|
| Basis capacity, format has no capacity | `format_missing_capacity` |
| Capacity unit is a different measurement kind | `capacity_unit_incompatible` |
| Capacity unit is container kind, no universal factor | `capacity_unit_unconvertible` |
| Basis explicit, `sellable_qty` missing | `missing_sellable_quantity` |
| Sellable unit not convertible to yield unit | `sellable_unit_incompatible` |
| Recipe yield missing or zero | `invalid_yield` *(existing)* |
| Any ingredient unpriced | `missing_price` *(existing)* |
| Format packaging item unpriced | `missing_packaging_price` |
| Overhead enabled but basis missing or incompatible | `missing_overhead_basis` / `overhead_basis_incompatible` |

A variant is complete only if its own basis resolves **and** the underlying recipe is complete. Completeness propagates upward exactly as it does for sub-recipes today.

---

# 5. FINAL OVERHEAD ALLOCATION (D1)

## The method

One methodology, not several. Overhead is recovered **per yield unit of output**:

```
overhead_rate = monthly_overhead_total ÷ convert(overhead_basis_qty, basis_unit → yield base unit)
variant_overhead = overhead_rate × resolved_qty
```

`business_settings` gains `overhead_basis_qty` and `overhead_basis_unit_id`, replacing the ambiguous count in `expected_monthly_units`. The basis is an explicit, stored, auditable declaration: "we expect 10,000 litres of output per month".

## Worked example, as specified

Monthly overhead ₦1,000,000 · expected output 10,000 L · **overhead rate ₦100 per litre**
Illustrative direct cost ₦3,000/L · old denominator 5,000 portions → ₦200 flat

| Format | Qty | Direct | OH new | Total new | OH old | Total old | Margin new | Margin old | Δ | OH % new | OH % old |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 500 ml | 0.5 L | ₦1,500 | ₦50 | ₦1,550 | ₦200 | ₦1,700 | **38.00%** | 32.00% | +6.00 | 3.23% | 11.76% |
| 2.5 L | 2.5 L | ₦7,500 | ₦250 | ₦7,750 | ₦200 | ₦7,700 | **29.55%** | 30.00% | −0.45 | 3.23% | 2.60% |
| 5 L | 5 L | ₦15,000 | ₦500 | ₦15,500 | ₦200 | ₦15,200 | **22.50%** | 24.00% | −1.50 | 3.23% | 1.32% |
| 10 L | 10 L | ₦30,000 | ₦1,000 | ₦31,000 | ₦200 | ₦30,200 | **18.42%** | 20.53% | −2.11 | 3.23% | 0.66% |

*(Selling prices used: ₦2,500 / ₦11,000 / ₦20,000 / ₦38,000. Illustrative only, seeded nowhere.)*

## Why this is economically defensible

1. **Overhead recovery is self-consistent.** Selling exactly 10,000 L recovers exactly ₦1,000,000. The old method recovers the full overhead only if exactly 5,000 portions sell, whatever their size, so a shift in format mix silently under or over recovers.
2. **The overhead share of cost is constant at 3.23% across every format.** Under the old method it ranged from 11.76% on a 500ml pack to 0.66% on a 10L bowl, an eighteen-fold distortion driven purely by container choice.
3. **The distortion the old method caused was material.** A 500ml pack was reported at 32% margin when the defensible figure is 38%. An owner could rationally discontinue a profitable small format on the strength of that error.
4. **It is auditable.** The rate, the basis and the resolved quantity are all stored on the snapshot, so any historical figure can be reconstructed.

## ⚠️ Where this method is weak, flagged as instructed

**It under-allocates to small formats, for the same reason linear labour does.** A 500ml pack absorbs ₦50 of overhead, but it occupies nearly as much fridge space, handling attention and counter time as a 2.5L bowl. Combined with D2's linear labour, **small formats will look better than they truly are.** The direction of the error is now at least consistent and explainable, which the old method's was not, and the fix belongs with the deferred per-container handling work rather than in a second allocation methodology. Recording it so it is a known limitation rather than a surprise.

**Second caution:** the rate depends entirely on the owner's estimate of monthly output. A wrong estimate scales every variant's overhead proportionally. `v_costing_blockers` should surface a stale or unset basis rather than letting it quietly distort everything.

---

# 6. FINAL PACKAGING RULES (D4)

## Definitions

**Recipe-level packaging** is consumed **per batch, independent of how the output is sold**: greaseproof lining used during cooking, muslin, cling film over the pot, a baking tin liner. It is already supported through `recipe_lines` with `kind='packaging'`, is costed into batch cost, and is therefore divided by effective yield along with everything else. **It scales with quantity.**

**Format-level packaging** is consumed **once per sold unit**: the bowl, its lid, the label, the carrier bag, the disposable spoon. It enters through `serving_format_packaging` and is added **after** the per-yield-unit calculation, once per variant sold. **It does not scale with quantity.**

The test that separates them: *if I sold the same batch in a different container, would I still buy this item?* Yes means recipe level. No means format level.

## How each enters cost

```
recipe-level   →  inside cost_per_yield_unit  →  × resolved_qty
format-level   →  added once per sold unit    →  not multiplied
```

Stored separately on the snapshot: existing `packaging_cost` keeps its meaning (recipe level), new `format_packaging_cost` holds the format level. The owner can see both.

## Preventing double counting

**Hard enforcement, not a convention.** A validation trigger fires on inserts to `recipe_lines`, `serving_format_packaging` and `recipe_variants`, and raises when the same `packaging_item_id` appears at both levels for any recipe/format pair that a variant joins.

The rule: *a given packaging item may appear at recipe level or at format level for a given variant, never both.* Because the conflict only becomes real when a variant links the two, the variant creation path is where it must be checked, and any later insert on either side must re-check the variants that already exist.

**No second packaging system.** Packaging items remain `ingredients` with `kind='packaging'`, keeping price history, purchase posting, unit conversions and the completeness gate.

---

# 7. FINAL HISTORICAL AND VERSIONING RULES (D6, D7)

## What is immutable and when

| Object | Mutable | Frozen at |
|---|---|---|
| `serving_formats` | Yes, current definition is current | never |
| `serving_format_changes` | **Append only** | on write |
| `cost_snapshots` | **Never** (existing trigger) | on computation |
| `order_lines.unit_cost_at_sale` | **Never** (existing trigger) | moment of sale |
| `recipe_prices` | Append only | on write |

## Family Bowl 4 L → 4.5 L, resolved

1. The format row updates. Current configuration is current.
2. A `serving_format_changes` row records field, old value, new value, who and when.
3. Affected variants recompute; **new** snapshots are written at 4.5 L.
4. Existing snapshots are untouched and still carry `resolved_qty = 4.0 L`.
5. Completed sales are untouched.

`resolved_qty` on the snapshot is the mechanism that makes an old record explainable without depending on configuration that has since moved. Without it, a historical cost of ₦12,000 sits beside a format that now says 4.5 L and nobody can reconstruct why.

**This is the minimum sufficient mechanism.** Full format versioning with immutable version rows was considered and rejected: the snapshot already captures what was used, so versioning would duplicate the record while adding a join to every costing query.

## Deactivation (D7)

| Behaviour | Enforcement |
|---|---|
| Formats are deactivated, never deleted | no DELETE grant; deactivation is `is_active = false` |
| Cannot be selected for a new variant | trigger on `recipe_variants` INSERT |
| Cannot be sold | trigger on `order_lines` / `sales_entries` INSERT |
| Existing variants stay historically valid | no cascade; variants are left untouched |
| Completed sales unaffected | already frozen |
| Snapshots preserved | already immutable |

---

# 8. FINAL SECURITY MODEL

Four layers, all inherited from Gate 1, nothing new to trust.

1. **Composite foreign keys.** `recipe_variants` carries `business_id` and references `recipes(id, business_id)` **and** `serving_formats(id, business_id)`. Attaching another business's format is a foreign key violation, not a policy decision. This is what survived the Gate 1 attacks.
2. **RLS**, `account_id` scoped, on all four new tables, following the 0004 pattern.
3. **Cost-role gating.** `serving_format_packaging` and variant pricing sit under `fn_can_see_costs`, because a competitor's container list plus prices is commercial intelligence and packaging cost is an inference channel into supplier pricing.
4. **RPC guards.** Any new function derives the account from the target row's own chain, then calls `fn_require_member` or `fn_require_cost_access`. Never from a caller-supplied ID. Internals revoked, grants explicit.

Attack tests to be added at implementation: B cannot read, use, modify or attach A's formats; B cannot read A's packaging costs; B cannot price A's variants; a kitchen role cannot read format packaging cost inside its own account.

---

# 9. MIGRATION STRATEGY

Property required: **existing costing behaviour is preserved bit for bit** until a business is deliberately moved.

**Phase 1, structural.** Add four tables and the nullable columns. Zero behavioural change.

**Phase 2, backfill.** For each business with recipes having a non-null `portion_qty`:
- one `serving_formats` row named "Default", **`capacity_qty` NULL, `capacity_unit_id` NULL**
- one `recipe_variants` row per recipe: `costing_basis='explicit_qty'`, `sellable_qty = recipes.portion_qty`, `sellable_unit_id = recipes.yield_unit_id`

Exact, not approximate, because `portion_qty` already *is* a quantity of recipe output in the yield unit. **No container is inferred**, per your locked rule 4.

**Phase 3, overhead basis (D1).** `overhead_enabled` currently defaults to false, so no live business is affected. Any business that has enabled it must supply `overhead_basis_qty` and unit; until they do, overhead-enabled recipes report `missing_overhead_basis` rather than silently switching methodology.

**Phase 4, cutover regression.** For every existing recipe, the new variant cost must equal the old `cost_per_portion` to six decimal places, **except** where overhead is enabled, where the change is intended and must be reported as a before-and-after list for the owner to see.

**Phase 5.** Views and `fn_freeze_sale_cost` repoint to variants. `portion_qty` and `expected_monthly_units` retained and deprecated. Dropping them is a separate later migration.

**Rollback:** additive throughout, and both legacy columns survive, so rollback reverts a read path rather than restoring data.

---

# 10. COMPLETE TEST MATRIX

## Business A, Slim Ọlọbẹ (litre formats, capacity basis)

| # | Case | Expected |
|---|---|---|
| A1 | Small Bowl 1.5 L | ✅ complete, cost, margin, recommended price |
| A2 | Medium Bowl 2.5 L | ✅ |
| A3 | Family Bowl 4 L | ✅ |
| A4 | Party Bowl 5 L | ✅ |
| A5 | Egusi and Efo Riro across all four | ✅ 8 variants, 2 recipes, 4 formats, **no duplicated recipes** |
| A6 | Independent price per variant | ✅ separate append-only price history |
| A7 | 5 L Bowl actually filled to 4.6 L | ✅ expressed as Basis B, **no fill percentage invented** (D3) |
| A8 | Format packaging: bowl + lid + label | ✅ three rows, costed once per sold unit |

## Business B, different soup business

| # | Case | Expected |
|---|---|---|
| B1 | 2.4 L | ✅ arbitrary decimal, no schema change |
| B2 | 10 L with a 5 L base batch | ✅ resolves; overhead ₦1,000 and labour both scale correctly |
| B3 | A attempts to use B's format | ❌ **foreign key violation** |
| B4 | A attempts to read B's formats | ❌ zero rows under RLS |
| B5 | A attempts to read B's packaging cost | ❌ blocked by cost-role policy |

## Business C, non-litre

| # | Case | Expected |
|---|---|---|
| C1 | Small Pack, explicit 800 g | ✅ complete, format has no capacity |
| C2 | Medium Pack, explicit 1.5 kg | ✅ mass units against a gram yield |
| C3 | Large Pack, explicit 3 kg | ✅ |
| C4 | **Party Tray, no capacity, no quantity** | ⚠️ **INCOMPLETE**, `missing_sellable_quantity`, no cost, no margin, no price, **no volume invented** |
| C5 | Party Tray after owner supplies 8 kg | ✅ becomes complete |
| C6 | Format with capacity in a container unit ("1 tray") | ⚠️ `capacity_unit_unconvertible`, must use Basis B |
| C7 | Capacity in kg against a millilitre yield | ⚠️ `capacity_unit_incompatible`, no density guessed |

## Overhead (D1)

| # | Case | Expected |
|---|---|---|
| O1 | ₦1m over 10,000 L, four formats | matches the section 5 table exactly |
| O2 | Overhead share of cost per format | constant 3.23%, not 11.76% to 0.66% |
| O3 | Overhead enabled, basis unset | `missing_overhead_basis`, incomplete, **not zero** |
| O4 | Basis in litres, recipe yields in grams | `overhead_basis_incompatible`, incomplete |
| O5 | Full-recovery check | 10,000 L sold recovers exactly ₦1,000,000 |

## History and deactivation (D6, D7)

| # | Case | Expected |
|---|---|---|
| H1 | Family Bowl 4 L → 4.5 L | new snapshot at 4.5 L; old snapshot unchanged at 4.0 L; sales unchanged; change row written |
| H2 | Attempt to UPDATE `serving_format_changes` | blocked |
| H3 | Attempt to DELETE a format | blocked; deactivation only |
| H4 | Deactivate a format with live variants | existing variants and sales stay valid; new variants and sales blocked |
| H5 | Variant price change after a sale | historical sale keeps its recorded price and frozen cost |
| H6 | Bowl packaging price rises | new snapshots for every variant using that format; sales frozen |

## Anti-hard-coding and anti-double-count

| # | Case | Expected |
|---|---|---|
| Z1 | Fresh install plus full onboarding | **zero** rows in `serving_formats` |
| Z2 | Schema, seed and function bodies scanned | no litre, bowl or capacity constant anywhere |
| Z3 | Three businesses, three vocabularies | coexist with no schema divergence |
| Z4 | Same packaging item at recipe **and** format level | ❌ rejected by the anti-double-count trigger |
| Z5 | Variant attempts to carry an ingredient | impossible: no such table exists (D5) |

---

# 11. D1 CONTRADICTION — RESOLVED AND LOCKED

**Resolution received and accepted:** one explicit business-level output basis with a measurement kind. A variant may use it only when its own measurement kind is compatible. Incompatible variants return `overhead_basis_incompatible` and receive no resolved margin. No cross-kind allocation, no arbitrary splitting of one pool, no container size as a proxy. Multi-basis allocation is **deferred product work**, named as future scope.

This is option (a) from the Gate 2A review: the system fails honestly rather than inventing a conversion.

## Verification of the account / business / brand distinction

Checked against the live schema rather than assumed:

| Question | Finding |
|---|---|
| Does a brand, org or operating-entity table exist? | **No.** The hierarchy is exactly `accounts → businesses → locations`. Nothing else |
| Where can an overhead basis live? | `business_settings`, primary key `business_id`. **One basis per business** |
| Can one account hold businesses with different measurement systems? | **Yes.** Slim Ọlọbẹ and Lunch Loft are separate `businesses` rows under one `accounts` row, each with its own `business_settings` |
| Where is measurement kind determined? | `recipes.yield_unit_id → units.kind`, one of `volume`, `mass`, `count`, `container`. It is a property of the **recipe**, not the business |
| Does anything constrain a business to one measurement kind? | **No constraint exists** |

**The tenant architecture represents the Slim Ọlọbẹ / Lunch Loft distinction correctly.** No second hierarchy is needed and none is proposed.

## ⚠️ The deeper finding: a single business is itself mixed

The contradiction is one level lower than the account/business boundary. **Measurement kind is a property of the recipe, so one business can legitimately hold several.** Slim Ọlọbẹ does, today:

| Line | Sold by | Kind |
|---|---|---|
| Soups, stews, rice, porridge | bowl, 1.5 L to 5 L | volume |
| Swallow (eba, amala, poundo) | per piece | count |
| Proteins | per piece | count |
| Trays, lunch packs | per pack | count |

So a business-level litre basis does not rescue Slim Ọlọbẹ from partial coverage. **If overhead were enabled with a litre basis, the soups would carry overhead and every swallow, protein, tray and lunch pack would return `overhead_basis_incompatible` with no margin and no recommended price.** By line-item count that is most of the menu.

**This is the locked behaviour working as intended, not a defect.** It is recorded here so that switching overhead on is a deliberate, informed act rather than a surprise.

**Implementation consequences, all within the lock:**
1. `overhead_enabled` stays `false` by default. No live business is affected today.
2. A **pre-flight check** before enabling overhead: report how many recipes would become incomplete under the chosen basis, so the owner sees the cost of the choice first.
3. `v_costing_blockers` surfaces `overhead_basis_incompatible` by name, so the reason is always visible.
4. **Do not split a business by measurement kind to work around this.** Creating "Slim Ọlọbẹ Soups" and "Slim Ọlọbẹ Swallow" as separate businesses would fragment recipes, channels, orders and reporting, and consume plan limits, to serve an accounting mechanism. Recorded as an anti-pattern.
5. **Future scope, explicitly named:** multi-basis overhead allocation, allowing one business to declare an expected output basis per measurement kind. Deferred, not designed here.

---

# 12. FINAL LOCKED DECISIONS — CONFIRMED

| | Decision | Confirmed as designed |
|---|---|---|
| **D1** | Overhead allocated by output, explicit and auditable, single methodology, no ABC | ✅ per yield unit, section 5 — **subject to the section 11 contradiction** |
| **D2** | Labour stays linear per yield unit; no per-container handling | ✅ unchanged; a 5 L variant absorbs proportionally more, as approved |
| **D3** | Capacity and sellable quantity are separate concepts; no fill percentage | ✅ capacity on format, `sellable_qty` on variant, made mutually exclusive by check constraint |
| **D4** | Container packaging on the format; recipe packaging stays valid; double counting prevented | ✅ two scopes defined, separated on the snapshot, enforced by trigger, no second packaging system |
| **D5** | No variant ingredient overrides | ✅ structurally impossible: no variant line table exists |
| **D6** | Formats historically traceable; no destructive deletes | ✅ append-only change log plus `resolved_qty` on every snapshot |
| **D7** | Deactivate, never delete | ✅ no DELETE path; new variants and sales blocked; history preserved |
| **Rule 1** | No hard-coded container sizes | ✅ zero seeded formats, tests Z1 to Z3 |
| **Rule 2** | Basis A and B only | ✅ no scale factor, no own yield |
| **Rule 3** | Incomplete costing, never ₦0, never inferred | ✅ nine named problem codes |
| **Rule 4** | `portion_qty` maps to variant quantity, no container inferred | ✅ Default format created with NULL capacity |
| **Rule 5** | Existing tenant boundary, Gate 1 authorization | ✅ business-owned, composite FKs, cost-role gating |

**No decision was silently overridden.** The single contradiction is D1 against mixed-measurement businesses, stated in full in section 11 and awaiting your choice between (a), (b) and (c).

---

**STOP.** No SQL written, no migration created, no table altered. Awaiting your resolution of section 11 and explicit approval before Gate 2 implementation.
