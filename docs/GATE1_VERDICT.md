# Gate 1 — Final Verdict

**Date:** 2026-08-23
**Scope:** the database authorization, tenancy and costing-integrity layer,
migrations `0001`–`0018`.
**Verified against:** a disposable Supabase project with real GoTrue sign-ins,
real JWTs, real PostgREST and Supabase's own roles. Production was never
touched.

---

# VERDICT: CONDITIONAL PASS

Gate 1's own scope is met and independently evidenced. The conditions below are
**not** defects in `0001`–`0018` — they are things outside this gate that must
exist before production carries real data or real money.

---

## 1. What Gate 1 proves

| Property | Evidence |
|---|---|
| Tenant boundary holds over real HTTP | boundary test 15/15 blocked, control PASS |
| Cost-role boundary is independent of tenancy | A6: cashier refused her **own** account's cost |
| Service context is unreachable from a client | X14/X15, S8a–c, and S11 (service key + end-user JWT → `false`) |
| The service_role billing path works | S9, S10 — row actually changed |
| Grant surface is minimal | `anon`: `SELECT` on 5 reference tables. `authenticated`: no `TRUNCATE`/`TRIGGER`/`REFERENCES` |
| Future objects inherit nothing | probe table created post-`0018`: `NONE` |
| Costing engine correct on Supabase | derived ₦15/g from a paint of rice and a private conversion |
| Completeness gate holds | suite 001, 26/26 |
| Full regression on real infrastructure | **154/154**, zero failures |
| `0018` idempotent | grant fingerprint identical before and after |

## 2. Defects found and closed during verification

| | Defect | Fixed by | Confirmed |
|---|---|---|---|
| 1 | `fn_set_subscription_plan` reported success on a zero-row update — money taken, no entitlement, no error | `0017` | S13, on real infrastructure |
| 2 | `anon` held `TRUNCATE` on every tenant table; RLS does not gate `TRUNCATE` | `0018` | items 2/3, plus A/B proof |

Neither was found by reading. Both were found by testing, and defect 2 had
survived two prior gates because the local shim did not model Supabase's
default privileges.

## 3. One correction recorded rather than fixed

`0016` line 43 justifies the `pg_trigger_depth()` control by claiming
`CREATE TRIGGER` requires table ownership. **That is wrong** — it requires the
`TRIGGER` privilege, which Supabase granted. The control holds for reasons
`0016` does not state: `authenticated` has no `CREATE` on schema `public`, and
every trigger-returning function has `EXECUTE` revoked (enumerated: zero
reachable). `0018` removes the privilege so the conclusion no longer rests on a
false premise. `0016` is not modified.

---

# 4. CONDITIONS BEFORE PRODUCTION

Every one of these is outstanding. None is optional.

## C1 — Production audit *(CLOSED 2026-08-23)*

Executed read-only via `C1a_AUDIT_catalogue.sql`. 20 rows. Findings:

| | Observed |
|---|---|
| All 11 migration markers | **ABSENT** — the chain has never been applied |
| `anon` / `authenticated` grants | `NONE` — there are no tables to grant on |
| Ungated privileges (TRUNCATE/TRIGGER/REFERENCES) | `0` |
| Grant fingerprint | `n/a` |
| **Default privileges for client roles** | **`f,r,S`** — Supabase's defaults ARE active |
| Tables with RLS disabled | `none — all enabled` |
| Lifetime writes | `0` |
| Current sessions | `pgbouncer`, `supabase_admin`, `PostgREST 14.15` — Supabase's own infrastructure only; no application is connected |

**Production is an empty Supabase project.** C1b was correctly not run: it
counts rows in tables that do not exist.

The `f,r,S` row is the one that matters for sequencing. Supabase's default
privileges are live, so every table created by `PART_1` will arrive with `ALL`
granted to `anon` and `authenticated`. The exposure `0018` fixes will be
*created by deployment* and removed at the end of `PART_5`.

## C2 — The chain is not deployed to production *(blocking, but now simple)*

C1 reframes this. It is not "apply `0017`/`0018` to a live database with
history" — it is a **fresh deployment of the whole verified chain onto an empty
project**, identical to the procedure rehearsed end-to-end on
`mmng-service-context-test`.

No preflight can refuse: there are no subscriptions to violate `0017`, and no
grants for `0018` to remove that anything depends on. Nothing is connected, so
there is no blast radius.

**One sequencing note.** Between `PART_1` and `PART_5` the tables exist with
Supabase's default `ALL` granted to `anon`. The practical exposure in that
window is nil — PostgREST never emits `TRUNCATE`, and RLS (enabled by `0001`)
gates every DML path it does expose; raw SQL needs database credentials that
are not public. It is a defence-in-depth gap, not an exploitable hole, and it
closes when `PART_5` runs.

Mitigation is simply to **run all five parts in one sitting**. Revoking the
default privileges before `PART_1` would close the window entirely, but that
deviates from the sequence we verified, and trading verified-correct for
marginally-tidier is a bad exchange.

## C3 — No billing path exists *(blocking before revenue, not before use)*

Paystack signs webhooks; PostgREST cannot verify a signature; therefore no
webhook can be processed today. Gate 3 covers this. Until it passes, **no real
payment may be accepted.**

## C4 — Entitlement is documented but not enforced *(blocking before revenue)*

Nothing in `0001`–`0018` reads `subscriptions.status`. `fn_account_is_entitled()`
does not exist. A cancelled account is not actually denied anything, so paid
plans cannot be enforced.

## C5 — Subscription transitions are unconstrained *(non-blocking)*

`0017` constrains the *set* of states, not the transitions between them.
`cancelled → trialing` is currently possible. Belongs with the webhook that will
drive transitions.

## C6 — Finalisation is opt-in *(non-blocking, carried from Gate 1 closure)*

`0014` makes revenue immutable once `fn_finalise_order` is called, but does not
force every order to be finalised — mandatory finalisation would have regressed
the verified baseline. Enforcing it is an application obligation until a
frontend exists.

## C7 — Single-run evidence *(accepted risk)*

One disposable project, one run per phase. Re-verification uses
`deploy/PART_1`–`PART_5` and takes roughly 40 minutes.

## C8 — Deliberately out of scope

`service_role` key custody is an operational control, not a database one. No
migration can protect a leaked key. The role bypasses RLS by design.

---

# 5. Why CONDITIONAL PASS and not PASS

PASS would mean production-ready. It is not: C1 and C2 mean **no verified
migration has been applied to the production project at all**, and nobody has
looked at what is in it.

Why not FAIL: nothing in `0001`–`0018` is known to be broken. Every defect found
was fixed and re-verified. The conditions are about the gap between a verified
chain and a production system, not about the chain itself.

---

# 6. The immediate next action

**C1 — the read-only production audit.** It is the only condition that unblocks
the others, it changes nothing, and until it is done any plan for production is
speculation about a database nobody has examined.
