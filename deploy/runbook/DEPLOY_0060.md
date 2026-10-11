# DEPLOYMENT RUNBOOK — 0060 (fixing a mistake without starting over)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0059 applied**, 118 policies, 95 `fn_*` functions.
Phase 1 of `docs/PLAN_NATURAL_UX.md`.

## What changes

| | |
|---|---|
| `purchases.replaced_by` | new column: which corrected purchase replaced this one. Covering index `ix_fk_purchases_replaced_by` |
| `customers.deleted_at` | new column: a customer put away, never deleted; their sales keep pointing at them |
| `fn_correct_purchase(original, date, supplier, reference, note, lines)` | new. One transaction: records and posts the corrected purchase, reverses the original through the unchanged `fn_reverse_purchase`, links them. Writes nothing when a line cannot be measured; returns the blockers instead |
| `fn_reissue_order(uuid)` | **replaced**. The replacement now carries the original's lines, discount, customer and date. A second live replacement of the same sale is refused |
| `fn_recompute_business_recipes(business)` | new. One snapshot per dish (and per active size) of a business; for after a wage or a monthly bill changes. Cost access required |
| `trg_ingredients_base_unit_locked` | new BEFORE UPDATE trigger on `ingredients`: the base unit cannot change once a purchase or recipe line is measured in it |
| Policies | 118 → **118** |
| `fn_*` | 95 → 98 |
| Customer rows | none written; two nullable columns added |

Every edit screen the app gains in this phase (dish name and portion, recipe
line unit, wages, bills, sizes, suppliers, customers, draft purchases and
sales, target margin) uses row policies that already exist (0015/0028). This
migration adds only what a client cannot do safely on its own.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0060.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0060_edit_and_correct.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0060.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0060_rollback.sql` | psql, only if 3 fails | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0060_edit_and_correct.sql
```

Expect **PRE 6/6**, `NOTICE: 0060 OK: …`, **POST 7/7**. Same transaction guard
as 0049–0059; it refuses the SQL Editor. After POST passes, `git mv` the file
from `proposed/` to `migrations/`.

The app's "Correct this purchase" and the copied-lines reissue ship in the
same deploy. If the app reaches production before the migration, "Correct
this purchase" reports that it is not available yet; the old empty reissue
keeps working.

## Rollback

Drops the two new functions and the trigger, restores the 0014
`fn_reissue_order` byte for byte, drops the two columns. A purchase already
corrected stays corrected (original reversed, replacement posted); only the
link between them is lost. A customer put away comes back into the list.

## Rehearsal results (11 Oct 2026, repository-built replica `mmq`, 0001→0060)

| Item | Result |
|---|---|
| apply on a fresh build | `0060 OK` |
| `tests/046_edit_and_correct.sql` | **25/25** |
| rollback / re-apply on a copy | `0060 rollback OK: back at 0059.` · `0060 OK` |
| `PRE_DEPLOY_0060.sql` on a 0059 database | 6/6 PASS |
| `POST_VERIFY_0060.sql` on the 0060 database | 7/7 PASS |
| full suite run (`scripts/run_suites.ps1 -Template mmq`) | see the commit message |
