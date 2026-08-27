# D-20 — CHECKOUT AND THE FIRST PAYMENT

**RULED 27 Aug 2026 — Option A. DESIGN ONLY.** Nothing created, no RLS altered,
no billing function changed, no Paystack transaction initialized, no deployment.

> **Menu Master NG owns the commercial quote. Paystack owns payment collection.**

**A browser redirect is not proof of payment.** The callback renders a status
page and grants nothing. Entitlement is granted only through the approved billing
state machine, from a signature-verified event or the reconciliation sweep.

---

## 1. What the frontend may say, and what it may never decide

The client sends **a selection**: which plan, which interval. It is never
authoritative for the amount, the currency, founding eligibility, slot
availability, the pricing tier, the Paystack plan code, or entitlement. Each is
resolved server-side from our own data.

The practical test: **a hostile client that posts `amount: 100` and
`tier: founding` gets exactly the same quote as an honest one**, because neither
field is read. The client's message is "Costing, monthly" and nothing more.

## 2. `checkout_quotes` — reconciled against what already exists

The instruction was not to duplicate a fact an authoritative foreign key already
provides. Reconciling against `plan_prices` (§7.2 of `PRICE_MODEL_RULINGS.md`)
removes most of the proposed columns:

**`plan_prices` is already effective-dated and append-only.** A price change
**inserts** a row and closes the old one; it never rewrites an amount. So a
foreign key to `plan_price_id` *is* the immutable snapshot of what was offered —
plan, tier, interval, gross amount, currency and provider plan code all resolve
through it, and a later price change cannot reach backwards through it. Copying
those six values into the quote would create a second source of truth for facts
that are already frozen.

```
checkout_quotes
  id                       uuid primary key
  account_id               uuid not null references accounts(id)
  plan_price_id            uuid not null references plan_prices(id)
        -- carries plan, tier, interval, amount, currency, provider plan code,
        --   all immutable by plan_prices' append-only discipline

  intent                   text not null    -- 'new_subscription' | 'trial_conversion'
                                            -- | 'recovery'
  checkout_reference       text not null unique      -- ours, deterministic
  provider_reference       text                      -- Paystack's, when known
  provider_access_code     text

  founding_slots_remaining_at_quote  int     -- evidence, never authority

  status                   text not null    -- 'open' | 'initialized' | 'consumed'
                                            -- | 'expired' | 'voided'
  created_at, initialized_at, expires_at, consumed_at, voided_at
  void_reason              text

  unique (account_id) where status in ('open','initialized')
```

### 2.1 Why this is a sibling of `upgrade_quotes` and not the same table

They differ structurally, not cosmetically. A checkout quote's amount **is** a
`plan_prices` row. An upgrade quote's amount is **computed** — the prorated
difference — and cannot be a foreign key to anything; it needs a literal amount
plus the two price ids it was derived from, so the arithmetic stays auditable.
Forcing both into one table would mean a nullable amount whose meaning depends on
a `kind` column, which is how a table stops telling the truth.

### 2.2 Immutability

Once initialization succeeds, no commercially significant field changes. There is
nothing to enforce with triggers on most of them — they are a foreign key to an
immutable row. `status` and the timestamps advance; nothing else moves.

A material change before payment — plan, interval, eligibility, tier — **voids
and reissues**. The old quote keeps its reference, its `void_reason` and its
history, so "what were they offered, and when did that change?" stays answerable.

### 2.3 Repeated clicks

`unique (account_id) where status in ('open','initialized')` means a second click
**returns the existing quote and access code**, not a new one. Two Paystack
transactions for one intent is a duplicate-payment risk, and the constraint is
what makes it unreachable rather than unlikely.

## 3. Expiry — duration deliberately not chosen

Quotes must expire. **No duration is set here**, because none has been approved
elsewhere and inventing one would be exactly the kind of unratified constant this
project has refused throughout.

It is also not a free choice: **our expiry must be reconciled with the lifetime
of Paystack's own hosted checkout link** (`access_code`), which is unverified —
**V-6**. A quote outliving the link leaves a customer with a dead page and a live
quote blocking their retry; a quote expiring first leaves a payable link with no
quote behind it, which the reconciliation path would then have to treat as an
unattributed payment. Recorded as **D-22**.

**Expiry consumes nothing.** A quote never touches `founding_slot_allocations`,
so an abandoned checkout cannot burn a founding number — the property that
disqualified Option C back when the race was first ruled.

## 4. Founding customers — the race, and what must not happen

**A founding-price quote reserves nothing.** The slot is claimed only at the
approved successful-payment boundary. So customers 99 and 100 may both hold valid
founding quotes with one slot left, and that is legitimate rather than a bug.

If 100 pays first and 99 then pays on a still-valid founding quote:

- **Do not silently reinterpret the payment as standard.** The quote records what
  was offered, which is the entire reason it exists.
- **Do not pretend the anomaly did not occur.**
- Route it through the approved anomaly handling: honour the amount for the period
  paid, no Founding Member #101, no permanent founding entitlement, record the
  anomaly, next renewal at standard, tell the customer before that charge.

### 4.1 A consequence that reaches Paystack, and D-18

Customer 99 paid through the **founding** plan code. Paystack now holds a
recurring subscription that will renew at ₦3,500 **for ever** unless we act. So
the anomaly is not only a database record — it carries an unavoidable provider
consequence, and moving them to the standard code is an **increase in recurring
charge**, which D-18 forbids doing unattended.

**This is the concrete case where "never silently change the billing amount"
stops being a principle and becomes a workflow.** It needs the customer to act,
and what happens if they do not act before the renewal date is not yet decided —
raised as the next decision below.

## 5. Standard pricing — refuse before Paystack

If founding slots are exhausted and the applicable standard price is absent,
checkout **refuses before initialization** with a deterministic
`no_standard_price` error and a reconciliation item. No invented price, no
fallback to founding.

Timing worth being precise about: standard prices are not needed on day one,
because no slots are consumed at launch. They are needed **before the 100th
paying customer**, which — if the Founding 100 lands as intended — could be
weeks, not months. Treating D-2 as a launch gate is the safe reading.

## 6. Trial conversion — same path

One payment architecture, no second flow. `intent = 'trial_conversion'` is the
only difference at quote time, and the difference lands at the state machine:
**`trialing → active`** on the same subscription row, not a new lifecycle.

## 7. Security boundary

Hosted Paystack checkout. Menu Master NG never collects, proxies, logs or
persists raw card data. **Option C is not implemented and no reusable card
authorization is stored** — the D-17 ruling, unchanged. Secrets stay server-side,
in the Edge Function environment, as they are today.

`provider_access_code` is not a credential — it identifies a hosted page, not a
means of charging — but it is scoped to one quote and expires with it.

## 8. Idempotency — reusing what is already approved

No checkout-specific truth system. Each risk maps to a mechanism that already
exists:

| Risk | Mechanism |
|---|---|
| Repeated checkout clicks | `unique (account_id) where status in ('open','initialized')` — L4 |
| Repeated browser callbacks | **inert by design.** The callback grants nothing, so repeating it does nothing |
| Duplicate webhook delivery | `body_sha256` (verified live) and `provider_event_id` (built, never exercised against a real duplicate — still an open gap) |
| Repeated reconciliation runs | apply is effect-keyed: `where consumed_at is null` |
| Two founding slots | `pg_try_advisory_xact_lock` + `unique (slot_number) where state <> 'void'` + `unique (account_id) where state <> 'void'` — L1, L2, L4 |
| Duplicate subscription | `ux_subscriptions_account` already permits one row per account; a second successful payment finds the quote consumed and routes to reconciliation rather than creating anything |

## 9. Reconciliation against the rest of the design

| Touches | Effect |
|---|---|
| **`fn_billing_apply`** | resolves `charge.success` by **our** `checkout_reference` first, falling back to plan code. `0030`'s `unmapped_plan_code` refusal survives for events carrying neither. This also removes the last case where plan-code mapping alone had to identify what someone bought. |
| **State machine** | `trialing → active` and `cancelled → active` finally have a concrete trigger. **No new state; the four are unchanged.** |
| **Founding allocation** | unchanged — the claim still happens at the payment boundary, under the advisory lock. Quotes are evidence at that boundary, never a reservation. |
| **D-17 / `upgrade_quotes`** | same discipline, different amount source (§2.1). Both verify the amount against the quote before applying. |
| **Recovery (P-3)** | `intent = 'recovery'` reuses this path, so the dunning notice's link is an ordinary checkout quote. One flow, three intents. |
| **J6 reconciliation** | a `consumed` quote with no subscription movement, or an `initialized` quote long past expiry with a provider reference, are both sweep candidates. |
| **D-14 waiver** | untouched — a waived upgrade creates no quote at all, because there is no payment to collect. |

## 10. Open items this creates

| | Item |
|---|---|
| **D-21** | What happens when a renewal amount must **increase** and the customer has not authorised it — the founding-race anomaly (§4.1) and every lapsed founding member. **Next decision.** |
| **D-22** | Checkout quote expiry duration, reconciled with V-6. |
| **V-6** | Lifetime of a Paystack hosted checkout link / `access_code`. |
