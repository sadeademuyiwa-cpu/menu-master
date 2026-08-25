# MENU MASTER NG — FRONTEND BLUEPRINT

**Status: DERIVED from the live API contract.** Nothing here invents a
capability the database does not already expose. The contract was read off a
PostgreSQL 17.6 replica built to the exact production baseline with `0021`
applied.

**Nothing exists yet.** No `package.json`, no `src/`. This document is the
specification the application will be built to.

---

## 1. The API contract the frontend must consume

**Transport:** Supabase PostgREST + GoTrue. Client role is `authenticated`.
`anon` may read exactly five reference tables and execute **zero** `fn_*`
functions — the frontend must therefore treat every catalogue screen as
requiring a session, except the five reference reads.

**Ten read views** (all `security_invoker`, so RLS applies to the caller):

| View | Screen it feeds | Key columns |
|---|---|---|
| `v_onboarding_status` | onboarding progress | `ingredients, prices_entered, recipes, complete_costings, blocking_conversions, selling_prices_set` |
| `v_costing_blockers` | "why is this recipe incomplete" | `problem, ingredient_name, unit_code, item` |
| `v_missing_unit_conversions` | conversion to-do list | `ingredient_name, unit_code, reason` |
| `v_recipe_cost_current` | latest cost per recipe | full snapshot row |
| `v_price_check` | pricing and margins | `cost_per_portion, selling_price, margin_pct, recommended_price, target_margin, commission_pct, is_complete, unpriced_items` |
| `v_dashboard_waterfall` | headline dashboard | `revenue, cogs, gross_profit, gross_margin_pct, cost_coverage_pct, revenue_without_cost, confidence` |
| `v_profit_by_product` | product profitability | `units_sold, revenue, cogs, gross_margin_pct, cost_coverage_pct` |
| `v_profit_by_period` | trend | as above, by `period` |
| `v_sales_unified` | sales ledger | orders and daily totals unified, `source` distinguishes them |
| `v_voided_sales` | corrections audit | `voided_at, void_reason, replaced_by` |

**RPCs callable by `authenticated`** (product surface only; the security
helpers `fn_is_account_member`, `fn_require_*`, `fn_can_see_costs` are called by
policies, not by the UI):

`fn_create_account_and_business` (9 args, **idempotency key required**) ·
`fn_clone_starter_catalog` · `fn_compute_recipe_cost_snapshot` ·
`fn_convert_between_units` · `fn_can_resolve_unit` · `fn_resolve_qty_to_base` ·
`fn_ingredient_unit_cost` · `fn_ingredient_usable_unit_cost` ·
`fn_recipes_using_ingredient` · `fn_recompute_recipes_for_ingredient` ·
`fn_post_purchase` · `fn_purchase_blockers` · `fn_reverse_purchase` ·
`fn_finalise_order` · `fn_void_order` · `fn_reissue_order` ·
`fn_void_sales_entry`

**Direct table writes** go through PostgREST with RLS and the `0015` role
matrix. The UI must never attempt a write its role cannot perform — it should
hide or disable, and it must still handle the server's refusal.

## 2. Non-negotiable UI rules

These come from the governing rule and from Gate 1/2 decisions. Breaking any of
them is a defect, not a style choice.

1. **NULL is never rendered as 0.** An unpriced ingredient shows "not priced",
   an unmeasured capacity shows "not measured". Never ₦0, never a dash that
   reads as zero.
2. **No margin, no recommended price, when incomplete.** `v_price_check`
   returns `is_complete`; when false the UI shows the named blockers from
   `unpriced_items` / `v_costing_blockers` and offers no price.
3. **`cost_coverage_pct` is shown beside every profit figure.** A margin over
   40 % coverage is not the same claim as one over 100 %.
4. **No default conversion factors.** Ever. `v_missing_unit_conversions` drives
   a to-do list the owner fills in themselves.
5. **No seeded prices.** The starter catalogue has 180 items and no price column.
6. **Cost-gated screens respect `fn_can_see_costs`.** A kitchen user must not
   see costs, margins or format packaging cost — including in aggregate.
7. **Unfinished functionality is not hidden behind a plausible screen.** If a
   capability is not built, the UI says so.

## 3. Workflow map

```
signup → login → [email confirmation, DECISION 7]
   └─ onboarding wizard ─ fn_create_account_and_business(idempotency_key)
        └─ business setup ─ settings, channels, locations, members
             ├─ ingredients ─ categories ─ packaging items
             │    ├─ prices ─ purchases ─ post/reverse
             │    └─ units ─ per-ingredient conversions
             ├─ recipes ─ lines ─ sub-recipes ─ labour
             │    └─ serving formats ─ variants ─ format packaging
             │         └─ costing ─ blockers ─ overhead
             │              └─ selling prices ─ margins
             ├─ trading ─ orders ─ finalise ─ void/reissue ─ sales entries
             ├─ dashboards ─ reporting
             └─ subscription ─ account management
```

## 4. Screen inventory (P0 unless marked)

| # | Screen | Data source | Notes |
|---|---|---|---|
| 1 | Sign up / log in | GoTrue | `handle_new_user` is a no-op; onboarding is an explicit RPC |
| 2 | Onboarding wizard | `fn_create_account_and_business` | key generated per attempt, reused on retry |
| 3 | Onboarding progress | `v_onboarding_status` | P1 |
| 4 | Business settings | `business_settings` | costing method change is currently silent — DECISION 4 |
| 5 | Locations, channels, members | tables + `0015` matrix | |
| 6 | Ingredients + packaging | `ingredients` | `kind` switch |
| 7 | Prices + purchases | `ingredient_prices`, `fn_post_purchase` | zero amount refused |
| 8 | Units + conversions | `units`, `v_missing_unit_conversions` | rule 4 |
| 9 | Recipes | `recipes`, `recipe_lines`, `recipe_labour` | cycle prevention surfaced |
| 10 | Serving formats | `serving_formats` | capacity optional, both-or-neither |
| 11 | Variants | `recipe_variants` | basis exclusive |
| 12 | Format packaging | `serving_format_packaging` | cost-gated; double-count refusal explained |
| 13 | Costing | `v_recipe_cost_current`, `v_costing_blockers` | rule 1, 2 |
| 14 | Overhead | `business_settings` + basis | pre-flight count before enabling |
| 15 | Pricing and margins | `v_price_check` | rule 2, 3 |
| 16 | Trading | orders, sales entries | P1 |
| 17 | Dashboards | `v_dashboard_waterfall` | rule 3 |
| 18 | Reporting | `v_profit_by_*`, `v_sales_unified`, `v_voided_sales` | P1 |
| 19 | Subscription / account | `subscriptions`, `plans` | blocked on entitlement, DECISION 2 |

## 5. Mobile

Every P0 workflow must be usable at 360 px. The costing and pricing tables are
the hard cases: they are wide and numeric. Tables collapse to labelled cards
below the breakpoint rather than scrolling horizontally, because a horizontally
scrolled margin column is a misreading risk, not merely inconvenient.

## 6. Security posture of the client

- The `service_role` key **never** reaches the browser. Only the publishable
  key ships.
- No client-side authorization decisions. The UI reflects permissions; the
  database enforces them.
- Every list query is account-scoped by RLS, not by a client filter.
