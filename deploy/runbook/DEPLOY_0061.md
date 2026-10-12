# DEPLOYMENT RUNBOOK — 0061 (what an extra costs you)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0060 applied**, 118 policies, 98 `fn_*` functions.
Phase 3 of `docs/PLAN_NATURAL_UX.md`. Apply **after** 0060.

## What changes

| | |
|---|---|
| `order_lines.extra_unit_cost` | new nullable column, non-negative: what one of a non-dish line (delivery, serving staff, drinks bought in) cost the owner. Ignored on dish lines |
| `fn_confirm_order` | **replaced**: at confirmation a non-dish line freezes `unit_cost_at_sale` from its typed cost, inside the same one-way window; dish lines unchanged |
| `fn_reissue_order` | **replaced**: the copied lines carry the extra cost |
| `v_sale_lines` | **replaced**, same columns: a non-dish line with a frozen cost reads `costed`; one without reads `no_product` as before |
| Policies | 118 → **118** |
| `fn_*` | 98 → 98 |
| Customer rows | none written; one nullable column added |

Reports read `unit_cost_at_sale` as they always have, so an extra with a cost
now counts in cost of goods and profit. The frozen-cost guard (0045) is
untouched.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0061.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0061_extras_cost.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0061.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0061_rollback.sql` | psql, only if 3 fails | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0061_extras_cost.sql
```

Expect **PRE 5/5**, `NOTICE: 0061 OK: …`, **POST 6/6**. After POST passes,
`git mv` the file from `proposed/` to `migrations/`.

The app writes `extra_unit_cost` only when the owner types a cost for a
non-dish item. Before 0061 that write is refused by PostgREST (unknown
column) and the app records the item without a cost, as it did before.

## Rollback

Restores the 0045 `fn_confirm_order`, the 0060 `fn_reissue_order` and the
0047 `v_sale_lines`, then drops the column. Sales already confirmed keep the
cost frozen onto their extras; only typed figures on draft lines are lost.

## Rehearsal results (12 Oct 2026, repository-built replica `mmq`, 0001→0061)

| Item | Result |
|---|---|
| apply on a fresh build | `0061 OK` |
| `tests/047_extras_cost.sql` | **14/14** |
| rollback / re-apply on a copy | see the commit message |
| `PRE_DEPLOY_0061.sql` on a 0060 database, `POST_VERIFY_0061.sql` on the 0061 database | see the commit message |
