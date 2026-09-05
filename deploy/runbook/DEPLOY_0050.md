# DEPLOYMENT RUNBOOK — 0050 (checkout quote + the 0049 payment boundary)

> ## ⛔ NOT AUTHORISED. NOTHING HERE HAS BEEN RUN AGAINST PRODUCTION.

Expected starting state: **migration 0049 applied**, 117 RLS policies,
`fn_checkout_quote` absent.

## Why this exists

`fn_billing_apply` was written at 0029 and has never been told founder slots
exist. Today, when a founding customer pays, their slot stays **reserved** and
expires half an hour later. They paid ₦3,500 and are not recorded as a founder.
None of 0049's five `subscriptions` columns are written either, so the founding
price is never locked and we hold no provider subscription code — we could not
disable their subscription at Paystack if we had to.

That is not a missing feature. It is **a payment we take and do not honour**.

## What changes

| | |
|---|---|
| New functions | `fn_checkout_quote`, `fn_apply_billing_side_effects` |
| Changed function | `fn_billing_apply` — one added call, inside the existing exception frame |
| Tables, columns, policies | **none.** 117 policies before and after |
| Data | no existing row updated or deleted. No `auth.users` row read or written |
| `provider_plan_code` | **deliberately not set.** Entered by the operator once the four Paystack Plans exist — a plan code invented in a migration would be a guess about a live payment provider |

## ⚠️ Same executor rule as 0049

`psql --single-transaction -v ON_ERROR_STOP=1`. 0050 carries the same guard and
**will refuse the Supabase SQL Editor**, verified.

## Order of operations

| Order | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0050.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0050_checkout_and_billing_apply.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0050.sql` | SQL Editor | no |
| — | `migrations/proposed/0050_rollback.sql` | psql, only if 3 fails | yes |

```
psql "<session-pooler connection string>" \
     --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0050_checkout_and_billing_apply.sql
```

Success is one line: `NOTICE: 0050 OK: checkout quote added, billing apply now
confirms founder slots and writes the five 0049 fields, 117 policies unchanged,
nothing reachable from the browser.`

### Rollback, and when it stops being available

`0050_rollback.sql` restores `fn_billing_apply` to its 0029 body — captured
byte-for-byte from a database at 0049, not retyped — and drops the two new
functions. Verified byte-faithful.

**It refuses once any founder slot is confirmed**, verified:

```
ERROR: 0050 rollback REFUSED: 1 founder slot(s) are confirmed. Rolling back
would leave paid founders without the code that maintains their slot and price.
```

That is deliberate. After the first founder pays, 0050 is the only thing keeping
their slot and price correct, and removing it would strand them silently.

## Rehearsal results (local replica, not production)

| Item | Result |
|---|---|
| 0050 md5 | `59fe2693fabf7540026bebe80f83feeb` |
| rollback md5 | `5f24b4de7e552355acd3163ec6051bf0` |
| Applies clean on a fresh 0049 | yes |
| Rollback fidelity | byte-identical to a fresh 0049, 2512 lines |
| Atomicity | 3 injected failures, all fired, all left the schema byte-identical |
| Wrong executor | refused before any object was touched |
| New suite `tests/036` | **29 / 29 PASS** |
| Regression, every suite at 0049 vs 0050 | **35 unchanged, 0 regressions** |
| Edge function unit tests | **19 / 19 PASS** (10 webhook + 9 checkout) |
| Web unit tests | **34 / 34 PASS** |

Raw output: `evidence/REHEARSAL_0050.txt`.

## The application half

0050 is only the database. The rest ships as code and secrets:

- `supabase/functions/paystack-checkout/` — new. Verifies the caller's JWT,
  resolves their account with the service role, quotes through
  `fn_checkout_quote`, calls Paystack `/transaction/initialize`.
- `web/src/app/api/checkout/route.ts` — an authenticated proxy holding **no
  credential**.
- `web/src/app/(app)/subscribe/page.tsx` + `components/plan-chooser.tsx`
- `web/src/app/checkout/callback/page.tsx` — **grants nothing**.

Deployment procedure, TEST mode first: `PAYSTACK_TEST_MODE_SETUP.md`.
