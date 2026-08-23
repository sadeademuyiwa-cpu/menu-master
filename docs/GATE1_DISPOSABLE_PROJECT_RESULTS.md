# Gate 1 — Disposable Project Verification Results

**Date:** 2026-08-23
**Project:** `mmng-service-context-test` (disposable, `eu-west-1`, created for this
purpose, contains no real data, deleted after testing).
**Production `MENU MASTER NG` was not touched at any point.**

Closes the `service_role` exclusion recorded in `SUPABASE_BOUNDARY_RESULT.md`
§4.1, and verifies migrations `0017` and `0018`.

---

## 1. Summary

| | Result |
|---|---|
| Phase A — clients cannot reach the billing path | **11/11 PASS** |
| Phase B — the `service_role` path | **15/15 scored PASS**, 1 recorded BY DESIGN |
| `0018` evidence (items 2–9) | **12/12 PASS** |
| `0018` idempotence (item 11) | fingerprint identical before/after |
| Pre-flight (item 1) | 14/14 `OK` |
| Regression suites (item 10) | **154/154**, zero failures |

Chain applied: `deploy/PART_1` … `PART_5`, covering migrations `0001`–`0018`.

## 2. Two defects found and fixed

Both were found by testing rather than by reading, and both were fixed before
this verification ran.

### 2.1 `fn_set_subscription_plan` reported success on a zero-row update

`0012` built its return value from its arguments and never consulted
`ROW_COUNT`. Calling it for an account with no subscription row returned
`{"plan_id":"trading","account_id":"…"}` — success — having changed nothing.
Paystack would record a customer as upgraded while the database still said
`trialing`: money taken, no entitlement, no error anywhere.

Fixed in `0017`. Confirmed closed on real infrastructure as **S13**:

```
S13  PASS  HTTP 500  {"code":"P0002","message":"No subscription exists for …"}
           rows actually affected = 0
```

### 2.2 `anon` could `TRUNCATE` every tenant table

`0011` said of the `anon` role: *"gets nothing on tenant data. Not read, not
write."* True on the local shim, false on Supabase. Supabase ships default
privileges granting `ALL` on new public tables to `anon`, `authenticated` and
`service_role`, and `GRANT`s are additive — `0011` never revoked them. Every
tenant table carried `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE,
UPDATE` for both client roles.

Tested rather than assumed, which changed the conclusion in two places:

| Privilege | Verdict |
|---|---|
| `SELECT`/`INSERT`/`UPDATE`/`DELETE` | mitigated — RLS gates them; `anon` reads 0 rows |
| `EXECUTE` on functions | mitigated — in-function authorization refuses `anon`; and `EXECUTE` to `PUBLIC` on new functions is core PostgreSQL behaviour, not a Supabase quirk |
| **`TRUNCATE`** | **NOT mitigated.** RLS does not apply. `set role anon; truncate ingredient_prices cascade;` emptied the table. |
| `TRIGGER` | not exploitable, but `0016` line 43 justifies `pg_trigger_depth()` by claiming `CREATE TRIGGER` requires table ownership. It requires the `TRIGGER` privilege, which was granted. The control held for reasons `0016` does not state: no `CREATE` on schema `public`, and every trigger-returning function has `EXECUTE` revoked. |

Fixed in `0018`.

## 3. Resulting grant surface

```
anon:          SELECT on units, catalog_categories, catalog_ingredients,
               plans, plan_features — and nothing else
authenticated: DELETE, INSERT, SELECT, UPDATE
               (no TRUNCATE, no TRIGGER, no REFERENCES anywhere;
                subscriptions is SELECT-only per 0012)
service_role:  unchanged — ALL
```

`service_role` is deliberately untouched: it is the trusted backend, bypasses
RLS by design, and the billing path depends on it.

`ALTER DEFAULT PRIVILEGES` now stops the next table inheriting the same
problem. This **fails closed** — a forgotten grant makes a feature visibly not
work rather than silently arriving world-writable. Verified empirically: a
table created after `0018` grants `NONE` to either client role.

## 4. Evidence

Fingerprint of the whole client grant surface, before and after re-applying
`0018` (item 11):

```
fingerprint  total_grants  anon_grants  authenticated_grants  ungated_privileges
8ac70f63e534          174            5                   169                   0   (before)
8ac70f63e534          174            5                   169                   0   (after)
```

Phase B, the four that matter:

```
S9   service_context=true                    the key is recognised
S10  row now = {"plan_id":"trading","status":"active","provider_ref":"PHASE-B-S10"}
S11  service_role apikey + end-user JWT → false      the mixed-credential case
S13  HTTP 500 P0002, rows affected = 0              defect 2.1 confirmed closed
```

`S12` — `service_role` reading any account's cost — is recorded **BY DESIGN**
and not scored. That bypass is the point of the role.

Regression suites, run in the SQL Editor of the disposable project:

```
001_correctness_and_isolation    26 / 0 / 26
002_gate1_attack_and_regression  54 / 0 / 54
004_gate1_closure                23 / 0 / 23
005_role_write_matrix            51 / 0 / 51
                                154 / 0 / 154
```

Suite `005` matters most here: `0018` removes privilege, so the failure mode to
fear is legitimate work breaking, not attacks succeeding. `002` proves attacks
are still blocked; `005` proves owners, managers, kitchen, sales and accountant
can still do their jobs.

## 5. The structural fix that made this findable

`tests/0000_local_supabase_shim.sql` now applies Supabase's three
`ALTER DEFAULT PRIVILEGES` statements. **Every local result before this was
produced against a more locked-down database than production**, which is why
the `TRUNCATE` exposure survived two gates. The local suite now runs on the
same grant surface production has.

Confirmation that it worked: the disposable project's grant fingerprint
(`8ac70f63e534`, `174/5/169/0`) is **identical** to the local mirror's.

## 6. What remains unverified

1. **Transition-matrix enforcement.** `0017` constrains the *set* of subscription
   states, not the transitions between them. See
   `SUBSCRIPTION_STATE_MACHINE.md` §4.
2. **`fn_account_is_entitled()` does not exist.** Nothing in `0001`–`0018` reads
   `subscriptions.status` for entitlement, so the state machine is documentation
   plus a CHECK constraint, not yet enforced behaviour.
3. **`S13` returns HTTP 500.** PostgREST maps `P0002` to 500, which tells
   Paystack the failure is transient — it will retry a call that can never
   succeed. A `PTxxx` SQLSTATE would return 4xx and stop the loop. Not changed
   during verification, because altering it mid-run would invalidate this
   evidence.
4. **`billing_events` audit table** does not exist; unknown external statuses are
   surfaced through Paystack's own delivery log.
5. One project, one run.

## 6a. Teardown

`service_role` key rotated, then the project deleted. Recorded on completion.
