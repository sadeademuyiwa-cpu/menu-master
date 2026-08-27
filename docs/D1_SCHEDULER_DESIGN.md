# D-1 — TIME-TRIGGERED SUBSCRIPTION WORK — IMPLEMENTATION-READY DESIGN

**DESIGN ONLY. No migrations, no production code, no Paystack plans, no
production changes.** Supersedes the D-1 outline of 27 Aug 2026.

Approved direction:
`Postgres/Supabase state → pg_cron → transactional SQL jobs → durable outbox →
Edge Function for provider operations`.

Rulings folded in: **D-17** customer-present checkout for prorated upgrades ·
**D-18** unattended changes allowed downward, never upward · **D-19** hourly, and
catch-up safe · **V-2** our own idempotency regardless of provider support.

---

## 1. Governing principle, and the two rules that implement it

> **Lateness must never grant entitlement, and must never remove legitimate
> entitlement.**

Two concrete rules carry it, and everything below obeys them:

**Rule 1 — due-or-overdue, never equals-now (D-19).** Every selection predicate
is `<= now()`. No job asks "what falls in this hour"; every job asks "what is due
or overdue and not yet done". A missed run is therefore recovered by the next run
with no catch-up mode, no backfill flag and no operator action.

**Rule 2 — the scheduler stamps and sends; it never decides entitlement.**
Entitlement, effective plan and founding-price eligibility are **derived** from
stored dates. The jobs materialise those derivations into columns for audit and
reporting, and they emit the side effects. If every job stopped forever, no
customer would gain access they had not paid for and none would lose access they
had.

### 1.1 A consequence that changed the design

Provider commands for a boundary change are dispatched **when the change is
requested, not when the boundary arrives.**

The earlier draft enqueued them at the boundary. That is wrong under Rule 1:
Paystack charges on `next_payment_date`, so a scheduler outage across the
boundary would let the **old** subscription renew at the **old** price — lateness
producing a wrong charge. Dispatching on request makes the commercial outcome
independent of any job running on time. The scheduler's role at the boundary
becomes: materialise our own state, notify, and **verify the provider did what we
asked**.

---

## 2. Objects this design assumes (not yet created)

| Object | Purpose |
|---|---|
| `scheduled_job_runs` | one row per logical run. `unique (job_name, run_key)`. Audit + L3 idempotency. |
| `notification_outbox` | customer-facing messages. `unique (dedupe_key)`. Freely retryable. |
| `provider_operations` | operations with a **provider-side or financial effect**. `unique (operation_key)`. Never freely retried — see §5. |
| `provider_operation_attempts` | one row per attempt: number, timestamps, outcome, provider reference, HTTP status, error code. **Never request/response bodies** — they carry credentials. |
| `reconciliation_items` | anything a human must resolve. Open/closed, with evidence. |
| `subscription_charges` | what a customer was actually charged: gross, VAT rate, VAT, net, period, provider reference (C-5). |
| `upgrade_quotes` | D-17's prorated quote: amount, price ids, period, expiry, state. |

The two outboxes are **deliberately separate**. A duplicated email is
embarrassing; a duplicated `create subscription` is two live subscriptions and
two charges. Mixing them into one table invites one retry policy for both.

---

## 3. The jobs

All cadences are pg_cron, UTC. Daily jobs at 00:15 UTC (01:15 Africa/Lagos).
Every job opens with `pg_try_advisory_xact_lock(<stable key>)` — the **try**
form, so a slow run never accumulates waiting copies — and processes each row in
its **own subtransaction**, so one poisoned row cannot block every other
customer.

### J1 · `fn_billing_apply_boundaries` — scheduled downgrade / interval change

| | |
|---|---|
| **Cadence** | hourly |
| **Selects** | `subscriptions where scheduled_plan_price_id is not null and scheduled_effective_at <= now()` |
| **Writes** | `subscriptions`: materialise `plan_id`, `billing_interval`, `price_tier`, `billing_plan_price_id`; clear `scheduled_*`. `subscription_changes`: one append-only row. |
| **Idempotency key** | L2 does the work — clearing `scheduled_*` in the same transaction means a second run selects nothing. L3 run key `('apply_boundaries', date_trunc('hour', now()))`. `subscription_changes` carries `unique (subscription_id, effective_at, change_kind)`. |
| **Retry** | none needed — next hourly run re-selects anything left. |
| **On failure** | per-row subtransaction rolls back that row only; error into `scheduled_job_runs.error` and a `reconciliation_item`; batch continues. |
| **Outbox** | `notification_outbox`: *plan change now in effect*. |
| **Edge Function** | **none at this point.** The provider command was dispatched at request time (§1.1). |
| **Reconciliation** | asserts the provider subscription matches the new plan; mismatch raises an item, never a write. |

**Nothing here is load-bearing for entitlement.** `fn_effective_plan()` already
returns the scheduled plan once its time has passed, so a J1 outage cannot leave
Costing + Sales switched on for someone who dropped to Costing.

### J2 · `fn_billing_finalise_nonrenewal` — cancellation at boundary

| | |
|---|---|
| **Cadence** | hourly |
| **Selects** | `status = 'cancelled' and current_period_end <= now() and finalised_at is null` |
| **Writes** | `subscriptions.finalised_at`. **Status is already `cancelled`** — set the moment the customer cancelled, per the state machine. Nothing about access changes here. |
| **Idempotency key** | `finalised_at is null` (L2); L3 hourly run key. |
| **Retry / failure** | as J1. |
| **Outbox** | *your access has ended*, plus the export-your-data reminder — reads are never gated, so this is factual, not a threat. |
| **Edge Function** | none. Paystack emits `subscription.disable` at the same boundary on its own. |
| **Reconciliation** | if Paystack still shows the subscription active past the boundary, raise — **do not** cancel it silently. |

### J3 · `fn_billing_expire_grace` — failed-payment grace expiry

| | |
|---|---|
| **Cadence** | hourly |
| **Selects** | `status = 'past_due' and current_period_end + interval '7 days' <= now()` and no successful charge covering the period |
| **Writes** | `subscriptions.status → 'cancelled'`, `lapsed_at`. |
| **Idempotency key** | the predicate stops matching once status moves (L2); L3 hourly. |
| **Retry / failure** | as J1. |
| **Outbox** | *subscription lapsed*, with re-subscribe path. |
| **Edge Function** | none. |
| **Reconciliation** | before lapsing, the most recent provider evidence must not show a successful payment. If it does, **do not lapse** — raise. Removing entitlement on stale data is the exact failure Rule 2 forbids. |

**With P-3 in force this job is the last resort, not the mechanism.** Paystack
does not retry, so the substantive work is J5's dunning notices during the seven
days. If those do not go out, this job simply lapses people in silence.

### J4 · `fn_billing_revoke_lapsed_founding_prices` — founding-price lapse

| | |
|---|---|
| **Cadence** | hourly, immediately after J3 |
| **Selects** | `founding_members f join subscriptions s using (account_id) where f.price_entitlement_revoked_at is null and not <entitlement continuity holds>` |
| **Writes** | `price_entitlement_revoked_at`, `revoke_reason`, `lapsed_at`. **Never** `slot_number`, `granted_at` or the row itself. |
| **Idempotency key** | `price_entitlement_revoked_at is null` — the stamp is **one-way** by construction, so a second run and a second lapse both change nothing. |
| **Retry / failure** | as J1. |
| **Outbox** | *founding price ended*, naming the standard price that now applies. |
| **Edge Function** | none. |
| **Reconciliation** | eligibility is **also** derived at price-resolution time from the dates, so a late stamp can never cause a founding quote after a lapse. |

**"Entitlement revocation" is not a job.** Entitlement is derived; there is
nothing to revoke. What is scheduled is the *stamping of the audit fact* and the
*notification*. That distinction is the whole of Rule 2.

### J5 · `fn_billing_scan_notices` — pre-renewal and dunning notices

| | |
|---|---|
| **Cadence** | daily 00:15 UTC (dunning reminders re-evaluated each run) |
| **Selects** | (a) renewals due within the notice window with nothing queued; (b) `past_due` accounts at day 0 / 3 / 6 of grace with that day's notice not queued; (c) any subscription whose next amount **differs** from the last charged amount |
| **Writes** | nothing in `subscriptions`. Notices only. |
| **Idempotency key** | `notification_outbox.dedupe_key = (account_id, kind, subject_key)` where `subject_key` is the period end and, for dunning, the day index. |
| **Retry / failure** | as J1; the notice is re-queued next run if the insert never landed. |
| **Outbox** | pre-renewal notice; dunning notices; **renewal-amount-changed notice** — the one the founding-race anomaly and every lapsed founder require. |
| **Edge Function** | drainer sends. |
| **Reconciliation** | `invoice.create` is a **fast path only** (§4.3 of the prior draft, retained): whichever path queues first wins, the other conflicts on the dedupe key. Losing every `invoice.create` delays a notice by at most one daily cycle. |

### J6 · `fn_billing_reconcile` — provider reconciliation

| | |
|---|---|
| **Cadence** | daily |
| **Selects** | subscriptions whose `current_period_end` has passed while status has not moved; `provider_operations` in `unknown` or long `in_flight`; `billing_events` in `rejected` |
| **Writes** | **enqueues probes only.** The job itself writes no subscription state. |
| **Idempotency key** | one open probe per subject: `unique (kind, subject_key) where status = 'open'`. |
| **Retry** | probes follow §5's backoff. |
| **On failure** | provider unreachable → leave open, retry. **Never** assume, in either direction. |
| **Outbox** | `provider_operations` of kind `probe_subscription`. |
| **Edge Function** | fetches the subscription and returns `status` + `next_payment_date` as evidence. |
| **Reconciliation** | the asymmetry in §4. |

### J7 · `fn_billing_retry_events` — inbound webhook recovery

| | |
|---|---|
| **Cadence** | 15 minutes |
| **Selects** | `billing_events where status = 'failed_transient' and next_retry_at <= now()` |
| **Writes** | re-invokes apply; updates `status`, `attempts`, `next_retry_at`. |
| **Idempotency key** | apply is already effect-keyed; `body_sha256` and `provider_event_id` remain the redelivery keys. |
| **Retry** | §5 backoff; terminal at `failed_permanent` + reconciliation item. |
| **Outbox** | none. |
| **Edge Function** | none — this is pure database work. |

**This closes a gap already on the record**: `0027` created `attempts` and
`next_retry_at` in production and nothing has ever read them.

### J8 · outbox drainer — Edge Function

| | |
|---|---|
| **Cadence** | 15 minutes (pg_cron may also trigger it; it is safe to run concurrently with itself only under §5's claim) |
| **Selects** | `notification_outbox` and `provider_operations` where `status in ('pending','failed_transient') and next_attempt_at <= now()`, claimed with `for update skip locked` |
| **Writes** | attempt rows; terminal status; `provider_reference` on success. |
| **Idempotency** | §5, all five mechanisms. |
| **Failure after the database commits** | see §6, scenario 2 — this is the case the whole design is shaped around. |

---

## 4. Reconciliation — the asymmetry that implements Rule 2

Provider state is **evidence, not authority**. But "never write on a mismatch"
is too blunt, and it fails the second half of the governing principle. The rule
is asymmetric, deliberately:

| Evidence says | Action |
|---|---|
| Provider is **ahead** in a way consistent with a renewal we missed — active, `next_payment_date` beyond our `current_period_end` | **Accept it.** Advance our period, record the evidence and the provider reference, and log a `reconciliation_item` marked auto-resolved so it stays visible. |
| Provider **contradicts** us in a way that would **remove** entitlement — shows cancelled/attention while we show active, or a period end earlier than ours | **Never write.** Raise for a human. |
| Provider **unreachable** | retry. Assume nothing. |

The asymmetry is the point: **evidence may extend entitlement automatically; it
may never withdraw it automatically.** A missed webhook then costs a customer
nothing, and a misread or stale provider response can never cut off someone who
has paid. This is the same instinct as the costing engine's refusal to invent a
price — except that here, refusing to act has a direction, and the safe direction
is toward the customer.

---

## 5. Idempotency — five mechanisms, ours not the provider's (V-2)

Paystack's idempotency support is **not verified** — its documentation is
unreachable from this environment — and per your ruling it is treated as an
*additional* protection if present, never as our only one.

| | Mechanism | Applies to |
|---|---|---|
| **L1** | `pg_try_advisory_xact_lock(job key)` | every job |
| **L2** | **effect-keyed predicates** — `where … is null`, `where scheduled_* is not null`. The layer that actually makes double-application impossible | every job |
| **L3** | `unique (job_name, run_key)` in `scheduled_job_runs`, `run_key = date_trunc(cadence, now())` | every job |
| **L4** | `unique (dedupe_key)` on notifications; `unique (operation_key)` on provider operations | outbox |
| **L5** | **reconcile-before-retry** on any operation that can create a provider resource or move money | `provider_operations` only |

### Deterministic operation keys

Derived from **state**, never from run time, so the same logical operation
computes the same key however many times it is generated:

```
downgrade at boundary   sub:<subscription_id>:boundary:<period_end>:to:<plan_price_id>
cancellation            sub:<subscription_id>:cancel:<period_end>
upgrade proration       sub:<subscription_id>:upgrade:<quote_id>
probe                   sub:<subscription_id>:probe:<period_end>
```

`unique (operation_key)` means a second generation is a conflict, not a duplicate
charge.

### Retry policy

| | Attempts | Backoff | Terminal |
|---|---|---|---|
| Notifications | 8 | 1m, 5m, 15m, 1h, 4h, 12h, 24h, 24h | `failed_permanent` + reconciliation item |
| Provider operations | **3**, each preceded by L5 | 2m, 15m, 2h | `needs_human` + reconciliation item + operator alert |

Provider operations get **fewer** automatic attempts on purpose. The cost of a
human looking at a stuck subscription change is trivially lower than the cost of
an automated system creating a second one.

### L5, in detail

Before **any** attempt after the first on a resource-creating or money-moving
operation, the drainer queries the provider for whether the effect already
exists — a subscription on the target plan with the expected start date, or a
transaction bearing our deterministic reference. Only if it is absent does it
issue. If present, it records the provider reference and closes the operation as
**succeeded**, not as skipped, because it did.

---

## 6. What happens when things go wrong

| # | Scenario | Outcome |
|---|---|---|
| **1** | **pg_cron stops for 6 hours** | Nothing breaks. Predicates are due-or-overdue, so the next run picks up everything with no catch-up mode. Entitlement and effective plan are derived, so no access is wrongly granted or removed. Audit stamps and notices are up to 6h late; against a 3-day pre-renewal window that is absorbed. Grace expiry is up to 6h late, which errs **toward** the customer. Boundary provider commands are unaffected — they were dispatched at request time (§1.1). |
| **2** | **Edge Function fails after the database commits** | The commit is the durable **intent**; the Edge Function is at-least-once delivery over it. The row is still `pending`/`in_flight` with an attempt record, and the next drain retries. The dangerous sub-case — Paystack succeeded but the function died before recording — is exactly what **L5** exists for: the next attempt reconciles first, finds the resource, records its reference, and closes the operation as succeeded. Without L5 this case is a double charge. |
| **3** | **Paystack succeeds, our webhook is delayed** | Harmless. `active` with a passed `current_period_end` is still entitled until grace expiry, and grace (7 days) vastly exceeds any realistic delivery delay. When the event lands, apply is effect-keyed and the period advances. |
| **4** | **Paystack succeeds, the webhook never arrives** | J6 selects the subscription (period passed, status unmoved), enqueues a probe, and the drainer fetches the truth. Provider is ahead and consistent with a renewal → **auto-accept** per §4, recording the evidence. The customer never notices. A `reconciliation_item` marked auto-resolved records that a webhook was lost, so a pattern of them is visible rather than invisible. |
| **5** | **The same webhook arrives twice** | Already solved in production: `body_sha256` is the exact-redelivery key and is verified live; `provider_event_id` is the second layer — **built but never exercised against a real duplicate**, which remains an open gap, not a claim. Apply itself is effect-keyed, so even a double-apply is a no-op. |
| **6** | **The same scheduler job executes twice** | L1 stops the second from proceeding; L3 refuses and records the duplicate slot; L2 means that even if both got through, the second selects nothing. Three independent reasons, any one sufficient. |
| **7** | **An outbox item is delivered twice** | Notifications: L4 prevents double-queueing and `delivered_at` prevents re-send, so a duplicate requires a genuine send-then-crash — an embarrassing email, no state damage. Provider operations: L4 plus L5 mean a duplicate delivery finds the effect already present and records it rather than repeating it. |
| **8** | **Customer downgrades, then changes their mind before period end** | Local state: clear `scheduled_*` — trivial. Provider state is the real work, because the commands were already dispatched (§1.1): the pending new subscription must be cancelled and the original one re-enabled. That is a **revert operation** with its own deterministic key, not an undo. **V-3: whether Paystack permits enabling a subscription that has emitted `not_renew` but not yet disabled is unverified.** If it does not, the revert is a fresh subscription on the original plan with `start_date` at the boundary — which works, and is what the design should assume until verified. |
| **9** | **Customer upgrades while a downgrade is already scheduled** | Compositionally: the upgrade must clear the pending downgrade *and* revert its provider commands, then dispatch new ones for the upgraded plan. **MVP proposal: refuse the upgrade while a downgrade is pending**, telling the customer to cancel the downgrade first. One extra click on a rare path, against a provider-state sequence with several failure modes. Recorded as a deliberate MVP limitation, not an oversight; the compose path is post-launch. |
| **10** | **Renewal payment fails and Paystack performs no retry (P-3)** | `invoice.payment_failed` → `past_due`, `current_period_end` **not** advanced, entitlement retained. J5 queues the day-0 recovery notice with a checkout link, then day-3 and day-6 reminders. **The notice is the dunning system** — nothing else will act. Recovery is customer-present checkout. Two facts this design must state plainly: (a) recovery is **re-subscription, not resumption** — the failed subscription does not resume itself; (b) founding-price continuity keys on **our** entitlement continuity, not on provider subscription identity, so a customer who recovers on day 5 keeps their founding price even though the provider subscription is technically new. Getting (b) wrong would silently strip founding pricing from every customer who ever recovered from a failed card. |

---

## 7. D-17 — prorated upgrade, customer-present

Approved: customer-present checkout; no reusable payment credential is stored;
the existing security boundary is unchanged, and
`BILLING_INTEGRATION_DESIGN.md` §7 stands **unamended**.

```
1. customer requests immediate upgrade
2. system computes the prorated amount   (PRICE_MODEL_RULINGS.md §10)
3. if below the provider minimum -> WAIVE: grant the upgrade, write the audit
   record (calculated amount, waived amount, reason, provider, timestamp), stop.
4. otherwise create an `upgrade_quote`: amount, both price ids, the period it was
   computed against, a deterministic reference, an expiry
5. customer completes Paystack checkout for that exact amount
6. charge.success arrives bearing our reference -> verify against the provider,
   then check the amount matches the quote EXACTLY
7. apply: plan_id flips, subscription_changes written, subscription_charges
   written, provider commands dispatched to move the recurring plan at boundary
```

**Failure or abandonment changes nothing.** The quote expires; the subscription,
the plan and the entitlement are exactly as they were. There is no partial state,
because nothing is applied before step 6.

Four guards, each closing a real hole:

| Guard | Closes |
|---|---|
| **Quote expiry** | a stale quote paid weeks later at a proration that no longer reflects the unused period |
| **Exact-amount match** | a customer paying a different amount and receiving the upgrade anyway |
| **One open quote per subscription** | two quotes paid, one upgrade, one unexplained payment |
| **Void if the period or plan changed** | a quote computed against a period that has since renewed |

Note the reuse: the checkout this needs is the **same** customer-present checkout
that P-3 forces for failed-payment recovery. One flow, two uses, no credential.

---

## 8. D-18 — what may happen unattended

| Transition | Unattended? |
|---|---|
| Downgrade at the paid-period boundary | **allowed** — customer-requested, decreases commitment |
| Cancellation / non-renewal at boundary | **allowed** |
| Same-price administrative transition | **allowed only where no financial disadvantage exists**, and the check is explicit, not assumed |
| Anything increasing the recurring charge | **customer authorisation required** |

P-6 makes an unattended increase *technically* possible. It is prohibited here
anyway. Technical capability is not commercial permission, and this table is the
place that distinction is enforced.

---

## 9. V-1 — VERIFIED, 27 Aug 2026

Owner-run read-only query against the production project
(`select name, default_version, installed_version from pg_available_extensions
where name in ('pg_cron','pg_net')`):

| name | default_version | installed_version |
|---|---|---|
| `pg_cron` | **1.6.4** | **NULL** |
| `pg_net` | **0.20.4** | **NULL** |

**Both available. Neither installed.** This is the preferred outcome: `pg_cron`
can be adopted, and nothing has been enabled behind our backs.

Three consequences for `0036`:

1. **`create extension pg_cron` is a real production change** and needs its own
   explicit authorisation when the time comes. It is not covered by approving
   this design.
2. **`pg_net` stays off, deliberately.** It is available, and availability is not
   a reason. Enabling it would let Postgres make outbound calls, which is exactly
   the boundary that keeps provider credentials out of the database. The Edge
   Function is the only thing that talks to Paystack. If a future migration ever
   proposes `pg_net`, that is a security decision, not a convenience.
3. **Two Supabase-specific details must be confirmed at migration time rather
   than assumed**: which schema `pg_cron` installs into, and which database its
   jobs execute against. Both are checkable in the same transaction that creates
   the extension, and `0036`'s preflight should refuse rather than guess.

### The fallback, now unused but retained

Had `pg_cron` been unavailable: one scheduled Edge Function, hourly, whose entire
body is `select fn_billing_tick();` calling J1-J7 in order, plus the drainer.
Same jobs, same predicates, same idempotency, same failure behaviour — a strictly
worse trigger for an unchanged design. Retained because it is also the **disaster
fallback** if `pg_cron` ever has to be dropped, and because it is the reason
every unit of work in §3 is a SQL function rather than inline SQL.

## A. Final recommendation

Adopt `pg_cron` → transactional SQL jobs → durable outbox → Edge Function, with:

- **Rule 1 (due-or-overdue) and Rule 2 (derive, don't decide)** as invariants that
  every job must satisfy, stated in each migration header;
- **provider commands dispatched at request time**, not at the boundary, so a
  scheduler outage can never cause a wrong charge;
- **asymmetric reconciliation** — evidence may extend entitlement automatically,
  never withdraw it;
- **five idempotency layers**, ours, with provider idempotency treated as a bonus
  if V-2 ever confirms it;
- **two separate outboxes**, because a duplicate email and a duplicate
  subscription are not the same risk;
- **customer-present checkout** for both prorated upgrades and failed-payment
  recovery — one flow, two uses, no stored credential.

**V-1 is verified and clears** (§9): `pg_cron` 1.6.4 available, not installed.
The recommendation therefore stands **unchanged** — verification confirmed the
trigger and changed nothing about the design, which is what it was supposed to
do. `pg_net` 0.20.4 is also available and is deliberately **not** adopted.

## B. Remaining decisions, ranked

### BLOCKER — implementation cannot start

**All prior blockers are now ruled.** What remains is owner-run verification
(D-3's query), external verification (D-7, U-3/U-4/U-5, V-3/V-4/V-5), commercial
values (D-2, D-8), and the newly-raised D-20.

| | Item |
|---|---|
| **D-3** | Grace when `current_period_end` is NULL. Proposed: stay entitled, raise an item. Decides the entitlement predicate and J3's guard. |
| **D-5 / D-6** | The Level 2 boundary, and whether 1/1/3 businesses, 2/3/10 users, 20/∞/∞ recipes is the packaging you intend to sell. Nothing in the repository defines what `level = 2` unlocks. |
| **D-9** | **RULED — email + WhatsApp**, provider-agnostic. `docs/D9_NOTIFICATION_ARCHITECTURE.md`. Remaining lead-time work (sender domain verification, Meta template approval) runs **in parallel** and gates launch, not migrations. |

### BEFORE LAUNCH — build can start, launch cannot happen

| | Item |
|---|---|
| **D-7** | VAT treatment, confirmed by a Nigerian tax adviser. Schema is NULL-safe; no charge may be taken until it is answered. |
| **D-2** | Six standard prices. A standard row is an INSERT — no migration changes. Blocks customer 101 and every lapsed founder's renewal. |
| **D-8** | Twelve Paystack plan codes, created and paired. |
| **U-3 / U-4 / U-5** | Hard NGN minimum; whether `quarterly`/`annually` advance exactly 3 and 12 calendar months; exact refund/chargeback event names. Values, not shapes — but U-4 wrong means the reconciliation sweep raises false discrepancies against every subscriber. |
| **V-3** | Whether Paystack can re-enable a subscription that has emitted `not_renew`. Decides whether scenario 8's revert is an enable or a fresh subscription. |

### DEFERRABLE

| | Item |
|---|---|
| **V-2** | Paystack idempotency support. We build our own regardless; confirmation would only add a layer. |
| **Scenario 9** | Upgrade-while-downgrade-pending. Refused at MVP, composed post-launch. |
| **D-15** | Combined plan-and-interval change in one action. Refused at MVP; both single paths exist. |
| **D-16** | Refusing upgrades while `past_due`. Proposed default, reversible. |
| — | Trial recipe-21 behaviour; the `monthly_equivalent` reporting view. |

## C. Migration sequence, once authorised

Each row names what gates it. Nothing in `0001`–`0030` is modified.

| | Migration | Contents | Gated by |
|---|---|---|---|
| **0031** | Pricing foundation — `billing_intervals` (with `months`, `provider_interval`), `plan_prices` on the triple, drop `plans.provider_plan_code` + its index (verified NULL at migration time), retire `plans.monthly_price` from read paths, repoint the ingest resolution from a plan id to the triple | D-13 ✓ · seed needs D-8 |
| **0032** | `founding_slot_allocations` (append-only ledger), the two partial unique indexes, `fn_claim_founding_slot` under the advisory lock with lowest-unused allocation, and D-4's provisional/confirmed/void states | D-4 ✓ |
| **0033** | Subscription state — `billing_interval`, `price_tier`, `billing_plan_price_id`, `scheduled_*`, `finalised_at`; `fn_effective_plan`; `subscription_changes` | 0031, 0032 |
| **0034** | Entitlement and grace — replace `fn_account_is_entitled` with the 7-day bound; NULL-period-end handling; update `tests/018` check 3 and `tests/019` check 10 for the changed rule, and add grace-expiry checks | **D-3** |
| **0035** | Money record — `subscription_charges` with gross/rate/VAT/net, period and provider reference (closes C-5) | D-7 for values, not for shape |
| **0036** | Scheduler core — `scheduled_job_runs`, `provider_operations`, `provider_operation_attempts`, `reconciliation_items`, J1–J7, `v_billing_job_health`, and the pg_cron schedules | V-1 ✓ · needs separate authorisation for `create extension pg_cron` |
| **0037** | Notification model (D-9) — `notification_channels`, `notification_types`, `account_contacts`, `communication_consents`, `notification_outbox`, `notification_attempts`, and the gap-item path. **Split out of `0036`**, which grew too large once D-9 was ruled; the two are separately reviewable and separately reversible | D-9 ✓ |
| **0038** | Plan-limit enforcement (R7) — businesses, users, recipes, and the `level` boundary actually enforced server-side | **D-5 / D-6** |
| **0039** | Upgrade proration — `upgrade_quotes`, quote/verify/apply, and D-14's waiver record | D-17 ✓ |

Then, outside migrations: create the twelve Paystack plans, seed
`plan_prices.provider_plan_code`, deploy the drainer, and run the D-9 email
integration. **None of that is authorised by this document.**

---

**STOPPING HERE for approval.** Nothing above has been implemented.
