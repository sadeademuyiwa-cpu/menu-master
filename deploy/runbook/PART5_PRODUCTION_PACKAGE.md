# PART 5 — Production Execution Package

**PART_5 was not modified while preparing this package.** It is byte-identical to
the validated artefact and reproducible from `migrations/`: rebuilding the chain
produced a file identical to the one validated.

Execute the five stages **in this order**. Do not skip a stage. Do not continue
past a STOP.

---

## Stage 1 — Verify the checksum

```
File:    deploy/PART_5_gate1_closure.sql
SHA-256: 2ad4577636c029d41bd457b272ab07d5c0a9c090eba59a85fb2c77ad3edcdf8d
Size:    66346 bytes
Lines:   1466
```

Check it before pasting anything:

```bash
sha256sum PART_5_gate1_closure.sql
# must print 2ad4577636c029d41bd457b272ab07d5c0a9c090eba59a85fb2c77ad3edcdf8d
```

Supporting artefacts, unchanged since Part 4:

| File | SHA-256 (first 16) |
|---|---|
| PART_1_core_schema.sql | `07d4340996321fb1` |
| PART_2_container_unit_RUN_ALONE.sql | `22a9f74fe548346f` |
| PART_3_starter_catalogue.sql | `0412c4820fabf217` |
| PART_4_engines_and_gate1.sql | `96ef886e427a837b` |

**PASS:** the checksum matches exactly.
**STOP:** any mismatch. Do not paste a file whose checksum you cannot verify.

---

## Stage 2 — Preflight (read-only)

Run `deploy/runbook/C2_PART5_PREFLIGHT.sql` immediately before PART_5. Pure
single-statement SELECT, no state change. 20 rows.

It asserts, from production itself:

- **A** Parts 1–4 are applied: `fn_*` = 33, relations = 42, policies = 37, the onboarding RPC exists.
- **B** Part 5 is **not** applied: the 0013, 0014, 0017 and 0018-section-7 markers are all absent, `p_units_read`/`p_units_write` still exist, and anon's SELECT surface is still the full public schema.
- **C** Reference data intact: 45 / 16 / 180 and 3 / 12, with `units` still distinct on `(account_id, lower(code))`.
- **D** No tenant data: `auth.users`, `accounts`, `businesses`, `ingredients`, `ingredient_prices`, `recipes` all 0.
- **E** The foreign object is still the only one: `handle_new_user` alone, `on_auth_user_created` present and enabled, and **no relation named `vendors`**.
- **F** Environment, informational only.

**PASS:** every `verdict >>>` reads **GO**. Two rows read INFORMATIONAL by design
(server version; open backends — PostgREST and realtime legitimately hold idle
connections, so this is reported, not gated).

**STOP:** any **STOP**. It means production has moved since validation. Send me
the row and I will re-validate; do not paste PART_5.

**Section B is the double-run guard.** Verified: on a database that already has
Part 5, the preflight raises **nine independent STOPs**. This is the control that
prevents a repeat of the Part 3 duplicate-submission incident.

---

## Stage 3 — Execute PART_5

Paste the **verified file** into the Supabase SQL Editor, wrapped in an explicit
transaction:

```
begin;
    ← the entire contents of the checksum-verified PART_5_gate1_closure.sql
commit;
```

**Why the wrapper.** PostgreSQL DDL is transactional, and I verified this
end-to-end: running PART_5 inside `begin; … rollback;` returned the schema
exactly to `fn_* = 33`, a complete rollback. Wrapping therefore converts any
mid-script failure from a half-applied schema into a clean no-op, which is the
entire emergency plan in Stage 7. The two wrapper lines are typed by you; the
checksum governs the file between them.

If the SQL Editor reports "there is already a transaction in progress", that is a
**warning**, not an error — the editor opened one for you. Continue.

**Expected notices** (three, in order):

```
0018: LEFT UNTOUCHED (not Menu Master functions): handle_new_user
0018 self-check passed: anon holds reference-data SELECT only; no TRUNCATE/TRIGGER/REFERENCES for either client role.
0018 section 7 passed: the anon reference surface is readable without EXECUTE on any Menu Master function.
```

**PASS:** no `ERROR`, all three notices present, `commit` succeeds.
**STOP:** any `ERROR`. Issue `rollback;`, then go to Stage 7.

**Known property — PART_5 is not idempotent.** A second run errors with
`policy "p_units_read_global" for table "units" already exists`. I verified the
final state still converges correctly (gate 26 PASS, test 010 5 PASS, 92
policies, anon reads 45 units and is refused every write), so a double run is
noisy rather than damaging — but the Stage 2 preflight exists precisely so it
never happens. Recorded as a runbook defect to fix later, alongside the same
defect in Part 3. **I did not modify PART_5 to fix this**, because `CREATE POLICY`
has no `IF NOT EXISTS` form, the change would invalidate the validated artefact
and its checksum, and the preflight already closes the hole.

---

## Stage 4 — Gate

Run `deploy/runbook/C2_PART5_GATE.sql`. Pure single-statement SELECT, 29 rows.

Covers structure (33 tables, 10 views, 43 relations), RLS (92 policies, none
outside `p_*`, none disabled), functions (`fn_*` = 40, exactly one non-`fn_`
non-extension function), the foreign object untouched, grants (anon's five
tables, SELECT only, zero `fn_*` EXECUTE; authenticated holds no
TRUNCATE/TRIGGER/REFERENCES; the onboarding RPC still executable; `service_role`
untouched), the anon read surface, reference data, migration markers for 0013 /
0014 / 0017, and two change-detection fingerprints.

**PASS:** **26 PASS, 0 STOP.** One row reads OPERATOR CHECK — the live
cross-tenant test, not runnable with 0 accounts, deferred to Stage 2 of the
signup work. Two rows read INFORMATIONAL: expect `8ac70f63e534` (grants) and
`b0ce58371195` (policies). A fingerprint difference is not itself a failure —
it means the environment differs from the local reference build — but report it.

**STOP:** any **STOP** row. Go to Stage 7.

---

## Stage 5 — Regression test 010

Run `tests/010_anon_reference_read.sql`. Read-only; safe against production.

This is the test whose absence let the `units` regression pass 154/154. It
asserts that an anonymous SELECT against **every** intended reference table
actually succeeds after privilege hardening, without anon holding EXECUTE on any
Menu Master function.

**PASS:** **5 of 5 PASS.** Row 1 should read
`all five readable: units=45 catalog_categories=16 catalog_ingredients=180 plans=3 plan_features=12`
and row 2 `0 of 40`.

**STOP:** any FAIL. Go to Stage 7.

---

## Stage 6 — PASS/STOP criteria, consolidated

| Stage | PASS | STOP |
|---|---|---|
| 1 Checksum | `2ad4577636c029d4…` exact | any mismatch |
| 2 Preflight | every `>>>` row GO (18 GO, 2 INFORMATIONAL) | any STOP |
| 3 Execute | no ERROR, 3 notices, commit succeeds | any ERROR → `rollback;` |
| 4 Gate | 26 PASS, 0 STOP | any STOP |
| 5 Test 010 | 5 PASS, 0 FAIL | any FAIL |

**Report to me after each stage.** Do not proceed to `0019a`, `0019b` or
`C2_TRIGGER_AUTHORITY.sql` — those need separate authorisation.

---

## Stage 7 — Rollback and emergency procedure

### First, the two facts that make this low-risk

1. **PART_5 changes no data.** Verified before and after on the replica:
   `units / catalog_categories / catalog_ingredients / plans / plan_features` =
   `45 / 16 / 180 / 3 / 12`, identical. PART_5 is DDL, grants and policies only.
2. **Production holds zero tenant data.** 0 `auth.users`, 0 `accounts`, 0
   `ingredients`, 0 `ingredient_prices`. There is nothing irreplaceable to lose.

### Case A — PART_5 errors during Stage 3

```sql
rollback;
```

Then re-run the Stage 2 preflight. It should return to all-GO, proving the
schema is back at the Parts 1–4 state. Send me the error text and the preflight
output. Do not retry PART_5 until I have re-validated.

### Case B — PART_5 committed, but Stage 4 or 5 fails

Do **not** improvise a fix and do **not** re-run PART_5.

1. **Capture evidence first.** Save the failing rows verbatim, then run
   `deploy/runbook/C2_FOREIGN_OBJECTS.sql` and the Stage 2 preflight, and send me
   all three outputs.
2. **Assess.** Most gate STOPs are expectation mismatches (an environment
   difference, a count I predicted wrong) rather than damage. The rows that would
   indicate real damage are: reference data ≠ 45/16/180/3/12, `handle_new_user`
   altered or missing, or `service_role` privileges gone.
3. **Recovery, in increasing order of cost:**
   - **B1 — targeted correction.** If the failure is one policy or one grant, I
     write a small forward migration for your approval. Preferred: forward fixes
     are reviewable; ad-hoc reversals are not.
   - **B2 — restore from Supabase backup / PITR.** Available on paid plans under
     Database → Backups. This is the clean option if the schema is genuinely
     wrong. Confirm your plan includes PITR **before** Stage 3, so you know
     whether B2 is available.
   - **B3 — rebuild from the chain.** Because production holds no tenant data,
     the whole schema can be recreated by running Parts 1–5 on a clean database.
     This is drastic but always available, and it is why doing this now — before
     the first user — is materially safer than doing it later.

### There is no reverse migration, deliberately

`0018` revokes privileges and replaces policies; an automated inverse would have
to guess the prior grant state, and a wrong guess re-opens the security hole the
migration exists to close. The preflight's Section B fingerprints the exact
pre-state instead, so if a reversal is ever needed it can be written against
recorded fact rather than assumption.

### Escalation

If anything is ambiguous, stop and send me the output. Nothing in Stages 3–5
becomes harder to fix by waiting, and production has no users to disrupt.
