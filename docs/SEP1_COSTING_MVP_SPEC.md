# SEPTEMBER 1 COSTING MVP — BUILD SPECIFICATION

**Read-only dependency pass complete. Nothing built, no production change.**
Every backend fact below is read from the migrations, not assumed.

**The promise:** a new food-business owner enters what they bought and paid,
creates a recipe, says how much of each ingredient it uses, and Menu Master NG
calculates the true ingredient cost, cost per yield and portion, and a
selling-price/margin result — saved, reopened, unchanged.

---

## 0. Five backend facts that shape everything

**F1 — Postgres already owns every calculation.** `fn_resolve_qty_to_base`,
`fn_ingredient_usable_unit_cost`, `fn_compute_recipe_cost_snapshot`,
`v_price_check`. **No arithmetic belongs in TypeScript.** The frontend collects
input, calls, and renders.

**F2 — `ingredient_prices.qty_base` is in the ingredient's BASE unit**, and
`unit_cost` is a **generated column** (`amount / qty_base`). A customer buying
"2 paint of rice for ₦9,000" cannot be inserted directly: the 2 paint must first
become base units via `fn_resolve_qty_to_base`. That call is the conversion, and
doing the multiplication in the browser instead would be exactly the duplicated
architecture to avoid.

**F3 — NOTHING RECOMPUTES A RECIPE WHEN ITS LINES CHANGE.** Verified: triggers
exist on `ingredient_prices`, `ingredient_unit_conversions` and `ingredients`
(`0008`), and on `recipe_lines` there is only `trg_recipe_lines_no_cycle`, a
cycle guard. **The UI must call `fn_compute_recipe_cost_snapshot(recipe_id)`
explicitly after editing lines**, or `v_recipe_cost_current` returns nothing and
the recipe silently appears uncosted. This is the single most important
integration fact in this document.

**F4 — Cost snapshots are immutable and complete-or-refusing.**
`cost_snapshots.is_complete`, `required_inputs`, `priced_inputs`,
`unpriced_items` jsonb. On an incomplete snapshot the cost figures are **the
floor, not the cost** — `0001`'s own words. The UI must never present a floor as
a cost.

**F5 — Three tables carry `for all` policies, so `0028`'s entitlement conjunct
never reached them.** `ingredient_prices`, `cost_snapshots` and `recipe_prices`
were re-created by `0004` as single `for all` policies; `0028` selected only
policies named `^p_.*_(insert|update|delete)$`. **Consequence for Gate A: once
`0032` makes trials expire, a lapsed user could still write prices while being
unable to add an ingredient.** This is V-7, and it is now a Gate A correctness
issue rather than a Gate B tidy-up. **Still verification-only** — confirm against
live `pg_policies` before acting.

---

## P0 — must exist for September 1

### P0-1 · Ingredient purchase prices

| | |
|---|---|
| **Existing backend** | `ingredient_prices` (append-only: DELETE blocked, UPDATE restricted by `fn_guard_ingredient_prices`). Columns: `account_id`, `ingredient_id`, `supplier_id` (nullable), **`qty_base`**, `amount`, `unit_cost` **(generated)**, `source` **(no default — always explicit)**, `effective_date` (defaults `current_date`). RPC: **`fn_resolve_qty_to_base(ingredient, qty, unit)`**. RLS: `p_ingredient_prices` — `fn_is_account_member` **and `fn_can_see_costs`**, so kitchen and sales roles cannot read or write prices at all |
| **Frontend** | On the ingredient row: quantity · unit (select) · amount paid · date (default today) · supplier (optional). Two calls: `rpc('fn_resolve_qty_to_base', …)` then `insert` with the returned `qty_base` and `source: 'manual'` |
| **Validation (DB-owned)** | `qty_base > 0`, `amount >= 0`, `source` NOT NULL with no default, append-only |
| **Failure state** | `fn_resolve_qty_to_base` returns **NULL** → the conversion is missing. **Do not insert.** Show: "Menu Master doesn't know how many kg are in 1 paint of rice for *your* rice" and link straight to P0-2. This is the moat working, not an error |
| **Acceptance** | Enter 2 paint / ₦9,000 with a paint→kg conversion present → one row, `qty_base` = 2 × factor, `unit_cost` computed by Postgres. Without the conversion → refused with the blocker, no row |
| **Complexity** | **Low–Medium** |

### P0-2 · Unit conversions

| | |
|---|---|
| **Existing backend** | `ingredient_unit_conversions` (`ingredient_id`, `unit_id`, `qty_in_base > 0`, `unique (ingredient_id, unit_id)`). `units` — `account_id` **NULL = global/system**, non-null = business-defined; `factor_to_base` NULL means the ratio is ingredient-specific. `v_missing_unit_conversions` ranks `blocking_recipe` / `blocking_purchase` / `suggested`. `fn_can_resolve_unit`. Trigger `trg_conversion_recompute` **recomputes affected recipes on insert** |
| **Frontend** | A form where the ingredients page today only complains: ingredient · unit · "how much of the base unit is 1 of these". **Read the existing units table; create no new unit taxonomy.** Global units are offered read-only; only the conversion is business data |
| **Validation** | `qty_in_base > 0`; the unique key prevents a second conversion for the same pair; `fn_assert_unit_visible` (`0004`) refuses a unit from another account |
| **Failure state** | Duplicate → "you already have a conversion for this unit; existing conversions cannot be silently replaced" |
| **Acceptance** | Add paint→kg = 4 for rice → the `v_missing_unit_conversions` entry disappears **and** any recipe using it recomputes without a further click (trigger) |
| **Complexity** | **Low** |

### P0-3 · `/recipes` — list and create

| | |
|---|---|
| **Existing backend** | `recipes`: `business_id`, `name`, **`batch_yield_qty > 0`**, **`yield_unit_id`**, `cooking_yield_pct` (default 100), `portion_qty` (nullable, `> 0`), `status` (default `draft`), `deleted_at`. `unique (business_id, lower(name)) where deleted_at is null`. RLS: `p_recipes_insert/_update/_delete` — roles **owner, manager, kitchen**, plus `0028`'s entitlement conjunct |
| **Frontend** | List of live recipes; create form: name · batch yield qty · yield unit · portion qty (optional) |
| **Validation** | yields `> 0`; duplicate name rejected by the unique index |
| **Failure state** | Duplicate name → name the conflict. Entitlement denial → the P0-7 trial-ended state, **never a raw RLS error** |
| **Acceptance** | Create "Jollof Rice", 5 L, portion 0.5 L → appears in the list, survives reload. **Also removes one of the two 404s** |
| **Complexity** | **Low–Medium** |

### P0-4 · Recipe detail — lines · **the largest screen**

| | |
|---|---|
| **Existing backend** | `recipe_lines`: `recipe_id`, **exactly one of** `ingredient_id` / `sub_recipe_id` (`one_target` check), `qty > 0`, `unit_id`, `is_cost_bearing` (default true), `exclusion_reason` (**required when not cost-bearing**), `no_self_reference`, `trg_recipe_lines_no_cycle`. **Then `rpc('fn_compute_recipe_cost_snapshot', { recipe_id })` — see F3** |
| **Frontend** | Add/remove a line: ingredient · quantity · unit. **Sub-recipes are P1** — the column stays untouched. After every mutation, call the snapshot RPC and re-read the cost |
| **Validation** | `qty > 0`; `one_target`; cycle guard |
| **Failure state** | A line whose unit cannot resolve does not fail the insert — it makes the **snapshot incomplete**, surfaced by P0-5 |
| **Acceptance** | Add 3 lines, remove 1, reload → exactly 2 lines and a snapshot matching them |
| **Complexity** | **High** — the only genuinely large piece |

### P0-5 · Cost result — **where the promise is kept or broken**

| | |
|---|---|
| **Existing backend** | `v_recipe_cost_current` (latest snapshot per recipe): `is_complete`, `required_inputs`, `priced_inputs`, `excluded_inputs`, **`unpriced_items` jsonb**, `ingredient_cost`, `packaging_cost`, `labour_cost`, `overhead_cost`, `batch_cost`, **`cost_per_yield_unit`**, **`cost_per_portion`**. Plus `v_costing_blockers` and `v_missing_unit_conversions` |
| **Frontend** | Complete → batch cost, cost per yield unit, cost per portion. **Incomplete → no cost figure at all**; instead "priced 4 of 7 inputs" and the named missing items from `unpriced_items`, each linking to P0-1 or P0-2 |
| **Validation** | None — display only |
| **Failure state** | **The core rule: never render a floor as a cost, and never render an absent figure as ₦0.** `lib/format`'s `NOT_ENTERED` already exists and is used correctly on the ingredients page — reuse it |
| **Acceptance** | A recipe with one unpriced ingredient shows **no cost**, names that ingredient, and offers the fix. Pricing it → cost appears **without a manual recompute** (the `ingredient_prices` trigger) |
| **Complexity** | **Medium** |

### P0-6 · Selling price and margin

| | |
|---|---|
| **Existing backend** | `recipe_prices` (append-only history): `recipe_id`, `channel_id` (nullable), `price >= 0`, `effective_from`. `v_price_check` (`0008`) already computes margin, profit and recommended price **and returns NULL for all three unless the snapshot is complete — the gate lives in the view, not the UI**. `channels.target_margin` overrides the business default. RLS: cost-adjacent, `fn_can_see_costs` |
| **Frontend** | A price field on the recipe detail writing `recipe_prices`; read `v_price_check`. **`/pricing` already renders this correctly (127 lines) — extend, do not rewrite** |
| **Validation** | `price >= 0`; append-only, so a change is a new row and last month's margin stays true |
| **Failure state** | Incomplete costing → `v_price_check` returns NULLs; show the blocker, **never a computed-looking zero margin** |
| **Acceptance** | Set ₦2,500 on a complete recipe → margin and recommended price appear from the view. Set it on an incomplete one → the blocker, no numbers |
| **Complexity** | **Low** — the view does the work |

### P0-7 · Trial-ended state and `/account`

| | |
|---|---|
| **Existing backend** | `fn_my_entitlement_status()` from Gate A `0032` |
| **Frontend** | A banner and a write-blocked state: "your trial ended on X — everything you entered is still here, and you can still read and export it." `/account`: business name, plan, trial end. **Removes the second 404** |
| **Failure state** | Without this, every write after expiry is a bare RLS error — the opaque failure ruled against for plan limits, arriving by another route |
| **Acceptance** | An expired-trial account sees the banner, cannot write, and can still open every recipe |
| **Complexity** | **Low**, but depends on `0032` |

---

## P1 — useful, can follow

Business settings screen (`0001` supplies defaults) · ingredient edit, deactivate, purchase yield · supplier management · sub-recipe lines · labour and overhead entry · serving formats and variants · channel management · price history display.

## P2 — explicitly deferred

Trading screens (orders, customers, purchases, sales) · plan-limit messaging (needs `0040`) · all Gate B billing UI · the `monthly_equivalent` view · WhatsApp.

**Copy constraint, since labour and overhead are P1:** the September 1 result must be described as **ingredient-based costing**. The engine includes what is entered and entering nothing yields an ingredients-only cost — truthful, but only if the UI says so.

---

## Smallest safe build sequence

```
1. P0-2 conversions      no dependencies; unblocks everything downstream
2. P0-1 prices           depends on 2 for its failure path
3. P0-3 recipes list     independent of 1 and 2; kills one 404
4. P0-4 recipe lines     depends on 3; the long pole
5. P0-5 cost result      depends on 4 (and F3's explicit recompute)
6. P0-6 price + margin   depends on 5; mostly wiring an existing view
7. P0-7 entitlement UI   depends on Gate A 0032
```

1–2 are one screen's worth of work and make every later step demonstrable, because a priced, convertible ingredient is what proves the engine end to end.

**Gate A migrations run in parallel**, not in series: `0031` and `0032` touch no table this specification reads, except through `fn_my_entitlement_status` in step 7.

## Persistence proof (F)

Nothing here caches a computed value in the browser. A recipe reopened re-reads
`recipes`, `recipe_lines` and `v_recipe_cost_current`, and the snapshot is
immutable (`fn_block_snapshot_mutation`), so the same inputs return the same
result by construction. **The only way this breaks is F3** — if a mutation path
forgets the recompute call, the reopened recipe shows a stale snapshot. That
makes "every `recipe_lines` mutation is followed by
`fn_compute_recipe_cost_snapshot`" a **testable invariant**, not a convention.

---

## Assessment: **CONDITIONAL GO**

**What makes it a GO.** Every calculation exists, is tested and is deployed. This
is assembly, not invention. Six of the seven P0 items are low or medium
complexity, and two of them (P0-5, P0-6) are largely rendering views that already
compute the right answers. `/pricing` and `/ingredients` prove the patterns work.

**What makes it conditional.**

1. **P0-4 is genuinely large** and everything downstream waits on it.
2. **F3 is a silent failure mode.** Forget the recompute and recipes look
   uncosted with no error anywhere. It needs a test, not care.
3. **F5 may need fixing inside `0032`** — trials expiring while price writes stay
   ungated is an incoherent trial-ended experience. Verification first.
4. **Five days also contains** two migrations, an email provider with DNS lead
   time, and a full test pass.

**The conditions.** GO if: P0-1 through P0-5 are complete and tested by **31
August** — that is the promise, and P0-6 without them is a margin on a cost
nobody can produce. If P0-4 is not working by **29 August**, the honest call is to
move the public date rather than launch a costing product that cannot cost.

P0-6 and P0-7 can slip a few days after launch **only** if the copy does not
promise them.

**NO-GO** if P0-1, P0-2, P0-4 or P0-5 is incomplete on 31 August. Those four are
the promise. Without any one of them the customer cannot reach the value moment,
and a launch would be exactly the "unfinished functionality behind misleading UI"
the founding brief forbids.
