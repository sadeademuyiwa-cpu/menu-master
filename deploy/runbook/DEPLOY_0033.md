# PRODUCTION DEPLOYMENT PACK — 0033

Migration `migrations/proposed/0033_recipe_line_costs.sql`
sha256 prefix `c908f42f571d79ad` · 8,531 bytes · 173 lines · commit `c8f609c`

---

## VERIFIED PRODUCTION BASELINE — post-0033, owner-supplied

Recorded from the actual production STEP 3 run. **These are the authoritative
post-0033 invariants.** Any future check compares against these, not against a
replica.

| Field | Production value | Notes |
|---|---|---|
| `view_exists` | 1 | |
| `security_invoker` | true | |
| `column_count` | **21** | the full list is below |
| `authenticated_grants` | SELECT | |
| `anon_grants` | 0 | |
| `is_updatable` | NO | |
| `policies` | 116 | unchanged by 0033 |
| `public_functions` | **61** | 60 `fn_*` + `handle_new_user` (Supabase signup handler, drives the `auth.users` trigger) |
| `triggers` | **40** | 34 public/application + 6 Supabase platform: `auth.users` 1, `realtime.subscription` 1, `storage.buckets` 2, `storage.objects` 2 |

The production function census was enumerated by name and reconciles exactly to
61. A single earlier scalar reading of 62 was a counting artefact and is
superseded: the detailed census enumerates every row individually, which is
stronger evidence than a scalar, and two independent readings agree on 61.
**No public function disappeared. 0033 creates none, and its apply/rollback
function fingerprint is byte-identical.**

## CORRECTED INVARIANTS

Two expectations in the first issue of this pack were wrong. Both were errors in
the verification documentation, not in the migration or in production. They are
recorded here because a runbook that states a wrong expected value trains the
operator to ignore mismatches, which is worse than having no expectation at all.

| Field | First stated | Correct | Why it was wrong |
|---|---|---|---|
| `column_count` | 20 | **21** | Written before the provenance fix added `purchase_count` as a 21st column; never updated |
| `public_functions` | 97 | **production's own STEP 1 value** | 97 is the replica's count. The replica installs pgcrypto into `public` (36 functions) and carries a test shim (`local_pre_request`); Supabase installs pgcrypto into `extensions` and has no shim. These were never comparable |
| `triggers` | 34 | **production's own STEP 1 value** | 34 counts public-schema triggers only. Production's non-internal count also includes Supabase platform triggers on `auth`, `realtime` and `storage` |

**Rule for future packs: never state a replica absolute as a production
expectation.** Cross-environment counts are comparable only after excluding
extension-owned objects, test shims and platform schemas. Use production's own
pre-deployment reading as the post-deployment invariant, and assert *equality
with STEP 1*, not a hard-coded number.

The figures that ARE portable, because the migration itself controls them:

| Field | Expected | Source |
|---|---|---|
| `view_exists` | 1 after, 0 before | the migration |
| `security_invoker` | `true` | asserted by the migration's own self-check |
| `column_count` | **21** | the SELECT list; pinned by `tests/023` check 26 |
| `authenticated_grants` | `SELECT` | the migration's single GRANT |
| `anon_grants` | 0 | no grant to `anon` |
| `is_updatable` | `NO` | the view aggregates and calls functions |
| `policies` | 116, unchanged | asserted by preflight and self-check |
| `public_functions`, `triggers` | **unchanged from STEP 1** (production: 61 and 40) | 0033 creates neither |

## HOW THE FALSE DISCREPANCY HAPPENED, AND WHAT PREVENTS IT NEXT TIME

Two of the three mismatches in this deployment were my documentation being
stale or non-portable, not production being wrong. Both wasted a verification
round-trip, and a runbook that cries wolf is worse than one with no expectations
at all, because the operator learns to click past mismatches.

The three rules now enforced:

1. **A stated invariant must be derivable from the migration, not remembered.**
   `column_count` was 20 because it was written before `purchase_count` existed.
   `tests/023` check 26 now pins the exact 21-column list in order, so the
   runbook figure is re-derived from the migration on every test run and cannot
   go stale silently.
2. **Never state a replica absolute as a production expectation.** Counts of
   functions and triggers are not comparable across environments: the replica
   installs pgcrypto into `public` (36 functions) and carries a test shim, where
   Supabase installs pgcrypto into `extensions` and has neither; and 34 counts
   public-schema triggers only, where production's non-internal count includes
   Supabase platform triggers on `auth`, `realtime` and `storage`. Production's
   61/40 and the replica's 97/34 describe the same application schema.
3. **Prefer an enumeration to a scalar for anything that must be reconciled.**
   A scalar count that disagrees cannot tell you what changed; a census by name
   can. Where a count is the invariant, pair it with the query that names the
   rows.

## THE VIEW'S 21 COLUMNS

`line_id, recipe_id, account_id, business_id, ingredient_id, sub_recipe_id,
item_name, item_kind, is_cost_bearing, exclusion_reason, recipe_qty,
recipe_unit, base_unit, base_qty, unit_cost, line_cost, purchase_qty_base,
purchase_amount, purchase_date, purchase_count, problem`

`tests/023` check 26 asserts this exact list in this exact order, so the
runbook's `column_count` can always be re-derived from the migration rather
than remembered.

## WHAT 0033 EXECUTES — THE COMPLETE LIST

Five statements, verified by `grep` over the file:

1. `do $$ ... $$` — preflight (view absent, engine present, 116 policies)
2. `create view v_recipe_line_costs with (security_invoker = on) as ...`
3. `comment on view ...`
4. `grant select on v_recipe_line_costs to authenticated`
5. `do $$ ... $$` — self-check (`security_invoker`, policies unchanged)

There is **no** `CREATE`, `DROP` or `ALTER FUNCTION` anywhere in the file, and
no DML of any kind. Verified empirically: `public_functions` is 97 before and 97
after on the replica, and the function-definition fingerprint is byte-identical
across apply and rollback. **0033 cannot add, remove or replace a function, and
cannot fire a trigger.**

## ROLLBACK

    drop view if exists v_recipe_line_costs;

Restores the schema to a byte-identical state; verified by fingerprint.
Per-line costs and purchase evidence go blank. Cost per portion, profit and
margin are unaffected — they come from `v_recipe_cost_current` and
`v_price_check`.
