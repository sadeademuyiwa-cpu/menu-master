# DEPLOYMENT RUNBOOK — 0051 (paid period + the Sales predicate)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.
> No production branch cutover. No Live Paystack switch. TEST mode throughout.

Expected starting state: **0050 applied**, 117 policies, 100 founder slots,
`fn_my_has_sales` absent.

## What changes, and what does not

| | |
|---|---|
| New function | `fn_my_has_sales()` — SECURITY **INVOKER**, adds no access; `fn_account_has_sales` underneath already refuses a non-member |
| Changed function | `fn_billing_apply` — derives the paid period when Paystack sends none |
| Tables, columns, policies | **none.** 117 before and after |
| Founder slots | untouched, still exactly 100 |
| Customer data | 0051 writes none. The **repair** is a separate, previewed step |

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0051.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0051_paid_period_and_sales_predicate.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0051.sql` | SQL Editor | no |
| 4 | `REPAIR_STALE_PAID_PERIOD.sql` *(preview)* | psql | **no** |
| 5 | `REPAIR_STALE_PAID_PERIOD.sql -v apply=yes` | psql | yes, one column |
| 6 | `VERIFY_REPAIR_0051.sql` | SQL Editor | no |
| — | `migrations/proposed/0051_rollback.sql` | psql, only if 3 fails | yes |

### Step 1 — preflight

Paste `deploy/runbook/PRE_DEPLOY_0051.sql` into the SQL Editor.
**Expect 12 rows, all PASS.**

Read rows 9 and 10 before going on. Row 9 names any paid subscription still
carrying its trial's end date — that is the fault, on your live data. Row 10
says whether there is a recorded `charge.success` with a `paid_at` to repair
*from*. If row 9 names a subscription and row 10 says `0`, stop and tell me:
the repair would have nothing to derive from, and it will correctly refuse.

### Step 2 — apply

```
psql "<session-pooler connection string>" \
     --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0051_paid_period_and_sales_predicate.sql
```

Success is one line:

```
NOTICE:  0051 OK: a paid charge now sets its own period, fn_my_has_sales added
for the interface, 117 policies unchanged, nothing new reachable by anon.
```

Both flags are required. 0051 carries the same transaction guard as 0049 and
0050 and **will refuse the SQL Editor** — verified.

### Step 3 — post-verify

Paste `deploy/runbook/POST_VERIFY_0051.sql`. **Rows 1–10 PASS.**

**Row 11 is INFO, not a failure.** It re-lists any subscription still on the
trial date. It is *expected* to still name your paid test account here: 0051
changes the code, and code changes do not reach back into rows already written.
That is what step 5 is for.

### Steps 4 and 5 — the repair

**It previews by default and writes nothing.** Run it that way first:

```
psql "<session-pooler connection string>" \
     --single-transaction -v ON_ERROR_STOP=1 \
     -f deploy/runbook/REPAIR_STALE_PAID_PERIOD.sql
```

It prints one row per candidate: the period end now, the `paid_at` Paystack
actually sent, and what the period end should be. It ends with
`PREVIEW ONLY -- nothing written.`

Check the middle column is the date you really paid. Then apply:

```
psql "<session-pooler connection string>" \
     --single-transaction -v ON_ERROR_STOP=1 -v apply=yes \
     -f deploy/runbook/REPAIR_STALE_PAID_PERIOD.sql
```

Expect `NOTICE: REPAIRED 1 subscription(s).` Running it again reports
`REPAIRED 0` — it is idempotent, and it re-checks the period end at write time
so nothing that moved in between is overwritten.

**What it will not do:** touch a subscription with no recorded `charge.success`
carrying a `paid_at`. A date with no evidence behind it is precisely the thing
being repaired, so it declines and says so.

### Step 6 — prove the repaired date came from the payment

Paste `deploy/runbook/VERIFY_REPAIR_0051.sql`. It puts the subscription's
period end beside Paystack's own `paid_at` from `billing_events`:

```
plan               paid_at      period end now   paid_at + 1 month   verdict
Founding Costing   2026-09-05   2026-10-05       2026-10-05          CORRECT -- derived from the real payment
```

`CORRECT` means the date was computed from the event, not from a default, a
guess, or the clock when the repair ran. The other verdicts are explicit:
`STILL STALE` (the trial end survived), `NO EVENT` (nothing to derive from), or
`DIFFERENT` (Paystack sent an explicit `next_payment_date`, which always wins).

## Rollback

`0051_rollback.sql`, same psql invocation. Byte-faithful back to 0050,
verified. It restores `fn_billing_apply` to its 0050 body captured from a real
0050 database, and drops `fn_my_has_sales`.

**Dates already repaired are NOT reverted.** The rollback changes code, never a
customer's period — and going back means the next `charge.success` will leave
the trial date in place again, which is the defect. Roll back only to escape a
worse problem.

## Rehearsal results (local replica)

| Item | Result |
|---|---|
| Applies clean on a fresh 0050 | yes |
| Atomicity | 2 injected failures, both left the schema byte-identical to 0050 |
| Wrong executor | refused before any object was touched |
| Rollback | byte-faithful to 0050 |
| `tests/037` | **14 / 14 PASS** |
| Regression, every suite at 0050 vs 0051 | **36 unchanged, 0 regressions** |
| Full gate end to end on a replica with the real stale condition | PRE 12/12 → apply → POST 10/10 + INFO → repair 1 → verify `CORRECT` |

## After this

The Sales lock needs **both** 0051 and a preview carrying commit `023b5a5` or
later. Until 0051 is applied, `fn_my_has_sales()` does not exist, the frontend
gets an error rather than a `false`, and it deliberately **fails open** — a
paying Costing + Sales customer must never be told they cannot sell because a
lookup failed. RLS refuses the write either way.
