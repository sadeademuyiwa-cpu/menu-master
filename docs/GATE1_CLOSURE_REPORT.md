# MENU MASTER NG — GATE 1 CLOSURE REPORT

Closes the P1 items left open by `docs/GATE1_REPORT.md` §8. Built on the
verified baseline `d0fea2d`, which is unchanged.

Method: additive migrations only, full suite run after every migration, stop on
any regression against the verified 80/80 baseline.

---

## 1. Result

| Suite | Baseline | After closure |
|---|---|---|
| `001` correctness and isolation | 26/26 | **26/26** |
| `002` Gate 1 attack and regression | 54/54 | **54/54** |
| `004` Gate 1 closure (new) | — | **23/23** |
| `005` write-side role matrix (new) | — | **51/51** |
| **Total** | **80/80** | **154/154** |

`0001 → 0016` rebuilds from an empty database, verified twice, identical both
times. `0013`–`0016` re-apply cleanly to an already-migrated database.

**No recovered baseline test regressed at any point.**

---

## 2. Items closed

| Item | Status |
|---|---|
| **P1.1** historical revenue mutable | **Closed** by 0014 — finalisation, void-and-reissue, revenue guards |
| **P1.3** zero-amount purchase | **Closed** by 0013 — `amount > 0` on both write paths |
| **P1.4** write-side role enforcement | **Closed** by 0015 — 21 tables moved to per-command policies |
| **P1.8** stale artifacts | Already closed — absent from this repository after the clean rebuild |

## 3. Items deliberately left open

| Item | Reason |
|---|---|
| **P1.2** recipe variants | Deferred to Gate 2 (founder ruling C1) |
| **P1.5** tax | Outstanding MVP/product item, not a Gate 1 concern (C5) |
| **P1.6** down-migrations | Idempotence guards + `docs/ROLLBACK.md` instead (C6) |
| **P1.7** synchronous recompute fan-out | Scale risk, not correctness |
| **P2 set** | Performance and polish |
| Missing `docs/menu-master-ng-blueprint.md` | Unrecovered. No substitute fabricated (C7) |

---

## 4. Two findings worth recording

### 4.1 P1.4 was 21 tables, not 24

`GATE1_REPORT.md` §8 states 24. Measured from the SQL: 0001's blanket loop
covered 24; 0012 re-scoped `memberships` and `subscriptions`; 0004 cost-gated
`ingredient_prices` and `recipe_prices`. 21 remained. The recovered report is
**not edited** — it is a forensic original.

### 4.2 A conflict between the role model and the costing engine

Founder ruling Q2 gives `kitchen` write access to `ingredients.purchase_yield_pct`
and `ingredient_unit_conversions.qty_in_base` — production facts the kitchen is
the authority on. But 0008 puts recompute triggers on both tables, that
recomputation reaches `fn_ingredient_unit_cost`, and 0012 guards it with
`fn_require_cost_access`.

The result: a kitchen user held the RLS right to record a yield and was still
refused, because recording a production fact recomputes costs and kitchen cannot
see costs.

**This was found by test 005, not by reading the SQL** — the same lesson the
Gate 1 report drew from its own `current_user` defect.

Resolved in 0016 by relaxing the **role** half of `fn_require_cost_access` inside
a trigger (`pg_trigger_depth() > 0`) while leaving the **account** half fully
enforced. This mirrors the sales-role cost freeze that Gate 1 already ships and
proves (report §5, R5): a user without cost access performs an action whose
consequence is a cost write, executed by a definer trigger, while still being
unable to read a single cost figure.

`pg_trigger_depth()` cannot be forged by a client: it is non-zero only inside a
trigger, and `authenticated` cannot install one (CREATE TRIGGER needs table
ownership). A settable bypass flag was rejected precisely because it would
reintroduce the "authority from the request instead of from the data" defect
Gate 1 existed to fix. Suite 005 proves kitchen and sales still read zero cost
rows and are still refused the costing RPCs directly.

---

## 5. THE SUPABASE BOUNDARY BLOCKER IS CLOSED

`GATE1_REPORT.md` §7 recorded a residual risk: `authenticator` is granted
`service_role`, and test 003 proved the JWT-subject clause blocks the escalation
only against a local `authenticator` role *we created ourselves*.

That is no longer an assumption. On 2026-08-21 the test was run against a
disposable Supabase project with real GoTrue sign-ins, real JWTs, real PostgREST
and Supabase's own roles and default privileges.

**Control PASS (owner A read her own cost of 15), 15/15 probes blocked, 0
inconclusive.** Full evidence, including the two harness defects found and fixed
along the way, is in `docs/SUPABASE_BOUNDARY_RESULT.md`.

Three exclusions remain and are stated in that document §4. The most significant:
**the `service_role` path is still unverified**, because testing it requires the
`service_role` key, which was deliberately never requested or handled.

### Secondary residual: finalisation is opt-in

0014 makes revenue immutable **once `fn_finalise_order` is called**. It does not
force every order to be finalised, because the recovered baseline suites create
orders and then add lines to them; mandatory finalisation would have regressed
the verified 80/80 baseline, which was not permitted.

The mechanism is complete and proven. Enforcing that the application always
calls it is an application-layer obligation, or a future migration once a
frontend exists. `sales_entries` have no such gap — they are immutable from
insert.
