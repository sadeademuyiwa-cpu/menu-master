# GATE A — EXECUTION PLAN

**Target: 1 September 2026. Public product and trial launch. No path accepts
money.** Planning only — nothing here has been executed.

---

## 0. Dependency verification: are `0031` / `0032` prerequisites?

Asked explicitly, and the answer is **not the one the abbreviated critical path
implied.**

| Dependency type | Meaning |
|---|---|
| **Schema** | A cannot be created without B's tables or columns |
| **Runtime** | A's code calls B's functions when it executes |
| **Launch** | Gate A cannot be honest or safe without it |
| **Billing-only** | Needed only once money moves |

### The finding

**`0033` as designed *does* depend on `0031`.** Its columns are
`billing_interval → billing_intervals(code)`, `billing_plan_price_id →
plan_prices(id)` and `scheduled_plan_price_id → plan_prices(id)`. Those are
**hard schema dependencies**, and starting the critical path at "`0033`" quietly
assumed otherwise. Beginning there, the migration would have failed at the first
foreign key.

Gate A does not need those columns. It needs **one thing** from the `0033`
design: `subscription_changes`, for D-25's audit. The rest is plan-and-price
machinery that matters only when money moves.

| Migration | Schema dep | Runtime dep | Launch dep | Verdict |
|---|---|---|---|---|
| **`0031` pricing foundation** | none | none | **no** | **billing-only.** It also rewrites `fn_billing_apply`'s plan resolution — live billing code. Touching that for a launch that takes no money is unnecessary risk. |
| **`0032` founding allocations** | none | none | **no** | **billing-only.** A slot is claimed on payment; no payment exists in Gate A. |
| **`0033` subscription state** | **on `0031`** | — | **partially** | **split required** |
| **`0034` entitlement** | none beyond `subscriptions` | none | **yes** | **Gate A** |

### Resolution: split, and renumber

`subscription_changes` has no pricing dependency at all. Splitting it out gives
Gate A a path with **zero** dependency on pricing or founding.

Migrations apply in number order and `0001`–`0030` are strictly sequential, so
**Gate A must take the next numbers.** Proposed remap — a change to the
previously stated sequence, needing your approval:

| Old | New | Gate |
|---|---|---|
| *(split out of `0033`)* | **`0031_subscription_change_log`** | **A** |
| `0034` entitlement | **`0032_entitlement_final`** | **A** |
| *(new, minimal)* | **`0033_notification_outbox_minimal`** | **A** |
| `0031` pricing foundation | `0034` | B |
| `0032` founding + reservations | `0035` | B |
| `0033` remainder (plan/price columns, `fn_effective_plan`) | `0036` | B |
| `0035` charges | `0037` | B |
| `0036` scheduler core | `0038` | B |
| `0037` notification model (full) | `0039` | B |
| `0038` plan limits | `0040` | B |
| `0039` proration | `0041` | B |

---

## 1. Gate A sequence

### Step 1 — `0031_subscription_change_log` · risk **LOW**

**Contents.** `subscription_changes`: subscription, account, `change_kind`,
previous and new values as jsonb, **`change_source` ('customer' \| 'provider' \|
'owner')**, **`authorised_by`**, `reason`, `effective_at`, `created_at`.
Append-only — INSERT granted, UPDATE and DELETE granted to nobody. RLS: tenant
SELECT, service-role INSERT. `unique (subscription_id, effective_at,
change_kind)`.

`change_source` and `authorised_by` exist because D-26 §6 requires an
**owner-authorised** change to be recordable. Without them the D-25 extension is
auditable in form only.

**Depends on.** `subscriptions`, `accounts` — both since `0001`. **Nothing else.**

**Tests before production.** New suite `021`: append-only holds for every
non-owner role · tenant isolation · service-role INSERT works · the unique key
rejects a duplicate · an owner-source row round-trips with `authorised_by`. Plus
all 20 existing suites unchanged, on the replica.

**Rollback.** `drop table subscription_changes` — new, no dependants, no data.

**Production verification.** Object counts before/after · grants (INSERT only for
service_role, SELECT for authenticated, **no** UPDATE/DELETE to anyone) · policy
count elsewhere unchanged · `count(*) = 0`.

---

### Step 2 — `0032_entitlement_final` · risk **HIGH**

**The highest-risk step in Gate A.** `fn_account_is_entitled` is referenced by
**60 write policies across 23 tables**. A wrong predicate does not error — it
silently changes who can write.

**Contents.**
1. `billing_config` — append-only, effective-dated, one authoritative
   `payment_failure_grace`; a change is an INSERT preserving who, when and why.
2. **Preflight**: count `subscriptions where current_period_end is null`. **If
   non-zero, raise and stop.** No silent rewrite of anomalous production data.
3. `fn_account_is_entitled` replaced **once**, carrying D-3, R4/D-11 and D-26 —
   a whitelist of four named statuses with the owner's final NULL rules (§2).
4. `check (current_period_end is not null)` — **only if** the preflight found zero.
5. `v_billing_anomalies` — NULL-boundary rows, visible immediately.
   **`reconciliation_items` stays Gate B**; a view needs no table, no writer, no job.
6. **`fn_my_entitlement_status()`** — §3.

**Depends on.** `subscriptions` and `0028`'s function. **Not** on pricing or
founding.

**Tests.** `tests/018` checks 3 and 10 updated for the changed rule — *the rule
changed; the test is not being weakened*, and the header must say so. New cases
for **all twelve truth-table rows**, each asserting write allowed/denied **and**
read always allowed. `019` and `020` re-run. **All 20 existing suites pass
unchanged** — 154/154, or the step does not ship.

**Rollback.** Restore `0028`'s definition (recorded verbatim in the header before
replacement); drop the constraint, `billing_config` and the view. Reversible
because the signature never changes.

**Abort if.** Any existing suite regresses · the preflight finds NULL rows not
first resolved by evidence · the post-deploy function fingerprint differs from
the intended text · any policy's `qual` or `with_check` changed — nothing should,
only the function body moves.

**Production verification.** A **definition fingerprint** of
`pg_get_functiondef`, not a count — the lesson from the superseded `0021` build,
where counts passed while a constraint differed · 60 policies still reference the
function · policy count unchanged · the twelve truth-table rows probed against a
disposable tenant · `billing_config` has exactly one row.

---

### Step 3 — `0033_notification_outbox_minimal` · risk **MEDIUM**

**Larger than "send an email", and the plan should not pretend otherwise.**
Making trials genuinely expire (Step 2) without telling anyone is the failure
this whole session has been avoiding.

**Contents.** A deliberate subset of D-9: `notification_outbox` (email only —
account, `type_code`, `dedupe_key` unique, `template_key`, `template_version`,
`payload_vars`, status, attempts, `next_attempt_at`, timestamps, `provider_code`,
`provider_message_id`) and `notification_attempts`. **No WhatsApp, no
`provider_operations`, no consent table** — nothing only billing needs.

**Not `pg_cron`.** Gate A uses the D-1 §9 fallback: **one scheduled Edge
Function**, needing no extension and no production database change. `pg_cron`
arrives with the full scheduler in Gate B. `pg_net` stays off.

**Two types only:** trial ending (T−3), trial ended (T+0).

**Tests.** The dedupe key rejects a second queue of the same notice · a failed
send retries without duplicating · **no billing predicate reads outbox status**,
asserted by searching the entitlement function's source — so the D-9 invariant is
verified rather than promised.

**Rollback.** Unschedule the function; drop both tables. Nothing references them.

**Production verification.** A test tenant with a trial ending in 3 days produces
exactly one queued row · re-running the scan produces none · the drainer marks it
sent · entitlement is unchanged throughout.

---

### Step 4 — Track C launch screens · risk **HIGH**

**The dominant Gate A risk, and larger than the migrations.**

Inventory read from the repository rather than recalled — **9 page files**:

```
built:  landing · signup · login · verify-email · onboarding
        dashboard · ingredients · pricing (recipe price-check) · reports
```

Missing, and required for a costing product to be usable:

| Missing | Why it is not optional |
|---|---|
| **recipes** — create/edit, lines, labour, overheads | **The core of the product.** There is no way to create a recipe. |
| units and conversions | the local moat; "2 paint of rice" resolves nowhere without it |
| suppliers and ingredient prices | prices are read-only today; there is no entry path |
| business settings | costing method, target margin, rounding |
| serving formats and variants | Gate 2's entire delivered capability is unreachable |
| **trial-ended state** | §3 |

One good finding: **`/pricing` is the recipe price-check screen, not a
subscription page.** No Paystack reference, no checkout. There is **no
subscription checkout surface in the frontend at all** — a fifth independent
reason no path accepts money.

**Recommendation.** This is where the five days actually go. The migrations are
about two days of careful work; **recipes alone is more than that.**

---

### Step 5 — email provider and domain verification · risk **LOW / elapsed-time**

Code is hours. **DNS propagation and sender warm-up are days and cannot be
compressed.** §5.

---

## 2. Case 11 — final ruling recorded

`provider_ref` is **not** an access-control primitive.

| Status + NULL boundary | Write | Read | Reconciliation |
|---|:---:|:---:|:---:|
| `trialing` | **✗** | ✓ | ✓ |
| `active` | **✓** *(temporary)* | ✓ | ✓ |
| `past_due` | **✓** *(temporary)* | ✓ | ✓ |
| `cancelled` | **✗** | ✓ | ✓ |
| unrecognised / invalid | **✗** | ✓ | ✓ |

`cancelled` is **terminal for current entitlement** and does not regain write
access because provider metadata happens to exist. The predicate drops its
`provider_ref` conjunct entirely — simpler, and one fewer field carrying implicit
authority.

## 3. Entitlement must be queryable, not only enforced

A gap this plan exposes: when Step 2 makes trials expire, **the UI has no way to
know.** It discovers the fact by a write failing with a bare RLS error — the same
opaque database error we ruled against for plan limits, arriving earlier by a
different route.

**`fn_my_entitlement_status()`** returns `entitled`, `status`, `boundary` and a
machine-readable `reason` for the calling account, so the app renders "your trial
ended on 14 September — everything you entered is still here" instead of failing.
It reads only the caller's own row and grants no access.

In Step 2. Without it, Step 4 has no honest trial-ended state to build.

## 4. What genuinely blocks Gate A

| Blocks Gate A | Moves to Gate B | Post-billing |
|---|---|---|
| Steps 1–5 · **D-3 classification** (owner-run) · **D-25 Phase 1** · **founding position notice** | D-7 VAT · `0034`–`0041` · D-8 · D-20 · D-21 · founding Phase 2 · WhatsApp/V-4 · U-3/U-4/U-5 · V-3/V-6 · D-22/D-23 | V-2 · V-5 · V-7 · D-15 · D-16 · trading screens |

The classification is a Gate A blocker for two reasons at once: Step 2's
preflight needs to know whether NULL rows exist, and D-25 Phase 1 cannot select
accounts without it.

**`0040` (plan limits) stays in Gate B, so launch copy must omit the trial's
numerical limits** — 1 business, 2 users, 20 recipes — until it is deployed. No
product promise ahead of enforcement.

## 5. Start immediately — elapsed time, not coding time

| | Why it cannot be compressed |
|---|---|
| **Email sender domain verification** | DNS propagation plus reputation warm-up. **On the Gate A critical path.** Start today. |
| **D-7 VAT adviser** | Weeks of someone else's calendar. Gate B, but the longest pole on the board. |
| **Meta WhatsApp verification + template approval** | Weeks. Gate B. |
| **Paystack account standing** | If business verification is needed before live plans can be created, that is elapsed time nobody can code around. Confirm now, not at Gate B. |

## 6. Recommended first action

**Run the D-3 classification query** (`D24_PRE_LAUNCH_ACCOUNTS.md` §5).

Read-only, a minute's work, and **Step 2 cannot be written without it** — the
migration either adds `check (current_period_end is not null)` or it does not,
and that turns entirely on whether NULL rows exist. It simultaneously delivers
the D-24 classification that D-25 Phase 1 and the founding notice both wait on.

**In parallel, the same day:** start **email sender domain verification** — the
only Gate A item where the clock, not the work, is the constraint.

**First migration to author: `0031_subscription_change_log`** — lowest risk, no
dependencies, and it is what makes Step 2's D-25 extension auditable.

**Nothing is executed until you approve.**
