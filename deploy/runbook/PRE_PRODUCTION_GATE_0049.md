# PRE-PRODUCTION GATE — 0049

**Status: PREPARED AND REHEARSED. NOT AUTHORISED. NOTHING RUN AGAINST PRODUCTION.**

Date 2026-09-04 · branch `claude/menu-master-ng-migrations-3faerm` · **not pushed** (the branch is Vercel-production-tracked and pushing it
deploys).

Every number below comes from a local production-faithful replica of the
production catalogue at migration 0048 — PostgreSQL 17.6, function-catalogue
fingerprint `e24f3871788893cafd1fc17c70fe41d5`, the same value production
returned on 2026-08-31. No production connection was opened.

---

## 1. Exact files changed

| File | Lines | Status |
|---|---|---|
| `migrations/proposed/0049_billing_tiers_and_founders.sql` | 523 | new · md5 `6640bc6c1ed71315b814af1b6af15776` |
| `migrations/proposed/0049_rollback.sql` | 174 | new · md5 `1cc293cad6870420ff808417559b789c` |
| `tests/035_billing_tiers_and_founders.sql` | 298 | new |
| `tests/018_entitlement.sql` | +5 −2 | modified — see §8 |
| `deploy/runbook/PRE_DEPLOY_0049.sql` | 86 | new · read-only, 18 checks |
| `deploy/runbook/POST_VERIFY_0049.sql` | 111 | new · read-only, 20 checks |
| `deploy/runbook/DEPLOY_0049.md` | 109 | new |
| `deploy/runbook/evidence/REHEARSAL_0049.txt` | 201 | new · raw output |
| `scripts/atomicity_check.sh` | 71 | new |
| `scripts/founder_concurrency_check.sh` | 48 | new |
| `scripts/regression_0049.sh` | 44 | new |

**No application code changed.** Nothing under `web/` is touched, and no
frontend file references `price_kobo`, `founder_slots`, `fn_account_has_sales`
or founding pricing. The deployed frontend is unaware of 0049 except through
RLS. Existing web unit tests: 34/34 pass, unchanged.

## 2. Exact migrations created

One forward migration and one rollback. Nothing else.

`0049` adds two tables (`founder_slots`, `founding_price_policy`), three columns
to `plans`, five to `subscriptions`, two plan rows, four functions, and rewrites
13 RLS write policies. It updates and deletes **no existing row**, and reads and
writes **no `auth.users` row**.

Prices are stored as integer kobo because Paystack transacts in kobo and
integers have no rounding. `monthly_price` is left in place for display.

| plan | tier | price_tier | price_kobo | display |
|---|---|---|---|---|
| `costing` | costing | standard | 750000 | ₦7,500 |
| `trading` | trading | standard | 1500000 | ₦15,000 |
| `founding_costing` | costing | founding | 350000 | ₦3,500 |
| `founding_trading` | trading | founding | 750000 | ₦7,500 |
| `trial` | trial | trial | 0 | free, full product |

`founding_price_policy` records the owner's two rulings as data, not as
behaviour to be inferred: `forfeit_on_lapse = true`,
`slot_returns_to_pool = false`.

## 3. Policy before / after inventory

**116 → 117.** The complete diff over every policy in the schema, nothing
elided:

```
13 policies gain the conjunct fn_account_has_sales(account_id):
  channels.p_channels_insert / _update / _delete
  customers.p_customers_insert / _update / _delete
  orders.p_orders_insert / _update / _delete
  order_lines.p_order_lines_insert / _update / _delete
  sales_entries.p_sales_entries_insert

1 policy is new:
  founder_slots.p_founder_slots_select   [SELECT, read-only]

0 other policies differ in any way.
```

Each of the 13 keeps its original role array (`{public}`) and its original
role-name conjunct — `owner`/`manager` on inserts and updates, `owner` alone on
deletes, `owner`/`manager`/`sales` on `sales_entries`. One conjunct is appended;
nothing is removed or widened.

**The five Sales SELECT policies are deliberately untouched.** An account that
downgrades from Costing + Sales keeps reading its own trading history and simply
cannot record anything new. Test 12 of the new suite asserts this by reading
back `1 order(s) still visible` after a downgrade.

`founder_slots` grants `authenticated` **SELECT only**, so the checkout page can
say how many slots remain. Nobody can write it; allocation happens only through
`fn_claim_founder_slot`, which `authenticated` cannot execute. The anon grant
surface is byte-identical to 0048 — 0049 grants a logged-out caller nothing.

## 4. Test results — new suite

`tests/035_billing_tiers_and_founders.sql`: **34 / 34 PASS.** Full output in
`evidence/REHEARSAL_0049.txt` §6. Coverage:

* Costing cannot record a sale, add a customer, or add a channel — and can still
  do costing work
* Costing + Sales can do all of it
* a live trial gets the **full** product including Sales; an expired trial is
  blocked from Sales **and** from costing writes
* Founding Costing behaves as Costing; Founding Costing + Sales as Costing + Sales
* a downgrade still **reads** its own sales history; it cannot record new ones
* an upgrade works immediately
* `past_due` inside the dunning grace can still sell; beyond it cannot
* `cancelled` but paid-up can still sell; past the period end cannot
* exactly 100 slots exist and a 101st cannot be inserted
* claiming twice returns the same slot, not two
* no more than 100 can ever be held; **customer 101 is refused**
* a lapse forfeits founding pricing, the slot **never** returns to the pool, and
  a forfeited founder cannot reclaim it by resubscribing
* `authenticated` cannot allocate a slot; `anon` cannot call the entitlement
  function
* the four approved prices are present in kobo; no active paid plan is ₦0
* exactly 13 write policies check the tier and exactly 0 read policies do

## 5. Regression results

Every SQL suite in `tests/`, run twice — once on a 0048 database and once on the
same database with 0049 applied, each suite getting a virgin copy. The
comparison is the evidence, because several suites are historical and were never
expected to pass at head.

**34 pre-existing suites identical. 0 regressions.**

Seven suites produce no machine-readable summary at either 0048 or 0049 and are
unchanged by this work: `003`, `006`, `007`, `008`, `009`, `010`, `012`. They
depend on Supabase-console fixtures that do not exist locally (`006`, `007`,
`009`) or re-apply an era-specific migration that head refuses (`012`).

Three suites carry pre-existing failures **identical at 0048 and at 0049** —
`011` (1), `015` (3), `017` (1). They predate this work and 0049 neither causes
nor fixes them. `010` check 4 reports the anon SELECT surface as six tables
rather than five; also pre-existing, and 0049 adds nothing to it.

Web unit tests: **34 / 34 pass**, no web file changed.

## 6. Migration atomicity result

A failure was injected at four points and each injection was **asserted to have
actually fired** — an injection that lands inside a dollar-quoted body becomes a
string literal and silently proves nothing, which caught me once during this
rehearsal.

| Failure injected where | Error fired | Schema afterwards |
|---|---|---|
| the new tables exist and are seeded | yes | **byte-identical to 0048** |
| all columns, constraints, plan rows and slots are in | yes | **byte-identical to 0048** |
| **an RLS write policy is dropped and not yet recreated** | yes | **byte-identical to 0048** |
| every change made, one statement from COMMIT | yes | **byte-identical to 0048** |

Baseline and all four results: fingerprint `5fe622f29fd2f916b0e08fa810cb3291`,
2445 lines, covering columns, function bodies, view definitions and
`reloptions`, grants, policies, triggers, constraints and composite types. After
four aborted attempts the clean file still applies.

**Rollback fidelity:** apply 0049, then `0049_rollback.sql` — the fingerprint
returns to `5fe622f29fd2f916b0e08fa810cb3291`, byte-identical to a database that
never saw 0049.

### The executor is part of the guarantee

That result holds **only** under `psql --single-transaction`. Run through an
autocommit executor — which is what the Supabase SQL Editor is — the same file
with the same injected failure previously left **68 catalogue differences**
behind, including `p_orders_insert` dropped and never recreated, i.e. orders
unwritable by anyone.

0049 therefore now opens by detecting a non-transactional executor and aborting:

```
ERROR:  0049 ABORT: this executor is not honouring transaction control
        (each statement is committing on its own). Do NOT run 0049 here.
        Run it with psql --single-transaction over the Session Pooler.
```

Rehearsed: under autocommit the fingerprint is unchanged, `founder_slots` does
not exist, `p_orders_insert` is still present. The guard fires before a single
object is touched. It costs two statements and closes the exact hole that left
this project's production database part-migrated once already.

## 7. Founder concurrency result

A loop inside one transaction proves the cap but not the concurrency. This runs
genuinely parallel client processes racing for the same hundred rows and then
asks the database what it actually allocated.

**180 claimants · 30 parallel OS processes · 100 slots**

```
slots held               | 100
distinct slots held      | 100
accounts holding a slot  | 100
claims that got a seq    | 100
claims refused (null)    | 80
any seq issued twice?    | NO
any account with 2 slots?| NO
slot seqs allocated      | 1..100
```

The cap is not `count(*) < 100`, which two concurrent claimants can both pass.
Exactly 100 rows exist and a CHECK constraint stops a 101st from being created,
so **customer 101 cannot be sold founding pricing however the race falls**.
`FOR UPDATE SKIP LOCKED` makes concurrent claimants take different rows instead
of queueing on one; a unique index on `account_id` stops one account holding
two. When nothing is free the function returns `null` and the caller must fall
back to standard pricing — it never invents a slot.

## 8. Two findings the rehearsal surfaced, and what was done

Reported rather than fixed silently, per the standing rule.

**(a) `fn_account_has_sales` violated the project's own function-surface
invariant.** `tests/034` asserts that every `SECURITY DEFINER` function taking an
account id refuses a caller who is not a member of it — the rule exists because
one such function had previously been a cost-reading service for anybody able to
guess an account id. As first written, `fn_account_has_sales` was definer, took
`p_account_id`, and checked nothing, so any signed-in user could ask whether an
arbitrary business had paid for Sales.

`034` has a by-name exemption list for the authorization primitives, and
`fn_account_is_entitled` is on it — adding its twin would have been the
one-line option. **The gate was not touched.** The function now requires
`fn_is_service_context() or fn_is_account_member(p_account_id)`. Inside the 13
policies the membership check is already the neighbouring conjunct, so behaviour
there is unchanged; the point is that the function is safe when called directly,
not merely safe in the one place it is called from today. `034` is back to 6/6
without modification.

**(b) `tests/018` check 14 pinned the policy count at 116.** 0049 declares
exactly one new policy, so the count is 117 and the test failed. This is a stale
constant, not a defect: the check's purpose is *"the count moved only by what the
migrations declare"*. It now names 0049's declared +1 alongside 0031/0032's, with
the reasoning written down. No assertion was loosened — the value is still an
exact allow-list, not a range.

## 9. Risks remaining

**R1 — 0049 changes what an existing `costing` subscriber can do, immediately on
commit.** Any production account whose plan is `costing` and which is currently
entitled loses the ability to record sales the moment the transaction commits.
That is the intended product change, but it is a live behavioural change, not
schema-only. Signup assigns `trial` by default and `trial` includes Sales, so
accounts created through the product are unaffected. `PRE_DEPLOY_0049.sql`
check 18 enumerates every plan and its subscriber count **before** you commit —
read that row and confirm it says what you expect.

**R2 — the rollback window closes at the first claimed slot.** `0049_rollback.sql`
refuses to run once any `founder_slots.claimed_at` is set, because dropping the
table would destroy the record of who holds founding pricing. Immediately after
step 2 nothing is claimed and rollback is byte-faithful. It stops being available
as soon as the first founder subscribes.

**R3 — the project is on the Supabase Free plan: no PITR and no scheduled
backups.** The rollback script is the recovery path. This is unchanged from
0034–0048 and is a reason to run the rollback rehearsal, not a reason to skip
0049.

**R4 — the local replica is `C.UTF-8`, production is `en_US.UTF-8`.** All
fingerprints here are `COLLATE "C"` and type-name based specifically so they do
not vary with collation, and this replica reproduces production's published 0048
value exactly. Residual risk is low but not zero: `PRE_DEPLOY_0049.sql` check 1
fails closed against it.

**R5 — no Paystack plan codes exist.** `provider_plan_code` is `null` on all
five plan rows including the two new founding ones. 0049 does not need them; a
checkout does. Nothing can be charged until they exist.

**R6 — the frontend does not yet reflect the split.** After 0049 a Costing-only
account still sees the Sales navigation and will hit an RLS refusal on writing.
The enforcement is correct and unbypassable, but the experience is an error
message rather than an explanation. This is the next piece of work and it is
frontend-only.

**R7 — dependency on judgement about 116.** The preflight, the self-check and
`tests/018` all encode 116 as production's policy count. It was 116 at 0033 and
is still 116 at 0048, verified twice. If anything changes production's policy
count between now and execution, 0049 refuses to start rather than guessing.

## 10. Recommended production execution method

**`psql --single-transaction` over the Session Pooler. Not the SQL Editor —
0049 will refuse it.**

1. `PRE_DEPLOY_0049.sql` — paste into the SQL Editor. Read-only, single SELECT.
   Expect **18 rows, all PASS**. Any FAIL stops the deployment. Read check 18.
2. From your own machine, using the Session Pooler connection string from
   Dashboard → Project Settings → Database:
   ```
   psql "<session-pooler connection string>" \
        --single-transaction -v ON_ERROR_STOP=1 \
        -f migrations/proposed/0049_billing_tiers_and_founders.sql
   ```
   Success is one line: `NOTICE: 0049 OK: 13 Sales write policies gated, …`.
   Anything else means it rolled back and production is still at 0048.
3. `POST_VERIFY_0049.sql` — paste into the SQL Editor. Expect **20 rows, all
   PASS**.
4. Only if step 3 fails: `0049_rollback.sql`, same psql invocation.

Never paste the connection string, the database password, the `service_role`
key or the Paystack secret into this chat.

## 11. Exact prerequisites still missing

**P1 — the Session Pooler connection string (BLOCKING).** 0049 cannot be applied
without it, and the guard means there is no SQL-Editor fallback. You obtain it
yourself from the Supabase dashboard and use it on your own machine; it is never
shared with me. This is the one prerequisite standing between "rehearsed" and
"executable".

**P2 — owner approval.** Not given. Nothing has been pushed or run.

**P3 — a decision on R1.** Confirm, from `PRE_DEPLOY_0049.sql` check 18, that no
production account is on `costing` and would lose Sales on commit.

**P4 — Paystack plans (not blocking for 0049).** Four plan codes must exist and
be written to `plans.provider_plan_code` before anything can be charged. That is
checkout work and is deliberately outside this migration.

**P5 — the frontend tier split (not blocking for 0049).** R6.

---

## Gate verdict

The database entitlement foundation is **proven**: the two tiers are genuinely
different in RLS, the first hundred is a data invariant that survives a 180-way
race, the migration is atomic under the recommended executor and refuses the
wrong one, the rollback is byte-faithful, and 0049 causes zero regressions
across every existing suite.

**Awaiting explicit owner approval. Nothing pushed. Nothing deployed. Checkout
and Paystack implementation not begun.**
