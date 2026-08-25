# MASTER COMPLETION REGISTER — SEPTEMBER 1 2026

Derived by sweeping the entire repository plus the live schema on a PostgreSQL
17.6 replica built to the exact production baseline. Nothing is invented; every
row cites its source. Where the repository is silent this register says
**PRODUCT DECISION REQUIRED** rather than guessing.

**Baseline:** HEAD `b7123ec`, 69 commits ahead of the Gate 1 baseline `d0fea2d`,
remote in sync, working tree clean. C1–C5 history verified intact (all nine
stage boundaries reachable from HEAD).

**Production state:** 40 `fn_*` · 44 relations · 93 policies · 5 protected auth
users · 0 tenant rows · `0019c` and `0020` applied · guard trigger enabled.

Status vocabulary: **DONE** · **AUTHORED NOT DEPLOYED** · **PARTIAL** ·
**NOT STARTED** · **BLOCKED** · **DECISION**

Effort is in focused engineering hours, not calendar time.

---

## A. TRACK A — DATA PLATFORM (Gate 2)

Source: `docs/GATE2_FINAL_DESIGN.md` §9.

| ID | Item | Status | P | Depends | Effort | Test requirement | Blocking condition |
|---|---|---|---|---|---|---|---|
| A1 | G2 production preflight | **DONE** 25 Aug — 28 GO / 3 INFO / 0 STOP | P0 | — | — | — | — |
| A2 | `0021` Phase 1 structural migration | **AUTHORED NOT DEPLOYED, GO ISSUED** — sha256 `b60d1d40…`, 30,982 B (the `48a4303…` build is superseded: it broke the costing engine) | P0 | A1 | done | `tests/011` 33/33 ✅ | operator must run it; I have no production access |
| A3 | `0021` rollback | **AUTHORED NOT DEPLOYED** — sha256 `1cb6dfc…` | P0 | A2 | done | replica cycle ✅ | — |
| A4 | `0022` Phase 2 backfill — Default format (capacity NULL), `portion_qty` → Basis B | **NOT STARTED** | P0 | A2 deployed | 4h | equality test: every backfilled variant reproduces `cost_per_portion` exactly | no-op in production (0 tenant rows) but required for correctness |
| A5 | `0023` Phase 3 overhead basis (D1) | **NOT STARTED** | P0 | A2 deployed | 5h | `overhead_basis_incompatible` returned, never a silent conversion | — |
| A6 | `0024` Phase 4 cutover regression — new variant cost = old `cost_per_portion` to 6 d.p. | **NOT STARTED** | P0 | A4 | 5h | bit-for-bit equality; before/after list where overhead is enabled | — |
| A7 | `0025` Phase 5 — views + `fn_freeze_sale_cost` repoint to variants | **NOT STARTED** | P0 | A6 | 6h | every existing view test still passes | highest-risk migration: it changes read paths |
| A8 | Gate 2 attack matrix (§8) | **PARTIAL** — `tests/011` checks 25–27 cover cross-tenant read | P0 | A2 deployed | 4h | B cannot read/use/modify/attach A's formats; kitchen cannot read format packaging cost | — |
| A9 | Gate 2 test matrix (§10) — businesses A/B/C, overhead, history, anti-hard-coding Z1–Z3 | **NOT STARTED** | P0 | A7 | 8h | full matrix green | — |
| A10 | Gate 2 post-migration production gate (47/48/105) | **NOT STARTED** | P0 | A2 | 2h | 0 STOP | counts currently live only in the `0021` self-check |
| A11 | Deprecate-not-drop: `recipes.portion_qty`, `business_settings.expected_monthly_units` | **DONE by design** — retained in `0021` | P0 | — | — | rollback self-check asserts both survive ✅ | dropping them is explicitly a later migration |

## B. TRACK B — BILLING AND COMMERCIAL CONTROL (Gate 3)

Source: `docs/BILLING_INTEGRATION_DESIGN.md`, review-approved 23 Aug.

| ID | Item | Status | P | Depends | Effort | Test requirement | Blocking condition |
|---|---|---|---|---|---|---|---|
| B1 | Paystack **test-mode account + keys** | **BLOCKED** | P0 | — | 1h | — | **external — only you can obtain this. Gates B3–B8** |
| B2 | `billing_events` migration — table, RLS with **no client policies**, `service_role` grants, `v_billing_reconciliation` | **NOT STARTED** | P0 | — | 4h | RLS: no client role can read it | **renumber** — design says `0019_billing_events.sql`; `0019c`/`0020` are taken, next free is `0026` |
| B3 | Webhook Edge Function — signature verification (§4) | **NOT STARTED** | P0 | B1, B2 | 8h | forged signature rejected | PostgREST cannot verify signatures; this must be an Edge Function |
| B4 | Idempotency strategy + event lifecycle (§2, §3) | **NOT STARTED** | P0 | B3 | 5h | replayed event changes nothing twice | — |
| B5 | Failure, retry and reconciliation (§5) | **NOT STARTED** | P0 | B4 | 5h | `v_billing_reconciliation` surfaces every gap | — |
| B6 | Secrets (§6) and the never-log list (§7) | **NOT STARTED** | P0 | B3 | 2h | no key, PAN or signature in any log | `service_role` key must never enter the repo or chat |
| B7 | Test plan §10 + the eleven scenarios §11 | **NOT STARTED** | P0 | B5 | 8h | 11/11 against Paystack sandbox | needs B1 |
| B8 | **C4 — server-side entitlement enforcement** | **DECISION + NOT STARTED** | P0 | decision | 8h | a cancelled account is actually denied | **`fn_account_is_entitled()` does not exist and nothing reads `subscriptions.status`. Named as a launch condition in `GATE1_VERDICT.md` §4, never designed.** See Decision 2 |
| B9 | C5 — subscription transition constraints (`cancelled → trialing` is currently possible) | **NOT STARTED** | P1 | B4 | 3h | illegal transition refused | verdict says it belongs with the webhook |
| B10 | `0017` subscription state integrity | **DONE** — deployed, S13 verified | — | — | — | — | — |

## C. TRACK C — PRODUCT AND FRONTEND

Source: **derived in this work block** — `MENU_MASTER_NG_PRODUCT_BLUEPRINT.md`
and `MENU_MASTER_NG_FRONTEND_BLUEPRINT.md`, both grounded in the live API
contract (10 views, 21 `fn_*` RPCs callable by `authenticated`, 33 tenant
tables). The original `docs/menu-master-ng-blueprint.md` remains **unrecovered**;
nothing has been fabricated to replace it.

| ID | Item | Status | P | Depends | Effort | Test requirement | Blocking condition |
|---|---|---|---|---|---|---|---|
| C1 | Product blueprint | **DONE** | P0 | — | — | — | — |
| C2 | Frontend blueprint | **DONE** | P0 | C1 | — | — | — |
| C3 | Frontend stack decision | **DONE** — Next.js + Vercel approved | — | — | — | — | — |
| C4 | Application scaffold | **DONE** — Next.js 15 / React 19 / Tailwind 4 / Supabase SSR, builds and typechecks clean, 11 routes | — | — | — | ✅ | — |
| C5 | Auth — signup, login, email confirmation, session | **PARTIAL** — implemented, untested against a live project | P0 | C4 | 6h | signup creates exactly one account | `0019c` neutralised the hook; onboarding is now an explicit RPC call |
| C6 | Onboarding wizard | **PARTIAL** — implemented with one key per attempt, untested live | P0 | C5 | 6h | retry with the same key creates nothing new | key generated client-side, one per attempt |
| C7 | Business / location / member management | **NOT STARTED** | P0 | C6 | 8h | role matrix honoured in the UI | — |
| C8 | Ingredients, categories, packaging items | **PARTIAL** — list, create and the conversions to-do list built | P0 | C6 | 8h | `kind='packaging'` respected | — |
| C9 | Prices + purchase posting | **NOT STARTED** | P0 | C8 | 8h | zero-amount refused (`0013`) | — |
| C10 | Units + per-ingredient conversions | **NOT STARTED** | P0 | C8 | 6h | `v_missing_unit_conversions` drives the UI | **never offer a default conversion factor** |
| C11 | Recipes, lines, sub-recipes, labour | **NOT STARTED** | P0 | C10 | 10h | cycle prevention surfaced | — |
| C12 | Serving formats + variants (Gate 2 UI) | **NOT STARTED** | P0 | C11, A7 | 10h | capacity NULL renders as "not measured", never 0 | — |
| C13 | Costing screens — `v_recipe_cost_current`, `v_costing_blockers` | **NOT STARTED** | P0 | C11 | 8h | **incomplete shows a named blocker, never ₦0** | governing rule |
| C14 | Overhead configuration | **NOT STARTED** | P0 | A5 | 5h | pre-flight shows how many recipes go incomplete before enabling | design §11 point 2 |
| C15 | Pricing and margins — `v_price_check` | **PARTIAL** — screen built, incomplete recipes correctly priceless | P0 | C13 | 8h | no recommended price when incomplete | — |
| C16 | Trading — orders, order lines, finalisation, void/reissue, sales entries | **NOT STARTED** | P1 | C15 | 12h | finalised revenue immutable (`0014`) | — |
| C17 | Dashboards and reporting **PARTIAL — by period, by product, voided sales built** — `v_dashboard_waterfall`, `v_profit_by_product`, `v_profit_by_period`, `v_sales_unified`, `v_voided_sales` | **NOT STARTED** | P1 | C16 | 10h | `cost_coverage_pct` always shown beside profit | the reporting surface **is** specified: these five views |
| C18 | Subscription and account management screens | **NOT STARTED** | P0 | B8 | 6h | entitlement state visible and honest | — |
| C19 | Mobile / responsive | **PARTIAL** — built concurrently: bottom nav, card-collapse tables, 16px inputs | P0 | C4 | 8h | every P0 workflow usable at 360 px | — |
| C20 | Onboarding progress — `v_onboarding_status` | **NOT STARTED** | P1 | C6 | 3h | — | — |

## D. TRACK D — QUALITY AND RELEASE

| ID | Item | Status | P | Depends | Effort | Test requirement | Blocking condition |
|---|---|---|---|---|---|---|---|
| D1 | Suites `001`/`002`/`004`/`005` repaired for the `0020` contract — **DONE**, 154/154 with `0021` applied. Original text: broken on `0020` — suite 001 dies at line 87, *"An idempotency key is required for onboarding"* | **DONE** | — | — | 6h | all four green again | measured 25 Aug: 001→1, 002→7, 004→20, 005→5 errors, **identical with and without `0021`** — this is `0020` damage, not Gate 2 |
| D2 | `tests/010_anon_reference_read.sql` | **DONE** — 5 PASS | — | — | — | — | — |
| D3 | `tests/011_gate2_phase1.sql` | **DONE** — 33 PASS / 0 FAIL on 17.6 | — | — | — | — | — |
| D4 | `tests/003` real client role escalation | **DONE** — Gate 1 | — | — | — | — | — |
| D5 | Frontend workflow tests (E2E) | **NOT STARTED** | P0 | C4 | 10h | every P0 workflow end-to-end | — |
| D6 | Billing lifecycle tests | **NOT STARTED** | P0 | B7 | — | 11/11 | needs B1 |
| D7 | Production smoke tests | **NOT STARTED** | P0 | C4 | 4h | signup → onboard → cost a recipe, in production | — |
| D8 | Production monitoring | **NOT STARTED** | P1 | — | 4h | webhook failures alert | **no monitoring exists anywhere in the repo** |
| D9 | Rollback / recovery | **PARTIAL** — `docs/ROLLBACK.md` + idempotence guards (founder ruling C6); `0021` has a tested rollback | P1 | — | 3h | rehearsed once | no down-migrations for `0001`–`0012` by ruling |
| D10 | Re-verification of the whole chain (C7 single-run evidence) | **NOT STARTED** | P1 | A7 | 2h | ≈40 min run, PART_1–PART_5 | — |
| D11 | Launch acceptance suite | **NOT STARTED** | P0 | all | 6h | signed off before 1 Sep | — |
| D12 | Deployment procedure | **PARTIAL** — `deploy/PART_1`–`PART_5` + runbook exist for the database; **nothing for the frontend or Edge Function** | P0 | C4, B3 | 4h | — | — |

## E. BLUEPRINT REQUIREMENTS STILL OPEN

Source: `docs/MENU_MASTER_NG_AUDIT.md` §3, the 39-item traceability matrix.

| ID | # | Requirement | Status | P | Effort | Blocking condition |
|---|---|---|---|---|---|---|
| E1 | 27 | Channel commission affects economics | **PARTIAL** — `commission_pct` is stored **and selected in `v_price_check`**, but enters no calculation | **P0** | 4h | see Decision 3 |
| E2 | 23/24 | Costing-method change must be a dated event | **PARTIAL** — `costing_method_changes` exists, **is never written to**; a method change is a silent `UPDATE`, violating approved Decision 2 | P1 | 4h | see Decision 4 |
| E3 | 28 | Tax configuration | **PARTIAL** — `tax_mode`/`tax_rate` exist, **nothing reads them** | P1 | 6h | **conflict** — blueprint matrix calls it MVP scope, `GATE1_CLOSURE_REPORT.md` §3 defers it as P1.5. See Decision 5 |
| E4 | 31 | Closed periods immutable | **PARTIAL** — `period_closes` exists, **nothing writes to it, nothing enforces it** | P1 | 6h | see Decision 6 |
| E5 | 39 | Stock lots, production, waste, finished goods, supplier balances | **Correctly absent** | P2 | — | out of scope by the governing rule |
| E6 | P1.7 | Synchronous recompute fan-out | **NOT STARTED** | P2 | — | scale risk, not correctness |
| E7 | P1.6 | Down-migrations | **Closed by ruling C6** | P2 | — | `ROLLBACK.md` accepted instead |

## F. VERIFIED COMPLETION

Counted on the register's own rows: **DONE** = 1.0, **AUTHORED NOT DEPLOYED** =
0.5, **PARTIAL** = 0.25, everything else 0. "Code written" is not DONE — a row
reaches 1.0 only when implementation, migration where applicable, security/RLS,
frontend integration where applicable, validation, automated tests and
documentation are all complete.

| Track | Items | Verified | % |
|---|---|---|---|
| A — data platform | 11 | 3.0 | **27%** |
| B — billing | 10 | 1.0 | **10%** |
| C — product/frontend | 20 | 7.0 | **35%** |
| D — quality/release | 12 | 5.0 | **42%** |
| E — blueprint residue | 7 | 3.5 | **50%** |
| **Overall** | **60** | **19.5** | **33%** |

Movement this block: Track C +25 (scaffold, auth, onboarding, ingredients,
pricing, reports, mobile), Track D +9 (154/154 restored), Track E +21 (tax,
commission, period close and method audit all designed against approved
rulings).

The database layer beneath this (migrations `0001`–`0020`, Gate 1 at 154/154)
is complete and deployed; it is not counted here because this register tracks
only what remains between today and launch.
