# C2 — Production Deployment Plan

**Status: REVIEW ONLY. Nothing has been executed against production.**

Deploys migrations `0001`–`0018` to the production `MENU MASTER NG` Supabase
project as five SQL Editor submissions.

C1 established that production is an **empty project**: all 11 migration
markers `ABSENT`, no tables, no data, no writes, and only Supabase's own
`pgbouncer`, `supabase_admin` and `PostgREST 14.15` connected. This is therefore
a **first deployment**, not an upgrade — the same procedure rehearsed end to end
on `mmng-service-context-test`.

---

## 0. What this deployment does NOT enable

Stated first because it is the easiest thing to get wrong.

| | Status after deployment |
|---|---|
| Paystack integration | **none.** No API call, no key, no webhook, no endpoint |
| `billing_events` table | **does not exist.** Gate 3, unstarted |
| Webhook Edge Function | **not written, not deployed** |
| Entitlement enforcement | **none.** `fn_account_is_entitled()` does not exist, and nothing in `0001`–`0018` reads `subscriptions.status` to grant or deny anything |
| Plan prices | all three `plans.monthly_price = 0` |
| Scheduled jobs | none. `pg_cron` is not enabled and nothing runs on a timer |
| Ability to charge a customer | **none** |

The chain creates `subscriptions`, `plans` and `fn_set_subscription_plan`. That
makes the database able to **record** an entitlement. It does not make the
product able to **charge** for one, or to **act** on one. Gate 3 is untouched.

`fn_set_subscription_plan` is callable only in service context and is revoked
from `anon` and `authenticated`, so no client can reach it either.

---

## 1. Preflight — before touching anything

| # | Check | Required result |
|---|---|---|
| P1 | Dashboard top-left reads **`MENU MASTER NG`** | this is the one time we DO want production |
| P2 | Re-run `tests/diagnostics/C1a_AUDIT_catalogue.sql` | all 11 markers still `ABSENT`. If any is `present`, **STOP** — something changed since the audit |
| P3 | 30–40 uninterrupted minutes available | see §3 |
| P4 | File integrity — SHA256 of the five parts | must match §2 exactly |
| P5 | Files came from commit `e2f9e42` or later on `claude/gate1-closure` | |

**P2 is not ceremony.** The audit is a snapshot. If anything applied SQL to
production in the meantime, this plan's assumptions are void.

---

## 2. The five parts

From `deploy/`, generated from `migrations/` by
`scripts/build_deploy_chain.sh`. Verified to apply cleanly to a fresh
PostgreSQL 16 database.

| Part | File | SHA256 (first 16) | Bytes | Migrations |
|---|---|---|---|---|
| 1 | `PART_1_core_schema.sql` | `07d4340996321fb1` | 36,056 | `0001` |
| 2 | `PART_2_container_unit_RUN_ALONE.sql` | `22a9f74fe548346f` | 1,530 | `0002` |
| 3 | `PART_3_starter_catalogue.sql` | `0412c4820fabf217` | 25,226 | `0003` |
| 4 | `PART_4_engines_and_gate1.sql` | `96ef886e427a837b` | 96,428 | `0004`–`0012` |
| 5 | `PART_5_gate1_closure.sql` | `369d881d33f912ba` | 53,772 | `0013`–`0018` |

---

## 3. One uninterrupted sitting — REQUIRED

**All five parts must be run back to back. Do not stop between them.**

C1 confirmed production has Supabase's default privileges active
(`default privileges for client roles = f,r,S`). Every table `PART_1` creates
therefore arrives with `ALL` granted to `anon` and `authenticated`, including
`TRUNCATE`, which RLS does not gate. `0018`, at the end of `PART_5`, removes it.

**Between `PART_1` and `PART_5` that grant is live.**

Being precise about the actual risk rather than alarming: the practical
exposure in that window is **nil**. PostgREST never emits `TRUNCATE`, and RLS —
enabled by `0001` — gates every DML path PostgREST does expose. Reaching
`TRUNCATE` needs a raw SQL channel, which needs database credentials that are
not public. It is a defence-in-depth gap, not an exploitable hole.

It is still not a state to leave a project sitting in overnight.

**Considered and rejected:** revoking the default privileges before `PART_1`
would close the window entirely. It deviates from the sequence verified end to
end on the disposable project, and trading verified-correct for
marginally-tidier is a bad exchange for a gap nothing can exploit.

---

## 4. The sequence

Each part: **SQL Editor → clear (`Ctrl+A`, `Delete`) → paste the whole file →
Run**. Confirm the project name before each one.

### Part 1 of 5 — core schema
Expected: `Success. No rows returned`. 10–20 seconds.
Creates the tables, RLS policies and base functions.

> **STOP if:** any error. Nothing is partially applied (§7). Send the error
> text; do not re-run.

### Part 2 of 5 — container unit — **RUN ALONE**
The editor must contain **only** this file. `ALTER TYPE … ADD VALUE` cannot
share a transaction with the statement that created the type.
Expected: `Success. No rows returned`. Instant.

> **STOP if:** `ALTER TYPE ... ADD VALUE cannot run inside a transaction block`
> — something else was in the editor. Clear it fully and re-run Part 2 alone.
> Nothing was half-applied.

### Part 3 of 5 — starter catalogue
Expected: `Success. No rows returned`. 10–20 seconds.
Loads ingredient names, categories and units. **No prices, no conversions, no
yields** — those are the owner's data and the architecture exists to avoid
guessing them.

> **STOP if:** any error.

### Part 4 of 5 — engines and Gate 1 hardening
Expected: `Success. No rows returned`. **30–60 seconds.** Do not click Run
twice if it seems slow.
Unit conversion, purchase posting, the recursive costing engine, snapshots,
sales freeze, onboarding, API grants, authorization hardening.

> **STOP if:** any error.

### Part 5 of 5 — Gate 1 closure
Expected: `Success. No rows returned`. 10–20 seconds.
`0013`–`0018`. Watch for the `0018` self-check notice:
`0018 self-check passed: anon holds reference-data SELECT only; no
TRUNCATE/TRIGGER/REFERENCES for either client role.`

> **STOP if:** a message beginning `0017 preflight FAILED:` or
> `0018 self-check FAILED:` appears. Both are guards refusing to claim success
> they have not earned. On an empty project neither should fire — if one does,
> the project is not in the state C1 reported.

---

## 5. Post-deployment verification

### V1 — `C1a_AUDIT_catalogue.sql` (read-only)

| Row | Required |
|---|---|
| All 11 migration markers | **`present`** |
| `>>> UNGATED (TRUNCATE/TRIGGER/REFERENCES)` | **`0`** |
| `anon: tables` | `catalog_categories, catalog_ingredients, plan_features, plans, units` |
| `anon: privileges` | `SELECT` |
| `authenticated: privileges` | `DELETE,INSERT,SELECT,UPDATE` |
| `default privileges for client roles` | **`none`** — was `f,r,S`; `0018` revoked it |
| `tables with RLS DISABLED` | `none — all enabled` |

### V2 — `C1b_AUDIT_data.sql` (read-only, now applicable)

Reference data loaded, tenant tables empty:

```
units 45 · catalog_categories 16 · catalog_ingredients 180
plans 3 · plan_features 12
accounts 0 · businesses 0 · subscriptions 0 · ingredients 0 · recipes 0
```

`D 0017 preflight` rows should read `0 row(s)` and `none`.

### V3 — `GRANT_FINGERPRINT.sql` (read-only)

Record the fingerprint and counts. This is the baseline any future change is
compared against.

### V4 — object counts

Expect **33 tables, 10 views, 76 functions** in `public`.

### DO NOT run the regression suites against production

`001`, `002`, `004` and `005` create their own users, accounts and recipes, and
leave `fx`, `_test_results`, `_g1`, `_c1` and `_m1` behind. They belong on a
disposable project. Their evidence is already recorded from
`mmng-service-context-test` at 154/154.

C1a's RLS row is the tripwire: if any of those table names ever appears there,
a suite was run against production.

---

## 6. Rollback and recovery

### 6a. A part fails

The Supabase SQL Editor executes a submission as a single transaction — this is
precisely why `PART_2` must run alone. A failing part therefore **rolls itself
back**, leaving the database at the previous part's state.

**Do not assume that. Verify it:** run `C1a_AUDIT_catalogue.sql` and read which
markers are `present`. That tells you exactly where the chain stopped.

Then: send me the error, I diagnose, we re-run **that part only**. Every part is
idempotent enough to be re-run after a clean rollback.

### 6b. The chain lands in a wrong but non-erroring state

Requires explicit approval; not part of this plan. On an empty project with no
consumers the reset is `drop schema public cascade; create schema public;`
followed by re-granting schema usage and re-running from `PART_1`. It is
destructive DDL and would need its own reviewed procedure.

### 6c. Last resort

Delete and recreate the project. Clean, but **the project URL and both API keys
change**, so anything referencing them must be updated. Not needed today —
nothing references them.

### What makes rollback low-risk here

There is **no data to lose**. C1 proved production is empty and nothing is
connected. Every recovery path costs time, not information. That will not be
true of the next deployment, and this plan should not be reused as-is once
production holds real data.

---

## 7. Effort

Roughly 30–40 minutes: 5 preflight checks, 5 parts (~2 minutes each plus
paste time), 4 verification runs.

## 8. After C2

Gate 1's C1 and C2 both close. Remaining conditions: **C3** (no billing path)
and **C4** (entitlement not enforced) — both belong to Gate 3 and both remain
blocking before revenue, not before use. C5–C8 stay non-blocking.

Gate 1's verdict would move from CONDITIONAL PASS to **PASS for its own scope**,
with C3 and C4 carried forward as Gate 3 preconditions.
