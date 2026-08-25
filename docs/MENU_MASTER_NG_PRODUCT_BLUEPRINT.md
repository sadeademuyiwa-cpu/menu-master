# MENU MASTER NG — PRODUCT BLUEPRINT

**Status: DERIVED, not recovered.** The original
`docs/menu-master-ng-blueprint.md` remains unrecovered
(`GATE1_CLOSURE_REPORT.md` §3). This document is rebuilt from what the
repository actually contains — the live schema, the 39-requirement traceability
matrix in `docs/MENU_MASTER_NG_AUDIT.md` §3, the Gate 1/2/3 designs and the
governing rule. **No requirement here was invented.** Every section cites where
it comes from. Anything that genuinely needs a product decision is marked
**[DECISION n]** and appears in `DECISION_PACKET_001.md`.

---

## 1. What the product is

*Financial operating system for African food businesses.*
**Know your cost. Know your price. Know your profit.** (`README.md`)

## 2. The governing rule — above every feature

**PERSONAL DATA IS THE SOURCE OF TRUTH.** Each business's costs are calculated
exclusively from that business's own entered data. A missing price, conversion,
yield or labour rate stays NULL and the record is marked **incomplete**. Never
substitute zero, an industry average, an AI estimate, a benchmark or an assumed
Nigerian market value.

This is not a preference. It is enforced in the database: the completeness gate,
the nine named problem codes, `unpriced_items`, and the refusal to emit a margin
or a recommended price for an incomplete recipe. Any UI that shows ₦0 where the
database says NULL is a defect, not a rounding choice.

## 3. Tenancy model

`accounts → businesses → locations`. Verified against the live schema: there is
no brand, org or operating-entity table, and none is needed
(`GATE2_FINAL_DESIGN.md` §11).

- One account may own **many businesses** (approved C10 decision, 25 Aug).
- Ingredients and suppliers are **account**-scoped; recipes, channels, labour
  rates, overhead items and serving formats are **business**-scoped.
- Roles: `owner`, `manager`, `kitchen`, `sales`, `accountant` (`member_role`).
  The write matrix is `0015`; the read side is `0004`; cost visibility is
  `fn_can_see_costs`.

## 4. Costing model

Sources: `docs/MENU_MASTER_NG_AUDIT.md` §6, `migrations/0007`, `0008`.

1. **Ingredient cost** — weighted average over purchase history within
   `wavg_window_days`, per account, per ingredient.
2. **Purchase yield** — usable share after peeling/boning/trimming.
   ₦5/g at 70 % becomes ₦7.1429/g.
3. **Unit conversion** — per-ingredient, never global. *1 paint of rice = 4 kg*
   does not apply to beans. A missing conversion blocks; it is never guessed.
4. **Cooking yield** — reduction/evaporation. 92 % turns 5 L into 4.6 L.
5. **Labour** — linear per yield unit. A 5 L variant absorbs 3.33× a 1.5 L
   variant. Approved methodology, not an assumption (`GATE2A_DESIGN.md` F2).
6. **Overhead** — allocated by output with an explicit business-level basis and
   measurement kind (D1, option (a)). Incompatible kinds return
   `overhead_basis_incompatible` and receive **no** resolved margin.
7. **Packaging** — two scopes, never double counted: recipe-level scales with
   quantity, format-level is once per sold unit (D4).
8. **Snapshots** — immutable. A price change writes a new row and never
   rewrites history.
9. **Sales freeze** — cost is frozen at the moment of sale. A later tripling of
   the rice price does not rewrite last month's margin.
10. **Coverage** — `cost_coverage_pct` states what share of revenue has a
    trustworthy cost behind it. Revenue always counts; COGS counts only where a
    complete cost existed at the time of sale.

## 5. Serving formats and recipe variants (Gate 2)

A recipe owns the **formula**; a variant owns the **commercial representation**.
There is no variant line table, so a variant cannot alter a formula even by
mistake. Capacity (the physical container) and sellable quantity are separate
concepts, made mutually exclusive by check constraint. No container size is ever
inferred. Formats are deactivated, never deleted; every capacity change is
logged with both values.

## 6. Pricing

`recommended_price = cost / (1 − target_margin)`, rounded up to
`price_rounding_to`. Channel target margin overrides the business default.
**No recommended price is offered when the costing is incomplete.**
Channel commission is stored and displayed but currently enters no
calculation — **[DECISION 3]**.

## 7. Trading

Orders → order lines → finalisation → immutable revenue; corrections by void
and reissue, never by edit (`0014`). Daily-totals mode via `sales_entries` for
businesses that do not record individual orders. Purchases post and reverse;
zero-value amounts are refused (`0013`).

## 8. Reporting

The reporting surface is **already specified by the schema** — ten views:
`v_dashboard_waterfall`, `v_profit_by_product`, `v_profit_by_period`,
`v_sales_unified`, `v_voided_sales`, `v_price_check`, `v_recipe_cost_current`,
`v_costing_blockers`, `v_missing_unit_conversions`, `v_onboarding_status`.
What is missing is the frontend that renders them, not the design of what to
render.

## 9. Subscriptions and billing (Gate 3)

Plans and features exist (`plans`, `plan_features`, `subscriptions`). Internal
status is one of four values, enforced by `0017`. Paystack vocabulary is mapped
at the boundary and never persisted. **Entitlement is documented but not
enforced** — nothing reads `subscriptions.status`, so a cancelled account is
currently denied nothing. **[DECISION 2]**

## 10. Deliberately out of scope

Stock lots, production runs, waste tracking, finished goods and supplier
balances are **correctly absent** (audit item 39, governing rule). Multi-basis
overhead allocation and per-format labour are named future scope
(`GATE2_FINAL_DESIGN.md` §11.5, `GATE2A_DESIGN.md` D2). None of these is
launch scope.

## 11. Open product questions

| | Issue | Where |
|---|---|---|
| D1 | Frontend stack | DECISION 1 |
| D2 | Entitlement enforcement (C4) | DECISION 2 |
| D3 | Channel commission in economics (audit #27) | DECISION 3 |
| D4 | Costing-method change audit (audit #23/24) | DECISION 4 |
| D5 | Tax scope conflict (audit #28) | DECISION 5 |
| D6 | Period close enforcement (audit #31) | DECISION 6 |
| D7 | Email confirmation on signup | DECISION 7 |
