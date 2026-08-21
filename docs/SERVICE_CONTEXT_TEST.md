# Service Context Test — S1–S13

Closes the exclusion recorded in `docs/SUPABASE_BOUNDARY_RESULT.md` §4.1: the
`service_role` path was never verified, because testing it requires a key that
was deliberately not requested during the boundary test.

**Disposable project only.** Nothing in this procedure touches the production
`MENU MASTER NG` project.

---

## 1. What is being tested

`fn_is_service_context()` gates four distinct behaviours. The boundary test
proved only that end users get `false`. It never proved the positive half — that
the billing path works when it should. A webhook that silently fails is as
damaging as one that leaks.

| Call site | Service context may |
|---|---|
| `0016` `fn_require_cost_access` | bypass all cost authorization |
| `0012` `fn_create_account_and_business` | create an account owned by any user |
| `0012` `fn_guard_subscription_writes` | write any subscription |
| `0012` `fn_set_subscription_plan` | change a plan — refuses everyone else |

### Phase A — clients must not reach the billing path (anon key only)

| # | Test | PASS |
|---|---|---|
| CTRL | Owner A reads her own cost | `15` — proves RPC reachability |
| S1 | Owner B calls `fn_set_subscription_plan` | refused |
| S2 | Owner B `PATCH`es his subscription status | refused |
| S3 | Owner B `DELETE`s his subscription | refused |
| S4 | Owner B `INSERT`s a second subscription | refused |
| S5 | Owner B onboards on a **paid** plan | refused by `fn_guard_subscription_writes` |
| S6 | Owner B upgrades himself to a paid plan | refused |
| S7a/b | Cashier B repeats S1 and S2 | refused |
| S8a/b/c | Each end user asks `fn_is_service_context()` | `false` |

S5 is the only probe that exercises the trigger's client branch. S2–S4 and S6
are stopped earlier, at the grant layer, because `0012` revokes
`insert, update, delete` on `subscriptions` from `authenticated`.

### Phase B — the service_role path (needs the key)

| # | Test | PASS |
|---|---|---|
| S9 | service key alone → `fn_is_service_context()` | `true` |
| S10 | service key sets a plan | succeeds **and the row actually changes** |
| S11 | service key as `apikey` + end-user JWT | `false` |
| S12 | service key reads any account's cost | recorded **BY DESIGN**, not scored |
| S13 | plan set on a **nonexistent** account | must not report success |

S11 is the one that matters: it is the mixed-credential case, and the reason
`fn_is_service_context()` requires the *absence* of `request.jwt.claim.sub`
rather than trusting the role alone.

## 2. What a PASS cannot mean

`service_role` bypasses RLS by design. This procedure cannot prove the key is
"safe" — only that (a) clients cannot become service context, and (b) the
legitimate billing path works. **Custody of the key is an operational control,
not a database one.** S12 is recorded rather than scored for exactly this
reason.

## 3. Credential controls

- The `service_role` key is never pasted into chat, never committed, never
  written to any file in this repository.
- The harness field is `type="password"`, `autocomplete="off"`.
- Every line of output passes through `scrub()`, which replaces the key with
  `«service key redacted»`. This is structural, not a promise: `L()` and `rec()`
  cannot emit text that has not been scrubbed.
- The key is sent only as an HTTP header, never in a URL or query string.
- The harness refuses to run if the service field contains the anon key.
- After Phase B the key is rotated, then the project is deleted.

## 4. Procedure

1. Create a new disposable Supabase project. No real data, ever.
2. SQL Editor: run `deploy/PART_1_core_schema.sql`.
3. Run `deploy/PART_2_container_unit_RUN_ALONE.sql` **alone**, in its own
   submission — `ALTER TYPE ... ADD VALUE` cannot share a transaction with the
   statement that created the type.
4. Run `deploy/PART_3`, then `PART_4`, then `PART_5`.
5. Create three users in Authentication → Users, all with the same password:
   `ownera@boundary.test`, `ownerb@boundary.test`, `cashierb@boundary.test`.
6. Run `tests/006_supabase_boundary_fixtures.sql`.
7. Run `tests/007_service_context.sql` — the pre-flight. Every `verdict` must
   read `OK` except section 5, which records known-absent guards.
8. Open `tests/service_context_test.html` in a browser. Anon key only. Run.
   That is Phase A.
9. Re-open it, add the `service_role` key, run again. That is Phase B.
10. Re-run the `POST_B_subscriptions` block of `tests/007_service_context.sql`.
11. Rotate the service_role key, then delete the project.

## 5. Result

Recorded on completion.
