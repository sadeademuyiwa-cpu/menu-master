# C2 — Production Deployment Runbook

**Status: REVIEW ONLY. Nothing executed against production.**

Target: production `MENU MASTER NG`. C1 proved it is an **empty project** —
all migration markers `ABSENT`, no tables, no data, no writes, only Supabase's
own `pgbouncer`, `supabase_admin` and `PostgREST 14.15` connected.

Every expected value below was produced by deploying this exact chain to a
fresh database and recording the result at each stage. They are measurements,
not predictions.

---

## 0. What this deployment does NOT enable

| | After deployment |
|---|---|
| Paystack | none — no key, no call, no webhook |
| `billing_events` | does not exist (Gate 3) |
| Billing Edge Function | not written, not deployed |
| Entitlement enforcement | none — `fn_account_is_entitled()` does not exist, and nothing reads `subscriptions.status` to grant or deny |
| Plan prices | all `0` |
| Scheduled jobs | none — `pg_cron` not installed |
| **Ability to charge a customer** | **none** |

The chain lets the database **record** an entitlement. It does not let the
product **charge** for one or **act** on one.

---

## 1. Preflight

| # | Check | Required |
|---|---|---|
| P1 | Dashboard top-left reads `MENU MASTER NG` | this time we DO want production |
| P2 | Run `tests/diagnostics/C1a_AUDIT_catalogue.sql` | all 11 markers `ABSENT`. **Any `present` ⇒ STOP** — the state changed since the audit |
| P3 | 30–40 uninterrupted minutes | §2 |
| P4 | SHA256 of all five parts match §3 | the file that reaches production must be the file that was tested |
| P5 | Files from commit `e2f9e42` or later, branch `claude/gate1-closure` | |

## 2. One uninterrupted sitting — REQUIRED

Production has Supabase's default privileges active (`f,r,S`). Every table
`PART_1` creates arrives with `ALL` granted to `anon`, including `TRUNCATE`,
which RLS does not gate. Measured: **UNGATED climbs to 216 after `PART_1` and
stays elevated until `PART_5` drops it to 0.**

Practical exposure in that window is **nil** — PostgREST never emits
`TRUNCATE`, and RLS gates every DML path it does expose; reaching `TRUNCATE`
needs database credentials that are not public. It is a defence-in-depth gap,
not an exploitable hole. It is still not a state to leave a project in
overnight.

---

## 3. The five parts

| Part | File | SHA256 (first 16) | Bytes | Migrations |
|---|---|---|---|---|
| 1 | `PART_1_core_schema.sql` | `07d4340996321fb1` | 36,056 | `0001` |
| 2 | `PART_2_container_unit_RUN_ALONE.sql` | `22a9f74fe548346f` | 1,530 | `0002` |
| 3 | `PART_3_starter_catalogue.sql` | `0412c4820fabf217` | 25,226 | `0003` |
| 4 | `PART_4_engines_and_gate1.sql` | `96ef886e427a837b` | 96,428 | `0004`–`0012` |
| 5 | `PART_5_gate1_closure.sql` | `369d881d33f912ba` | 53,772 | `0013`–`0018` |

Verification scripts (all pure `SELECT`, single statement, no state change):

- `deploy/runbook/C2_CHECK_structure.sql` — safe at **any** stage
- `deploy/runbook/C2_CHECK_data.sql` — **only after PART 3** (`catalog_*` are created by `0003`, so it fails at parse time before then)
- `deploy/runbook/C2_ACCEPTANCE.sql` — **only after PART 5**

---

## 4. GO / STOP criteria at a glance

Measured on a fresh deployment of this exact chain:

| After | markers | tables | views | functions | UNGATED | fingerprint | anon privileges |
|---|---|---|---|---|---|---|---|
| PART 1 | 4/21 | 31 | 5 | 40 | 216 | `1cda737a8513` | all 7 |
| PART 2 | 5/21 | 31 | 5 | 40 | 216 | `1cda737a8513` | all 7 |
| PART 3 | 6/21 | 33 | 6 | 41 | 234 | `3a341e1096c9` | all 7 |
| PART 4 | 14/21 | 33 | 9 | 69 | 252 | `b814547ec55f` | all 7 |
| PART 5 | **21/21** | 33 | 10 | 76 | **0** | **`8ac70f63e534`** | **SELECT** |

`8ac70f63e534` is the same fingerprint the verified disposable project
produced. If production's final fingerprint differs, its object set differs
from the verified baseline and that must be explained before acceptance.

---

## 5. Part-by-part

### PART 1 — core schema

1. **Script:** `deploy/PART_1_core_schema.sql` · SHA256 `07d4340996321fb1…`
2. **Precondition:** P1–P5 all satisfied; `C1a` shows all 11 markers `ABSENT`.
3. **Expected:** `Success. No rows returned`. 10–20 s.
4. **Verify:** `C2_CHECK_structure.sql`
5. **GO if:** markers 4/21 · tables 31 · views 5 · functions 40 · RLS disabled `none — all enabled` · RLS enabled 31 · fingerprint `1cda737a8513`.
   UNGATED **216 is expected here** — `0018` has not run yet.
6. **STOP if:** any SQL error · tables ≠ 31 · any table with RLS disabled · markers > 4 · fingerprint mismatch.
7. **On STOP:** §6a.

### PART 2 — container unit — **RUN ALONE**

1. **Script:** `deploy/PART_2_container_unit_RUN_ALONE.sql` · `22a9f74fe548346f…`
2. **Precondition:** PART 1 GO. **The editor contains this file and nothing else** — `ALTER TYPE … ADD VALUE` cannot share a transaction with the statement that created the type.
3. **Expected:** `Success. No rows returned`. Instant.
4. **Verify:** `C2_CHECK_structure.sql`
5. **GO if:** markers 5/21 (`0002 container unit kind` now `present`) · tables 31 · functions 40 · fingerprint unchanged `1cda737a8513`.
6. **STOP if:** `ALTER TYPE ... ADD VALUE cannot run inside a transaction block` · marker still `ABSENT` · counts changed.
7. **On STOP:** that specific error means something else was in the editor. Nothing was half-applied. Clear fully, re-run PART 2 alone. Any other error → §6a.

### PART 3 — starter catalogue

1. **Script:** `deploy/PART_3_starter_catalogue.sql` · `0412c4820fabf217…`
2. **Precondition:** PART 2 GO.
3. **Expected:** `Success. No rows returned`. 10–20 s.
4. **Verify:** `C2_CHECK_structure.sql`, then `C2_CHECK_data.sql` (first time it is valid).
5. **GO if:** markers 6/21 · tables 33 · views 6 · functions 41 · fingerprint `3a341e1096c9` · data shows `units 45 · catalog_categories 16 · catalog_ingredients 180 · plans 3 · plan_features 12` and **every tenant table 0** · `non-zero monthly_price` = `none — all zero`.
6. **STOP if:** any SQL error · any reference count differs · any tenant table non-zero · `C2_CHECK_data.sql` errors (it must be valid from here).
7. **On STOP:** §6a.

**A non-zero tenant table here is serious** — it would mean something wrote to production during deployment.

### PART 4 — engines and Gate 1 hardening

1. **Script:** `deploy/PART_4_engines_and_gate1.sql` · `96ef886e427a837b…`
2. **Precondition:** PART 3 GO.
3. **Expected:** `Success. No rows returned`. **30–60 s.** Do not click Run twice.
4. **Verify:** `C2_CHECK_structure.sql` + `C2_CHECK_data.sql`
5. **GO if:** markers 14/21 · tables 33 · views 9 · functions 69 · fingerprint `b814547ec55f` · reference counts unchanged · tenant tables still 0.
6. **STOP if:** any SQL error · functions ≠ 69 · views ≠ 9 · markers ≠ 14 · any tenant table non-zero.
7. **On STOP:** §6a. This is the largest part; a failure here is the most likely place to need diagnosis before retry.

### PART 5 — Gate 1 closure

1. **Script:** `deploy/PART_5_gate1_closure.sql` · `369d881d33f912ba…`
2. **Precondition:** PART 4 GO.
3. **Expected:** `Success. No rows returned`, plus the notice
   `0018 self-check passed: anon holds reference-data SELECT only; no TRUNCATE/TRIGGER/REFERENCES for either client role.`
4. **Verify:** `C2_CHECK_structure.sql` + `C2_CHECK_data.sql` + `C2_ACCEPTANCE.sql`
5. **GO if:** markers **21/21** · tables 33 · views 10 · functions 76 · **UNGATED 0** · anon privileges **`SELECT`** · anon tables exactly the five reference tables · default privileges **`none`** · fingerprint **`8ac70f63e534`**.
6. **STOP if:** `0017 preflight FAILED:` · `0018 self-check FAILED:` · UNGATED ≠ 0 · default privileges still `f,r,S` · fingerprint ≠ `8ac70f63e534` · any acceptance row `>>> FAIL`.
7. **On STOP:** §6b — `PART_5` is the one part where a *partial* outcome matters most, because it is what closes the grant exposure.

---

## 6. On STOP — transaction rollback vs. committed recovery

**These are different situations and must not be confused.**

### 6a. The part errored — transaction rollback

The Supabase SQL Editor executes a submission as a single transaction. That is
*why* `PART_2` must run alone. An erroring part therefore rolls itself back and
the database stays at the previous part's state.

**Do not assume that. Prove it:** run `C2_CHECK_structure.sql` and read the
marker count against §4. That tells you exactly where the chain stopped.

Then: send me the exact error text. **Do not re-run the part.** Diagnose first —
a part that failed once will fail the same way again, and repeated attempts
make the state harder to reason about.

### 6b. The part succeeded but the state is wrong — committed migration

This is the harder case, and no rollback is available. `CREATE TABLE`,
`ALTER TYPE`, `GRANT` and `REVOKE` are committed once the part returns success.
There is no undo.

Recovery is **forward or reset**, never "roll back":

- **Forward:** if the deviation is understood and small (e.g. `0018`'s self-check
  passed but the fingerprint differs because production carries an extra
  object), the fix is a new, reviewed migration. Not an edit to `0001`–`0018`.
- **Reset:** on an empty project the clean reset is
  `drop schema public cascade; create schema public;` plus re-granting schema
  usage, then re-running from `PART_1`. **This is destructive DDL and requires
  its own approval** — it is not part of this runbook.
- **Last resort:** delete and recreate the project. Clean, but the project URL
  and both API keys change.

**Why this is survivable today and will not be next time:** there is no data to
lose. C1 proved production is empty and nothing is connected. Every recovery
path costs time, not information. **Once production holds real data this
runbook must not be reused as written.**

---

## 7. Production acceptance checklist

Run `deploy/runbook/C2_ACCEPTANCE.sql`. 16 rows.

| # | Item | Required |
|---|---|---|
| 1 | migrations `0001`–`0018` present | `18 of 18 markers` · PASS |
| 2 | RLS enabled on every public table | `33 of 33` · PASS |
| 3 | UNGATED = 0 | `0` · PASS |
| 4 | `anon` limited to 5 reference tables, SELECT only | PASS |
| 5 | default privileges revoked for client roles | `none` · PASS |
| 6 | reference data matches baseline | `units=45 cat=16 ing=180 plans=3 feat=12` · PASS |
| 7 | tenant tables empty | all `0` · PASS |
| 8 | no test fixtures, users or accounts | `auth.users=0 test tables=none` · PASS |
| 9 | no `billing_events` table | `absent` · PASS |
| 10 | no entitlement enforcement | `absent` · PASS |
| 11 | plan prices all zero | `all zero` · PASS |
| 12 | no scheduled jobs | `pg_cron not installed` · PASS |
| 13 | billing fn closed to clients | `authenticated=false anon=false` · PASS |
| 14 | no billing Edge Function | **OPERATOR CHECK** — dashboard → Edge Functions list empty |
| 15 | no Paystack secrets | **OPERATOR CHECK** — dashboard → Edge Functions → Secrets, no `PAYSTACK_*` |
| 16 | no webhook endpoint | **OPERATOR CHECK** — Paystack dashboard, no webhook URL for this project |

**Items 14–16 print `OPERATOR CHECK`, never `PASS`.** A script must not report
a pass for something it did not check; that is the defect that made an earlier
test harness score missing functions as successful security controls.

**Negative control:** run against a pre-`0018` database, this checklist
produces six `>>> FAIL` rows. It can fail, so its PASS means something.

**Also required:** `>>> tables with RLS DISABLED` must read `none — all enabled`.
If `fx`, `_test_results`, `_g1`, `_c1` or `_m1` ever appears there, the
regression suites were run against production — which must never happen. They
create users, accounts and recipes and leave fixtures behind. Their evidence is
already recorded from the disposable project at 154/154.

---

## 8. Decision rule

> ### C2 PASS
> All five parts returned success · every GO criterion in §4 met at its stage ·
> acceptance items **1–13 all PASS** · operator items **14–16 confirmed by you
> in the dashboard** · final fingerprint `8ac70f63e534` · RLS disabled list
> empty.

> ### C2 FAIL
> **Any** of: a part errored · any GO criterion missed · any acceptance item
> `>>> FAIL` · fingerprint ≠ `8ac70f63e534` · UNGATED ≠ 0 · any tenant table
> non-zero · any operator check not confirmed.

There is no partial pass. UNGATED ≠ 0 alone is a FAIL even with everything else
green: it means the grant exposure `0018` exists to close is still open.

On FAIL: stop, report, diagnose. Do not proceed to Gate 3, do not connect
anything, do not begin Gate 2 against this project.

## 9. After C2 PASS

Gate 1 conditions **C1 and C2 both close**. C3 (no billing path) and C4
(entitlement not enforced) remain, both belonging to Gate 3, both blocking
before revenue rather than before use. C5–C8 stay non-blocking.

Gate 1 moves from **CONDITIONAL PASS** to **PASS for its own scope**, with C3
and C4 carried forward as Gate 3 preconditions.
