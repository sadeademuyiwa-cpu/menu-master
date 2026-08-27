# D-1 — TIME-TRIGGERED SUBSCRIPTION WORK

**DESIGN ONLY. No migrations, no production code, no Paystack plans, no
production changes.** Recommendation for approval.

Depends on the verified provider facts in `docs/D13_PAYSTACK_RESEARCH.md` §7 —
in particular **P-3, Paystack does not retry failed subscription charges**, which
changes what a scheduler is *for*.

---

## 1. The governing principle

> **Lateness must never grant entitlement, and never remove it.**

Menu Master NG already has one instance of this idea and it has paid for itself
twice: `fn_account_is_entitled` derives entitlement from **status and date
together**, so a subscription can sit at `active` with a period end in the past
and the answer is still right. `SUBSCRIPTION_STATE_MACHINE.md` §1 chose that
precisely because nothing ran on a timer. R10 then added three billing intervals
and that rule needed **no change at all**.

The scheduler should not undo that. So every state that *can* be derived from
stored dates stays derived, and the scheduler's job is narrowed to the three
things that genuinely cannot be:

| | Category | Examples | If the scheduler is down for a day |
|---|---|---|---|
| **Derived** | entitlement; effective feature plan; founding-price eligibility | `fn_account_is_entitled`, `fn_effective_plan` | **Nothing is wrong.** Nobody gains what they did not pay for; nobody loses what they did. |
| **Stamped** | `price_entitlement_revoked_at`, `lapsed_at`, materialising `plan_id` after a boundary change, the `cancelled` transition | audit facts that must exist once, with a time | Audit is **late**, not wrong — and catch-up is automatic, because the jobs key on the effect, not on the run. |
| **Sent / executed** | notifications; provider commands (disable + create-at-boundary) | outbox | **Genuinely late.** This is the only category where a stopped scheduler has customer-visible consequences. |

Two derivations carry the weight and both are worth stating explicitly:

- **`fn_effective_plan(account_id)`** returns `scheduled_plan_id` once
  `scheduled_effective_at <= now()`, otherwise `plan_id`. A downgrade that the
  job has not yet materialised is *already* in force for feature purposes, so a
  late job cannot leave Costing + Sales switched on for a customer who dropped to
  Costing. The stored column catches up; the answer was never wrong.
- **Founding-price eligibility** is resolved at price-resolution time from the
  revocation stamp **and** the dates, not from the stamp alone. A late revocation
  therefore cannot cause someone to be quoted the founding price after lapsing.

This is what makes the choice of scheduler a **replaceable implementation
detail** rather than a load-bearing dependency — which is exactly what you want
for the one component the system has never had.

---

## 2. What P-3 changes

Paystack does not retry a failed subscription charge. The consequences are larger
than a footnote:

1. **The 7-day grace is a working window, not a waiting one.** Nothing recovers
   on its own. At day 7 the customer lapses in silence unless something acted.
2. **R8's notification stops being a courtesy and becomes the recovery
   mechanism.** "Your payment failed, here is how to fix it" *is* the dunning
   system. There is no other one.
3. **Recovery must be customer-present**, unless D-17 is opened up — a
   server-initiated retry needs `authorization_code`. A fresh checkout needs
   nothing stored, and per the owner's ruling the security boundary is not moved
   for convenience.

So the scheduler's most commercially important job is not state transitions. It
is **making sure a human is told, in time, while the account can still be
saved.**

---

## 3. Options

| | **A. `pg_cron`** | **B. Scheduled Edge Function** | **C. External (Vercel Cron / GH Actions)** |
|---|---|---|---|
| Runs where | inside Postgres | Supabase Deno runtime | third-party, over the public internet |
| Outbound HTTP | **no** (would need `pg_net`) | **yes**, native | **yes**, native |
| Transactional with our data | **yes** — the job *is* a transaction | no; a network hop away | no |
| New credential at rest | **none** | `service_role` key in function env | key in a third-party vendor **and** a public authenticated endpoint |
| New attack surface | none | reuses the boundary `paystack-webhook` already established | **a new internet-reachable trigger endpoint** |
| RLS posture | runs as `postgres` → `fn_is_service_context()` is **true**, same as a migration | service role | service role |
| Cold start / time limits | none | yes, both | yes |
| Failure visibility | needs our own audit table | needs our own audit table | best of the three out of the box |

**C is rejected on security grounds**, and that is not a close call: it requires
an authenticated public endpoint whose only purpose is to let an outside party
start privileged billing work, plus a credential in a fourth vendor. We have
spent this whole gate keeping the billing boundary narrow.

**B alone is rejected on correctness grounds**: the state work is transactional
database work sitting behind constraints, RLS and audit triggers, and putting a
network hop and a cold start in the middle of it buys nothing.

---

## 4. Recommendation — A as the engine, B as the only outbound arm, an outbox between

```
   pg_cron  --calls-->  SQL job functions  --write-->  outbox tables
                              |                              |
                    all state work, transactional            |
                    no network, no credentials               |
                                                             v
                                              scheduled Edge Function
                                              drains outbox -> email / Paystack
                                              records outcome back
```

Three properties this buys:

1. **The database never holds a provider credential and never makes a network
   call.** Everything that talks to Paystack stays in the same isolated Deno
   function that already handles the webhook.
2. **The network side is retryable and auditable**, because it reads a *durable
   queue* rather than reacting to an ephemeral trigger. A failed send is a row
   that is still there next time — the same discipline `billing_events` already
   applies inbound.
3. **The scheduler is swappable.** Every unit of work is a SQL function
   (`fn_billing_*`). If `pg_cron` turns out to be unavailable (**V-1**), the same
   functions are driven by a scheduled Edge Function calling one entrypoint, and
   nothing else in the design changes.

### 4.1 The jobs

| Job | Cadence | Does |
|---|---|---|
| `fn_billing_apply_boundaries()` | hourly | Applies scheduled plan/interval changes whose time has passed: materialises `plan_id` / `billing_interval`, clears `scheduled_*`, writes `subscription_changes`, enqueues the provider command. |
| `fn_billing_expire_grace()` | hourly | Subscriptions past `current_period_end + grace` with no successful renewal → transition to `cancelled`, revoke the founding price **once**, enqueue the founding-price-loss notice. |
| `fn_billing_scan_renewals()` | daily | Renewals due within the notice window that have **no** queued pre-renewal notification → enqueue one. Independent of any webhook (§4.3). |
| `fn_billing_reconcile()` | daily | Compares our period state against provider evidence; raises items, never overwrites (§4.4). |
| `fn_billing_retry_events()` | 15 min | Drains `billing_events` where `status = 'failed_transient'` and `next_retry_at <= now()`. **This closes the "no sweeper" gap already recorded against `0027`** — those columns exist today and nothing reads them. |
| outbox drainer | 5-15 min | Edge Function: sends notifications, executes provider commands, records the outcome. |

Cron is UTC; the business timezone is Africa/Lagos. Daily jobs at **00:15 UTC**
(01:15 Lagos) — after midnight locally, before the working day.

### 4.2 The eight required behaviours

| Requirement | How |
|---|---|
| **Scheduled downgrade at period end** | Derived immediately by `fn_effective_plan`; materialised by `fn_billing_apply_boundaries`; executed at the provider by disable + create-with-`start_date` (P-6), which needs no re-authorisation and no stored credential. |
| **Cancellation / non-renewal** | Already correct with no scheduler: `cancelled AND current_period_end > now()` retains entitlement to the paid-through date. The job only stamps and notifies. |
| **Failed-payment grace expiry** | `fn_billing_expire_grace`, hourly. Because of P-3 the *notifications* during grace are the substantive part — the expiry job is the last resort, not the mechanism. |
| **Entitlement revocation** | One-way and effect-keyed: `where price_entitlement_revoked_at is null`. Re-running stamps nothing. Eligibility is derived independently, so a late stamp is never a pricing error. |
| **Pre-renewal notifications** | `fn_billing_scan_renewals` plus the `invoice.create` fast path (§4.3). |
| **Founding-price lapse** | Same transaction as grace expiry, so the lapse and its revocation cannot diverge. Founding **status** and `slot_number` are untouched — permanent. |
| **Delayed or missing webhook** | `fn_billing_reconcile` (§4.4). |
| **Idempotency** | Four layers (§5). |

### 4.3 `invoice.create` — a fast path, never a dependency

P-4 gives us a provider event 3 days before each payment. Per your instruction the
state machine must not depend on receiving it, so **both paths run**:

- `invoice.create` arrives → enqueue the pre-renewal notice.
- `fn_billing_scan_renewals` independently finds renewals inside the notice
  window with nothing queued → enqueue.

Whichever gets there first wins; the other is a no-op, because the outbox's
natural dedup key (§5, L4) makes the second insert a conflict rather than a
duplicate. Losing every `invoice.create` Paystack sends would delay a notice by
at most one daily cycle. Receiving them all changes nothing about correctness.

### 4.4 Reconciliation — provider state is evidence, not authority

For each subscription whose `current_period_end` has passed while its status has
not moved, the drainer fetches the provider's view and compares it with ours.
Three outcomes, and only three:

| | |
|---|---|
| **Agree** | advance our period, recording `next_payment_date` as the evidence it came from |
| **Disagree** | write a reconciliation item. **Do not write.** A human resolves it. |
| **Unreachable** | retry later. Never assume, in either direction. |

This is the costing engine's rule applied to billing: where the data does not
support a conclusion, produce **no** conclusion rather than a plausible one.
Overwriting our period with theirs on a mismatch would be the billing equivalent
of substituting an industry-average price.

The sweep also surfaces two existing blind spots: `rejected` events, which today
hold only a body hash and sit outside the reconciliation queue, and events whose
signature verified but whose body would not parse.

---

## 5. Idempotency — four layers

| | Layer | Guarantees |
|---|---|---|
| **L1** | `pg_try_advisory_xact_lock(<job key>)` at the top of each job | Two overlapping runs cannot both proceed. **`try`, not the blocking form** — a slow run must not accumulate a queue of waiting copies behind it. |
| **L2** | **Effect-keyed predicates**, never run-keyed. `where price_entitlement_revoked_at is null`; `where scheduled_effective_at <= now() and scheduled_plan_id is not null` | A second run finds nothing to do. This is the layer that actually makes double-application impossible; the others are containment. |
| **L3** | `scheduled_job_runs (job_name, run_key)` **unique**, `run_key = date_trunc(<cadence>, now())` | A duplicate invocation for the same logical slot is *refused and recorded*, not silently tolerated. Also the audit trail: started, finished, rows affected, error. |
| **L4** | Outbox natural dedup key, unique — e.g. `(account_id, kind, subject_key)` where `subject_key` is the period end being notified about | The same notice cannot be queued twice whichever path queued it. This is what makes §4.3's belt-and-braces safe rather than noisy. |

The same technique the founding-slot allocator already uses — an advisory lock
for serialisation plus a unique constraint as the backstop that holds even if a
future caller bypasses the function.

**Provider commands need one more thing.** A duplicated create-subscription would
produce two live subscriptions for one customer, which is worse than a duplicated
email. The drainer must therefore (a) hold the outbox row's dedup key, and
(b) **check provider state before issuing**, not merely trust its own queue.
Whether Paystack offers an idempotency key on these endpoints is **V-2** — not
verified, and not to be assumed.

---

## 6. Observability

`v_billing_job_health`: last successful run per job, consecutive failures, outbox
depth, age of the oldest unsent item, count of open reconciliation items.

Stated plainly, because it has been recorded against this project before and is
still true: **a view is not an alert.** With P-3 in force, a stalled outbox means
customers silently lapsing. The operator alert path is part of D-9's scope, not a
later nicety.

---

## 7. What this needs before implementation

| | Item | Kind |
|---|---|---|
| **V-1** | **Is `pg_cron` available on our Supabase plan and project?** Supabase's documentation is also blocked by this environment's egress proxy, so I have not verified it. Settled read-only by `list_extensions` against the project, or from the dashboard's extensions list. | Verification. If absent, fall back to B driving the same SQL functions — no design change. |
| **V-2** | Does Paystack support an idempotency key on Create Subscription / Charge Authorization? | Verification. Affects §5's provider-command layer only. |
| **D-18** | **Does Menu Master NG commercially permit a plan switch with no customer interaction?** P-6 makes it *technically* possible. Proposed: **yes for a decrease** (with notice), **no for an increase** — an increase requires explicit confirmation, per the standing rule against changing a billing amount without authorisation. | Commercial decision. |
| **D-19** | Cadence: hourly for boundary work, or 15 minutes? | Minor; hourly proposed. Correctness does not depend on it (§1), only the lag between a boundary passing and its audit stamp. |
| **D-17** | Unchanged and **OPEN**. Narrowed to one flow (`D13` §7.4.D). Nothing in this design requires it to be opened. | Security decision. |

**Nothing here is blocked on D-17.** That is deliberate: the scheduler design
holds whichever way D-17 goes, because the only flow that would need a stored
credential — the one-off prorated charge — is not a scheduled job.
