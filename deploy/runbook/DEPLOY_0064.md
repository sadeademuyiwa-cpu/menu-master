# DEPLOYMENT RUNBOOK — 0064 (sales staff see selling prices, never costs)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0063 applied**, 118 policies in `public`, 98 `fn_*`
functions. The owner's decision 1 (16 Oct 2026,
`branding/09-uiux/04-simplify-plan.md`): sales staff may see what each dish
**sells for**, never what it costs. Kitchen stays as it is.

## What changes

| | |
|---|---|
| `fn_menu_prices()` | new. `SECURITY DEFINER`, `STABLE`, `search_path` pinned to `public`; granted to `authenticated` (and `service_role`), not to `anon` or PUBLIC. Returns `business_id, recipe_id, variant_id, channel_id, selling_price` and nothing else: one row per dish, per active size (or the dish itself when it has none), per active channel, exactly the rows `v_price_check` lists, with the price chosen by the same rule (a size's own price first, then the latest effective date on or before today). A dish with no price is a row with NULL, never zero. Rows only for accounts where the caller is **owner, manager, sales or accountant** (`fn_has_account_role`); kitchen, a non-member and a logged-out caller get none |
| `recipe_prices` | **unchanged**: its four 0004/0028 policies still require `fn_can_see_costs` to read or write, so sales still cannot read the table, its history or who set a price |
| `v_price_check`, `v_product_attention` | unchanged: a sales member still sees no cost, profit, margin or suggested price in them |
| Policies in `public` | 118 → **118** |
| `fn_*` | 98 → **99** |
| Customer rows | none |

Confirming a sale was never blocked by price visibility: `fn_confirm_order`
admits owner, manager and sales, and freezes the cost through
`fn_frozen_sale_cost`, which needs membership only. `tests/050` records and
confirms a sale as a sales member at the price `fn_menu_prices` gave.

## What the owner sees

Nothing changes for the owner, manager or accountant. Once the app's New sale
screen reads `fn_menu_prices`, her sales helper sees each dish's price on the
tile instead of "No price yet" and stops typing prices by hand. The helper
still sees no cost, no "you keep", no margin and no "Use ₦…" suggestion, and
cannot change a price. Kitchen staff see no price, as before. The PRE audit's
last row says how many sales members on production gain this.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0064.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0064_sales_reads_prices.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0064.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0064_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0064_sales_reads_prices.sql
```

Expect **PRE 7/7**, `NOTICE: 0064 OK: …`, **POST 7/7**. Same transaction
guard as 0049–0063. Run it after 0063's POST has passed; 0064 refuses to run
without 0063. PRE passes on 0062 as well as 0063 so the whole release can be
audited up front; its row 3 says whether 0063 is in yet. After POST passes,
`git mv` the file from `proposed/` to `migrations/`.

Apply 0064 before, or with, the app version that calls `fn_menu_prices`. An
app that falls back to the current behaviour when the function is missing
(every price "not known", as today) is safe in either order.

## Rollback

`0064_rollback.sql` drops the function. Sales staff are back to typing each
price; nothing is lost, because the function stores nothing and every price
is still in `recipe_prices`. Roll back 0064 before 0063: the 0063 rollback
refuses to run while `fn_menu_prices` exists.

## Rehearsal results (16 Oct 2026, repository-built databases, 0001→0064)

| Item | Result |
|---|---|
| `PRE_DEPLOY_0064.sql` on a 0062 and on a 0063 database | 7/7 PASS on each |
| apply on the 0063 database | `0064 OK` |
| `POST_VERIFY_0064.sql` on the 0064 database (`mm64`) | 7/7 PASS |
| apply without `--single-transaction` | refused by the guard |
| `tests/050_sales_reads_prices.sql` | **21/21** |
| rollback 0064 → 0063 → schema dump identical to the fresh 0062 build | yes |
| full suite run (`scripts/run_suites.ps1 -Template mm64`) | 48 suites, **1013 pass, 0 fail**, 2 skipped by design. 046-048 now run at their own era (0060/0061/0062): each asserts "98 `fn_*`", which 0064 moves to 99 |
