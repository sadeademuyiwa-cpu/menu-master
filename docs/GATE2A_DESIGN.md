# MENU MASTER NG — GATE 2A
# Product Model and Costing Design Specification

Design review only. No SQL written, no migration created, no table altered.
Grounded in the live schema as of migration 0012, inspected rather than recalled.

---

# 0. THREE FINDINGS THAT SHAPE EVERYTHING BELOW

Before the model, three facts established by inspecting what actually exists.

**F1. `recipes.portion_qty` is not a container size.** The 0001 definition is "portion sold, expressed in the yield unit". It is a **quantity of recipe output**, never a capacity. This matters enormously for migration: it maps cleanly and honestly onto Basis B (explicit quantity) and must **not** be reinterpreted as a format capacity. Doing so would invent a physical measurement the owner never gave us.

**F2. Labour is already linear per yield unit, and the blueprint says so.** `recipe_labour.hours` is per batch; the engine adds it to batch cost and divides the whole by effective yield. The approved cost stack states exactly this. So a 5L variant already absorbs 3.33 times the labour of a 1.5L variant. **This is approved methodology, not an assumption I am adding.** What is *not* representable is labour that varies per format rather than per volume, such as portioning and sealing time per bowl. That gap is flagged in section 18.

**F3. Overhead is allocated per portion, and variants break that.** `business_settings.expected_monthly_units` divides monthly overhead across "units". With one portion size per recipe, a unit was unambiguous. With variants, a 500ml pack and a 10L bowl each absorb **identical overhead**, which materially overstates the cost of small formats and understates large ones. This is the single sharpest problem the variant model exposes and I am not resolving it myself. See section 18.

---

# A. ENTITY RELATIONSHIP MODEL

```
accounts
  │
  ├── ingredients  (kind = 'ingredient' | 'packaging')      [ACCOUNT scoped]
  │        └── ingredient_prices, ingredient_unit_conversions
  │
  └── businesses                                            [BUSINESS scoped below]
        ├── business_settings
        ├── channels
        ├── labour_rates, overhead_items
        │
        ├── serving_formats                        ◀── NEW
        │       └── serving_format_packaging       ◀── NEW  (→ ingredients, kind='packaging')
        │
        ├── recipes
        │       ├── recipe_lines (→ ingredients | → recipes)
        │       ├── recipe_labour (→ labour_rates)
        │       │
        │       └── recipe_variants                ◀── NEW  (recipe × serving_format)
        │                ├── recipe_prices     (repointed: variant + channel)
        │                ├── cost_snapshots    (repointed: per variant)
        │                └── order_lines / sales_entries (repointed: variant)
        │
        └── orders → order_lines ──frozen──▶ cost_snapshots
```

The only structural change to existing tables is the addition of `variant_id` to three tables. Nothing is dropped.

---

# B. PROPOSED TABLES

## B.1 `serving_formats`

Business-owned, reusable across every recipe in that business.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK, `gen_random_uuid()` |
| `account_id` | uuid | NO | FK → accounts, tenancy root |
| `business_id` | uuid | NO | FK → businesses, composite with account |
| `name` | text | NO | "Family Bowl", "Party Tray", "Small Pack" |
| `description` | text | YES | optional |
| `capacity_qty` | numeric(14,3) | **YES** | **Optional by design.** NULL is a valid, honest state |
| `capacity_unit_id` | uuid | YES | FK → units |
| `is_active` | boolean | NO | default true |
| `sort_order` | integer | NO | default 0, menu display order |
| `created_at` / `updated_at` | timestamptz | NO | default now() |

**Constraints**
- PK `(id)`; unique `(id, account_id)` and `(id, business_id)` for composite FKs
- Unique `(business_id, lower(name))` as a partial index
- Check: `capacity_qty is null = capacity_unit_id is null` (both or neither, never a bare number)
- Check: `capacity_qty > 0` when present
- FK `(business_id, account_id)` → `businesses(id, account_id)`
- FK `(capacity_unit_id)` → `units(id)`, plus a unit-visibility trigger matching the existing `fn_assert_unit_visible` pattern

**Indexes:** `(business_id, is_active, sort_order)`.

**Deliberately excluded:** any packaging column. Packaging is a child table, see B.3.

## B.2 `recipe_variants`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `account_id` | uuid | NO | tenancy |
| `business_id` | uuid | NO | denormalised so the composite FK can enforce same-business |
| `recipe_id` | uuid | NO | FK → recipes |
| `format_id` | uuid | NO | FK → serving_formats |
| `costing_basis` | enum | NO | `'capacity'` \| `'explicit_qty'` |
| `basis_qty` | numeric(14,3) | YES | required when basis = explicit_qty |
| `basis_unit_id` | uuid | YES | required when basis = explicit_qty |
| `is_active` | boolean | NO | default true |
| `created_at` / `updated_at` | timestamptz | NO | |

**Constraints**
- Unique `(recipe_id, format_id)` — the duplicate-variant rule you specified
- Unique `(id, account_id)` and `(id, business_id)` for downstream composite FKs
- FK `(recipe_id, business_id)` → `recipes(id, business_id)`
- FK `(format_id, business_id)` → `serving_formats(id, business_id)`
- Check: `costing_basis = 'explicit_qty'` implies `basis_qty is not null and basis_unit_id is not null`
- Check: `basis_qty > 0` when present

The two composite foreign keys are the important part. They make "attach another business's format to my recipe" a **constraint violation**, not a policy question, exactly as migration 0004 did for ingredients.

**No `selling_price` column.** Price is time-varying and already has an append-only home. See B.4.

## B.3 `serving_format_packaging`

A format normally consumes several packaging items: bowl, lid, label, carrier bag, spoon. A single `packaging_item_id` column on the format would need a redesign the first time someone adds a lid, which is precisely the outcome you asked me to avoid.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `account_id`, `business_id` | uuid | NO | tenancy |
| `format_id` | uuid | NO | FK → serving_formats |
| `packaging_item_id` | uuid | NO | FK → ingredients, must be `kind='packaging'` |
| `qty` | numeric(14,3) | NO | usually 1, but 2 for a double-bagged tray |
| `is_cost_bearing` | boolean | NO | default true, mirrors `recipe_lines` |
| `exclusion_reason` | enum | YES | required when not cost bearing |

**Constraints:** unique `(format_id, packaging_item_id)`; FK `(packaging_item_id, account_id)` → `ingredients(id, account_id)`; a trigger asserting `kind = 'packaging'`.

This reuses the existing item architecture completely. Packaging items are already `ingredients` with `kind='packaging'`, already carry price history, already flow through purchases, and 23 already exist in the starter catalogue.

## B.4 Changes to existing tables (additive)

| Table | Change | Rationale |
|---|---|---|
| `cost_snapshots` | add `variant_id uuid NULL` + FK `(variant_id, account_id)`; add `basis_qty_resolved numeric(18,6)`, `basis_unit_id uuid`, `resolved_from text` | A snapshot must record the quantity it actually costed, so a historical record stays explainable after the format changes |
| `recipe_prices` | add `variant_id uuid NULL` + FK; unique index on `(variant_id, channel_id, effective_from)` | Price belongs to what is sold: recipe in a format, per channel |
| `order_lines` | add `variant_id uuid NULL` + FK | The sale references the variant; the freeze then targets the variant's snapshot |
| `sales_entries` | add `variant_id uuid NULL` + FK | as above |
| `recipes.portion_qty` | **retained, not dropped**, marked deprecated | Migration safety, see F |

`variant_id` is nullable throughout so that pre-migration rows remain valid and the change is genuinely additive.

---

# C. COSTING RULES

Both bases resolve to the same thing: **a quantity of recipe output, expressed in the recipe's yield unit.** Everything downstream is the existing engine, unchanged.

## Basis A — CAPACITY

```
resolved_qty = convert(format.capacity_qty, format.capacity_unit → recipe.yield_unit)
```

Resolves only when **all** of the following hold, otherwise incomplete:
1. `capacity_qty` and `capacity_unit_id` are both present
2. The capacity unit and the recipe yield unit are the **same measurement kind**
3. Both units carry a universal `factor_to_base` (litre → ml works; "paint" → ml does not, because a container unit has no universal factor and a recipe has no ingredient to look one up against)

**Capacity is not automatically sellable quantity.** You asked me to distinguish these and the distinction is real: a 5L bowl is rarely filled to 5.000L. I am **not** proposing a fill-percentage field, because a fill factor is exactly the kind of plausible number that becomes an invented assumption. The honest expression of "my 5L bowl holds 4.6L of soup" is Basis B with `basis_qty = 4.6 L`. Basis A means "capacity is the quantity, and I am asserting that". Whether that is acceptable is listed in section 18.

## Basis B — EXPLICIT QUANTITY

```
resolved_qty = convert(variant.basis_qty, variant.basis_unit → recipe.yield_unit)
```

Requires no capacity on the format at all. This is what makes "Party Tray = 8 kg" costable, and it is also the exact shape of today's `portion_qty`.

## Cost computation, once resolved

```
variant_cost = cost_per_yield_unit × resolved_qty        [existing engine]
             + Σ (packaging qty × usable unit cost)      [format packaging]
             + overhead_per_unit                          [see section 18, unresolved]
```

`cost_per_yield_unit` already carries ingredients, sub-recipes, cooking yield, purchase yield and labour. Nothing about that changes.

## Incomplete costing

The existing gate applies unchanged. A variant that cannot resolve produces **no cost, no margin, no recommended price**, and names the problem:

| Situation | `problem` code |
|---|---|
| Basis capacity, format has no capacity | `format_missing_capacity` |
| Basis capacity, unit kind mismatch (kg capacity, ml yield) | `capacity_unit_incompatible` |
| Basis capacity, container-kind unit with no universal factor | `capacity_unit_unconvertible` |
| Basis explicit, `basis_qty` missing | `missing_basis_quantity` |
| Recipe yield missing or zero | `invalid_yield` (existing) |
| Any underlying ingredient unpriced | `missing_price` (existing) |
| Packaging item unpriced | `missing_packaging_price` |

A variant is complete only if its own basis resolves **and** the base recipe snapshot is complete. Completeness propagates upward exactly as it already does for sub-recipes.

---

# D. HISTORICAL INTEGRITY RULES

The Family Bowl 4L → 4.5L scenario, resolved:

| Object | Behaviour on a format change |
|---|---|
| `serving_formats` row | Mutable. Current configuration is current |
| Existing `cost_snapshots` | **Immutable.** Already trigger-enforced |
| New snapshots | Written on change, carrying `basis_qty_resolved = 4.5 L` |
| Completed sales | **Untouched.** `unit_cost_at_sale` and `unit_price` already frozen |
| Old snapshots' explainability | Preserved by `basis_qty_resolved`, which records that the old figure was costed at 4.0 L |

`basis_qty_resolved` is the crux. Without it, an old snapshot says "cost ₦12,000" and the format now says 4.5L, and nobody can reconstruct why. With it, the record is self-describing and does not depend on configuration that has since moved.

**Recommended trigger set** (mirrors the existing `fn_trg_price_change_recompute`): changing a format's capacity, a variant's basis, or format packaging recomputes affected variants. Old snapshots are never touched.

**Deliberately not proposed:** full version history on `serving_formats`. The snapshot already captures what was used at the time, so a second history mechanism would be redundant. Flagged in section 18 in case you want an explicit audit trail of who changed a capacity and when.

---

# E. PACKAGING MODEL — RECOMMENDATION

**1. Is packaging in the approved MVP?** Yes. The blueprint lists packaging as a first-class cost ("routinely 8 to 15 percent of true cost and almost always forgotten"), `item_kind` already has a `packaging` value, `cost_snapshots.packaging_cost` already exists, and 23 packaging items already ship in the catalogue. **This is not new methodology.**

**2. Does it fit the existing item architecture?** Yes, completely. Packaging items are `ingredients` with `kind='packaging'`. They get price history, purchase posting, unit conversions and the completeness gate for free.

**3. Item or special schema?** Item. No special schema. `serving_format_packaging` is a link table, not a parallel model.

**4. Does it support lids, spoons, labels later?** Yes, because the link table is one-to-many from day one. Adding a lid is inserting a row.

**What is genuinely new, and is therefore a decision, not an implementation detail:** *where* packaging attaches. Today packaging attaches to the recipe and is costed **per batch**. That is wrong for variants: one batch fills three 1.5L bowls, needing three bowls, not one. Moving container packaging to the format fixes this, but recipe-level packaging lines still exist and would double-count if a business puts the bowl in both places. See section 18.

---

# F. MIGRATION STRATEGY

The safety property required is that **existing costing behaviour is bit-for-bit preserved** until you deliberately move a business onto the new model.

**Step 1.** Add the new tables and the nullable `variant_id` columns. Nothing changes behaviourally.

**Step 2.** For each existing recipe with a non-null `portion_qty`, create:
- one `serving_formats` row per business named "Default", **with `capacity_qty` NULL**
- one `recipe_variants` row with `costing_basis = 'explicit_qty'`, `basis_qty = recipes.portion_qty`, `basis_unit_id = recipes.yield_unit_id`

This is exact, not approximate, because of finding F1: `portion_qty` already *is* an explicit quantity in the yield unit. **The default format gets no capacity**, because we do not know the container and must not invent one.

**Step 3.** The engine computes variant snapshots that are numerically identical to today's `cost_per_portion`. This is the regression test that gates the cutover: for every existing recipe, old value must equal new value to six decimal places.

**Step 4.** Recipes with `portion_qty IS NULL` are already incomplete today and stay incomplete. No change.

**Step 5.** `recipes.portion_qty` is retained and marked deprecated, not dropped. Dropping it is a separate migration after the new path has run in production for a period you choose.

**Rollback:** because every change is additive and `portion_qty` survives, rollback is reverting the read path, not restoring data.

---

# G. SECURITY MODEL

Four layers, identical to the Gate 1 model, so nothing new has to be trusted.

1. **Composite foreign keys.** `recipe_variants` carries `business_id` and references both `recipes(id, business_id)` and `serving_formats(id, business_id)`. Attaching Business B's format to Business A's recipe is a **foreign key violation**, not a policy check that might be misconfigured. This is the strongest guarantee available and it is the same technique that survived the Gate 1 attacks.
2. **RLS.** `serving_formats`, `serving_format_packaging` and `recipe_variants` get `account_id`-scoped policies. Variant **pricing** goes under the cost-role policy (`fn_can_see_costs`), because a competitor's format list plus prices is commercial intelligence.
3. **RPC guards.** Any new function follows the Gate 1 rule without exception: derive the account from the target row's own chain, then `fn_require_member` or `fn_require_cost_access`. Never from a caller-supplied ID.
4. **Grants.** Explicit, per the 0011 pattern, with internals revoked.

**Inference channel worth naming:** packaging cost is a real leak vector. If Business A can read any format belonging to Business B, they learn B's container choices and, combined with a costing RPC, could infer B's supplier pricing. Formats must therefore be gated at the same level as costs, not treated as harmless reference data.

---

# H. TEST MATRIX

Three businesses, one schema, no changes between them.

| # | Business | Format | Basis | Config | Expected |
|---|---|---|---|---|---|
| 1 | A Slim Ọlọbẹ | Small Bowl | capacity | 1.5 L | ✅ costs, margin, recommended price |
| 2 | A | Medium Bowl | capacity | 2.5 L | ✅ |
| 3 | A | Family Bowl | capacity | 4 L | ✅ |
| 4 | A | Party Bowl | capacity | 5 L | ✅ |
| 5 | A | Egusi and Efo Riro across all four | | | ✅ 8 variants, 2 recipes, 4 formats, **no duplicated recipes** |
| 6 | A | different prices per format | | | ✅ independent price history per variant |
| 7 | B other soup business | Small | capacity | 2.4 L | ✅ arbitrary decimal, no schema change |
| 8 | B | Bulk | capacity | 10 L | ✅ resolves even though base batch is 5 L (two batches' worth) |
| 9 | B | — | | | ✅ A cannot see, use or attach B's formats: **FK violation**, not just zero rows |
| 10 | C non-litre | Small Pack | explicit | 800 g | ✅ costs correctly, format has no capacity |
| 11 | C | Medium Pack | explicit | 1.5 kg | ✅ mass units, recipe yield in g |
| 12 | C | Large Pack | explicit | 3 kg | ✅ |
| 13 | C | **Party Tray** | either | **no capacity, no quantity** | ⚠️ **INCOMPLETE**. No cost, no margin, no price. Problem: `missing_basis_quantity`. **No volume invented** |
| 14 | C | Party Tray after owner supplies 8 kg | explicit | 8 kg | ✅ becomes complete |

**Extreme cases**

| Case | Supported | Note |
|---|---|---|
| 500 ml, 0.25 L, 2.4 L, 10 L, 25 L | ✅ | `numeric(14,3)` in a ml base is ample |
| kilograms, grams | ✅ | when recipe yield is a mass |
| pieces | ✅ | when recipe yield is a count |
| bowls, trays, packs **as capacity units** | ❌ | container-kind units have no universal factor and a recipe has no ingredient to resolve one against → `capacity_unit_unconvertible`. **Use Basis B.** This is correct behaviour, not a limitation to work around |
| formats with no measurable capacity | ✅ | the whole point of nullable capacity |
| capacity in kg, recipe yield in ml | ❌ incomplete | cross-kind conversion needs a density we do not have and must not guess |

**Historical integrity tests**

| # | Scenario | Expected |
|---|---|---|
| 15 | A changes Family Bowl 4 L → 4.5 L | New snapshot at 4.5 L; old snapshot unchanged; completed sales unchanged |
| 16 | A raises the 2.5 L price | New `recipe_prices` row; prior sales keep their recorded price |
| 17 | Packaging bowl price rises | New snapshots for every variant using that format; sales frozen |
| 18 | Format deactivated | Existing sales still report; variant no longer sellable |

**Anti-hard-coding assertions**

| # | Assertion |
|---|---|
| 19 | Zero rows in `serving_formats` after a fresh install and full onboarding |
| 20 | No litre, bowl or capacity constant anywhere in schema, seed or function bodies |
| 21 | Three businesses with entirely different format vocabularies coexist with no schema divergence |

---

# 18. DECISION SEPARATION

## ✅ DECISIONS WE CAN LOCK NOW
Supported by the existing blueprint or by the architecture already approved and shipped.

1. Serving format is **business-owned**, not account-owned. Justification: it sits with `recipes`, `channels`, `labour_rates` and `overhead_items`, which are all business-scoped, while `ingredients` and `suppliers` are account-scoped. A format is a menu concept belonging to a brand; the physical bowl remains an account-scoped ingredient shared by both brands. This also lets the composite FK enforce same-business, which is stronger than same-account.
2. Capacity is **optional**, both-or-neither with its unit, and never invented.
3. Uniqueness on `(recipe_id, format_id)`.
4. Only Basis A and Basis B in the MVP. Both test suites resolve fully with these two; scale factor and own yield are unnecessary.
5. The completeness gate extends unchanged to variants, with named problem codes.
6. Packaging remains an `ingredient` with `kind='packaging'`. No parallel schema.
7. Format packaging is a **one-to-many link table**, so lids, labels and spoons need no redesign.
8. Price lives in `recipe_prices` keyed by variant and channel, append-only. No `selling_price` column on the variant.
9. Snapshots record `basis_qty_resolved`, making historical records self-describing.
10. Security follows the Gate 1 pattern: composite FKs, account-scoped RLS, guarded RPCs, explicit grants.
11. Migration maps `portion_qty` → Basis B explicit quantity, creates a **capacity-less** Default format, retains `portion_qty`, and is gated on a bit-for-bit cost equality regression.

## 🔴 PRODUCT DECISIONS REQUIRING YOUR APPROVAL

**D1. Overhead allocation across formats.** *(highest impact)*
Overhead is currently monthly cost ÷ `expected_monthly_units`, added per portion. With variants, a 500ml pack and a 10L bowl absorb identical overhead. Options: (a) keep per portion, simple but distorts small formats badly; (b) allocate per yield unit, so overhead scales with volume; (c) let the business choose the basis. **Impact: this changes reported margin on every variant of every dish.** I will not choose it.

**D2. Per-format labour.**
Approved methodology makes labour linear per yield unit (finding F2), so this is consistent today. But portioning, sealing and labelling time is per container, not per litre: forty 500ml packs is far more handling than four 5L bowls from the same batch. Options: (a) accept linear labour for MVP and note the known understatement on small formats; (b) add per-format labour minutes. Option (b) is new methodology and I am not adding it unprompted.

**D3. Does capacity mean sellable quantity?**
My recommendation is yes for Basis A, with under-fill expressed through Basis B rather than a fill-percentage field, because a fill factor is an invented number. If you want an explicit `fill_pct`, that is a methodology change and needs your approval.

**D4. Packaging placement and double counting.**
Moving container packaging from recipe to format is correct, but recipe-level packaging lines still exist. Options: (a) allow both and warn, (b) forbid `kind='packaging'` on recipe lines once formats exist, (c) allow both silently. Option (c) is a silent-double-count risk and I would not ship it.

**D5. Variant-level overrides.**
Can a variant override the base recipe, for example a Party Tray that adds a garnish the 1.5L bowl does not? Answering yes means variant-level recipe lines, which is materially more schema. My recommendation for MVP is no.

**D6. Format capacity audit trail.**
Snapshots make history explainable. Do you also want a `serving_format_changes` audit recording who changed a capacity and when? Note the parallel: `costing_method_changes` was approved in Decision 2 and never wired up, so this is a live pattern in the codebase already.

**D7. Deactivating a format with live variants.**
Cascade to variants, block, or leave variants active. Affects what an owner sees when they retire a container.

---

**STOP.** No SQL written, no migration created, no table altered. Awaiting your review and the seven decisions above before Gate 2 implementation.
