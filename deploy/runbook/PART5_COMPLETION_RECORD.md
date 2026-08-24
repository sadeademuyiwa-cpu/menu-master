# PART 5 — completed and verified in production (2026-08-24)

**Status: COMPLETE. Do not rerun or modify PART_5.**

## What was applied

`deploy/PART_5_gate1_closure.sql` — migrations 0013 through 0018 — on Supabase
production, PostgreSQL **17.6**, inside an explicit transaction.

## Preflight (before)

`C2_PART5_PREFLIGHT_v2.sql`: **20 GO, 0 STOP**. `auth.users` baseline 5 exactly,
no `vendors` relation, `handle_new_user` the only foreign public function,
`on_auth_user_created` unchanged, server version 17.6.

## Gate (after)

`C2_PART5_GATE.sql`: **0 STOP**, 1 OPERATOR CHECK (live cross-tenant test, not
runnable at 0 accounts, deferred to the signup acceptance test), 2 INFORMATIONAL.

Verified: 33 base tables · 10 views · 43 relations · 92 policies · RLS enabled
on every base table · 40 `fn_*` functions · `handle_new_user` the only non-`fn_`
non-extension function, still present, SECURITY DEFINER, owner `postgres`, body
still targeting the missing `vendors` · `on_auth_user_created` still present and
enabled · onboarding RPC executable by `authenticated` · `authenticated` holds
no TRUNCATE/TRIGGER/REFERENCES · `anon` EXECUTE on `fn_*` = 0 · `anon` holds
SELECT only, on exactly `catalog_categories, catalog_ingredients, plan_features,
plans, units` · no anon-readable table with an unscoped `fn_`-calling policy ·
`service_role` untouched · 0013, 0014 (7 functions) and 0017 markers present ·
units/catalog_categories/catalog_ingredients 45/16/180, unique count 45 ·
plans/plan_features 3/12 · 0 accounts, 0 price rows.

**Fingerprints matched the validated reference build exactly:**
grants `8ac70f63e534`, policies `b0ce58371195`.

## Regression test (after)

`tests/010_anon_reference_read.sql`: **5 PASS, 0 FAIL**. All five reference
tables readable by `anon` (45/16/180/3/12) with `0 of 40` `fn_*` executable —
the invariant that `anon` executes no Menu Master function holds while the
reference surface stays readable.

## Note on the Step 1 checksum anomaly

The operator's local SHA-256 of `PART_5_gate1_closure.sql` did not match, and no
transformation of any version of the file reproduced their hash — prefixes,
suffixes, line endings, BOMs, UTF-16 encodings, whitespace normalisation and all
five historical versions were all tested and excluded. The anomaly was in the
copy that was hashed, not in what reached production: the gate's grant and
policy fingerprints matched the validated build exactly, which a materially
different PART_5 could not produce.

**Outstanding bookkeeping:** the gate's displayed row count was not returned.
The gate is a `UNION ALL` of 29 scalar branches and therefore always emits
exactly 29 rows; the operator's tally of 27 PASS + 1 OPERATOR CHECK + 2
INFORMATIONAL sums to 30. Every substantive item matched expectation, so this is
almost certainly a miscount of the PASS column rather than a schema difference.
It does not affect the PART_5 verdict and is recorded here so it is not lost.

## Still true after PART 5

- Signup is **broken**: `handle_new_user` fires on `auth.users` and inserts into
  a `vendors` relation that exists in no schema, so every signup fails 42P01.
  PART_5 deliberately did not touch this.
- **Five `auth.users` remain, untouched**, with no tenant. Treat as potentially
  real users; do not alter them.
- Gate 1 remains CONDITIONAL PASS pending blocker C9 (signup).
