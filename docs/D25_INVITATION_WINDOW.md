# D-25 — WRITE ACCESS DURING THE FOUNDING INVITATION WINDOW

**RULED 27 Aug 2026 — Option B, subject to D-3 classification. DESIGN ONLY.**
No trial updated, no reservation table created, no `0034` deployed, no Paystack
change, no invitation sent.

---

## 0. A correction to my own framing

I told you last turn that *"the moment `0034` deploys, `fn_account_is_entitled`
returns false and their write access stops."* **That is wrong as stated**, and the
correction matters because D-25 was framed around it.

The live function:

```sql
status IN ('trialing','active','past_due')
  OR (status = 'cancelled' AND current_period_end > now())
```

`trialing` is matched **on status alone — no date is consulted.** So an expired
trial is still entitled, today, indefinitely. And because the `trialing →
cancelled` transition needs a scheduler that does not exist, the row never leaves
`trialing` on its own.

Two consequences:

1. **The five accounts have write access right now** and will keep it after
   `0034` unless `0034` also bounds `trialing` by a date.
2. **The trial does not currently expire at all.** Not a D-25 issue — a live
   defect in the entitlement rule, and now the next decision (**D-26**).

D-25's ruling is unaffected: the extension is still the right mechanism. What
changes is the reason it is needed — it is not defending against a cut-off that
`0034` causes today, it is making the dates *true* before D-26 makes them
enforceable.

---

## 1. The ruling

Genuine external pre-launch users, **positively classified by the owner**, keep
write access for their 7-day invitation window, implemented as a deliberate
extension of their existing trial dates.

**Not created:** a new entitlement state · a branch in `fn_account_is_entitled` ·
permanent complimentary access · an exception in any scheduled job · a fabricated
subscription · a fabricated payment · an indefinite grace period.

**Not assumed:** that any of the five qualifies. Classification precedes
everything. Internal, owner, developer, administrative, QA, demonstration and
test accounts receive **no reservation, no invitation and no extension**, and can
never consume a founding slot.

## 2. `trial_ends_at` vs `current_period_end` — the semantic question

Your challenge was the right one, and it deserves an answer from the schema
rather than from convenience.

### 2.1 The approved meanings

| Field | Meaning | Authority |
|---|---|---|
| `trial_ends_at` | when the trial ends — and after conversion, **a historical fact, not live state** | `SUBSCRIPTION_STATE_MACHINE.md` §3.1, verbatim: *"left as-is — it is a historical fact, not live state"* |
| `current_period_end` | **the live boundary of the current entitlement period**, whatever its source | §3.1 sets it from Paystack on conversion; `0020` sets it to the trial end at signup |

**`0020` already writes both for a new trial** — `trial_ends_at` and
`current_period_end` are both `now() + 14 days`. That is deployed behaviour in
production, not a proposal. So `current_period_end` is *already* the live
boundary during a trial; treating it as a paid-only field would contradict the
code that created every existing row.

### 2.2 Therefore: setting both is correct, and is not an overload

A trial extension means **the trial genuinely ends later**. `trial_ends_at` moves
because the fact it records has changed. `current_period_end` moves because it is
the live boundary and the trial *is* the current period. Neither field is being
borrowed to mean something it does not mean.

**The decisive test you asked for.** Under the *current* function, updating
`current_period_end` on a `trialing` row **changes nothing** — the trialing branch
never reads it. So the update cannot be motivated by making the entitlement
function return true; it is motivated purely by the field's domain meaning. That
is the proof the update is principled rather than expedient.

### 2.3 The alternative, and why it is rejected

Using `trial_ends_at` alone as the trial's live boundary is internally coherent,
but it would require `0020` to stop writing `current_period_end` for trials, a
reconciliation of every existing row, and a status branch in **every** consumer
that reads the boundary — J2's finalisation, J3's grace, D-21's `boundary_at`,
§10's proration. One field meaning "the live boundary" for all statuses is worth
keeping.

## 3. One boundary, written three times

The reservation, the invitation and the extension must expire **at the same
instant**, so they are computed **once** as an absolute timestamp and written to
all three:

```
invitation_expires_at := <fixed absolute timestamp, 7 days from issue>

founding_slot_reservations.expires_at  := invitation_expires_at
notification payload "deadline"        := invitation_expires_at
subscriptions.trial_ends_at            := invitation_expires_at
subscriptions.current_period_end       := invitation_expires_at
```

They cannot drift, because there is one value. And each expires **by predicate**,
not by a job: entitlement reads `current_period_end > now()`, the reservation
reads `expires_at > now()`. **No cleanup job is required for correctness** — the
jobs stamp status for audit and nothing else, exactly as D-1 Rule 2 requires.

## 4. The production update, when it is eventually authorised

Not now. When it is:

| Requirement | How |
|---|---|
| Explicit owner authorisation | its own approval, separate from any migration |
| Exact account UUIDs | supplied by the owner **after** D-3 classification — never a `where` clause over account age or activity |
| Reason recorded | "D-24/D-25 pre-launch founding invitation" |
| Previous and new dates recorded | **see §4.1 — no mechanism exists today** |
| Only classified genuine external accounts | an explicit UUID list, nothing inferred |
| Idempotent | **an absolute literal timestamp, never `now() + interval '7 days'`** — a relative expression would extend the window again on every re-run |
| Never infers eligibility | the UUID list is the only selector |

Guarded additionally by `and status = 'trialing'`, so a re-run after someone has
converted cannot touch a paid subscription.

### 4.1 There is no audit mechanism for this yet

`subscriptions` has no history table; `subscription_changes` does not exist until
`0033`. So "record previous and new dates" is **not currently possible in the
database**. Two honest options, and the choice belongs with the sequencing:

- **run the update after `0033`**, so it is captured by the ordinary mechanism; or
- **record it in a committed runbook file** carrying the before and after values,
  which is how `C1`–`C5` were handled.

What must not happen is the update running with the audit requirement quietly
unmet.

## 5. `founding_slot_reservations` — constraints accepted

Every constraint holds, and each is met structurally rather than by convention:

| Constraint | Met by |
|---|---|
| reservations never count as founding members | they live in a different table; the member count reads `founding_slot_allocations` only |
| expired reservations are free **by predicate** | liveness is `status = 'held' AND expires_at > now()` — the cleanup job's status stamp is never consulted for correctness |
| payment converts through normal machinery | allocation is created by the ordinary payment path; the reservation is marked `claimed` and references the allocation |
| allocations stay payment-backed | nothing else creates one |
| `granting_payment_reference` never fabricated or NULL-special | it stays `not null` and real; a reservation has no such column to fill |
| cap remains exactly 100 | `check (slot_number between 1 and 100)` plus `unique (slot_number) where state <> 'void'` on allocations and `unique (slot_number) where status = 'held'` on reservations |
| concurrency cannot allocate a number twice | `pg_try_advisory_xact_lock` serialises allocation; both unique indexes hold even if a caller bypasses the function |

**A quote never reserves a founding slot.** That rule stays absolute — no
`checkout_quotes` column, no conditional, nothing to re-verify.

## 6. Register position

D-25 blocks the launch transition's ordering, not `0031`–`0033`. It depends on
D-3 classification, which depends on the owner-run query.

**D-7 (VAT) remains a launch-critical external dependency.** No Nigerian VAT
assumption is made anywhere in this design: `plan_prices.vat_rate` is NULL until
answered, and `vat_amount`/`net_amount` propagate NULL rather than zero. It is
the longest-lead item on the register and nothing else depends on it, so it
should run in parallel from now.
