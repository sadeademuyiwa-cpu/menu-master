# SEPTEMBER 1 CRITICAL PATH — COMPLETION BOARD

**Directive:** 1 September 2026 hard launch. Full approved architecture, no MVP
reduction, **no new scope**. Feature-complete 30 Aug · RC 31 Aug · launch 1 Sep.

**Derivation rule:** every item below is traced to a file in this repository.
Nothing is invented. Where the approved roadmap is silent, this board says so
rather than filling the gap.

Board date: 25 Aug 2026. **Six build days remain (25–30 Aug).**

---

## 0. THE FINDING THAT DOMINATES THIS BOARD

**There is no frontend in this repository, and no approved design for one.**

- No `package.json`, no `src/`, `app/`, `web/` or `components/`. Zero lines.
- `README.md` status table: *"Frontend | Not started, correctly."*
- `docs/menu-master-ng-blueprint.md` — the approved product blueprint that
  would define screens, workflows and reporting — is **unrecovered**.
  `GATE1_CLOSURE_REPORT.md` §3: *"Unrecovered. No substitute fabricated (C7)."*

Three P0/P1 priorities therefore have **no derivable source**:

| Priority | Item | Why it cannot be derived |
|---|---|---|
| P0 | complete frontend integration | no design, no scaffold, no code |
| P0 | mobile usability | ditto |
| P1 | reporting/dashboard functionality already designed | the design document is missing |

I have not invented tasks for these, per the directive. What the repository
*does* fully specify is the database, costing, tenancy, onboarding, Gate 2 and
Gate 3 layers — those are boarded below in full.

**Arithmetic, stated plainly and once:** the P0 database/billing critical path
below consumes essentially all six remaining days under the existing
preflight → migration → verification → acceptance discipline. A frontend
starting from an empty directory, with its blueprint missing, does not fit
beside it. That is a scheduling fact, not a recommendation — the call on how to
resolve it is yours.

---

## 1. GATE 2 — SERVING FORMATS AND RECIPE VARIANTS

Source: `docs/GATE2_FINAL_DESIGN.md` §9 (five phases), §8 (security), §10 (test
matrix). Design locked, D1 resolved as option (a).

| # | Item | Depends on | Status | P |
|---|---|---|---|---|
| G2.1 | `0021` Phase 1 structural | G2 preflight ✅ | **Authored, replica-tested 33/0, awaiting your review** | P0 |
| G2.2 | `0021` production execution | G2.1 review | Not started | P0 |
| G2.3 | `0022` Phase 2 backfill — Default format, `portion_qty` → Basis B | G2.2 | Not started | P0 |
| G2.4 | `0023` Phase 3 overhead basis (D1) | G2.2 | Not started | P0 |
| G2.5 | `0024` Phase 4 cutover regression — new variant cost = old `cost_per_portion` to 6 d.p. | G2.3 | Not started | P0 |
| G2.6 | `0025` Phase 5 — views and `fn_freeze_sale_cost` repoint to variants | G2.5 | Not started | P0 |
| G2.7 | Gate 2 attack matrix (§8): B cannot read/use/modify/attach A's formats; kitchen cannot read format packaging cost inside its own account | G2.2 | Partially covered — `tests/011` checks 25–27 | P0 |
| G2.8 | Gate 2 test matrix (§10): businesses A/B/C, overhead, history/deactivation, anti-hard-coding Z1–Z3 | G2.6 | Not started | P0 |

**Note on G2.3:** production holds **0 tenant rows**, so the backfill is a no-op
there. It must still be written and tested — the suites build data, and any
future environment will not be empty.

**Deprecated, never dropped:** `recipes.portion_qty`,
`business_settings.expected_monthly_units`. Dropping them is a separate later
migration, explicitly out of scope (§9 Phase 5).

---

## 2. GATE 3 — BILLING INTEGRATION

Source: `docs/BILLING_INTEGRATION_DESIGN.md`, review-approved 2026-08-23.
Ordering per §0: Gate 2 first, Gate 3 before any real payment.

| # | Item | Depends on | Status | P |
|---|---|---|---|---|
| G3.1 | `billing_events` migration — table, constraints, indexes, RLS with **no client policies**, `service_role` grants, `v_billing_reconciliation` | — | Not started. **Renumber required** — design names it `0019_billing_events.sql`, but `0019c` and `0020` are taken. Next free number after Gate 2 is `0026` | P0 |
| G3.2 | Paystack webhook Edge Function — signature verification (§4) | G3.1 | Not started | P0 |
| G3.3 | Secret management (§6) and the never-log list (§7) | G3.2 | Not started | P0 |
| G3.4 | Event lifecycle + idempotency strategy (§2, §3) | G3.2 | Not started | P0 |
| G3.5 | Failure, retry and reconciliation (§5) | G3.4 | Not started | P0 |
| G3.6 | Test plan §10 and the eleven scenarios §11 | G3.5 | Not started | P0 |
| G3.7 | Paystack **test-mode account** and sandbox evidence | — | Not started. **External dependency — start it first, it is not under our control** | P0 |

Every subscription write goes through `fn_set_subscription_plan`. The Edge
Function never issues `UPDATE subscriptions` directly (§8).

---

## 3. GATE 1 RESIDUAL CONDITIONS

Source: `docs/GATE1_VERDICT.md` §4.

| # | Condition | Status | P |
|---|---|---|---|
| C1 | Production audit | **CLOSED** 23 Aug | — |
| C2 | Chain deployed to production | **CLOSED** — PART 5 verified 24 Aug | — |
| C3 | No billing path | Open → covered by Gate 3 | P0 |
| C4 | **Entitlement documented but not enforced** — nothing in `0001`–`0021` reads `subscriptions.status`; `fn_account_is_entitled()` does not exist, so a cancelled account is denied nothing | Open. **No design document exists for this.** Named as a condition, never specified | P0 |
| C5 | Subscription transitions unconstrained (`cancelled → trialing` is possible) | Open — verdict says "belongs with the webhook that will drive transitions" | P1 |
| C6 | Finalisation is opt-in — `0014` makes revenue immutable once finalised but does not force finalisation | Open — an application obligation until a frontend exists | P1 |
| C7 | Single-run evidence — one disposable project, one run per phase; re-verification ≈40 min | Accepted risk | P1 |
| C8 | `service_role` key custody | Operational control, out of database scope | P1 |
| C9 | Signup broken by foreign hook | **CLOSED** — `0019c` | — |
| C10 | Onboarding not idempotent | **CLOSED** — `0020` | — |
| C5-cleanup | Committed acceptance-test tenant | **CLOSED** 25 Aug — `C5_CLOSURE_RECORD.md` | — |

---

## 4. BLUEPRINT REQUIREMENTS STILL OPEN

Source: `docs/MENU_MASTER_NG_AUDIT.md` §3, the 39-requirement traceability
matrix. Items closed by `0013`–`0018` are omitted.

| # | Requirement | Evidence of the gap | P |
|---|---|---|---|
| 27 | Channel commission affects economics | `channels.commission_pct` is stored, selected in the view, and **used in no calculation** | **P0** — pricing/margins |
| 23 / 24 | Costing method configurable; method change must not rewrite history | `costing_method_changes` exists but **is never written to**. Changing the method is a silent `UPDATE`, violating approved Decision 2 | P1 |
| 28 | Tax configuration in MVP scope | `tax_mode` and `tax_rate` exist; **nothing reads them**. Note the conflict: the blueprint matrix calls tax MVP scope, `GATE1_CLOSURE_REPORT.md` §3 defers it as item P1.5 | P1 — **conflict, needs your ruling** |
| 31 | Closed periods immutable | `period_closes` exists; **nothing writes to it and nothing enforces it** | P1 |
| 39 | Stock lots, production, waste, finished goods, supplier balances | **Correctly absent** — out of scope by governing rule | P2 |

---

## 5. TEST AND VERIFICATION DEBT

| # | Item | Status | P |
|---|---|---|---|
| T.1 | **Suites `001`/`002`/`004`/`005` no longer run on a `0020` database** — suite 001 dies at line 87, *"An idempotency key is required for onboarding"*. `0020` made the key mandatory and the suites still call the old contract | Open. Measured 25 Aug: 001→1 error, 002→7, 004→20, 005→5, **identical with and without `0021`** — this is `0020` damage, not Gate 2 | **P0** — these are the production acceptance suites |
| T.2 | `tests/010_anon_reference_read.sql` | **DONE** — 5 PASS | — |
| T.3 | `tests/011_gate2_phase1.sql` | **DONE** — 33 PASS / 0 FAIL on 17.6 | — |
| T.4 | Gate 2 post-migration production gate (new counts 47/48/105) | Not started — currently the `0021` self-check carries them | P0 |
| T.5 | Historical C1–C5 gate files carry `40/44/93` and will report a false STOP after `0021` | **By instruction: leave unchanged.** Recorded so nobody mistakes it for drift | — |
| T.6 | Down-migrations | Not built — `ROLLBACK.md` + idempotence guards accepted instead (founder ruling C6) | P2 |
| T.7 | Synchronous recompute fan-out | Scale risk, not correctness | P2 |

---

## 6. CRITICAL PATH, SIX DAYS

Longest dependency chain: **G2.1 → G2.2 → G2.3 → G2.5 → G2.6 → G2.8**. Nothing
in Gate 2 after `0021` can start until `0021` is executed in production, so
**G2.2 is the single most schedule-critical action on this board.**

| Day | Work | Gates it opens |
|---|---|---|
| Tue 25 Aug | Review + execute `0021` (G2.2). Repair the acceptance suites for the `0020` contract (T.1). Open the Paystack test account (G3.7) | unblocks all of Gate 2 |
| Wed 26 Aug | `0022` backfill, `0023` overhead basis | |
| Thu 27 Aug | `0024` cutover regression, `0025` repoint | |
| Fri 28 Aug | Gate 2 attack matrix + test matrix (G2.7, G2.8), Gate 2 production gate (T.4) | **Gate 2 closed** |
| Sat 29 Aug | `billing_events` migration, Edge Function, entitlement C4 | |
| Sun 30 Aug | Billing scenarios §11, channel commission (#27), production acceptance | **feature-complete** |
| Mon 31 Aug | Release candidate — full regression, re-verification (C7) | |
| Tue 1 Sep | **Launch** | |

G3.7 is external and gates G3.2–G3.6; it is placed on day 1 for that reason.

---

## 7. WHAT THIS BOARD DELIBERATELY DOES NOT CONTAIN

Per the directive — freeze scope, invent nothing:

- No frontend tasks. There is no approved frontend design in this repository.
- No reporting or dashboard tasks. Same reason.
- No inventory, production, waste, finished goods or supplier balances —
  correctly absent by the governing rule, audit item 39.
- No new features, no cosmetic work, no speculative integrations, no
  architecture redesign. All P2, all post-launch.

## 8. DECISIONS THIS BOARD NEEDS FROM YOU

1. **Frontend.** Nothing can be planned until the missing blueprint is
   recovered or its scope is restated. This is the largest P0 and it is blocked
   at the design stage.
2. **Tax (audit #28).** The blueprint matrix calls it MVP scope; the Gate 1
   closure report defers it as P1.5. One of the two is wrong.
3. **C4 entitlement.** Named as a launch condition, never designed. It needs a
   design before it can be built, and it is blocking before revenue.
