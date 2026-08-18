# MENU MASTER NG — GATE 1 REPORT
## Authorization Hardening

Method: fix, rebuild from 0001, then attack the repaired database as a real `authenticated` client with forged JWT subjects. Nothing here is asserted from reading SQL.

---

# 1. CHANGES MADE

| File | Status | Purpose |
|---|---|---|
| `migrations/0012_gate1_authorization_hardening.sql` | **NEW** | All four P0 fixes. Additive. No earlier migration rewritten |
| `tests/002_gate1_attack_and_regression.sql` | **NEW** | 54 attack, bypass and regression tests |
| `tests/003_real_client_role_escalation.sql` | **NEW** | Escalation tests from a genuine restricted client connection |
| `tests/0000_local_supabase_shim.sql` | amended | Added an `authenticator` LOGIN NOINHERIT role so tests run as a real client, not a superuser |

Migrations 0001 to 0011 are untouched.

## What 0012 contains

**Authorization primitives:** `fn_is_service_context`, `fn_has_account_role`, `fn_require_member`, `fn_require_cost_access`, `fn_require_account_role`.

**P0-1, costing and conversion RPCs rewritten with guards:** `fn_ingredient_unit_cost`, `fn_ingredient_usable_unit_cost`, `fn_resolve_qty_to_base`, `fn_recipes_using_ingredient`, `fn_compute_recipe_cost_snapshot`, `fn_recompute_recipes_for_ingredient`.

**P0-2, purchase authorization:** `fn_post_purchase` and `fn_reverse_purchase` now require `owner` or `manager` **on the account derived from the purchase row itself**, and take a row lock. `fn_purchase_blockers` requires membership.

**P0-3, membership:** the single `FOR ALL` policy replaced with four per-command policies where INSERT, UPDATE and DELETE require an existing `owner`. Added `fn_guard_last_owner` so an account cannot be orphaned. `fn_create_account_and_business` now refuses to mint an owner membership for anyone but the caller. `fn_clone_starter_catalog` requires owner.

**P0-4, subscriptions:** DML revoked from `authenticated`; policy reduced to SELECT; `trg_subscriptions_guard` blocks client writes; `fn_set_subscription_plan` is the service-only path; `plans.is_self_serve_trial` permits exactly one trialing self-signup row and nothing else.

**Sweep:** EXECUTE revoked from trigger functions and internal guards.

---

# 2. ROOT CAUSE

Three distinct design failures, all of the same family: **authority was taken from the request instead of from the data.**

**A. Functions trusted their arguments.** Every vulnerable function accepted a business or ingredient ID and used it to scope a query, never asking whether the caller had any relationship to it. Because they were `SECURITY DEFINER`, RLS — the only control that did check — was switched off inside them. Migration 0011 then granted EXECUTE to `authenticated`, publishing the bypass.

The corrected rule, applied uniformly in 0012: **derive the owning account from the target row's own relational chain, then authorize the caller against that account.** A caller-supplied ID can now only ever narrow a query, never widen authority.

**B. The row that grants authority was writable by those it governs.** `memberships` was protected by "are you in this account", which every member satisfies. Since `fn_can_see_costs` reads `memberships.role`, a cashier could grant themselves the role the check was designed to test. A correct check downstream of a writable input is not a check.

**C. Entitlement was treated as ordinary tenant data.** `subscriptions` sat under the same generic policy as recipes, so plan state was client-writable.

---

# 3. SECURITY MODEL AFTER FIX

Four layers, each independently sufficient for what it covers:

1. **RLS** on all 33 tenant tables gates direct table access by `account_id`.
2. **Composite foreign keys** (37, from 0004) make a cross-account reference a constraint violation rather than a policy question.
3. **RPC guards** in every `SECURITY DEFINER` function: resolve the account from the target row, then `fn_require_member`, `fn_require_cost_access` or `fn_require_account_role`.
4. **Role-aware write policies** on the two tables that confer authority, membership and subscription.

Authorization failures **raise** rather than return NULL. In this system NULL already means "not entered"; a locked door must be distinguishable from an empty room.

## The service context, and a correction I had to make mid-Gate

My first implementation defined service context as `current_user not in ('authenticated','anon')`. **That was wrong and it disabled every guard I had just written.** Inside a `SECURITY DEFINER` function, `current_user` is the function *owner*, so every call reported itself as the billing system. Proven directly:

```
INSIDE SECURITY DEFINER, caller is authenticated:
  current_user           = postgres
  session_user           = postgres
  role GUC               = authenticated
  fn_is_service_context  = true      <-- wrong
```

The first attack run failed 14 of 54 tests because of it. The fix uses the `role` GUC, which `SET ROLE` sets at the connection edge and `SECURITY DEFINER` does not change, **plus** the absence of an end-user JWT subject:

```sql
select coalesce(current_setting('role', true), 'none') not in ('authenticated','anon')
   and coalesce(current_setting('request.jwt.claim.sub', true), '') = '';
```

The second clause is defence in depth. `authenticator` is granted `service_role`, so anyone reaching a raw SQL channel could `SET ROLE service_role`. Test 003 confirms that even then, while holding a user JWT, `fn_is_service_context()` returns **false**.

---

# 4. EXPLOIT RESULTS

## The five original exploits

| Test | Before | After | Result |
|---|---|---|---|
| Cross-tenant costing | Vulnerable | Blocked | **PASS** |
| Cross-tenant conversion | Vulnerable | Blocked | **PASS** |
| Cross-tenant purchase reversal | Vulnerable | Blocked | **PASS** |
| Self-promotion to owner | Vulnerable | Blocked | **PASS** |
| Self-upgrade of subscription | Vulnerable | Blocked | **PASS** |

## Full attack matrix: 54 of 54 blocked or correct

**Attack A, costing RPC (4/4 BLOCKED)**
- A1 B calls costing RPC with A's ingredient and A's business
- A2 B mixes A's ingredient with its own business ID
- A3 B calls the usable-cost variant on A's data
- A4 NULL business ID does not leak

**Attack B, conversion RPC (2/2 BLOCKED)**
- B1 B reads A's private paint-to-kg conversion
- B2 cashier probes whether A's conversion exists

**Attack C, purchase reversal (4/4 BLOCKED)**
- C1 B reverses A's posted purchase
- C2 cashier reverses A's posted purchase
- C3 A's purchase verified untouched: still `posted`, zero reversed price rows, cost still ₦15/g
- C4 kitchen role **inside its own account** cannot reverse

**Attack D, self-promotion (8/8 BLOCKED)**
- D1 cashier inserts an owner membership for self
- D2 cashier updates own role to owner (verified by reading the stored role, not by absence of an error)
- D3 cashier grants self owner of another account
- D4 kitchen user updates own role
- D5 forged account ID rejected
- D6 cashier mints an owner membership for a different user via onboarding
- D7 cashier holds no owner row anywhere afterwards
- D8 owner of B cannot add members to A

**Attack E, subscriptions (7/7 BLOCKED)**
- E1 cashier upgrades own plan
- E2 **owner** upgrades own plan directly
- E3 owner inserts a second paid subscription
- E4 owner deletes subscription to escape billing
- E5 client calls the billing function directly
- E6 plan verified unchanged, still `trial`
- E7 self-signup cannot mint a paid plan through the trial carve-out

**Bypass attempts beyond the originals (14/14 BLOCKED or correct)**
- X1, X2 direct SELECT on A's prices and snapshots return zero rows
- X3 join from recipes into cost_snapshots reaches zero A snapshots
- X4 enumerate A's recipes via the dependency RPC
- X5 read A's purchase contents via the blockers RPC
- X6 write a snapshot into A's ledger
- X7 mass recompute across A
- X8 post A's draft purchase
- X9 pollute A's catalogue
- X10 insert a forged price row into A
- X11 kitchen role reads cost **in its own account**
- X12 kitchen role direct-reads prices in its own account
- X13 no JWT subject at all
- X14 client cannot claim service context

**Real-client escalation, test 003**
- `SET ROLE postgres` → `ERROR: permission denied to set role "postgres"`
- `SET ROLE service_role` while holding a user JWT → SET succeeds, but `fn_is_service_context()` = **false**
- Genuine service call with no user JWT → `fn_is_service_context()` = **true**

---

# 5. LEGITIMATE WORKFLOW RESULTS

All 8 regression tests pass, plus 7 in-suite legitimate-path checks.

| Workflow | Result |
|---|---|
| L1 B costs its own ingredient (₦35,000 / 3,500g = ₦10/g) | ✅ |
| L2 B resolves its own paint conversion (3,500g) | ✅ |
| L3 A's owner reverses A's own purchase | ✅ |
| L4 owner adds a manager to own account | ✅ |
| L5 owner changes a member's role | ✅ |
| L6 last owner cannot be deleted | ✅ |
| L7 billing system upgrades a plan | ✅ |
| R1 B computes its own recipe snapshot | ✅ |
| R2 B's dish costs correctly: 800g @ ₦10/g ÷ 4000 × 400 = **₦800** | ✅ |
| R3 B creates an order | ✅ |
| R4 **cashier** records a sale line | ✅ |
| R5 the sale froze cost ₦800 **without the cashier being able to see it** | ✅ |
| R6 B adds its own unit conversion | ✅ |
| R7 A's owner still reads own costs after all attacks | ✅ |
| R8 a brand new user can self-onboard | ✅ |

R5 is the one worth noting: the freeze runs inside a trigger executing as the definer, so a sales-role user records a sale and COGS is captured correctly while that user still cannot read a single cost figure. The role model and the costing model do not fight each other.

**One regression was caused by my own fix and caught by these tests:** the first version of the subscription guard blocked onboarding, because self-signup legitimately creates a trial row. Fixed with `plans.is_self_serve_trial`, permitting exactly one `trialing` row on a self-serve plan and nothing else. E7 proves the carve-out cannot be used to mint a paid plan.

---

# 6. MIGRATION REBUILD RESULT

**0001 → 0012 rebuilds successfully from an empty database.** Executed four times during Gate 1.

```
  ok  0001_init.sql
  ok  0002_add_container_unit.sql
  ok  0003_seed_catalog.sql
  ok  0004_integrity_and_security_fixes.sql
  ok  0005_unit_conversion_engine.sql
  ok  0006_purchase_posting.sql
  ok  0007_recipe_cost_engine.sql
  ok  0008_snapshot_and_pricing_engine.sql
  ok  0009_sales_freeze_and_profitability.sql
  ok  0010_onboarding.sql
  ok  0011_grants_and_api_surface.sql
  ok  0012_gate1_authorization_hardening.sql
ALL MIGRATIONS APPLIED
```

**Suite 001 (correctness and isolation): 26 / 26 PASS.** The costing engine, completeness gate, snapshot immutability and sales freeze are unaffected by the authorization work.

**Suite 002 (Gate 1 attack and regression): 54 / 54 PASS.**

---

# 7. NEW VULNERABILITIES FOUND DURING THE SWEEP

**No new P0 was found in the existing system.**

One P0-class defect was found **in my own Gate 1 fix, before it shipped**: the `current_user` service-context flaw described in section 3. It is reported here rather than quietly corrected, because it is the clearest possible illustration of why this gate required attacking the database rather than reviewing the SQL. The fix looked correct. It was inert.

**Residual risk, partially UNVERIFIED:** `authenticator` is granted `service_role`, so a raw SQL channel would allow `SET ROLE service_role`. PostgREST does not expose raw SQL, and the JWT-subject clause blocks the escalation anyway (test 003). What I cannot verify locally is Supabase's production `authenticator` configuration and its default privilege grants. **Marked UNVERIFIED — requires testing against the real Supabase project.**

**Sweep note:** three functions (`fn_can_resolve_unit`, `fn_ingredient_usable_unit_cost`, `fn_create_account_and_business`) contain no literal guard call. All three are guarded by delegation and are proven blocked by tests B2, A3 and D6 respectively.

---

# 8. REMAINING P1 / P2 ISSUES — TRACKED, NOT FIXED

Deliberately untouched in Gate 1.

## P1
1. **Historical revenue is mutable.** `order_lines.unit_price` and `qty` are editable after a sale; no order finalisation; no delete guard. Cost is frozen, revenue is not.
2. **Recipe variants missing.** `recipes.portion_qty` is a single scalar, so 1.5L / 2.5L / 4L / 5L cannot be modelled without duplicate recipes or corrupted per-portion COGS. Cheapest to fix before real sales data exists.
3. **Zero-amount purchase produces a real ₦0 cost**, indistinguishable from a priced ingredient.
4. **Write-side role enforcement absent.** 24 tables still use `FOR ALL`, so a kitchen user can delete recipes, edit business settings and change targets. Gate 1 fixed only the two tables that confer authority.
5. **Tax is in locked MVP scope and unimplemented.**
6. **Migrations are not idempotent, and have no down-migrations.**
7. **Synchronous recompute fan-out** remains a timeout risk.
8. **Three stale artifacts** still present, two of which are broken copies of live migrations.

## P2
Snapshot tie non-determinism; 40+ unindexed foreign keys; per-row RLS function calls not wrapped in `(select ...)`; UTC date boundary versus Africa/Lagos; `costing_method_changes` unwired; `period_closes` unenforced; channel commission unused; direct reversal stamping; recipe hard-delete contradiction; soft-delete filtering in views; plan limits unenforced.

---

# 9. GATE 1 VERDICT

## 🟢 GATE 1 PASSED

| Condition | Met |
|---|---|
| All four original P0 exploits blocked | ✅ Proven by execution |
| No new P0 remaining in the tested surface | ✅ Sweep clean; one defect found in the fix itself and corrected |
| Legitimate workflows still function | ✅ 15 / 15 |
| Migrations rebuild successfully | ✅ 0001 → 0012 |
| Database attacked again after the fixes | ✅ 54 attack and bypass tests |

**Stopping here as instructed.** No Gate 2 work, no P1 work, no application layer.

One item for your decision before Gate 2: the UNVERIFIED residual in section 7 can only be closed against the real Supabase project. If you can create a throwaway Supabase project, I can give you a short script that runs the same attacks against it and proves the boundary in the environment that actually matters.
