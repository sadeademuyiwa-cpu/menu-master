# DEPLOYMENT RUNBOOK — 0049 (billing tiers, founding pricing, entitlement split)

> ## ⛔ NOT AUTHORISED. NOTHING HERE HAS BEEN RUN AGAINST PRODUCTION.
>
> This is the rehearsed package awaiting the owner's explicit approval. Every
> result quoted below comes from the local production-faithful replica.

Production starting state this package expects: **migration 0048**, PostgreSQL
17.6.1.155, project `mgbrrrjxbufstsjrdoug`, function-catalogue fingerprint
`e24f3871788893cafd1fc17c70fe41d5`, **116 RLS policies**, 7 login accounts.

## What changes

| | |
|---|---|
| New tables | `founder_slots` (exactly 100 rows), `founding_price_policy` |
| New columns | `plans.tier`, `plans.price_tier`, `plans.price_kobo`; `subscriptions.price_kobo`, `.provider_customer_code`, `.provider_subscription_code`, `.cancel_at_period_end`, `.founding_price_active` |
| New plan rows | `founding_costing` (₦3,500 = 350000 kobo), `founding_trading` (₦7,500 = 750000 kobo) |
| New functions | `fn_account_has_sales`, `fn_claim_founder_slot`, `fn_confirm_founder_slot`, `fn_forfeit_founding_price` |
| Policies | 13 Sales **write** policies dropped and recreated with one extra conjunct; 1 new read-only policy on `founder_slots`. **116 → 117.** |
| Policies **not** touched | all 5 Sales **SELECT** policies, and the other 103 |
| Data | no existing row is updated or deleted. No `auth.users` row is read or written. |

`monthly_price` is left in place for display. `price_kobo` is the charging
authority, because Paystack transacts in integer kobo and integers have no
rounding.

## ⚠️ THE EXECUTOR IS PART OF THE PROCEDURE

**0049 must NOT be pasted into the Supabase SQL Editor.** The editor commits
every statement individually and stops at the first error — that is exactly how
this project's production database was left part-migrated once before.

0049's first executable statement is a guard that detects a non-transactional
executor and aborts before touching a single object. Rehearsed both ways:

* run under `psql --single-transaction` → applies, `0049 OK: …`
* run under autocommit → `ERROR: 0049 ABORT: this executor is not honouring
  transaction control`, schema fingerprint unchanged, `founder_slots` absent,
  `p_orders_insert` still present.

Without the guard, the same autocommit run left **68 catalogue differences**
behind, including `p_orders_insert` **dropped and not recreated** — orders
unwritable by anybody.

## Order of operations

| Order | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0049.sql` | SQL Editor (single SELECT) | **no** |
| 2 | `migrations/proposed/0049_billing_tiers_and_founders.sql` | **`psql --single-transaction` ONLY** | **yes — the only one** |
| 3 | `POST_VERIFY_0049.sql` | SQL Editor (single SELECT) | **no** |
| — | `migrations/proposed/0049_rollback.sql` | `psql`, only if step 3 fails | yes |

Expected: step 1 → **18 rows, all PASS**. Step 3 → **20 rows, all PASS**.

### Step 2, exactly

Get the connection string from **Supabase Dashboard → Project Settings →
Database → Connection string → Session pooler (port 5432)**. Run it from your
own machine. **Never paste that string, the password, or any key into our
chat.**

```
psql "<session-pooler connection string>" \
     --single-transaction \
     -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0049_billing_tiers_and_founders.sql
```

`--single-transaction` and `-v ON_ERROR_STOP=1` are both required. Success is
one line:

```
NOTICE:  0049 OK: 13 Sales write policies gated, 5 SELECT policies untouched,
100 founder slots seeded, the pre-existing 116 policies unchanged.
```

Anything else means the transaction rolled back and production is still at
0048 — proven four times over in rehearsal, see below.

### Rollback

`0049_rollback.sql` refuses to run if any founder slot has been **claimed**
(`claimed_at is not null`), because dropping the table would destroy the record
of who holds founding pricing. Immediately after step 2 no slot is claimed, so
the rollback window is open. It closes the moment the first founder subscribes.

## Rehearsal results (local replica, not production)

| Item | Result |
|---|---|
| 0049 md5 | `6640bc6c1ed71315b814af1b6af15776` |
| rollback md5 | `1cc293cad6870420ff808417559b789c` |
| Applies clean on a fresh 0048 | yes |
| Rollback fidelity | fingerprint after rollback **byte-identical** to a fresh 0048 (2445 lines) |
| Atomicity | failure injected at 4 points — after the new tables are seeded, after all columns/rows/slots, **with an RLS policy dropped and not yet recreated**, and one statement before COMMIT. All 4 fired; all 4 left the schema byte-identical to 0048 |
| Wrong executor | refused before any object was touched |
| New suite `tests/035` | **34 / 34 PASS** |
| Regression, every suite at 0048 vs 0049 | **34 suites identical, 0 regressions** |
| Founder concurrency | 180 claimants, 30 parallel OS processes, 100 slots: exactly **100 allocated, 80 refused, no seq issued twice, no account holding two** |

Raw output: `evidence/REHEARSAL_0049.txt`.

## What this deliberately does NOT do

No checkout. No Paystack call. No payment path. No live plan creation. 0049
builds the entitlement foundation only, so it can be proven while nobody is
able to pay.
