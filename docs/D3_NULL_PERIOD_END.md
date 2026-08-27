# D-3 — MISSING `current_period_end`

**RULED 27 Aug 2026 — A + D together. DESIGN ONLY, NOT IMPLEMENTED.**
Verification query in §5 has **not** been run — this environment has no route to
the production database (§5.1).

> **Governing principle (owner):** missing internal billing data must never
> automatically withdraw entitlement from a customer who may legitimately have
> paid — but the system must prevent new non-trial subscription states from being
> created without the period data needed to evaluate entitlement correctly.

---

## 1. Why this is not hypothetical

The function `0028` installed, now referenced by 60 write policies across 23
tables:

```sql
status IN ('trialing','active','past_due')
  OR (status = 'cancelled' AND current_period_end > now())
```

With a NULL period end its two branches behave **differently, and nobody decided
that**:

| Row | Evaluates | Effect |
|---|---|---|
| `past_due`, `current_period_end` NULL | first branch true on status alone | **entitled** — fails open |
| `cancelled`, `current_period_end` NULL | `NULL > now()` → NULL → false | **not entitled** — fails closed |

Adding R4's grace bound turns the first branch into
`status = 'past_due' AND current_period_end + 7 days > now()`, which with a NULL
evaluates to NULL → **not entitled**. So implementing the grace bound would
**silently flip `past_due` + NULL from entitled to locked out**, inside a
migration approved for an entirely different purpose. That is the whole reason
D-3 had to be ruled rather than defaulted.

---

## 2. A — fail open on read

The tolerance is written as an **explicit branch**, never left to fall out of
operator precedence, and carries a comment saying what it is:

```sql
-- ANOMALY TOLERANCE, NOT A VALID STATE.
-- A NULL period end means our data is incomplete, not that the customer stopped
-- paying. Withdrawing entitlement here would punish a customer for our gap.
-- Every row matching this branch has an open reconciliation obligation.
```

### 2.1 The `cancelled` branch — one reading to confirm

The ruling names `active`, `past_due` "or otherwise entitlement-bearing". A
`cancelled` row with a NULL period end **may** still hold paid time — we cannot
tell, which is exactly the condition the principle addresses. Reading the
principle literally, it should **also** fail open, which would change today's
behaviour.

**This is recorded as a reading, not as a ruled decision.** It makes the function
consistent for the first time, and consistency here means one rule — *missing
data never withdraws* — rather than two accidental ones. **Confirm before
`0034`.**

### 2.2 The durable obligation

Every NULL-period row raises a `reconciliation_items` row of kind
`null_period_end`, idempotently — `unique (kind, subject_key) where status =
'open'`, so re-evaluation never multiplies items. It carries the subscription,
the account, the status, and when it was first seen.

### 2.3 Why there is deliberately **no** automatic expiry on the tolerance

"Fail-open must not become permanent free entitlement" is the right worry, and
the wrong fix would be an automatic cut-off after N days. That would reintroduce
**automatic withdrawal on missing data** — the precise thing the ruling
forbids — just with a delay.

The guarantee is instead: **visible, aged, and owned.** `v_billing_job_health`
carries the count of open `null_period_end` items and the age of the oldest, so
an unresolved anomaly is a number someone is looking at, not a quiet grant. Once
authoritative evidence establishes the period, the anomaly closes and normal
entitlement rules resume with no special case.

### 2.4 J3 must not lapse what it cannot evaluate

Grace expiry selects on `current_period_end + interval '7 days' <= now()`, which
is NULL-safe by construction — a NULL never satisfies it. That is correct and
should be **stated in the migration header as intentional**, so a later
"simplification" to `coalesce(current_period_end, created_at)` is recognised for
what it would be: manufacturing a date in order to cut someone off.

---

## 3. D — refuse invalid writes

Two layers, because the function boundary alone is not enough.

**Layer 1 — the transition boundary.** `fn_set_subscription_plan` refuses to
write any status other than `trialing` without the period dates the state machine
requires, with a distinct error code, in the same style as §3.5's refusal of an
unrecognised status.

**Layer 2 — the database.** Once §5 confirms no violating rows exist:

```sql
alter table subscriptions
  add constraint ck_subscriptions_period_present
  check (status = 'trialing' or current_period_end is not null);
```

Layer 2 is what makes "cannot be bypassed accidentally" **true rather than
aspirational**. A CHECK constraint binds `service_role`, a support fix, a webhook
handler, a scheduled job and application code identically. A function-level guard
binds only callers who use the function.

**No date is ever manufactured.** Where provider evidence is absent, the write is
refused and reconciled — never filled with `now()`, the trial end, or a guess.
That is the same rule the costing engine applies to a missing ingredient price.

---

## 4. What this changes

| | |
|---|---|
| `fn_account_is_entitled` | replaced in place — signature unchanged, so **none of the 60 policies is touched**; gains the explicit NULL branch and (pending §2.1) a consistent `cancelled` branch |
| `tests/018`, `tests/019` | NULL-period cases added for each status; existing checks 3 and 10 already need updating for the grace bound |
| J3 | header states the NULL-safety as intentional |
| `fn_set_subscription_plan` | new refusal + error code |
| `subscriptions` | new CHECK, **after** §5 verifies |
| `reconciliation_items` | new kind `null_period_end` |
| `v_billing_job_health` | open count + oldest age |

Blocks **`0034`** and J3's guard in `0036`. `0031`–`0033` are unaffected.

---

## 5. Read-only verification — NOT YET RUN

```sql
-- D-3 verification. READ ONLY. Selects only; modifies nothing.
with s as (
  select id, account_id, plan_id, status, trial_ends_at,
         current_period_end, provider_ref, created_at
    from subscriptions
),
ev as (
  select b.account_id,
         count(*) filter (where b.signature_valid)              as signed_events,
         max(b.received_at)                                     as last_event_at,
         max(b.payload #>> '{data,subscription,next_payment_date}') as np_sub,
         max(b.payload #>> '{data,next_payment_date}')              as np_top
    from billing_events b
   group by b.account_id
)
select
  (select count(*) from s)                                  as total_subscriptions,
  (select count(*) from s where current_period_end is null) as null_period_rows,
  s.id                                                      as subscription_id,
  s.account_id,
  s.status,
  s.plan_id,
  s.current_period_end,
  s.trial_ends_at,
  s.provider_ref,
  coalesce(ev.signed_events, 0)                             as signed_provider_events,
  coalesce(ev.np_sub, ev.np_top)                            as provider_next_payment_date,
  case
    when s.current_period_end is not null                        then 'ok'
    when s.status = 'trialing' and s.trial_ends_at is not null   then 'derivable_from_trial'
    when coalesce(ev.np_sub, ev.np_top) is not null              then 'derivable_from_provider_event'
    when s.provider_ref is not null                              then 'needs_provider_fetch'
    else                                                              'no_evidence_manual'
  end                                                       as evidence
from s
left join ev on ev.account_id = s.account_id
order by (s.current_period_end is null) desc, s.created_at;
```

### 5.1 Why it has not been run here

This container has never had a route to the production database: the Supabase MCP
server is not connected in this session, no Supabase CLI is installed, the repo
carries no project link, and there is no connection string or credential in the
environment. Consistent with the standing instruction not to touch the production
project, every production query in this build has been owner-run.

### 5.2 How to read the result

| `evidence` | Meaning | Backfill |
|---|---|---|
| `ok` | period end present | none |
| `derivable_from_trial` | `trialing` with a trial end — the period end **is** the trial end, and `0020` sets both | derive; not a guess |
| `derivable_from_provider_event` | a stored signed event carries `next_payment_date` | derive from that event, citing it |
| `needs_provider_fetch` | we hold `provider_ref` but no stored date | fetch from Paystack as evidence before writing |
| `no_evidence_manual` | nothing to derive from | **never invent.** Fail open, keep the reconciliation item, resolve by hand |

**`null_period_rows = 0` → no backfill, and `0034` may add the CHECK directly.**
Any other result means the CHECK waits until those rows are resolved by evidence,
and the migration must verify zero violations at execution time rather than trust
this reading.
