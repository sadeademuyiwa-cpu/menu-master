# D-24 — THE EXISTING PRODUCTION ACCOUNTS

**RULED 27 Aug 2026 — B-via-A with classification first. DESIGN ONLY.**
No migration, no production data change, no Paystack change, no job, no
notification. **The five accounts are not modified, and have not been read.**

> **Founding 100 = the first 100 eligible *paying* businesses — not the first 100
> database accounts.** An internal or test account can never consume a number. An
> invited pre-launch user who never pays can never permanently consume one. Only a
> successful eligible founding payment converts a slot into an allocation.

---

## 1. Classification comes first, and it is not mine to make

An account is not entitled to founding status because it exists. Two classes:

1. **genuine external pre-launch users** — priority access to the Founding 100;
2. **owner, developer, administrative, demonstration, QA or test accounts** —
   **never** consume a founding slot.

**I cannot classify these accounts, and should not try.** No query distinguishes
"the founder's own test tenant" from "a caterer in Ikeja" — the data looks
identical. §5 surfaces the activity signals; the classification is the owner's,
and this document records it once supplied.

---

## 2. Reservation is not allocation

A reservation is **temporary first-refusal priority over a founding number**. It
is explicitly **not** a subscription, an allocation, an entitlement, a payment, or
permission to keep using paid functionality.

```
Invitation issued → reservation HELD (7 days)
        │
        ├── successful qualifying payment → allocation created by the existing
        │      founding machinery; reservation CLAIMED
        │
        └── window expires → reservation RELEASED; the number returns to the
               public pool with nothing consumed
```

## 3. Why the existing quote machinery cannot carry this

Reconciled before proposing anything, as instructed. It cannot, for two
independent reasons:

**First, timing.** A reservation exists from the moment the invitation is issued.
The invited user has not chosen a plan or an interval, so no quote exists yet —
`checkout_quotes` requires a `plan_price_id`. A reservation must outlive the
absence of a quote.

**Second, and decisive: it would break an absolute rule into a conditional one.**
Today "a quote never reserves a slot" is checkable by inspection — no code path
from `checkout_quotes` touches allocation. Adding a `reserved_slot_number` column
would turn that into "a quote never reserves a slot *unless* this column is set",
and a rule with an exception is a rule that has to be re-verified every time
somebody touches the table. **The public rule must stay absolute**, so the
reservation lives somewhere else entirely.

```
founding_slot_reservations
  id                    uuid primary key
  slot_number           int not null check (between 1 and 100)
  account_id            uuid not null references accounts(id)
  reason                text not null        -- 'pre_launch_priority'
  reserved_at           timestamptz not null
  expires_at            timestamptz not null
  status                text not null        -- 'held' | 'claimed' | 'expired'
                                             -- | 'released'
  claimed_allocation_id uuid references founding_slot_allocations(id)
  released_at, release_reason

  unique (slot_number) where status = 'held'
  unique (account_id)  where status = 'held'
```

**`founding_slot_allocations` is untouched.** No payment reference is fabricated,
no NULL is given a special meaning, and `granting_payment_reference` stays
`not null` and real. An allocation is still created only by a payment.

## 4. Reconciliation — four findings, no contradiction

### 4.1 Capacity accounting extends; the cap does not move

Allocation changes from *"lowest number in 1..100 not held by a non-void
allocation"* to:

```
lowest N in 1..100 such that
    no non-void allocation holds N
AND no LIVE reservation holds N
```

Still under the same advisory lock, still backstopped by the same unique indexes.
A held reservation temporarily withholds a number from the public — which is the
entire intent — while never counting as a founding member.

### 4.2 Expiry must be **derived**, not job-dependent (D-1, Rule 2)

The liveness test is `status = 'held' AND expires_at > now()`, **not**
`status = 'held'`. So a reservation that has actually expired stops blocking the
public number **immediately**, whether or not the job that stamps
`status = 'expired'` has run.

Had it been status-only, a scheduler outage would have blocked real paying
customers from numbers nobody holds — lateness removing something. The stamping
job remains, for audit; correctness does not wait for it.

### 4.3 Founding eligibility must consult the reservation (D-20)

An invited user's checkout resolves the founding tier if **either** they hold a
live reservation **or** an unreserved number is free. Without the first clause,
five invited users would be quoted standard prices the moment the public filled
the other 95 — the exact outcome the reservation exists to prevent.

### 4.4 Notification (D-9)

Two types to add: **founding invitation** and **invitation expiring**. Both
email, and the invitation also on WhatsApp where consent and a verified number
exist — it is time-boxed and consequential, which is what the WhatsApp channel is
for. Copy states plainly: paid access is starting; they have priority because
they were genuine pre-launch users; the position is held **7 days**; they must
subscribe to claim it; if they do not, it is released and normal rules apply.

**No contradiction found** with D-1, D-20, D-21, the founding invariants,
entitlement, trial expiry or the launch transition, subject to §6.

## 5. Verification — NOT RUN

I have **not** read these accounts. This environment has no route to the
production database: no Supabase MCP connection in this session, no CLI, no
project link, no credential. Read-only, owner-run:

```sql
-- D-3 + D-24 verification. READ ONLY. Selects only; modifies nothing.
-- Returns NO names, emails or phone numbers: identity stays out of the output.
with s as (
  select id, account_id, plan_id, status, trial_ends_at,
         current_period_end, provider_ref, created_at
    from subscriptions
),
ev as (
  select b.account_id,
         count(*) filter (where b.signature_valid)                  as signed_events,
         count(*) filter (where b.signature_valid
                            and b.event_type = 'charge.success')     as successful_charges,
         max(b.payload #>> '{data,subscription,next_payment_date}')  as np_sub,
         max(b.payload #>> '{data,next_payment_date}')               as np_top
    from billing_events b
   group by b.account_id
),
act as (
  select a.id as account_id,
         (select count(*) from businesses  b where b.account_id = a.id) as businesses,
         (select count(*) from memberships m where m.account_id = a.id) as users,
         (select count(*) from recipes     r where r.account_id = a.id) as recipes,
         (select count(*) from ingredients i where i.account_id = a.id) as ingredients
    from accounts a
)
select
  (select count(*) from s)                                   as total_subscriptions,
  (select count(*) from s where current_period_end is null)  as null_period_rows,
  s.account_id,
  s.status,
  s.plan_id,
  s.created_at::date                                         as account_created,
  s.trial_ends_at,
  s.current_period_end,
  (s.trial_ends_at < now())                                  as trial_expired,
  coalesce(ev.successful_charges, 0)                         as real_payments,
  coalesce(ev.signed_events, 0)                              as signed_events,
  act.businesses, act.users, act.recipes, act.ingredients,
  case
    when s.current_period_end is not null                        then 'ok'
    when s.status = 'trialing' and s.trial_ends_at is not null   then 'derivable_from_trial'
    when coalesce(ev.np_sub, ev.np_top) is not null              then 'derivable_from_provider_event'
    when s.provider_ref is not null                              then 'needs_provider_fetch'
    else                                                              'no_evidence_manual'
  end                                                        as d3_evidence
from s
left join ev  on ev.account_id  = s.account_id
left join act on act.account_id = s.account_id
order by s.created_at;
```

It answers D-3 and D-24 in one pass and returns **no personal data** — account
UUIDs and activity counts only. Map UUID to identity privately and report back
**classifications**, not identities.

### 5.1 The table to be filled in, once classified

| Account | Class | Sub state | Trial expired | Real payments | Activity | D-24 outcome |
|---|---|---|---|---|---|---|
| *(pending)* | | | | | | |

Reading guide: **`real_payments = 0` is expected for all five** — no charge has
ever reached production, which is consistent with `plans.monthly_price` being
₦0.00 throughout. Low `businesses`/`recipes`/`ingredients` counts alongside an
early `account_created` suggest an internal tenant; substantive catalogue and
recipe activity suggests a genuine user. **Suggestive only. The owner decides.**

## 6. The open sub-question this creates

**Do the invited accounts keep write access during their 7-day window?**

Their trials expired long ago, so the moment `0034` deploys,
`fn_account_is_entitled` returns false and their **write access stops** — reads
survive, per the permanent rule. That is not silent, but it *is* simultaneous
with the invitation, which sits awkwardly against "do not terminate without
communication": they would be invited to subscribe on the same day the product
stops accepting their work.

Raised as **D-25**, not assumed. It is a genuine commercial judgement and there
is no defensible default.
