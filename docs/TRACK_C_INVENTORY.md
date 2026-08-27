# TRACK C — REPOSITORY INVENTORY AGAINST THE SEPTEMBER 1 CORE-VALUE TEST

**Read-only inspection of `web/` on 27 Aug 2026. Nothing built, nothing changed.**
Every finding below is read from source, not inferred from the existence of a
database table.

---

## 0. The measurement that decides everything

**The entire application contains exactly two write paths.** Searched for
`.insert(`, `.update(`, `.upsert(` and `.rpc(` across all of `src/`:

```
src/app/(app)/onboarding/page.tsx:34   supabase.rpc('fn_create_account_and_business', …)
src/app/(app)/ingredients/page.tsx:26  supabase.from('ingredients').insert({ name, kind, base_unit_id })
```

That is the complete list. Everything else in the app — dashboard, reports,
pricing — **reads views**. 1,126 lines of source across 19 files.

So a new customer can create an account, create one business, and type ingredient
**names**. They cannot enter a price, a conversion, or a recipe.

**The core value moment is unreachable.** Not partially reachable — there is no
code path from a signed-up user to a costed recipe.

---

## 1. Journey inventory

| Step | State | Detail |
|---|---|---|
| **signup** | **EXISTS** | `(auth)/signup` — 82 lines, real |
| **verification** | **EXISTS** | `verify-email` + `auth/callback` route; D-7 email confirmation honoured |
| **onboarding** | **EXISTS** | calls `fn_create_account_and_business` with a mount-time idempotency key — the C10 contract, correctly implemented |
| **business setup** | **PARTIAL** | the business row is created; **no settings screen.** `business_settings` — costing method, target margin, price rounding — cannot be viewed or changed |
| **units** | **MISSING** | units are seeded globally and readable, but there is **no way to enter a unit conversion.** The ingredients page *reports* missing conversions and offers no form to supply one |
| **ingredients** | **PARTIAL** | create by name/kind/base unit only. No edit, no purchase yield, no deactivate |
| **ingredient prices** | **MISSING** | **no write to `ingredient_prices` anywhere in the app.** The page's own footer says "Prices are entered per item" — there is no form |
| **recipe creation** | **MISSING** | no `/recipes` route, no write to `recipes` |
| **recipe quantities** | **MISSING** | no write to `recipe_lines` |
| **recipe costing** | **MISSING (as a user action)** | the engine exists and is tested in the database; **nothing in the UI reaches it** |
| **cost per yield / portion** | **MISSING** | no surface |
| **selling price / profit** | **PARTIAL, read-only** | `/pricing` reads `v_price_check` competently — but nothing can populate it, and a selling price cannot be entered |
| **saved recipes** | **MISSING** | nothing to save, nothing to list |
| **reopen and re-derive** | **MISSING** | follows from the above |
| **dashboard** | **EXISTS** | reads `v_onboarding_status` and `v_dashboard_waterfall` |
| **reporting** | **EXISTS (read-only)** | reads `v_profit_by_period`, `v_profit_by_product`, `v_voided_sales` — all trading data that cannot yet exist |

### 1.1 Two nav links point at routes that do not exist

`(app)/layout.tsx` navigation lists **`/recipes`** and **`/account`**. Neither
file exists. In the deployed app both are 404s, reachable from every page on
mobile and desktop.

---

## 2. Against the acceptance test

> create account → set up business → define/use units → enter ingredients and
> purchase prices → create a recipe → enter quantities → calculate true cost →
> see cost per portion → see selling price/profit → save → reopen and get the
> same answer.

**Reachable today: the first two steps.** The journey stops at "enter purchase
prices", which has no interface, and every subsequent step is absent.

**Verdict: Menu Master NG cannot publicly launch as a costing product on 1
September on the current frontend.** The database is ready; the product is not
assembled.

---

## 3. `BLOCKS SEP 1` — the minimum to make the journey real

Ordered by dependency. Each entry states the minimum, not the ideal.

| # | Item | Minimum implementation |
|---|---|---|
| **1** | **Ingredient prices** | One form on the ingredients page: quantity, unit, amount paid, supplier optional, date. Writes `ingredient_prices`. **Without this nothing can ever cost anything.** |
| **2** | **Unit conversions** | An entry form where `v_missing_unit_conversions` currently only complains: ingredient, from-unit, to-unit, factor. Writes `ingredient_unit_conversions`. **The local moat is unreachable without it** — "2 paint of rice" resolves nowhere |
| **3** | **`/recipes` list + create** | name, yield quantity, yield unit, portion quantity. Writes `recipes`. Also removes one of the two 404s |
| **4** | **Recipe detail + lines** | add/remove an ingredient with quantity and unit. Writes `recipe_lines`. This is the largest single screen |
| **5** | **Recipe cost display** | read `v_recipe_cost_current` and `v_costing_blockers`: total cost, cost per portion, and — where incomplete — **exactly which inputs are missing**. The refusal-to-guess rule is a feature and must be visible |
| **6** | **Selling price entry + margin** | write `recipe_prices`; read `v_price_check` for margin and recommended price. `/pricing` already renders this competently once data exists |
| **7** | **Trial-ended state** | the UI must read `fn_my_entitlement_status()` (Gate A Step 2) and show "your trial ended on X — everything you entered is still here", never a bare RLS error |
| **8** | **`/account` route** | minimally: business name, plan, trial end. Removes the second 404 |

### 3.1 Deliberately confirmed as NOT required

- **Serving formats and variants.** Checked against `0025`: recipe-level costing
  rows (`variant_id is null`) still exist and still compute. A recipe created
  without a variant costs correctly. **Variant UI can follow September 1.**
- **Labour and overheads.** The engine includes what is entered; entering
  nothing yields an ingredients-only cost, which is truthful rather than
  fabricated. **Provided the UI does not claim labour and overhead are
  included** — that is a copy constraint, not a code one.
- **Trading screens** — orders, customers, purchases, sales. Gate B or later, and
  `/reports` already reads them read-only.

---

## 4. `CAN FOLLOW AFTER SEP 1`

| Item | Why it can wait |
|---|---|
| Business settings screen | `0001` supplies defaults; nothing is blocked, only untunable |
| Ingredient edit / deactivate / purchase yield | create-only is survivable for weeks |
| Serving formats and variants | §3.1 |
| Labour rates and overhead entry | §3.1 |
| Suppliers management | `ingredient_prices.supplier_id` is nullable |
| Trading screens | Gate B |
| Plan-limit messaging | needs `0040`; launch copy omits the numbers regardless |

---

## 5. Honest assessment

Steps 1–6 of §3 are **the product**, and none of them exists. The database work
behind them is finished, tested and deployed — which means this is assembly
rather than invention, and the shapes are all known.

But it is still six screens with real forms, real validation and real error
states, in **five days**, alongside two Gate A migrations and an email provider.
The migrations are the smaller half of that.

**The recipe workflow is now a larger September 1 risk than billing**, and
billing has already been moved behind Gate B. If something has to give, it should
give here first — and the honest options are to narrow §3 further (for example,
shipping steps 1–5 and letting selling-price entry follow), or to move the public
date. **Cutting steps 1–5 is not an option**, because what remains would not be a
costing product.
