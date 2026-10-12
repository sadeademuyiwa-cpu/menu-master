# DEPLOYMENT RUNBOOK — 0062 (a dish made from another dish shows in its list)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0061 applied**, 118 policies, 98 `fn_*` functions.
Phase 3 of `docs/PLAN_NATURAL_UX.md`. Apply **after** 0061.

## What changes

| | |
|---|---|
| `v_recipe_line_costs` | **rebuilt**, same 22 columns. The purchase-evidence lookup (`fn_ingredient_cost_basis`) runs only for lines that have an ingredient; it raised for a sub-recipe line and took the whole view down for that recipe. A sub-recipe line now also carries its `line_cost` (quantity converted into the other dish's yield unit × that dish's current cost per yield unit, the engine's own two figures) |
| Policies | 118 → **118** |
| `fn_*` | 98 → 98 |
| Customer rows | none |

The engine is untouched; batch costs do not move. This only stops the
per-line view failing for a dish that is made from another dish, which the
app can now add ("Add a dish you make").

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0062.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0062_sub_recipe_lines.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0062.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0062_rollback.sql` | psql, only if 3 fails | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0062_sub_recipe_lines.sql
```

Expect **PRE 4/4**, `NOTICE: 0062 OK: …`, **POST 4/4**. After POST passes,
`git mv` the file from `proposed/` to `migrations/`.

Until 0062 is live, a dish that contains another dish shows "Nothing in this
recipe yet" under Ingredients while its cost is right; remove the sub-recipe
line to see the list again. No data is at risk.

## Rollback

Restores the 0034 view byte for byte.

## Rehearsal results (12 Oct 2026, repository-built replica `mmq`, 0001→0062)

| Item | Result |
|---|---|
| apply on a fresh build / `tests/048` / rollback / PRE / re-apply / POST | see the commit message |
